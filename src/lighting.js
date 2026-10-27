// Block light: breadth-first flood fill (Minecraft style). Light loses 1 level per block and
// cannot pass through opaque blocks, so walls properly block torch light.
import { BLOCKS, B } from './blocks.js';
import { CHUNK, HEIGHT } from './constants.js';
import { PX, PXZ, PAD_SIZE } from './mesher.js';

export const LIGHT_EMIT = new Uint8Array(256);
LIGHT_EMIT[B.TORCH] = 14;
LIGHT_EMIT[B.WISP_LAMP] = 15;
LIGHT_EMIT[B.FIRE] = 15;
for (const d of BLOCKS) if (d?.fluid === 'lava') LIGHT_EMIT[d.id] = 15;
export const LIT_FURNACE_LIGHT = 13;
export const MAX_LIGHT_REACH = 15;

const BLOCKS_LIGHT = new Uint8Array(256);
for (const d of BLOCKS) if (d && d.opaque && d.render === 'cube') BLOCKS_LIGHT[d.id] = 1;
export const blocksLight = (id) => BLOCKS_LIGHT[id] === 1;

// Extra light lost when passing through a block: 255 = blocks light entirely,
// 1 = leaves & water (each block dims light by one more level, like Minecraft).
export const ATTEN = new Uint8Array(256);
for (const d of BLOCKS) {
  if (!d) continue;
  if (BLOCKS_LIGHT[d.id]) ATTEN[d.id] = 255;
  else if (d.id === B.LEAVES || d.fluid === 'water') ATTEN[d.id] = 1;
}
export const lightAttenuation = (id) => ATTEN[id];

// ---------- static light for one chunk (3x3 chunk working volume) ----------
// Any light that can reach the centre chunk starts within 15 blocks of it, so a 48x48 volume
// (the chunk plus its 8 neighbours) gives exact results.
const S = CHUNK * 3; // 48
const SS = S * S;
const VOL = SS * HEIGHT;
const att = new Uint8Array(VOL); // per-cell attenuation (255 = opaque)
const blk = new Uint8Array(VOL);
const sky = new Uint8Array(VOL);
const queue = new Int32Array(VOL);

// BFS flood fill: each step loses one level (+ the target's attenuation); opaque cells stop light.
function flood(vol, head, tail) {
  const push = (n, nl) => {
    const a = att[n];
    if (a === 255) return;
    const v = nl - a;
    if (vol[n] >= v) return;
    vol[n] = v;
    queue[tail] = n;
    tail = (tail + 1) % VOL;
  };
  while (head !== tail) {
    const i = queue[head];
    head = (head + 1) % VOL;
    const l = vol[i];
    if (l <= 1) continue;
    const y = (i / SS) | 0, rem = i - y * SS, z = (rem / S) | 0, x = rem - z * S;
    const nl = l - 1;
    if (x > 0) push(i - 1, nl);
    if (x < S - 1) push(i + 1, nl);
    if (z > 0) push(i - S, nl);
    if (z < S - 1) push(i + S, nl);
    if (y > 0) push(i - SS, nl);
    if (y < HEIGHT - 1) push(i + SS, nl);
  }
}

function extract(vol, topValue) {
  const pad = new Uint8Array(PAD_SIZE);
  const chunk = new Uint8Array(CHUNK * CHUNK * HEIGHT);
  for (let pz = 0; pz < PX; pz++) {
    for (let px = 0; px < PX; px++) {
      let si = (px - 1 + CHUNK) + (pz - 1 + CHUNK) * S;
      let di = px + pz * PX + PXZ;
      for (let y = 0; y < HEIGHT; y++) {
        pad[di] = vol[si];
        si += SS;
        di += PXZ;
      }
      pad[px + pz * PX + (HEIGHT + 1) * PXZ] = topValue; // above the world
    }
  }
  for (let y = 0; y < HEIGHT; y++) {
    for (let z = 0; z < CHUNK; z++) {
      const si = CHUNK + (z + CHUNK) * S + y * SS;
      chunk.set(vol.subarray(si, si + CHUNK), (z << 4) | (y << 8));
    }
  }
  return { pad, chunk };
}

/**
 * nb: 9 neighbouring chunk block arrays (row-major dz,dx from -1..1).
 * sources: block-light emitters as a flat array [x, y, z, level, ...] in volume coordinates (0..47).
 * Returns padded (for the mesher) and centre-chunk arrays for block light and sky light.
 */
