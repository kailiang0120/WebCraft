// Minecraft-style sprite particles (smoke, flames, lava embers) and the "on fire" look of entities.
// Particles are camera-facing pixel-art squares drawn as GL points from a small sprite sheet.
// Flames and embers glow; smoke takes the light level of the spot it appeared in.
import * as THREE from 'three';
import { B, isLava } from './blocks.js';
import { atlasTexture, worldUniforms } from './materials.js';
import { tileIndex, tileUV, mkRand } from './textures.js';
import { CHUNK } from './constants.js';

const MAX = 3000;
const SHEET_COLS = 16; // 8x8 sprites in a 128x8 sheet
const FLAME = 8, EMBER = 9;
const AMBIENT_RANGE = 24;

// ---------- sprite sheet ----------
function buildSheet() {
  const c = document.createElement('canvas');
  c.width = SHEET_COLS * 8;
  c.height = 8;
  const g = c.getContext('2d');
  const r = mkRand(77);
  const px = (sx, x, y, col) => { g.fillStyle = col; g.fillRect(sx * 8 + x, y, 1, 1); };
  // 0..7: puffs from a single pixel to a full rough circle (white, tinted per particle).
  for (let k = 0; k < 8; k++) {
    const rad = 0.6 + k * 0.5;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const d = Math.hypot(x + 0.5 - 4, y + 0.5 - 4);
        if (d > rad + (r() - 0.5) * 0.6) continue;
        const shade = 255 - Math.round(((x + y) / 14) * 70 + r() * 25);
        px(k, x, y, `rgb(${shade},${shade},${shade})`);
      }
    }
  }
  // 8: flame — a small teardrop, yellow core with an orange rim.
  const flame = ['...##...', '...##...', '..#OO#..', '..#OO#..', '.#OYYO#.', '.#OYYO#.', '.#OYYO#.', '..#OO#..'];
  const fc = { '#': '#e0601a', O: '#f8a830', Y: '#fff0a0' };
  flame.forEach((row, y) => [...row].forEach((ch, x) => { if (fc[ch]) px(FLAME, x, y, fc[ch]); }));
  // 9: lava ember — glowing blob.
  const ember = ['........', '..####..', '.#OOOO#.', '.#OYYO#.', '.#OYYO#.', '.#OOOO#.', '..####..', '........'];
  const ec = { '#': '#d04808', O: '#f88a18', Y: '#ffe070' };
  ember.forEach((row, y) => [...row].forEach((ch, x) => { if (ec[ch]) px(EMBER, x, y, ec[ch]); }));
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aFrame;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vFrame;
  varying vec3 vColor;
  varying float vDist;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFrame = aFrame;
    vColor = aColor;
    vDist = -mv.z;
    gl_PointSize = aSize * uScale / max(0.05, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  varying float vFrame;
  varying vec3 vColor;
  varying float vDist;
  void main() {
    vec2 uv = vec2((vFrame + gl_PointCoord.x) / ${SHEET_COLS.toFixed(1)}, 1.0 - gl_PointCoord.y);
    vec4 t = texture2D(map, uv);
    if (t.a < 0.5) discard;
    gl_FragColor = vec4(mix(t.rgb * vColor, uFogColor, smoothstep(uFogNear, uFogFar, vDist)), 1.0);
  }
`;

export class Fx {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.ambT = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.frame = new Float32Array(MAX);
    this.color = new Float32Array(MAX * 3);
    const dyn = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', dyn(this.pos, 3));
    geo.setAttribute('aSize', dyn(this.size, 1));
    geo.setAttribute('aFrame', dyn(this.frame, 1));
    geo.setAttribute('aColor', dyn(this.color, 3));
    geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: buildSheet() }, uScale: { value: 500 },
        uFogColor: worldUniforms.uFogColor, uFogNear: worldUniforms.uFogNear, uFogFar: worldUniforms.uFogFar,
      },
      vertexShader,
      fragmentShader,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    game.scene.add(this.points);

    // Fire wrapped around burning entities: a pool of camera-facing flame billboards.
    this.burnMat = new THREE.MeshBasicMaterial({ map: atlasTexture, alphaTest: 0.5, side: THREE.DoubleSide });
    this.burnGeoms = ['fire_0', 'fire_1'].map((name) => {
      const g = new THREE.PlaneGeometry(1, 1.4).translate(0, 0.7, 0);
      const [u0, v0, u1, v1] = tileUV(tileIndex(name));
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      return g;
    });
    this.burnGroup = new THREE.Group();
    game.scene.add(this.burnGroup);
    this.burnUsed = 0;
  }

  // ---------- spawning ----------
  add(type, x, y, z, vx, vy, vz, life, size, r, g, b) {
    if (this.list.length >= MAX) return null;
    const q = { type, x, y, z, vx, vy, vz, age: 0, life, size, r, g, b, frame: 0 };
    this.list.push(q);
    return q;
  }

  bright(x, y, z) {
    return Math.pow(0.8, 15 - this.game.lightLevel(x, y, z));
  }

  // Grey smoke that rises, slows and shrinks (large = the thick puffs over fire).
  smoke(x, y, z, large = false, shade = null) {
    const b = this.bright(x, y, z);
    const c = (shade ?? (large ? 0.12 + Math.random() * 0.15 : 0.25 + Math.random() * 0.25)) * b;
    this.add('smoke', x, y, z, (Math.random() - 0.5) * 0.3, large ? 0.6 : 0.3, (Math.random() - 0.5) * 0.3,
      (large ? 1.2 : 0.6) + Math.random() * (large ? 1.6 : 1.2), large ? 0.45 + Math.random() * 0.2 : 0.24, c, c, c);
  }

  flame(x, y, z, vx = 0, vy = 0, vz = 0) {
    this.add('flame', x, y, z, vx, vy + 0.08, vz, 0.5 + Math.random() * 0.7, 0.16 + Math.random() * 0.06, 1, 1, 1);
  }

  // Lava pop: a glowing blob hops out, falls, and trails smoke.
  ember(x, y, z) {
    const a = Math.random() * Math.PI * 2, s = 0.6 + Math.random() * 1.2;
    this.add('ember', x, y, z, Math.cos(a) * s, 3 + Math.random() * 4, Math.sin(a) * s,
      1 + Math.random() * 2, 0.18 + Math.random() * 0.12, 1, 1, 1);
  }

  sparks(x, y, z, n = 6) {
    for (let i = 0; i < n; i++) {
      this.add('ember', x, y, z, (Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3,
        0.3 + Math.random() * 0.4, 0.08 + Math.random() * 0.05, 1, 1, 1);
    }
  }

  // Puff of smoke when a fire is put out or lava hardens.
  puff(x, y, z, n = 8) {
    for (let i = 0; i < n; i++) this.smoke(x + Math.random(), y + Math.random() * 0.6, z + Math.random(), true, 0.45 + Math.random() * 0.2);
  }

  // ---------- per frame ----------
  update(dt, camera, viewportHeight) {
    const w = this.game.world;
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const q = L[i];
      q.age += dt;
      if (q.age >= q.life) { L[i] = L[L.length - 1]; L.pop(); continue; }
      const f = q.age / q.life;
      if (q.type === 'smoke') {
        q.vy += 0.9 * dt;
        const damp = Math.exp(-1.2 * dt);
        q.vx *= damp; q.vy *= damp; q.vz *= damp;
        q.frame = 7 - Math.floor(f * 8); // Minecraft smoke shrinks as it fades
      } else if (q.type === 'flame') {
        q.frame = FLAME;
        q.scale = 1 - f * f * 0.6;
      } else if (q.type === 'ember') {
        q.vy -= 14 * dt;
        q.frame = EMBER;
        q.scale = 1 - f * f;
        if (Math.random() < f * dt * 4) this.smoke(q.x, q.y, q.z);
        if (w.isSolid(Math.floor(q.x), Math.floor(q.y + q.vy * dt), Math.floor(q.z))) { q.vy = 0; q.vx *= 0.5; q.vz *= 0.5; }
      }
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    }
    const n = L.length;
    for (let i = 0; i < n; i++) {
      const q = L[i];
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
      this.size[i] = q.size * (q.scale ?? 1);
      this.frame[i] = q.frame;
      this.color[i * 3] = q.r; this.color[i * 3 + 1] = q.g; this.color[i * 3 + 2] = q.b;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    for (const k of ['position', 'aSize', 'aFrame', 'aColor']) {
      const a = geo.attributes[k];
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
    // Pixel size of one world unit at distance 1.
    this.material.uniforms.uScale.value = viewportHeight * camera.projectionMatrix.elements[5] * 0.5;
  }

  // ---------- ambient emitters (Minecraft's "random display ticks"), 20 times a second ----------
  ambient(dt) {
    this.ambT -= dt;
    if (this.ambT > 0) return;
    this.ambT += 0.05;
    if (this.ambT < 0) this.ambT = 0.05;
    const g = this.game, w = g.world, P = g.player.pos, snd = g.sound;
    const px = Math.floor(P.x), py = Math.floor(P.y), pz = Math.floor(P.z);
    const R2 = AMBIENT_RANGE * AMBIENT_RANGE;
    const cr = Math.ceil(AMBIENT_RANGE / CHUNK);
    let sounds = 0;
    const vol = (x, y, z) => Math.max(0, 1 - Math.hypot(x + 0.5 - P.x, y + 0.5 - P.y, z + 0.5 - P.z) / 20);
    for (let cz = (pz >> 4) - cr; cz <= (pz >> 4) + cr; cz++) {
      for (let cx = (px >> 4) - cr; cx <= (px >> 4) + cr; cx++) {
        const c = w.getChunk(cx, cz);
        if (!c || !c.torches.size) continue;
        for (const i of c.torches) {
          const x = cx * CHUNK + (i & 15), y = i >> 8, z = cz * CHUNK + ((i >> 4) & 15);
          const dx = x - px, dy = y - py, dz = z - pz;
          if (dx * dx + dy * dy + dz * dz > R2) continue;
          const id = c.blocks[i];
          const rnd = Math.random();
          if (id === B.TORCH) {
            if (rnd < 0.075) this.flame(x + 0.5, y + 0.72, z + 0.5);
            else if (rnd < 0.105) this.smoke(x + 0.5, y + 0.75, z + 0.5);
          } else if (id === B.FIRE) {
            if (rnd < 0.08) {
              this.smoke(x + Math.random(), y + 0.5 + Math.random() * 0.6, z + Math.random(), true);
              if (rnd < 0.03) this.smoke(x + Math.random(), y + 0.7 + Math.random() * 0.6, z + Math.random(), true);
            }
            if (Math.random() < 0.012 && sounds < 2) { snd.crackle(vol(x, y, z)); sounds++; }
          } else if (isLava(id)) {
            if (rnd < 0.0006 && w.getBlock(x, y + 1, z) === B.AIR) {
              this.ember(x + Math.random(), y + 0.9, z + Math.random());
              if (sounds < 2) { snd.lavaPop(vol(x, y, z)); sounds++; }
            } else if (rnd > 0.9994 && sounds < 2 && w.getBlock(x, y + 1, z) === B.AIR) { snd.lavaAmbient(vol(x, y, z)); sounds++; }
          }
        }
      }
    }
    // Lit furnaces: flames and smoke at the mouth, and a crackle now and then.
    for (const e of w.entities.values()) {
      if (!e.lit) continue;
      const [x, y, z] = e.pos;
      if ((x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2 > R2) continue;
      if (Math.random() < 0.12) {
        const n = [[1, 0], [-1, 0], null, null, [0, 1], [0, -1]][e.facing] || [0, 1];
        const along = (Math.random() - 0.5) * 0.6;
        const fx = x + 0.5 + n[0] * 0.52 + n[1] * along, fz = z + 0.5 + n[1] * 0.52 + n[0] * along;
        const fy = y + Math.random() * 0.4 + 0.1;
        this.flame(fx, fy, fz);
        this.smoke(fx, fy + 0.1, fz);
      }
      if (Math.random() < 0.01 && sounds < 2) { snd.crackle(vol(x, y, z) * 0.6); sounds++; }
    }
  }

  // ---------- burning entities ----------
  beginBurns() { this.burnUsed = 0; }

  // Stack flame billboards up an entity of width w and height h standing at (x, y, z).
  burn(x, y, z, w, h, cameraYaw) {
    const f = w * 1.4;
    const layers = Math.max(1, Math.round(h / (f * 0.8)));
    for (let k = 0; k < layers; k++) {
      let m = this.burnGroup.children[this.burnUsed];
      if (!m) { m = new THREE.Mesh(this.burnGeoms[0], this.burnMat); this.burnGroup.add(m); }
      this.burnUsed++;
      m.geometry = this.burnGeoms[k & 1];
      const s = f * (1 - k * 0.12);
      m.scale.set(s, s, s);
      const lift = layers > 1 ? (k / (layers - 1)) * Math.max(0, h - s * 1.1) : 0;
      // Drawn in front of the body (towards the camera), each layer a touch closer so they don't z-fight.
      const toCam = w * 0.55 + k * 0.04;
      m.position.set(x + Math.sin(cameraYaw) * toCam, y + lift, z + Math.cos(cameraYaw) * toCam);
      m.rotation.set(0, cameraYaw, 0);
      m.visible = true;
    }
  }

  endBurns() {
    const ch = this.burnGroup.children;
    for (let i = this.burnUsed; i < ch.length; i++) ch[i].visible = false;
  }

  dispose() {
    this.game.scene.remove(this.points);
    this.game.scene.remove(this.burnGroup);
    this.points.geometry.dispose();
    this.material.dispose();
    this.burnMat.dispose();
  }
}
