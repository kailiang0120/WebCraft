// Builds chunk geometry from a padded block volume (chunk + 1-block border from neighbours).
import { BLOCKS, B, FLAMMABILITY } from './blocks.js';
import { HEIGHT } from './constants.js';
import { tileIndex, tileUV } from './textures.js';

export const PX = 18;
export const PXZ = PX * PX;
export const PAD_SIZE = PXZ * (HEIGHT + 2);
export const padIndex = (x, y, z) => (x + 1) + (z + 1) * PX + (y + 1) * PXZ;

// Copy the centre chunk plus a 1-block border from its 8 neighbours (nb: row-major dz,dx -1..1).
export function buildPad(nb, pad = new Uint8Array(PAD_SIZE)) {
  for (let pz = 0; pz < PX; pz++) {
    const z = pz - 1, ncz = z < 0 ? 0 : z > 15 ? 2 : 1, lz = (z + 16) & 15;
    for (let px = 0; px < PX; px++) {
      const x = px - 1, ncx = x < 0 ? 0 : x > 15 ? 2 : 1, lx = (x + 16) & 15;
      const src = nb[ncz * 3 + ncx];
      let si = lx | (lz << 4);
      let di = px + pz * PX + PXZ;
      for (let y = 0; y < HEIGHT; y++) {
        pad[di] = src[si];
        si += 256;
        di += PXZ;
      }
      pad[px + pz * PX] = B.BEDROCK;
      pad[px + pz * PX + (HEIGHT + 1) * PXZ] = B.AIR;
    }
  }
  return pad;
}

// Face order matches THREE.BoxGeometry: +X, -X, +Y, -Y, +Z, -Z.
// Corners listed bottom-left, bottom-right, top-right, top-left as seen from outside.
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.8 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.8 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.55 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.9 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.9 },
];
export const FACE_NORMALS = FACES.map((f) => f.n);
const FACE_UV = [
  (p) => [1 - p[2], p[1]],
  (p) => [p[2], p[1]],
  (p) => [p[0], 1 - p[2]],
  (p) => [p[0], p[2]],
  (p) => [p[0], p[1]],
  (p) => [1 - p[0], p[1]],
];
const AO_CURVE = [0.5, 0.68, 0.84, 1.0];

const off = (dx, dy, dz) => dx + dz * PX + dy * PXZ;
const NOFF = FACES.map((f) => off(...f.n));
// For each face/corner: padded offsets of side1, side2, corner neighbours (relative to the block).
const AO_OFF = FACES.map((f) => {
  const axes = [0, 1, 2].filter((a) => f.n[a] === 0);
  return f.c.map((c) => {
    const t1 = [0, 0, 0], t2 = [0, 0, 0];
    t1[axes[0]] = c[axes[0]] ? 1 : -1;
    t2[axes[1]] = c[axes[1]] ? 1 : -1;
    const s1 = off(f.n[0] + t1[0], f.n[1] + t1[1], f.n[2] + t1[2]);
    const s2 = off(f.n[0] + t2[0], f.n[1] + t2[1], f.n[2] + t2[2]);
    const cc = off(f.n[0] + t1[0] + t2[0], f.n[1] + t1[1] + t2[1], f.n[2] + t1[2] + t2[2]);
    return [s1, s2, cc];
  });
});

// Per-block lookup tables.
const OPAQUE = new Uint8Array(256);
const AO_OCC = new Uint8Array(256);
const FACE_TILE = new Int16Array(256 * 6);
const TILE_UVS = new Float32Array(256 * 4);
const RENDER = new Uint8Array(256); // 0 none, 1 cube, 2 liquid, 3 cross, 4 torch, 5 box
const FLUID = new Uint8Array(256);
const LEVEL = new Uint8Array(256);
const CULL_SAME = new Uint8Array(256);
const FACING = new Uint8Array(256);
const SOLID = new Uint8Array(256);
const FLAM = new Uint8Array(256);
const RENDER_CODES = { cube: 1, liquid: 2, cross: 3, torch: 4, box: 5, fire: 6 };
let FURNACE_LIT_TILE = 0;
let FIRE_TILE_1 = 0;
let initDone = false;

