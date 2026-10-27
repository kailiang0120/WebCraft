import { BLOCKS, isFluid } from './blocks.js';

// Voxel DDA (Amanatides & Woo). Returns {x,y,z,id,normal,dist} of the first selectable block
// (or water block, when `fluids` is set — used by buckets).
export function raycast(world, origin, dir, maxDist, fluids = false) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
  const tdx = sx ? Math.abs(1 / dir.x) : Infinity;
  const tdy = sy ? Math.abs(1 / dir.y) : Infinity;
  const tdz = sz ? Math.abs(1 / dir.z) : Infinity;
  let tmx = sx > 0 ? (x + 1 - origin.x) * tdx : sx < 0 ? (origin.x - x) * tdx : Infinity;
  let tmy = sy > 0 ? (y + 1 - origin.y) * tdy : sy < 0 ? (origin.y - y) * tdy : Infinity;
  let tmz = sz > 0 ? (z + 1 - origin.z) * tdz : sz < 0 ? (origin.z - z) * tdz : Infinity;
  let normal = [0, 0, 0];
  let t = 0;
  while (t <= maxDist) {
    const id = world.getBlock(x, y, z);
    if (BLOCKS[id]?.selectable || (fluids && isFluid(id))) return { x, y, z, id, normal, dist: t };
    if (tmx < tmy && tmx < tmz) {
      x += sx; t = tmx; tmx += tdx; normal = [-sx, 0, 0];
    } else if (tmy < tmz) {
      y += sy; t = tmy; tmy += tdy; normal = [0, -sy, 0];
    } else {
      z += sz; t = tmz; tmz += tdz; normal = [0, 0, -sz];
    }
  }
  return null;
}