export function computeChunkLight(nb, sources) {
  // Attenuation volume + straight-down sky light per column.
  sky.fill(0);
  let maxCovered = 0; // above this height every cell has full sky light
  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const c = nb[(z >> 4) * 3 + (x >> 4)];
      const base = (x & 15) | ((z & 15) << 4);
      const col = x + z * S;
      let l = 15, blocked = false;
      for (let y = HEIGHT - 1; y >= 0; y--) {
        const a = ATTEN[c[base | (y << 8)]];
        const i = col + y * SS;
        att[i] = a;
        if (blocked) continue;
        if (a === 255) { blocked = true; maxCovered = Math.max(maxCovered, y + 1); continue; }
        l = Math.max(0, l - a);
        if (l < 15) maxCovered = Math.max(maxCovered, y + 1);
        sky[i] = l;
      }
    }
  }

  // Block light from emitters.
  blk.fill(0);
  let tail = 0;
  for (let k = 0; k < sources.length; k += 4) {
    const i = sources[k] + sources[k + 2] * S + sources[k + 1] * SS;
    const l = sources[k + 3];
    if (blk[i] < l) { blk[i] = l; queue[tail++] = i; }
  }
  flood(blk, 0, tail);

  // Sky light spreads sideways from every lit cell whose horizontal neighbour is darker by more than one.
  // (Vertically the column pass is already consistent.) Above maxCovered nothing can differ.
  tail = 0;
  for (let y = 0; y <= Math.min(HEIGHT - 1, maxCovered); y++) {
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < S; x++) {
        const i = x + z * S + y * SS;
        const v = sky[i];
        if (v < 2) continue;
        if ((x > 0 && att[i - 1] !== 255 && sky[i - 1] < v - 1 - att[i - 1])
          || (x < S - 1 && att[i + 1] !== 255 && sky[i + 1] < v - 1 - att[i + 1])
          || (z > 0 && att[i - S] !== 255 && sky[i - S] < v - 1 - att[i - S])
          || (z < S - 1 && att[i + S] !== 255 && sky[i + S] < v - 1 - att[i + S])) {
          queue[tail] = i;
          tail = (tail + 1) % VOL;
        }
      }
    }
  }
  flood(sky, 0, tail);

  const b = extract(blk, 0), s = extract(sky, 15);
  return { padBlock: b.pad, chunkBlock: b.chunk, padSky: s.pad, chunkSky: s.chunk };
}

// ---------- dynamic lights (held torch, glowing mobs) ----------
// Flood-filled every frame into a small 3D volume around the player, sampled by the shader.
export const DYN_SIZE = 32;
const DS = DYN_SIZE, DSS = DS * DS, DVOL = DSS * DS;
export const dynData = new Uint8Array(DVOL);
const dynLevel = new Uint8Array(DVOL);
const dynQueue = new Int32Array(DVOL);

// lights: [x, y, z, level] in world coordinates. Returns integer origin of the volume.
export function computeDynamicLight(world, cx, cy, cz, lights) {
  const ox = Math.floor(cx) - DS / 2, oy = Math.floor(cy) - DS / 2, oz = Math.floor(cz) - DS / 2;
  dynLevel.fill(0);
  for (const [lx, ly, lz, level] of lights) {
    const x0 = Math.floor(lx) - ox, y0 = Math.floor(ly) - oy, z0 = Math.floor(lz) - oz;
    if (x0 < 0 || y0 < 0 || z0 < 0 || x0 >= DS || y0 >= DS || z0 >= DS) continue;
    let head = 0, tail = 0;
    const start = x0 + z0 * DS + y0 * DSS;
    if (dynLevel[start] >= level) continue;
    dynLevel[start] = level;
    dynQueue[tail++] = start;
    // Per-light BFS; light only flows into cells where it improves the current level.
    const local = new Map([[start, level]]);
    while (head < tail) {
      const i = dynQueue[head++];
      const l = local.get(i);
      if (l <= 1) continue;
      const y = (i / DSS) | 0, rem = i - y * DSS, z = (rem / DS) | 0, x = rem - z * DS;
      const nl = l - 1;
      for (let k = 0; k < 6; k++) {
        let nx = x, ny = y, nz = z;
        if (k === 0) nx--; else if (k === 1) nx++; else if (k === 2) nz--; else if (k === 3) nz++; else if (k === 4) ny--; else ny++;
        if (nx < 0 || ny < 0 || nz < 0 || nx >= DS || ny >= DS || nz >= DS) continue;
        const ni = nx + nz * DS + ny * DSS;
        if ((local.get(ni) ?? 0) >= nl) continue;
        const a = ATTEN[world.getBlock(ox + nx, oy + ny, oz + nz)];
        if (a === 255) continue;
        const v = nl - a;
        if ((local.get(ni) ?? 0) >= v) continue;
        local.set(ni, v);
        if (dynLevel[ni] < v) dynLevel[ni] = v;
        dynQueue[tail++] = ni;
      }
    }
  }
  for (let i = 0; i < DVOL; i++) dynData[i] = dynLevel[i] * 17;
  return [ox, oy, oz];
}

export function dynamicLevelAt(origin, x, y, z) {
  const lx = Math.floor(x) - origin[0], ly = Math.floor(y) - origin[1], lz = Math.floor(z) - origin[2];
  if (lx < 0 || ly < 0 || lz < 0 || lx >= DS || ly >= DS || lz >= DS) return 0;
  return dynLevel[lx + lz * DS + ly * DSS];
}
