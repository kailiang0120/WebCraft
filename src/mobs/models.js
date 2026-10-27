// Box-model mobs with procedurally painted 16x16 face textures (own atlas).
import * as THREE from 'three';
import { Painter, hex, mul } from '../textures.js';

const COLS = 16;
const canvas = document.createElement('canvas');
canvas.width = canvas.height = COLS * 16;
const ctx = canvas.getContext('2d');
const tiles = new Map();

function tile(name, fn) {
  const i = tiles.size;
  const p = new Painter(5000 + i * 131);
  fn(p);
  ctx.putImageData(new ImageData(p.d, 16, 16), (i % COLS) * 16, Math.floor(i / COLS) * 16);
  tiles.set(name, i);
}

const eyes = (p, y, white = hex(0xffffff), pupil = hex(0x111111), inner = true) => {
  // Left eye: white then pupil toward centre; right eye mirrored.
  p.rect(2, y, 3, y + 1, white); p.rect(4, y, 5, y + 1, pupil);
  p.rect(10, y, 11, y + 1, pupil); p.rect(12, y, 13, y + 1, white);
  if (!inner) { p.rect(2, y, 5, y + 1, pupil); p.rect(10, y, 13, y + 1, pupil); }
};

// Passive mobs
tile('pig_skin', (p) => { p.fill(hex(0xf0a5a5), 0.04); p.speckle(14, hex(0xe08f8f), 0.03); });
tile('pig_face', (p) => { p.fill(hex(0xf0a5a5), 0.04); eyes(p, 6); });
tile('pig_snout', (p) => { p.fill(hex(0xe48a8a), 0.03); p.rect(3, 5, 5, 10, hex(0x8a3f3f)); p.rect(10, 5, 12, 10, hex(0x8a3f3f)); });
tile('cow_hide', (p) => {
  p.fill(hex(0x3d2b20), 0.06);
  for (let k = 0; k < 3; k++) {
    const cx = p.ri(16), cy = p.ri(16), r = 2 + p.r() * 3;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (Math.hypot(x - cx, y - cy) < r) p.set(x, y, p.v(hex(0xe6e6e6), 0.03));
  }
});
tile('cow_face', (p) => {
  p.fill(hex(0x3d2b20), 0.06);
  p.rect(6, 0, 9, 9, hex(0xe6e6e6), 0.03);
  eyes(p, 5);
  p.rect(3, 10, 12, 15, hex(0xbfa08e), 0.04);
  p.rect(5, 12, 6, 13, hex(0x4a3020)); p.rect(9, 12, 10, 13, hex(0x4a3020));
});
tile('cow_horn', (p) => p.fill(hex(0xd8d0c0), 0.03));
tile('wool', (p) => {
  p.fill(hex(0xececec), 0.03);
  for (let i = 0; i < 40; i++) p.set(p.ri(16), p.ri(16), p.v(hex(0xd2d2d2), 0.03));
});
tile('sheep_face', (p) => {
  p.fill(hex(0xd9c3a8), 0.04);
  for (let x = 0; x < 16; x++) for (let y = 0; y < 3; y++) p.set(x, y, p.v(hex(0xececec), 0.03));
  eyes(p, 6);
  p.rect(6, 11, 9, 12, hex(0xe5a0a0));
});
tile('sheep_skin', (p) => p.fill(hex(0xd9c3a8), 0.04));
tile('sheep_leg', (p) => {
  p.fill(hex(0xd9c3a8), 0.04);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) p.set(x, y, p.v(hex(0xececec), 0.03));
});
tile('chicken_white', (p) => { p.fill(hex(0xf6f6f6), 0.03); p.speckle(10, hex(0xe0e0e0), 0.02); });
tile('chicken_face', (p) => { p.fill(hex(0xf6f6f6), 0.03); p.rect(2, 4, 4, 6, hex(0x111111)); p.rect(11, 4, 13, 6, hex(0x111111)); });
tile('beak', (p) => p.fill(hex(0xf2b030), 0.04));
tile('wattle', (p) => p.fill(hex(0xd82020), 0.05));
tile('chicken_leg', (p) => p.fill(hex(0xe8a020), 0.05));