function init() {
  initDone = true;
  FURNACE_LIT_TILE = tileIndex('furnace_front_lit');
  FIRE_TILE_1 = tileIndex('fire_1');
  for (let i = 0; i < 256; i++) { SOLID[i] = BLOCKS[i]?.solid ? 1 : 0; FLAM[i] = FLAMMABILITY[i] ? 1 : 0; }
  for (let t = 0; t < 256; t++) TILE_UVS.set(tileUV(t), t * 4);
  for (const d of BLOCKS) {
    if (!d || !d.tex) continue;
    RENDER[d.id] = RENDER_CODES[d.render] || 0;
    FLUID[d.id] = d.fluid === 'water' ? 1 : d.fluid === 'lava' ? 2 : 0;
    LEVEL[d.id] = d.level || 0;
    CULL_SAME[d.id] = d.cullSame ? 1 : 0;
    FACING[d.id] = d.facing ? 1 : 0;
    OPAQUE[d.id] = d.opaque && d.render === 'cube' ? 1 : 0;
    AO_OCC[d.id] = OPAQUE[d.id] || d.id === B.LEAVES ? 1 : 0;
    const t = d.tex;
    const side = tileIndex(t.side), front = tileIndex(t.front);
    FACE_TILE[d.id * 6 + 0] = side;
    FACE_TILE[d.id * 6 + 1] = side;
    FACE_TILE[d.id * 6 + 2] = tileIndex(t.top);
    FACE_TILE[d.id * 6 + 3] = tileIndex(t.bottom);
    // Crafting table shows its "front" on both Z faces; facing blocks override per entity.
    FACE_TILE[d.id * 6 + 4] = d.id === B.CRAFTING_TABLE ? front : side;
    FACE_TILE[d.id * 6 + 5] = d.id === B.CRAFTING_TABLE ? front : side;
  }
}

export function isOpaque(id) {
  if (!initDone) init();
  return OPAQUE[id] === 1;
}

class Builder {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.light = [];
    this.index = [];
    this.n = 0;
  }
  quad(p, uv, l, flip) {
    for (let k = 0; k < 4; k++) {
      this.pos.push(p[k][0], p[k][1], p[k][2]);
      this.uv.push(uv[k][0], uv[k][1]);
      this.light.push(l[k][0], l[k][1], l[k][2]);
    }
    const n = this.n;
    if (flip) this.index.push(n + 1, n + 2, n + 3, n + 1, n + 3, n);
    else this.index.push(n, n + 1, n + 2, n, n + 2, n + 3);
    this.n += 4;
  }
  // Allocation-free path used by the hot cube loop: 4 vert() calls then close().
  vert(x, y, z, u, v, l0, l1, l2) {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    this.light.push(l0, l1, l2);
  }
  close(flip) {
    const n = this.n;
    if (flip) this.index.push(n + 1, n + 2, n + 3, n + 1, n + 3, n);
    else this.index.push(n, n + 1, n + 2, n, n + 2, n + 3);
    this.n += 4;
  }
  result() {
    if (!this.n) return null;
    return {
      position: new Float32Array(this.pos),
      uv: new Float32Array(this.uv),
      light: new Float32Array(this.light),
      index: new Uint32Array(this.index),
    };
  }
}

function atlasUV(tile, u, v) {
  const r = tileUV(tile);
  return [r[0] + (r[2] - r[0]) * u, r[1] + (r[3] - r[1]) * v];
}

// Fire, modelled like Minecraft's (all sheets 1.4 blocks tall, drawn from both sides, full bright):
//  - on a floor: two crossing pairs of sheets that lean outward, one pair per axis;
//  - otherwise: a sheet pressed flat against each flammable neighbour it is clinging to.
const FIRE_H = 1.4;
function fireModel(O, pad, pi, x, y, z, sky, tile0) {
  const l = [[1, sky, 1], [1, sky, 1], [1, sky, 1], [1, sky, 1]];
  const sheet = (q, tile) => {
    const uv = [atlasUV(tile, 0, 0), atlasUV(tile, 1, 0), atlasUV(tile, 1, 1), atlasUV(tile, 0, 1)];
    O.quad(q, uv, l, false);
    O.quad([q[1], q[0], q[3], q[2]], [uv[1], uv[0], uv[3], uv[2]], l, false);
  };
  const T = y + FIRE_H;
  const below = pad[pi - PXZ];
  let drawn = false;
  if (!SOLID[below] && !FLAM[below]) {
    // Against walls: +X, -X, +Z, -Z neighbours.
    const e = 0.02;
    const sides = [
      [1, [[x + 1 - e, y, z], [x + 1 - e, y, z + 1], [x + 1 - e, T, z + 1], [x + 1 - e, T, z]]],
      [-1, [[x + e, y, z + 1], [x + e, y, z], [x + e, T, z], [x + e, T, z + 1]]],
      [PX, [[x + 1, y, z + 1 - e], [x, y, z + 1 - e], [x, T, z + 1 - e], [x + 1, T, z + 1 - e]]],
      [-PX, [[x, y, z + e], [x + 1, y, z + e], [x + 1, T, z + e], [x, T, z + e]]],
    ];
    sides.forEach(([o, q], k) => {
      if (!FLAM[pad[pi + o]]) return;
      sheet(q, k < 2 ? tile0 : FIRE_TILE_1);
      drawn = true;
    });
  }
  if (drawn) return;
  const a = 0.34, b = 0.92; // bottom / top offsets of the leaning sheets
  sheet([[x, y, z + a], [x + 1, y, z + a], [x + 1, T, z + b], [x, T, z + b]], tile0);
  sheet([[x + 1, y, z + 1 - a], [x, y, z + 1 - a], [x, T, z + 1 - b], [x + 1, T, z + 1 - b]], tile0);
  sheet([[x + 1 - a, y, z], [x + 1 - a, y, z + 1], [x + 1 - b, T, z + 1], [x + 1 - b, T, z]], FIRE_TILE_1);
  sheet([[x + a, y, z + 1], [x + a, y, z], [x + b, T, z], [x + b, T, z + 1]], FIRE_TILE_1);
}

