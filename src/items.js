// Dropped item entities: bob & spin on the ground, merge into stacks, get vacuumed up by the player.
import * as THREE from 'three';
import { B, getItem, maxStack, isWater, isLava } from './blocks.js';
import { atlasTexture } from './materials.js';
import { tileIndex, tileUV } from './textures.js';
import { itemIconCanvas } from './icons.js';
import { moveBody } from './physics.js';

const MAX_ITEMS = 300;
const DESPAWN = 300; // seconds
const PICKUP_RANGE = 1.8;
const geomCache = new Map();
const matCache = new Map();
const flatGeom = new THREE.PlaneGeometry(0.42, 0.42);

function baseFor(id) {
  let entry = matCache.get(id);
  if (entry) return entry;
  const def = getItem(id);
  if (def.isBlock && !def.flatIcon) {
    let g = geomCache.get(id);
    if (!g) {
      g = new THREE.BoxGeometry(0.25, 0.25, 0.25);
      const t = def.tex;
      const tiles = [t.side, t.side, t.top, t.bottom, t.front, t.side].map(tileIndex);
      const uv = g.attributes.uv;
      for (let f = 0; f < 6; f++) {
        const [u0, v0, u1, v1] = tileUV(tiles[f]);
        for (let k = 0; k < 4; k++) {
          const i = f * 4 + k;
          uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
        }
      }
      geomCache.set(id, g);
    }
    entry = { geometry: g, material: new THREE.MeshBasicMaterial({ map: atlasTexture, alphaTest: 0.5 }) };
  } else {
    const tex = new THREE.CanvasTexture(itemIconCanvas(id));
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.NoColorSpace;
    entry = { geometry: flatGeom, material: new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.1, side: THREE.DoubleSide }) };
  }
  matCache.set(id, entry);
  return entry;
}

const copiesFor = (count) => (count > 32 ? 3 : count > 1 ? 2 : 1);