// Hostile mobs
tile('zombie_skin', (p) => { p.fill(hex(0x5f8f4a), 0.07); p.speckle(16, hex(0x4a7a3a), 0.04); });
tile('zombie_face', (p) => {
  p.fill(hex(0x5f8f4a), 0.07);
  p.rect(2, 6, 5, 7, hex(0x1a2a14)); p.rect(10, 6, 13, 7, hex(0x1a2a14));
  p.rect(7, 8, 8, 9, hex(0x3d6030));
  p.rect(5, 11, 10, 12, hex(0x3a5a2a));
});
tile('zombie_shirt', (p) => { p.fill(hex(0x2c9ea6), 0.06); for (let x = 0; x < 16; x++) p.set(x, 15, hex(0x1e7a80)); });
tile('zombie_pants', (p) => p.fill(hex(0x3b3e9c), 0.06));
tile('bone', (p) => {
  p.fill(hex(0xc9c9c9), 0.05);
  for (let x = 0; x < 16; x++) { p.set(x, 5, hex(0x8a8a8a)); p.set(x, 11, hex(0x8a8a8a)); }
});
tile('skull_face', (p) => {
  p.fill(hex(0xc6c6c6), 0.05);
  p.rect(2, 6, 5, 8, hex(0x161616)); p.rect(10, 6, 13, 8, hex(0x161616));
  p.rect(7, 9, 8, 10, hex(0x161616));
  for (let x = 4; x < 12; x++) p.set(x, 12, x % 2 ? hex(0x555555) : hex(0x161616));
});
const creeperPal = [0x4caf3c, 0x5ec84a, 0x3a8a2c, 0x7ad66a, 0x2e6e24].map(hex);
const creeperSkin = (p) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, creeperPal[Math.min(4, Math.floor(p.r() * p.r() * 5 + p.r() * 1.2))]);
};
tile('creeper_skin', creeperSkin);
tile('creeper_face', (p) => {
  creeperSkin(p);
  const k = hex(0x0e0e0e);
  p.rect(2, 4, 5, 7, k); p.rect(10, 4, 13, 7, k);
  p.rect(6, 8, 9, 11, k); p.rect(4, 10, 5, 15, k); p.rect(10, 10, 11, 15, k);
});
tile('spider_body', (p) => { p.fill(hex(0x2b2520), 0.1); p.speckle(30, hex(0x4a403a), 0.05); });
tile('spider_face', (p) => {
  p.fill(hex(0x2b2520), 0.1);
  for (const [x, y] of [[3, 6], [5, 4], [10, 4], [12, 6], [6, 7], [9, 7]]) p.rect(x, y, x + 1, y + 1, hex(0xd81818));
  p.set(4, 9, hex(0xa01010)); p.set(11, 9, hex(0xa01010));
});
tile('spider_leg', (p) => {
  p.fill(hex(0x2b2520), 0.08);
  for (let y = 0; y < 16; y++) for (const x of [4, 10]) p.set(x, y, hex(0x3d342e));
});
tile('arrow', (p) => {
  p.fill(hex(0x6b4c24), 0.06);
});
// Original mobs: rock golem (stone mimic) and wisp.
tile('mimic_stone', (p) => {
  p.fill(hex(0x7f7f7f), 0.05);
  for (let i = 0; i < 12; i++) {
    const x = p.ri(16), y = p.ri(16), len = 1 + p.ri(3);
    for (let k = 0; k < len; k++) p.set(x + k, y, p.v(hex(0x6a6a6a), 0.04));
  }
  p.speckle(10, hex(0x8e8e8e), 0.03);
});
tile('mimic_eyes', (p) => {
  p.d.fill(0);
  p.rect(0, 2, 5, 13, hex(0xffb020));
  p.rect(10, 2, 15, 13, hex(0xffb020));
  p.rect(1, 5, 4, 10, hex(0xfff0a0));
  p.rect(11, 5, 14, 10, hex(0xfff0a0));
});
tile('wisp_core', (p) => {
  p.fill(hex(0xd8f8ff), 0.04);
  p.rect(4, 4, 11, 11, hex(0xffffff));
});
tile('wisp_shell', (p) => {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if ((x + y) % 3 === 0 || p.r() < 0.12) p.set(x, y, p.v(hex(0x7fdcff), 0.1));
      else p.set(x, y, [0, 0, 0], 0);
    }
  }
});

export const mobTexture = new THREE.CanvasTexture(canvas);
mobTexture.magFilter = THREE.NearestFilter;
mobTexture.minFilter = THREE.NearestFilter;
mobTexture.generateMipmaps = false;
mobTexture.colorSpace = THREE.NoColorSpace;

const SHADES = [0.8, 0.8, 1.0, 0.55, 0.9, 0.9];
const geomCache = new Map();

function tileUV(name) {
  const i = tiles.get(name);
  if (i === undefined) throw new Error(`Unknown mob tile ${name}`);
  const e = 0.0005;
  const c = i % COLS, r = Math.floor(i / COLS);
  return [c / COLS + e, 1 - (r + 1) / COLS + e, (c + 1) / COLS - e, 1 - r / COLS - e];
}