// pad: padded block volume; padLight: matching block-light levels (0-15).
// entityAt(lx,y,lz) -> block entity or undefined.
export function meshChunk(pad, padLight, padSky, entityAt) {
  if (!initDone) init();
  const skyAt = (pi) => padSky[pi];
  // Fluid surface height of a padded cell (-1 if not this kind of fluid). Fluid with the same fluid
  // above fills the whole block.
  const waterHeight = (pi, kind = FLUID[pad[pi]]) => {
    const id = pad[pi];
    if (!kind || FLUID[id] !== kind) return -1;
    if (FLUID[pad[pi + PXZ]] === kind) return 1;
    const l = LEVEL[id];
    return l === 0 || l === 8 ? 0.875 : (8 - l) / 9;
  };
  // Corner height: average of the (up to 4) same-fluid cells sharing that vertical edge.
  const cornerHeight = (pi, cx, cz) => {
    const kind = FLUID[pad[pi]];
    let sum = 0, n = 0;
    for (const dx of cx ? [0, 1] : [-1, 0]) {
      for (const dz of cz ? [0, 1] : [-1, 0]) {
        const q = pi + dx + dz * PX;
        if (FLUID[pad[q + PXZ]] === kind && FLUID[pad[q]] === kind) return 1;
        const h = waterHeight(q, kind);
        if (h >= 0) { sum += h; n++; }
      }
    }
    return n ? sum / n : 0.875;
  };

  const O = new Builder();
  const W = new Builder();
  const P = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const UV = [[0, 0], [0, 0], [0, 0], [0, 0]];
  const L = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const ao = [0, 0, 0, 0];

  const box = (B_, x, y, z, min, max, tiles, sky, blk) => {
    for (let f = 0; f < 6; f++) {
      const face = FACES[f];
      const tile = tiles[f];
      for (let k = 0; k < 4; k++) {
        const c = face.c[k];
        const lp = [min[0] + c[0] * (max[0] - min[0]), min[1] + c[1] * (max[1] - min[1]), min[2] + c[2] * (max[2] - min[2])];
        P[k] = [x + lp[0], y + lp[1], z + lp[2]];
        const [u, v] = FACE_UV[f](lp);
        UV[k] = atlasUV(tile, u, v);
        L[k] = [face.shade, sky, blk];
      }
      B_.quad(P, UV, L, false);
    }
  };

  for (let y = 0; y < HEIGHT; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const pi = padIndex(x, y, z);
        const id = pad[pi];
        const render = RENDER[id];
        if (!render) continue;

        if (render === 1) {
          let ent = null;
          for (let f = 0; f < 6; f++) {
            const nid = pad[pi + NOFF[f]];
            if (OPAQUE[nid] || (nid === id && CULL_SAME[id])) continue;
            let tile = FACE_TILE[id * 6 + f];
            if (FACING[id]) {
              const d = BLOCKS[id];
              if (ent === null) ent = entityAt(x, y, z) || false;
              const facing = ent ? ent.facing : 4;
              if (f === facing) tile = id === B.FURNACE && ent && ent.lit ? FURNACE_LIT_TILE : tileIndex(d.tex.front);
            }
            const face = FACES[f];
            const base = pi + NOFF[f];
            const aoOff = AO_OFF[f];
            const t4 = tile * 4;
            const baseSky = skyAt(base);
            const baseBlk = padLight[base];
            for (let k = 0; k < 4; k++) {
              const o = aoOff[k];
              const n1 = pad[pi + o[0]], n2 = pad[pi + o[1]], n3 = pad[pi + o[2]];
              const s1 = AO_OCC[n1], s2 = AO_OCC[n2], cc = AO_OCC[n3];
              const a = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
              ao[k] = a;
              // Smooth lighting: average sky & block light over the open cells touching this vertex.
              let sum = baseSky, bsum = baseBlk, cnt = 1;
              const o1 = !OPAQUE[n1], o2 = !OPAQUE[n2];
              if (o1) { sum += skyAt(pi + o[0]); bsum += padLight[pi + o[0]]; cnt++; }
              if (o2) { sum += skyAt(pi + o[1]); bsum += padLight[pi + o[1]]; cnt++; }
              if ((o1 || o2) && !OPAQUE[n3]) { sum += skyAt(pi + o[2]); bsum += padLight[pi + o[2]]; cnt++; }
              const c = face.c[k];
              O.vert(x + c[0], y + c[1], z + c[2],
                TILE_UVS[t4 + (k === 1 || k === 2 ? 2 : 0)], TILE_UVS[t4 + (k >= 2 ? 3 : 1)],
                AO_CURVE[a] * face.shade, sum / cnt / 15, bsum / cnt / 15);
            }
            O.close(ao[0] + ao[2] < ao[1] + ao[3]);
          }
        } else if (render === 2) {
          const sky = skyAt(pi) / 15;
          const blk = padLight[pi] / 15;
          const ch = [cornerHeight(pi, 0, 0), cornerHeight(pi, 1, 0), cornerHeight(pi, 0, 1), cornerHeight(pi, 1, 1)];
          const kind = FLUID[id];
          const out = kind === 2 ? O : W; // lava is opaque; water goes in the transparent pass
          for (let f = 0; f < 6; f++) {
            const nid = pad[pi + NOFF[f]];
            if (OPAQUE[nid]) continue;
            // Hide faces between same-fluid cells, except where a lower neighbour exposes part of our side.
            if (FLUID[nid] === kind && (f === 2 || f === 3 || waterHeight(pi + NOFF[f], kind) >= waterHeight(pi))) continue;
            if (f === 3 && nid !== B.AIR) continue;
            const face = FACES[f];
            const tile = FACE_TILE[id * 6 + f];
            for (let k = 0; k < 4; k++) {
              const c = face.c[k];
              const lp = [c[0], c[1] ? ch[c[0] + c[2] * 2] : 0, c[2]];
              P[k] = [x + lp[0], y + lp[1], z + lp[2]];
              const [u, v] = FACE_UV[f](lp);
              UV[k] = atlasUV(tile, u, v);
              L[k] = [face.shade, sky, blk];
            }
            out.quad(P, UV, L, false);
          }
        } else if (render === 3) {
          const tile = FACE_TILE[id * 6];
          const sky = skyAt(pi) / 15;
          const blk = padLight[pi] / 15;
          const a = 0.15, b = 0.85;
          for (const [p0, p1] of [[[a, a], [b, b]], [[a, b], [b, a]]]) {
            const v0 = [x + p0[0], y, z + p0[1]], v1 = [x + p1[0], y, z + p1[1]];
            const q = [v0, v1, [v1[0], y + 1, v1[2]], [v0[0], y + 1, v0[2]]];
            const uv = [atlasUV(tile, 0, 0), atlasUV(tile, 1, 0), atlasUV(tile, 1, 1), atlasUV(tile, 0, 1)];
            const l = [[0.92, sky, blk], [0.92, sky, blk], [0.92, sky, blk], [0.92, sky, blk]];
            O.quad(q, uv, l, false);
            O.quad([q[1], q[0], q[3], q[2]], [uv[1], uv[0], uv[3], uv[2]], l, false);
          }
        } else if (render === 4) {
          const tile = FACE_TILE[id * 6];
          box(O, x, y, z, [7 / 16, 0, 7 / 16], [9 / 16, 10 / 16, 9 / 16], [tile, tile, tile, tile, tile, tile], skyAt(pi) / 15, 1);
        } else if (render === 5) {
          const d = BLOCKS[id];
          const tiles = [];
          let facing = -1;
          if (d.facing) facing = (entityAt(x, y, z) || { facing: 4 }).facing;
          for (let f = 0; f < 6; f++) tiles.push(f === facing ? tileIndex(d.tex.front) : FACE_TILE[id * 6 + f]);
          const bx = d.box;
          box(O, x, y, z, [bx[0], bx[1], bx[2]], [bx[3], bx[4], bx[5]], tiles, skyAt(pi) / 15, padLight[pi] / 15);
        } else if (render === 6) {
          fireModel(O, pad, pi, x, y, z, skyAt(pi) / 15, FACE_TILE[id * 6]);
        }
      }
    }
  }
  return { opaque: O.result(), water: W.result() };
}