export class ItemEntities {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.list = [];
    this.mergeT = 0;
  }

  spawn(stack, x, y, z, vel = null, delay = 0.5) {
    if (!stack || stack.count <= 0 || !getItem(stack.id)) return null;
    if (this.list.length >= MAX_ITEMS) this.remove(this.list[0]);
    const e = {
      stack: { ...stack },
      pos: new THREE.Vector3(x, y, z),
      vel: vel ? vel.clone() : new THREE.Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 2, (Math.random() - 0.5) * 3),
      hw: 0.125, height: 0.25, onGround: false, blocked: false,
      age: 0, delay, spin: Math.random() * Math.PI * 2, lightT: 0,
      obj: new THREE.Group(), material: baseFor(stack.id).material.clone(), copies: 0,
    };
    this.rebuild(e);
    this.group.add(e.obj);
    this.list.push(e);
    return e;
  }

  // Drop from a broken block: pops out of the block's centre.
  dropAt(stack, bx, by, bz) {
    return this.spawn(stack, bx + 0.5, by + 0.35, bz + 0.5);
  }

  rebuild(e) {
    const n = copiesFor(e.stack.count);
    if (n === e.copies) return;
    e.copies = n;
    e.obj.clear();
    const { geometry } = baseFor(e.stack.id);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geometry, e.material);
      m.position.set(i * 0.06, i * 0.05, i * 0.04);
      e.obj.add(m);
    }
  }

  remove(e) {
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
    this.group.remove(e.obj);
    e.material.dispose();
  }

  update(dt) {
    const g = this.game, w = g.world, p = g.player;
    const target = new THREE.Vector3(p.pos.x, p.pos.y + 0.8, p.pos.z);
    let picked = false;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.age += dt;
      if (e.age > DESPAWN || e.pos.y < -10) { this.remove(e); continue; }
      if (!w.isLoaded(e.pos.x, e.pos.z)) continue;

      // Vacuum toward the player; collect once inside the player's (slightly expanded) bounding box.
      const d = e.pos.distanceTo(target);
      let pulled = false;
      if (e.age > e.delay && !g.dead && d < PICKUP_RANGE) {
        const touching = Math.abs(e.pos.x - p.pos.x) < 0.8 && Math.abs(e.pos.z - p.pos.z) < 0.8
          && e.pos.y > p.pos.y - 0.6 && e.pos.y < p.pos.y + 2.2;
        if (touching) {
          const before = e.stack.count;
          const rem = g.inventory.addStack(e.stack);
          if (!rem) { this.remove(e); picked = true; continue; }
          if (rem.count !== before) picked = true;
          e.stack = rem;
          this.rebuild(e);
        } else {
          const dir = target.clone().sub(e.pos).normalize();
          e.vel.x += (dir.x * 7 - e.vel.x) * Math.min(1, dt * 10);
          e.vel.z += (dir.z * 7 - e.vel.z) * Math.min(1, dt * 10);
          if (dir.y > 0.2 && e.onGround) e.vel.y = 2.5;
          pulled = true;
        }
      }

      const here = w.getBlock(Math.floor(e.pos.x), Math.floor(e.pos.y + 0.1), Math.floor(e.pos.z));
      if (isLava(here) || here === B.FIRE) { // burned up
        g.fx.puff(e.pos.x - 0.5, e.pos.y, e.pos.z - 0.5, 3);
        g.sound.fizz();
        this.remove(e);
        continue;
      }
      const inWater = isWater(here);
      if (inWater) {
        e.vel.y += (3 - e.vel.y) * Math.min(1, dt * 3); // bob up
        e.vel.x *= Math.exp(-2 * dt);
        e.vel.z *= Math.exp(-2 * dt);
        const f = g.fluids.flowAt(e.pos.x, e.pos.y + 0.1, e.pos.z); // carried downstream
        e.vel.x += f.x * 8 * dt;
        e.vel.z += f.z * 8 * dt;
      } else {
        e.vel.y -= 20 * dt;
        if (e.onGround && !pulled) { e.vel.x *= Math.exp(-8 * dt); e.vel.z *= Math.exp(-8 * dt); }
      }
      moveBody(e, w, dt);

      e.obj.position.set(e.pos.x, e.pos.y + 0.16 + Math.sin(e.age * 2.5) * 0.05, e.pos.z);
      e.obj.rotation.y = e.spin + e.age * 1.6;
      e.lightT -= dt;
      if (e.lightT <= 0) {
        e.lightT = 0.3;
        e.material.color.setScalar(Math.pow(0.8, 15 - g.lightLevel(e.pos.x, e.pos.y + 0.2, e.pos.z)));
      }
    }
    if (picked) g.sound.pop();

    // Merge nearby identical stacks to keep counts low.
    this.mergeT -= dt;
    if (this.mergeT <= 0) {
      this.mergeT = 0.5;
      const L = this.list;
      for (let i = 0; i < L.length; i++) {
        const a = L[i];
        const max = maxStack(a.stack.id);
        if (max <= 1 || a.stack.count >= max) continue;
        for (let j = i + 1; j < L.length; j++) {
          const b = L[j];
          if (b.stack.id !== a.stack.id || a.pos.distanceToSquared(b.pos) > 1) continue;
          const n = Math.min(max - a.stack.count, b.stack.count);
          a.stack.count += n;
          b.stack.count -= n;
          a.age = Math.min(a.age, b.age);
          this.rebuild(a);
          if (b.stack.count <= 0) { this.remove(b); j--; } else this.rebuild(b);
          if (a.stack.count >= max) break;
        }
      }
    }
  }

  serialize() {
    return this.list.map((e) => ({ stack: e.stack, pos: [e.pos.x, e.pos.y, e.pos.z], age: e.age }));
  }

  load(list) {
    for (const s of list || []) {
      const e = this.spawn(s.stack, s.pos[0], s.pos[1], s.pos[2], new THREE.Vector3(), 0);
      if (e) e.age = s.age || 0;
    }
  }

  dispose() {
    for (const e of [...this.list]) this.remove(e);
    this.game.scene.remove(this.group);
  }
}