// Box with per-face tile (front = -Z face) and baked directional shading.
function boxGeometry(size, tex, front) {
  const key = `${size}|${tex}|${front}`;
  let g = geomCache.get(key);
  if (g) return g;
  g = new THREE.BoxGeometry(size[0] / 16, size[1] / 16, size[2] / 16);
  const uv = g.attributes.uv;
  const colors = new Float32Array(uv.count * 3);
  for (let f = 0; f < 6; f++) {
    const [u0, v0, u1, v1] = tileUV(f === 5 && front ? front : tex);
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = SHADES[f];
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geomCache.set(key, g);
  return g;
}

// Part: n name, s size(px), p pivot(px, relative to parent pivot or feet), o box offset from pivot,
// t texture tile, f front tile, parent, r initial rotation [x,y,z].
const quadLegs = (size, x, y, zf, zb, t) => [
  { n: 'legFL', s: size, p: [-x, y, zf], o: [0, -size[1] / 2, 0], t },
  { n: 'legFR', s: size, p: [x, y, zf], o: [0, -size[1] / 2, 0], t },
  { n: 'legBL', s: size, p: [-x, y, zb], o: [0, -size[1] / 2, 0], t },
  { n: 'legBR', s: size, p: [x, y, zb], o: [0, -size[1] / 2, 0], t },
];

const humanoid = (head, face, body, arm, leg, limb = 4) => [
  { n: 'head', s: [8, 8, 8], p: [0, 24, 0], o: [0, 4, 0], t: head, f: face },
  { n: 'body', s: [8, 12, 4], p: [0, 18, 0], t: body },
  { n: 'armL', s: [limb, 12, limb], p: [-(4 + limb / 2), 22, 0], o: [0, -4, 0], t: arm },
  { n: 'armR', s: [limb, 12, limb], p: [4 + limb / 2, 22, 0], o: [0, -4, 0], t: arm },
  { n: 'legL', s: [limb, 12, limb], p: [-2, 12, 0], o: [0, -6, 0], t: leg },
  { n: 'legR', s: [limb, 12, limb], p: [2, 12, 0], o: [0, -6, 0], t: leg },
];

const spiderLegs = () => {
  const legs = [];
  [-4.5, -1.5, 1.5, 4.5].forEach((z, i) => {
    for (const side of [-1, 1]) {
      legs.push({
        n: `leg${i}${side < 0 ? 'L' : 'R'}`, s: [16, 2, 2], p: [side * 3, 9, z], o: [side * 8, 0, 0], t: 'spider_leg',
        r: [0, side * (i - 1.5) * 0.35, side * -0.55], side, idx: i,
      });
    }
  });
  return legs;
};

export const MODELS = {
  pig: [
    { n: 'body', s: [10, 8, 16], p: [0, 10, 0], t: 'pig_skin' },
    { n: 'head', s: [8, 8, 8], p: [0, 12, -8], o: [0, 0, -4], t: 'pig_skin', f: 'pig_face' },
    { n: 'snout', parent: 'head', s: [4, 3, 1], p: [0, -1.5, -8.5], t: 'pig_snout', f: 'pig_snout' },
    ...quadLegs([4, 6, 4], 3, 6, -5, 6, 'pig_skin'),
  ],
  cow: [
    { n: 'body', s: [12, 10, 18], p: [0, 15, 0], t: 'cow_hide' },
    { n: 'head', s: [8, 8, 6], p: [0, 18, -9], o: [0, 0, -3], t: 'cow_hide', f: 'cow_face' },
    { n: 'hornL', parent: 'head', s: [1, 3, 1], p: [-4.5, 5, -4], t: 'cow_horn' },
    { n: 'hornR', parent: 'head', s: [1, 3, 1], p: [4.5, 5, -4], t: 'cow_horn' },
    ...quadLegs([4, 10, 4], 4, 10, -6, 7, 'cow_hide'),
  ],
  sheep: [
    { n: 'body', s: [10, 9, 16], p: [0, 15, 0], t: 'wool' },
    { n: 'head', s: [6, 6, 8], p: [0, 17, -8], o: [0, 0, -3], t: 'sheep_skin', f: 'sheep_face' },
    { n: 'cap', parent: 'head', s: [7, 3, 6], p: [0, 2.5, -2], t: 'wool' },
    ...quadLegs([4, 11, 4], 3, 11, -5, 6, 'sheep_leg'),
  ],
  chicken: [
    { n: 'body', s: [6, 6, 8], p: [0, 7, 0], t: 'chicken_white' },
    { n: 'head', s: [4, 6, 3], p: [0, 9, -4], o: [0, 1.5, -1.5], t: 'chicken_white', f: 'chicken_face' },
    { n: 'beak', parent: 'head', s: [4, 2, 2], p: [0, 2, -4], t: 'beak' },
    { n: 'wattle', parent: 'head', s: [2, 2, 1], p: [0, 0, -3.5], t: 'wattle' },
    { n: 'wingL', s: [1, 4, 6], p: [-3.5, 9, 0], o: [0, -2, 0], t: 'chicken_white' },
    { n: 'wingR', s: [1, 4, 6], p: [3.5, 9, 0], o: [0, -2, 0], t: 'chicken_white' },
    { n: 'legFL', s: [1, 5, 1], p: [-1.5, 5, 0.5], o: [0, -2.5, 0], t: 'chicken_leg' },
    { n: 'legFR', s: [1, 5, 1], p: [1.5, 5, 0.5], o: [0, -2.5, 0], t: 'chicken_leg' },
  ],
  zombie: humanoid('zombie_skin', 'zombie_face', 'zombie_shirt', 'zombie_skin', 'zombie_pants'),
  skeleton: humanoid('bone', 'skull_face', 'bone', 'bone', 'bone', 2),
  creeper: [
    { n: 'head', s: [8, 8, 8], p: [0, 18, 0], o: [0, 4, 0], t: 'creeper_skin', f: 'creeper_face' },
    { n: 'body', s: [8, 12, 4], p: [0, 12, 0], t: 'creeper_skin' },
    ...quadLegs([4, 6, 4], 2, 6, -4, 4, 'creeper_skin'),
  ],
  spider: [
    { n: 'abdomen', s: [10, 8, 12], p: [0, 9, 6], o: [0, 0, 3], t: 'spider_body' },
    { n: 'body', s: [6, 6, 6], p: [0, 9, 0], t: 'spider_body' },
    { n: 'head', s: [8, 8, 8], p: [0, 9, -3], o: [0, 0, -4], t: 'spider_body', f: 'spider_face' },
    ...spiderLegs(),
  ],
  rock_golem: [
    { n: 'body', s: [16, 16, 16], p: [0, 8, 0], t: 'mimic_stone' },
    { n: 'eyes', parent: 'body', s: [10, 3, 0.5], p: [0, 2, -8.3], t: 'mimic_eyes', glow: true },
    ...quadLegs([4, 6, 4], 5, 6, -5, 5, 'mimic_stone'),
  ],
  wisp: [
    { n: 'core', s: [6, 6, 6], p: [0, 5, 0], t: 'wisp_core', glow: true },
    { n: 'shell', s: [10, 10, 10], p: [0, 5, 0], t: 'wisp_shell', glow: true },
    { n: 'tail1', s: [3, 3, 3], p: [0, 1, 3], t: 'wisp_core', glow: true },
    { n: 'tail2', s: [2, 2, 2], p: [0, -1, 5], t: 'wisp_core', glow: true },
  ],
};

const baseMaterial = new THREE.MeshBasicMaterial({ map: mobTexture, vertexColors: true, alphaTest: 0.5 });

export function buildModel(type) {
  const spec = MODELS[type];
  const material = baseMaterial.clone();
  const glowMaterial = baseMaterial.clone(); // ignores darkness
  glowMaterial.color.setScalar(1.25);
  const root = new THREE.Group();
  const inner = new THREE.Group(); // tilted on death
  root.add(inner);
  const parts = {};
  for (const s of spec) {
    const g = new THREE.Group();
    g.position.set(s.p[0] / 16, s.p[1] / 16, s.p[2] / 16);
    if (s.r) g.rotation.set(...s.r);
    const m = new THREE.Mesh(boxGeometry(s.s, s.t, s.f), s.glow ? glowMaterial : material);
    if (s.o) m.position.set(s.o[0] / 16, s.o[1] / 16, s.o[2] / 16);
    g.add(m);
    g.userData = { base: s.r ? [...s.r] : [0, 0, 0], side: s.side, idx: s.idx };
    (s.parent ? parts[s.parent] : inner).add(g);
    parts[s.n] = g;
  }
  return { root, inner, parts, material, glowMaterial };
}

// Thin stick model for flying arrows.
export function buildArrowMesh() {
  const g = boxGeometry([1, 1, 8], 'arrow');
  return new THREE.Mesh(g, baseMaterial.clone());
}
