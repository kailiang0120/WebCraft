// A* pathfinding over the voxel grid for walking mobs.
// Moves: 8 horizontal directions, step up 1 block (jump), drop down up to `maxDrop` blocks.
import { B, BLOCKS, isWater, isLava } from '../blocks.js';

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * opts: { height (blocks), maxNodes, maxDrop, avoidWater, range }
 * Returns an array of [x, y, z] cells (excluding the start), or null if nothing useful was found.
 * If the goal can't be reached, returns the path to the explored cell closest to it.
 */
export function findPath(world, sx, sy, sz, gx, gy, gz, opts = {}) {
  const h = Math.ceil(opts.height ?? 2);
  const maxNodes = opts.maxNodes ?? 600;
  const maxDrop = opts.maxDrop ?? 3;
  const range = opts.range ?? 32;
  const avoidWater = !!opts.avoidWater;

  const climb = !!opts.climb; // spiders: can walk up/down walls
  // Footprint in cells (wide mobs like spiders need a 2x2 gap). Nodes are the footprint's min corner.
  const W = Math.max(1, Math.ceil((opts.width ?? 1) - 0.05));
  const solid = (x, y, z) => BLOCKS[world.getBlock(x, y, z)].solid;
  const danger = (x, y, z) => {
    const id = world.getBlock(x, y, z);
    return id === B.CACTUS || id === B.FIRE || isLava(id);
  };
  const clear = (x, y, z) => {
    for (let ix = 0; ix < W; ix++) {
      for (let iz = 0; iz < W; iz++) {
        for (let k = 0; k < h; k++) if (solid(x + ix, y + k, z + iz) || danger(x + ix, y + k, z + iz)) return false;
      }
    }
    return true;
  };
  const besideWall = (x, y, z) => {
    for (let i = 0; i < W; i++) {
      if (solid(x - 1, y, z + i) || solid(x + W, y, z + i) || solid(x + i, y, z - 1) || solid(x + i, y, z + W)) return true;
    }
    return false;
  };
  const standable = (x, y, z) => {
    if (!clear(x, y, z)) return false;
    let support = false, lavaBelow = false;
    for (let ix = 0; ix < W; ix++) {
      for (let iz = 0; iz < W; iz++) {
        const below = world.getBlock(x + ix, y - 1, z + iz);
        if (BLOCKS[below].solid && below !== B.CACTUS) support = true;
        if (isLava(below)) lavaBelow = true;
      }
    }
    if (support) return true;
    if (lavaBelow) return false;
    if (climb && besideWall(x, y, z)) return true; // clinging to a wall
    const here = world.getBlock(x, y, z);
    return isWater(here) && !avoidWater; // swimming
  };

  const key = (x, y, z) => ((x - sx + 512) * 1024 + (z - sz + 512)) * 256 + y;
  const hdist = (x, y, z) => Math.hypot(x - gx, (y - gy) * 1.5, z - gz);
  const start = { x: sx, y: sy, z: sz, g: 0, f: hdist(sx, sy, sz), parent: null };
  const open = new Heap();
  open.push(start);
  const best = new Map([[key(sx, sy, sz), 0]]);
  let closest = start, expanded = 0;

  while (open.size && expanded < maxNodes) {
    const n = open.pop();
    if (n.g > best.get(key(n.x, n.y, n.z))) continue; // stale entry
    expanded++;
    const hd = n.f - n.g;
    if (hd < closest.f - closest.g) closest = n;
    if (Math.abs(n.x - gx) + Math.abs(n.z - gz) <= 1 && Math.abs(n.y - gy) <= 1) { closest = n; break; }

    // Climbers can also move straight up or down along a wall.
    if (climb) {
      for (const dy of [1, -1]) {
        const y = n.y + dy;
        if (y < 1 || !standable(n.x, y, n.z) || !besideWall(n.x, y, n.z)) continue;
        const g = n.g + (dy > 0 ? 1.3 : 1);
        const k = key(n.x, y, n.z);
        if (best.has(k) && best.get(k) <= g) continue;
        best.set(k, g);
        open.push({ x: n.x, y, z: n.z, g, f: g + hdist(n.x, y, n.z), parent: n });
      }
    }
    for (const [dx, dz] of DIRS) {
      const x = n.x + dx, z = n.z + dz;
      if (Math.abs(x - sx) > range || Math.abs(z - sz) > range) continue;
      const diag = dx !== 0 && dz !== 0;
      // No corner cutting: both orthogonal neighbours must be passable at this height.
      if (diag && (!clear(n.x + dx, n.y, n.z) || !clear(n.x, n.y, n.z + dz))) continue;
      let y = null, cost = diag ? 1.414 : 1;
      if (standable(x, n.y, z)) y = n.y;
      else if (!diag && !solid(n.x, n.y + h, n.z) && standable(x, n.y + 1, z)) {
        y = n.y + 1; cost += 0.6; // jump up
      } else if (clear(x, n.y, z)) {
        for (let d = 1; d <= maxDrop; d++) {
          if (!clear(x, n.y - d, z)) break;
          if (standable(x, n.y - d, z)) { y = n.y - d; cost += 0.2 * d; break; }
        }
      }
      if (y === null || y < 1) continue;
      if (isWater(world.getBlock(x, y, z))) cost += avoidWater ? 8 : 1.5;
      const g = n.g + cost;
      const k = key(x, y, z);
      if (best.has(k) && best.get(k) <= g) continue;
      best.set(k, g);
      open.push({ x, y, z, g, f: g + hdist(x, y, z), parent: n });
    }
  }

  if (closest === start) return null;
  const path = [];
  for (let n = closest; n && n !== start; n = n.parent) path.push([n.x, n.y, n.z]);
  return path.reverse();
}
