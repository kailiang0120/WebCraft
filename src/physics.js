// Axis-separated AABB vs voxel collision for mobs.
// body: { pos: Vector3, vel: Vector3, hw (half width), height, onGround, blocked }
const EPS = 1e-4;

export function bodyCollides(world, x, y, z, hw, h) {
  const x0 = Math.floor(x - hw), x1 = Math.floor(x + hw - EPS);
  const y0 = Math.floor(y), y1 = Math.floor(y + h - EPS);
  const z0 = Math.floor(z - hw), z1 = Math.floor(z + hw - EPS);
  for (let by = y0; by <= y1; by++) {
    for (let bz = z0; bz <= z1; bz++) {
      for (let bx = x0; bx <= x1; bx++) if (world.isSolid(bx, by, bz)) return true;
    }
  }
  return false;
}

function moveAxis(b, world, axis, d) {
  if (d === 0) return;
  const p = b.pos;
  const nx = axis === 0 ? p.x + d : p.x;
  const ny = axis === 1 ? p.y + d : p.y;
  const nz = axis === 2 ? p.z + d : p.z;
  if (!bodyCollides(world, nx, ny, nz, b.hw, b.height)) {
    p.set(nx, ny, nz);
    return;
  }
  if (axis === 1) {
    if (d < 0) {
      const snapped = Math.floor(p.y + d) + 1;
      if (!bodyCollides(world, p.x, snapped, p.z, b.hw, b.height)) p.y = snapped;
      b.onGround = true;
    } else {
      const snapped = Math.ceil(p.y + b.height + d) - 1 - b.height - EPS;
      if (!bodyCollides(world, p.x, snapped, p.z, b.hw, b.height)) p.y = snapped;
    }
    b.vel.y = 0;
  } else {
    const c = axis === 0 ? p.x : p.z;
    const snapped = d > 0 ? Math.floor(c + b.hw + d) - b.hw - EPS : Math.floor(c - b.hw + d) + 1 + b.hw + EPS;
    const hit = axis === 0
      ? bodyCollides(world, snapped, p.y, p.z, b.hw, b.height)
      : bodyCollides(world, p.x, p.y, snapped, b.hw, b.height);
    if (!hit) { if (axis === 0) p.x = snapped; else p.z = snapped; }
    if (axis === 0) b.vel.x = 0; else b.vel.z = 0;
    b.blocked = true;
  }
}

export function moveBody(b, world, dt) {
  const steps = Math.max(1, Math.ceil((b.vel.length() * dt) / 0.4));
  const sdt = dt / steps;
  b.onGround = false;
  b.blocked = false;
  for (let i = 0; i < steps; i++) {
    moveAxis(b, world, 0, b.vel.x * sdt);
    moveAxis(b, world, 2, b.vel.z * sdt);
    moveAxis(b, world, 1, b.vel.y * sdt);
  }
}

// Ray vs axis-aligned box (slab method). Returns hit distance or -1.
export function rayBox(o, d, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = 0, tmax = Infinity;
  const lo = [minX, minY, minZ], hi = [maxX, maxY, maxZ], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dd[a]) < 1e-9) {
      if (oo[a] < lo[a] || oo[a] > hi[a]) return -1;
      continue;
    }
    let t1 = (lo[a] - oo[a]) / dd[a], t2 = (hi[a] - oo[a]) / dd[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}
