// Fire and TNT, following Minecraft's rules:
//  - Fire ticks every 1.5–2 s. It burns away neighbouring flammable blocks (chance from their
//    "flammability") and jumps to nearby air next to flammable blocks (chance from "encouragement").
//  - Fire with nothing to burn dies out after a few ticks; fire floating in the air dies at once.
//  - Lava occasionally sets fire to flammable blocks near it.
//  - TNT lit by flint & steel, fire or an explosion falls, flashes and explodes after 4 s.
import * as THREE from 'three';
import { B, BLOCKS, FIRE_ENCOURAGE, FLAMMABILITY, isLava, isWater } from './blocks.js';
import { atlasTexture } from './materials.js';
import { tileIndex, tileUV } from './textures.js';
import { moveBody } from './physics.js';
import { CHUNK } from './constants.js';

const DIRS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const MAX_FIRES = 800;
const LAVA_IGNITE_CHANCE = 1 / 60; // per lava block, per 0.5 s scan (~30 s on average, like random ticks)
const TNT_FUSE = 4;
const TNT_POWER = 4;

let tntGeom = null;
function tntGeometry() {
  if (tntGeom) return tntGeom;
  tntGeom = new THREE.BoxGeometry(0.98, 0.98, 0.98);
  const tiles = ['tnt_side', 'tnt_side', 'tnt_top', 'tnt_bottom', 'tnt_side', 'tnt_side'].map(tileIndex);
  const uv = tntGeom.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const [u0, v0, u1, v1] = tileUV(tiles[f]);
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
  }
  return tntGeom;
}

