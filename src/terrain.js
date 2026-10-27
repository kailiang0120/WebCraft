import { Simplex, mulberry32, hash2, hash3 } from './noise.js';
import { CHUNK, HEIGHT, SEA_LEVEL, idx } from './constants.js';
import { B } from './blocks.js';

const LAVA_LEVEL = 10;

export const BIOME = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, DESERT: 4, SNOW: 5, MOUNTAINS: 6 };
export const BIOME_NAMES = ['海洋', '沙滩', '平原', '森林', '沙漠', '雪原', '山地'];

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class TerrainGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    const mk = (k) => new Simplex(mulberry32((this.seed ^ Math.imul(k, 0x9e3779b1)) >>> 0));
    this.nCont = mk(1);
    this.nDetail = mk(2);
    this.nMount = mk(3);
    this.nMountMask = mk(4);
    this.nTemp = mk(5);
    this.nHum = mk(6);
    this.nCave1 = mk(7);
    this.nCave2 = mk(8);
    this.nCave3 = mk(9);
    this.nSurf = mk(10);
  }

  fbm(n, x, z, oct) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += n.noise2(x * freq, z * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  column(x, z) {
    const c = this.fbm(this.nCont, x / 512, z / 512, 4);
    const d = this.fbm(this.nDetail, x / 96, z / 96, 3);
    const mm = smoothstep(0.05, 0.45, this.fbm(this.nMountMask, x / 420, z / 420, 2));
    const r = 1 - Math.abs(this.fbm(this.nMount, x / 160, z / 160, 4));
    let h = 64 + c * 24 + d * 6 + mm * r * r * 50;
    h = Math.floor(Math.max(3, Math.min(112, h)));

    const temp = this.fbm(this.nTemp, x / 800, z / 800, 2) - Math.max(0, h - 85) / 60;
    const hum = this.fbm(this.nHum, x / 700 + 100, z / 700, 2);
    let biome;
    if (h < SEA_LEVEL) biome = BIOME.OCEAN;
    else if (h <= SEA_LEVEL + 1 && temp > -0.25) biome = BIOME.BEACH;
    else if (h > 90 && mm > 0.3) biome = BIOME.MOUNTAINS;
    else if (temp < -0.25) biome = BIOME.SNOW;
    else if (temp > 0.18 && hum < 0) biome = BIOME.DESERT;
    else if (hum > 0.12) biome = BIOME.FOREST;
    else biome = BIOME.PLAINS;
    return { h, biome };
  }

  // 0 = solid, 1 = worm tunnel, 2 = large cavern.
  isCave(x, y, z, h) {
    if (y <= 4) return 0;
    if (h <= SEA_LEVEL + 1 && y > h - 5) return 0; // keep sea / lake floors sealed
    const a = this.nCave1.noise3(x / 36, y / 22, z / 36);
    const b = this.nCave2.noise3(x / 36, y / 22, z / 36);
    if (a * a + b * b < 0.011) return 1;
    if (y < 44 && this.nCave3.noise3(x / 64, y / 32, z / 64) > 0.6) return 2;
    return 0;
  }

  // Lava pools only fill the floors of some large caverns (patchy, like Minecraft's lava lakes).
  lavaRegion(x, z) {
    return this.nSurf.noise2(x / 90 + 50, z / 90 - 50) > 0.25;
  }

  generate(cx, cz) {
    const blocks = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const cols = new Array(CHUNK * CHUNK);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const seed = this.seed;

    // 1. Base terrain, surface layers, caves, water.
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const col = this.column(x, z);
        cols[lx + lz * CHUNK] = col;
        const { h, biome } = col;
        const lavaHere = this.lavaRegion(x, z);
        let top = B.GRASS, filler = B.DIRT, fillDepth = 3, deep = 0;
        switch (biome) {
          case BIOME.DESERT: top = B.SAND; filler = B.SAND; deep = B.SANDSTONE; break;
          case BIOME.BEACH: top = B.SAND; filler = B.SAND; break;
          case BIOME.SNOW: top = B.SNOW; break;
          case BIOME.MOUNTAINS:
            if (h > 102) { top = B.SNOW; filler = B.STONE; }
            else if (h > 94 || this.nSurf.noise2(x / 12, z / 12) > 0.2) { top = B.STONE; filler = B.STONE; }
            break;
          case BIOME.OCEAN: {
            const depth = SEA_LEVEL - h;
            if (depth < 6) top = filler = B.SAND;
            else top = filler = this.nSurf.noise2(x / 20, z / 20) > 0 ? B.GRAVEL : B.DIRT;
            break;
          }
        }
        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0) id = B.BEDROCK;
          else if (y <= 3 && hash3(seed, x, y, z) < (4 - y) * 0.25) id = B.BEDROCK;
          else if (y === h) id = top;
          else if (y > h - 1 - fillDepth) id = filler;
          else if (deep && y > h - 8) id = deep;
          else id = B.STONE;
          // The bottoms of some deep caverns are flooded with lava, like Minecraft's lava lakes.
          if (id !== B.BEDROCK) {
            const cave = this.isCave(x, y, z, h);
            if (cave) id = cave === 2 && lavaHere && y <= LAVA_LEVEL ? B.LAVA : B.AIR;
          }
          blocks[idx(lx, y, lz)] = id;
        }
        for (let y = h + 1; y <= SEA_LEVEL; y++) blocks[idx(lx, y, lz)] = B.WATER;
      }
    }

    // 2. Ore veins.
    const rng = mulberry32(Math.floor(hash2(seed + 7, cx, cz) * 4294967296));
    const ORES = [
      [B.COAL_ORE, 20, 5, 100, 10],
      [B.IRON_ORE, 14, 5, 64, 7],
      [B.GOLD_ORE, 3, 5, 32, 6],
      [B.DIAMOND_ORE, 2, 3, 16, 5],
    ];
    for (const [id, veins, ymin, ymax, size] of ORES) {
      for (let v = 0; v < veins; v++) {
        let x = Math.floor(rng() * 16), y = ymin + Math.floor(rng() * (ymax - ymin)), z = Math.floor(rng() * 16);
        for (let s = 0; s < size; s++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < HEIGHT) {
            const i = idx(x, y, z);
            if (blocks[i] === B.STONE) blocks[i] = id;
          }
          x += Math.floor(rng() * 3) - 1;
          y += Math.floor(rng() * 3) - 1;
          z += Math.floor(rng() * 3) - 1;
        }
      }
    }

    // 3. Trees (also from neighbouring columns so canopies cross chunk borders seamlessly).
    const set = (x, y, z, id, onlyAir) => {
      const lx = x - x0, lz = z - z0;
      if (lx < 0 || lx >= 16 || lz < 0 || lz >= 16 || y < 0 || y >= HEIGHT) return;
      const i = idx(lx, y, lz);
      if (onlyAir && blocks[i] !== B.AIR && blocks[i] !== B.TALL_GRASS) return;
      blocks[i] = id;
    };
    for (let gz = z0 - 3; gz < z0 + 19; gz++) {
      for (let gx = x0 - 3; gx < x0 + 19; gx++) {
        const r = hash2(seed + 101, gx, gz);
        if (r > 0.04) continue;
        const inside = gx >= x0 && gx < x0 + 16 && gz >= z0 && gz < z0 + 16;
        const col = inside ? cols[gx - x0 + (gz - z0) * 16] : this.column(gx, gz);
        const density = col.biome === BIOME.FOREST ? 0.035 : col.biome === BIOME.SNOW ? 0.012
          : col.biome === BIOME.PLAINS ? 0.004 : 0;
        if (r >= density || col.h <= SEA_LEVEL || col.h > 100) continue;
        if (this.isCave(gx, col.h, gz, col.h)) continue;
        const base = col.h + 1;
        const r2 = hash2(seed + 102, gx, gz);
        if (col.biome === BIOME.SNOW) this.spruce(set, gx, base, gz, r2);
        else this.oak(set, gx, base, gz, r2);
      }
    }

    // 4. Plants & cacti.
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const { h, biome } = cols[lx + lz * CHUNK];
        if (h + 1 >= HEIGHT) continue;
        const x = x0 + lx, z = z0 + lz;
        const surf = blocks[idx(lx, h, lz)];
        const above = idx(lx, h + 1, lz);
        if (blocks[above] !== B.AIR) continue;
        const r = hash2(seed + 202, x, z);
        if (surf === B.GRASS && (biome === BIOME.PLAINS || biome === BIOME.FOREST)) {
          const g = biome === BIOME.PLAINS ? 0.1 : 0.05;
          if (r < g) blocks[above] = B.TALL_GRASS;
          else if (r < g + 0.012) blocks[above] = B.DANDELION;
          else if (r < g + 0.02) blocks[above] = B.POPPY;
        } else if (surf === B.SAND && biome === BIOME.DESERT && r < 0.006) {
          const ch = 1 + Math.floor(hash2(seed + 203, x, z) * 3);
          for (let k = 0; k < ch && h + 1 + k < HEIGHT; k++) blocks[idx(lx, h + 1 + k, lz)] = B.CACTUS;
        }
      }
    }
    return blocks;
  }

  oak(set, x, base, z, r) {
    const th = 4 + Math.floor(r * 3);
    for (let dy = th - 3; dy <= th; dy++) {
      const rad = dy >= th - 1 ? 1 : 2;
      for (let dx = -rad; dx <= rad; dx++) {
        for (let dz = -rad; dz <= rad; dz++) {
          if (Math.abs(dx) === rad && Math.abs(dz) === rad
            && (dy >= th - 1 || hash3(this.seed + 5, x + dx, base + dy, z + dz) < 0.5)) continue;
          set(x + dx, base + dy, z + dz, B.LEAVES, true);
        }
      }
    }
    for (let y = 0; y < th; y++) set(x, base + y, z, B.LOG, false);
  }

  spruce(set, x, base, z, r) {
    const th = 6 + Math.floor(r * 3);
    set(x, base + th, z, B.LEAVES, true);
    for (let dy = th - 1; dy >= 2; dy--) {
      const rad = dy > th - 3 ? 1 : (th - dy) % 2 === 0 ? 1 : 2;
      for (let dx = -rad; dx <= rad; dx++) {
        for (let dz = -rad; dz <= rad; dz++) {
          if (Math.abs(dx) === rad && Math.abs(dz) === rad && rad > 0) continue;
          set(x + dx, base + dy, z + dz, B.LEAVES, true);
        }
      }
    }
    for (let y = 0; y < th; y++) set(x, base + y, z, B.LOG, false);
  }
}
