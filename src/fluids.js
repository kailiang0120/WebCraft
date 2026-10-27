// Minecraft-style fluid flow for water and lava.
//  - Sources spread sideways (water 7 blocks, lava 3), fall when unsupported.
//  - Flowing fluid heads toward the nearest drop within a few blocks (water 4, lava 2).
//  - Two water sources make a new one. Lava meeting water hardens into obsidian/cobblestone/stone.
import * as THREE from 'three';
import { B, BLOCKS, FLUID_KIND, fluidLevel, isWater, getDrop } from './blocks.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const MAX_UPDATES_PER_FRAME = 2500;

const KINDS = {
  1: { source: B.WATER, falling: B.WATER_FALLING, flow1: B.WATER_FLOW_1, step: 1, delay: 0.25, search: 4, infinite: true },
  2: { source: B.LAVA, falling: B.LAVA_FALLING, flow1: B.LAVA_FLOW_1, step: 2, delay: 1.5, search: 2, infinite: false },
};
const flowing = (K, level) => (level === 8 ? K.falling : K.flow1 + level - 1);

export class Fluids {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.pending = new Map(); // "x,y,z" -> [x, y, z, dueTime]
    this.time = 0;
    this.world.onChange = (x, y, z) => this.scheduleAround(x, y, z);
  }

  // Each fluid ticks at its own rate (lava is much slower than water).
  schedule(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    const kind = FLUID_KIND[id];
    let delay = kind ? KINDS[kind].delay : 0.25;
    // A cell next to lava that may receive lava should wait for the lava's pace too.
    const k = `${x},${y},${z}`;
    const due = this.time + delay;
    const cur = this.pending.get(k);
    if (!cur || cur[3] > due) this.pending.set(k, [x, y, z, due]);
  }

  scheduleAround(x, y, z) {
    this.schedule(x, y, z);
    this.schedule(x, y + 1, z);
    this.schedule(x, y - 1, z);
    for (const [dx, dz] of DIRS) this.schedule(x + dx, y, z + dz);
  }

  // Fluids flow into air and wash away plants & torches (dropping them as items).
  canFlowInto(id) {
    if (id === B.AIR) return true;
    if (FLUID_KIND[id]) return false;
    const d = BLOCKS[id];
    return !d.solid && (d.replaceable || !!d.support);
  }

  set(x, y, z, id) {
    const w = this.world;
    const old = w.getBlock(x, y, z);
    if (old !== B.AIR && !FLUID_KIND[old] && FLUID_KIND[id]) {
      const drop = getDrop(BLOCKS[old]);
      // Lava burns what it touches; water washes it away as an item.
      if (drop && FLUID_KIND[id] === 1 && this.game.gameMode === 'survival') {
        this.game.items.dropAt({ id: drop.id, count: drop.count }, x, y, z);
      }
    }
    w.setBlock(x, y, z, id, false);
  }

  harden(x, y, z, id) {
    this.set(x, y, z, id);
    this.game.sound.fizz?.();
    this.game.fx.puff(x, y + 0.3, z, 6);
  }

  update(dt) {
    this.time += dt;
    for (const p of this.world.flowingFound) this.schedule(...p);
    this.world.flowingFound.length = 0;
    if (!this.pending.size) return;
    const due = [];
    for (const [k, e] of this.pending) {
      if (e[3] <= this.time) { due.push(e); this.pending.delete(k); }
      if (due.length >= MAX_UPDATES_PER_FRAME) break;
    }
    for (const [x, y, z] of due) if (this.world.isLoaded(x, z)) this.tick(x, y, z);
  }

  tick(x, y, z) {
    const w = this.world;
    let id = w.getBlock(x, y, z);
    const kind = FLUID_KIND[id];
    if (!kind) return;
    const K = KINDS[kind];

    // Lava touching water (from the side or above) hardens.
    if (kind === 2) {
      const touching = DIRS.some(([dx, dz]) => isWater(w.getBlock(x + dx, y, z + dz))) || isWater(w.getBlock(x, y + 1, z));
      if (touching) { this.harden(x, y, z, id === B.LAVA ? B.OBSIDIAN : B.COBBLESTONE); return; }
    }

    // Flowing fluid re-evaluates what it should be from its neighbours.
    if (id !== K.source) {
      let want;
      if (FLUID_KIND[w.getBlock(x, y + 1, z)] === kind) want = K.falling;
      else {
        let best = 99, sources = 0;
        for (const [dx, dz] of DIRS) {
          const nid = w.getBlock(x + dx, y, z + dz);
          if (FLUID_KIND[nid] !== kind) continue;
          const l = fluidLevel(nid);
          if (l === 0) sources++;
          best = Math.min(best, l === 0 || l === 8 ? K.step : l + K.step);
        }
        const below = w.getBlock(x, y - 1, z);
        if (K.infinite && sources >= 2 && (BLOCKS[below].solid || below === K.source)) want = K.source;
        else want = best <= 7 ? flowing(K, best) : B.AIR;
      }
      if (want !== id) {
        this.set(x, y, z, want);
        if (want === B.AIR) return;
        id = want;
      }
    }

    // Fall first.
    const below = w.getBlock(x, y - 1, z);
    if (y > 0 && kind === 2 && isWater(below)) { this.harden(x, y - 1, z, B.STONE); return; } // lava onto water
    if (y > 0 && this.canFlowInto(below)) {
      this.set(x, y - 1, z, K.falling);
      return;
    }
    if (FLUID_KIND[below] === kind && below !== K.source) return; // still pouring into flowing fluid

    // Then spread sideways, preferring the direction(s) with the nearest drop.
    const l = fluidLevel(id);
    const next = l === 0 || l === 8 ? K.step : l + K.step;
    if (next > 7) return;
    for (const d of this.preferredDirs(x, y, z, kind, K.search)) {
      const nx = x + DIRS[d][0], nz = z + DIRS[d][1];
      const nid = w.getBlock(nx, y, nz);
      if (this.canFlowInto(nid)) this.set(nx, y, nz, flowing(K, next));
      else if (FLUID_KIND[nid] === kind && nid !== K.source && nid !== K.falling && fluidLevel(nid) > next) {
        this.set(nx, y, nz, flowing(K, next));
      } else if (kind === 1 && FLUID_KIND[nid] === 2) this.scheduleAround(nx, y, nz); // water reaching lava
    }
  }

  // Minecraft's rule: of the 4 directions, flow only toward the one(s) with the shortest path
  // (within `range` blocks) to a spot where the fluid can fall. If there's no drop nearby, flow everywhere.
  preferredDirs(x, y, z, kind, range) {
    const w = this.world;
    const passable = (px, pz) => {
      const id = w.getBlock(px, y, pz);
      return this.canFlowInto(id) || (FLUID_KIND[id] === kind && fluidLevel(id) !== 0);
    };
    const hole = (px, pz) => {
      const b = w.getBlock(px, y - 1, pz);
      return this.canFlowInto(b) || (FLUID_KIND[b] === kind && fluidLevel(b) !== 0);
    };
    const dist = new Array(4).fill(Infinity);
    for (let d = 0; d < 4; d++) {
      const sx = x + DIRS[d][0], sz = z + DIRS[d][1];
      if (!passable(sx, sz)) continue;
      // Small BFS from the first step, not walking back through the origin.
      const seen = new Set([`${x},${z}`, `${sx},${sz}`]);
      let frontier = [[sx, sz]];
      for (let depth = 1; depth <= range && frontier.length; depth++) {
        if (frontier.some(([fx, fz]) => hole(fx, fz))) { dist[d] = depth; break; }
        const nextF = [];
        for (const [fx, fz] of frontier) {
          for (const [dx, dz] of DIRS) {
            const qx = fx + dx, qz = fz + dz, k = `${qx},${qz}`;
            if (seen.has(k) || !passable(qx, qz)) continue;
            seen.add(k);
            nextF.push([qx, qz]);
          }
        }
        frontier = nextF;
      }
    }
    const min = Math.min(...dist);
    const out = [];
    for (let d = 0; d < 4; d++) {
      if (min === Infinity ? true : dist[d] === min) out.push(d);
    }
    return out;
  }

  // Current direction at a point (for pushing entities downstream).
  flowAt(px, py, pz, out = new THREE.Vector3()) {
    out.set(0, 0, 0);
    const w = this.world;
    const x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz);
    const id = w.getBlock(x, y, z);
    const kind = FLUID_KIND[id];
    const l = fluidLevel(id);
    if (!kind || l <= 0 || l === 8) return out;
    for (const [dx, dz] of DIRS) {
      const nid = w.getBlock(x + dx, y, z + dz);
      const nl = FLUID_KIND[nid] === kind ? fluidLevel(nid) : -1;
      if (nl > l && nl !== 8) { out.x += dx * (nl - l); out.z += dz * (nl - l); }
      else if (nl < 0 && !BLOCKS[nid].solid) { out.x += dx * 2; out.z += dz * 2; }
      else if (nl >= 0 && nl < l) { out.x -= dx * (l - nl); out.z -= dz * (l - nl); }
    }
    const len = Math.hypot(out.x, out.z);
    if (len > 0) out.multiplyScalar((kind === 2 ? 0.4 : 1) / len);
    return out;
  }
}