export class Fire {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.ages = new Map(); // "x,y,z" -> fire age 0..15
    this.pending = new Map(); // "x,y,z" -> [x, y, z, due]
    this.time = 0;
    this.lavaT = 0;
    this.tnt = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
  }

  get count() { return this.ages.size; }

  schedule(x, y, z, delay = 1.5 + Math.random() * 0.5) {
    const k = `${x},${y},${z}`;
    if (!this.pending.has(k)) this.pending.set(k, [x, y, z, this.time + delay]);
  }

  // Can fire sit here? Needs a solid floor or something flammable next to it.
  canSurvive(x, y, z) {
    const w = this.world;
    if (BLOCKS[w.getBlock(x, y - 1, z)].solid) return true;
    return this.flammableAround(x, y, z);
  }

  flammableAround(x, y, z) {
    const w = this.world;
    for (const [dx, dy, dz] of DIRS6) if (FLAMMABILITY[w.getBlock(x + dx, y + dy, z + dz)]) return true;
    return false;
  }

  // Light a fire (flint & steel, lava, spreading). Returns true if a fire was placed.
  ignite(x, y, z, age = 0, urgent = false) {
    const w = this.world;
    if (w.getBlock(x, y, z) !== B.AIR || !this.canSurvive(x, y, z)) return false;
    if (this.ages.size >= MAX_FIRES) return false;
    w.setBlock(x, y, z, B.FIRE, urgent);
    this.ages.set(`${x},${y},${z}`, age);
    this.schedule(x, y, z);
    return true;
  }

  extinguish(x, y, z) {
    this.world.setBlock(x, y, z, B.AIR);
    this.ages.delete(`${x},${y},${z}`);
  }

  update(dt) {
    this.time += dt;
    const w = this.world;
    // Fires in freshly loaded chunks resume burning.
    for (const [x, y, z] of w.firesFound) { this.ages.set(`${x},${y},${z}`, 0); this.schedule(x, y, z, Math.random() * 2); }
    w.firesFound.length = 0;

    if (this.pending.size) {
      const due = [];
      for (const [k, e] of this.pending) if (e[3] <= this.time) { due.push(e); this.pending.delete(k); }
      for (const [x, y, z] of due) {
        if (w.isLoaded(x, z)) this.tick(x, y, z);
        else this.ages.delete(`${x},${y},${z}`); // resumes from firesFound when the chunk reloads
      }
    }

    this.lavaT -= dt;
    if (this.lavaT <= 0) { this.lavaT = 0.5; this.lavaScan(); }
    this.updateTnt(dt);
  }

  tick(x, y, z) {
    const w = this.world;
    const k = `${x},${y},${z}`;
    if (w.getBlock(x, y, z) !== B.FIRE) { this.ages.delete(k); return; }
    if (!this.canSurvive(x, y, z)) { this.extinguish(x, y, z); return; }
    let age = this.ages.get(k) ?? 0;
    if (Math.random() < 1 / 3) age = Math.min(15, age + 1);
    this.ages.set(k, age);

    const below = w.getBlock(x, y - 1, z);
    if (!this.flammableAround(x, y, z)) {
      // Nothing left to burn: a fire on bare ground flickers out after a few ticks.
      if (age > 3) { this.extinguish(x, y, z); return; }
    } else if (age === 15 && !FLAMMABILITY[below] && Math.random() < 0.25) {
      this.extinguish(x, y, z);
      return;
    }

    // Burn neighbouring blocks.
    for (const [dx, dy, dz] of DIRS6) this.tryBurn(x + dx, y + dy, z + dz, dy !== 0 ? 250 : 300, age);

    // Spread into nearby air (a 3x3 column from one below to four above).
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 4; dy++) {
          if (!dx && !dy && !dz) continue;
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (w.getBlock(nx, ny, nz) !== B.AIR) continue;
          let enc = 0;
          for (const [ex, ey, ez] of DIRS6) enc = Math.max(enc, FIRE_ENCOURAGE[w.getBlock(nx + ex, ny + ey, nz + ez)]);
          if (!enc) continue;
          const base = dy > 1 ? 100 + (dy - 1) * 100 : 100;
          const chance = (enc + 40 + 14) / (age + 30); // 14 = normal difficulty in Minecraft's formula
          if (Math.random() * base <= chance) this.ignite(nx, ny, nz, Math.min(15, age + (Math.random() < 0.2 ? 1 : 0)));
        }
      }
    }
    this.schedule(x, y, z);
  }

  // A flammable block next to fire may burn away (sometimes leaving fire behind). TNT gets lit instead.
  tryBurn(x, y, z, chance, age) {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    const f = FLAMMABILITY[id];
    if (!f || Math.random() * chance >= f) return;
    if (id === B.TNT) { this.primeTnt(x, y, z); return; }
    w.setBlock(x, y, z, B.AIR, false);
    if (Math.random() * (age + 10) < 5) this.ignite(x, y, z, Math.min(15, age + (Math.random() < 0.2 ? 1 : 0)));
    this.game.onBlockRemoved(x, y, z); // plants on top fall off, sand settles
  }

  // Lava randomly sets fire to flammable blocks around (and above) it.
  lavaScan() {
    const w = this.world, p = this.game.player;
    const pcx = Math.floor(p.pos.x) >> 4, pcz = Math.floor(p.pos.z) >> 4;
    for (let cz = pcz - 4; cz <= pcz + 4; cz++) {
      for (let cx = pcx - 4; cx <= pcx + 4; cx++) {
        const c = w.getChunk(cx, cz);
        if (!c) continue;
        for (const i of c.torches) {
          if (Math.random() >= LAVA_IGNITE_CHANCE || !isLava(c.blocks[i])) continue;
          this.lavaTick(cx * CHUNK + (i & 15), i >> 8, cz * CHUNK + ((i >> 4) & 15));
        }
      }
    }
  }

  lavaTick(x, y, z) {
    const w = this.world;
    const r3 = () => Math.floor(Math.random() * 3) - 1;
    const n = Math.floor(Math.random() * 3);
    if (n > 0) {
      let px = x, py = y, pz = z;
      for (let j = 0; j < n; j++) {
        px += r3(); py += 1; pz += r3();
        const id = w.getBlock(px, py, pz);
        if (id === B.AIR) {
          if (this.flammableAround(px, py, pz)) { this.ignite(px, py, pz); return; }
        } else if (BLOCKS[id].solid) return;
      }
    } else {
      for (let j = 0; j < 3; j++) {
        const qx = x + r3(), qz = z + r3();
        if (w.getBlock(qx, y + 1, qz) === B.AIR && FLAMMABILITY[w.getBlock(qx, y, qz)]) this.ignite(qx, y + 1, qz);
      }
    }
  }

  // ---------- TNT ----------
  primeTnt(x, y, z, fuse = TNT_FUSE) {
    const w = this.world;
    w.setBlock(x, y, z, B.AIR);
    this.game.onBlockRemoved(x, y, z);
    const mesh = new THREE.Mesh(tntGeometry(), new THREE.MeshBasicMaterial({ map: atlasTexture }));
    const flash = new THREE.Mesh(tntGeometry(), new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
    }));
    flash.scale.setScalar(1.01);
    mesh.add(flash);
    this.group.add(mesh);
    const a = Math.random() * Math.PI * 2;
    this.tnt.push({
      pos: new THREE.Vector3(x + 0.5, y, z + 0.5),
      vel: new THREE.Vector3(Math.cos(a) * 0.4, 4, Math.sin(a) * 0.4),
      hw: 0.49, height: 0.98, onGround: false, blocked: false, fuse, mesh, flash, lightT: 0,
    });
    this.game.mobs.sound.mob('creeper', 'fuse', this.game.mobs.volumeAt(new THREE.Vector3(x, y, z)));
  }

  updateTnt(dt) {
    const g = this.game;
    for (let i = this.tnt.length - 1; i >= 0; i--) {
      const t = this.tnt[i];
      t.fuse -= dt;
      const inWater = isWater(this.world.getBlock(Math.floor(t.pos.x), Math.floor(t.pos.y + 0.3), Math.floor(t.pos.z)));
      t.vel.y -= (inWater ? 6 : 20) * dt;
      if (inWater) t.vel.multiplyScalar(Math.exp(-3 * dt));
      if (t.onGround) { t.vel.x *= Math.exp(-6 * dt); t.vel.z *= Math.exp(-6 * dt); }
      moveBody(t, this.world, dt);
      t.mesh.position.set(t.pos.x, t.pos.y + 0.49, t.pos.z);
      // Swells and flashes white, faster near the end.
      const s = t.fuse < 0.4 ? 1 + (0.4 - t.fuse) * 0.4 : 1;
      t.mesh.scale.setScalar(s);
      t.flash.material.opacity = Math.floor(t.fuse * (t.fuse < 1 ? 8 : 2.5)) % 2 ? 0.55 : 0;
      t.lightT -= dt;
      if (t.lightT <= 0) {
        t.lightT = 0.25;
        t.mesh.material.color.setScalar(Math.pow(0.8, 15 - g.lightLevel(t.pos.x, t.pos.y + 0.5, t.pos.z)));
      }
      if (t.fuse <= 0) {
        this.removeTnt(i);
        // Underwater TNT hurts but doesn't break blocks (like Minecraft).
        g.mobs.explode(t.pos.x, t.pos.y + 0.49, t.pos.z, TNT_POWER, 'tnt', !inWater);
      }
    }
  }

  removeTnt(i) {
    const t = this.tnt[i];
    this.group.remove(t.mesh);
    t.mesh.material.dispose();
    t.flash.material.dispose();
    this.tnt.splice(i, 1);
  }

  dispose() {
    for (let i = this.tnt.length - 1; i >= 0; i--) this.removeTnt(i);
    this.game.scene.remove(this.group);
  }
}
