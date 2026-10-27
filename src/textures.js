// Procedurally painted 16x16 pixel-art tiles packed into one 256x256 texture atlas.
import { TOOL_MATERIALS, TOOL_TYPES, ARMOR_MATERIALS, ARMOR_SLOTS } from './blocks.js';

export const TILE = 16;
export const ATLAS_COLS = 16;
export const ATLAS_SIZE = TILE * ATLAS_COLS;

export const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
export const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function mkRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Painter {
  constructor(seed) {
    this.d = new Uint8ClampedArray(TILE * TILE * 4);
    this.r = mkRand(seed);
  }
  ri(n) { return Math.floor(this.r() * n); }
  set(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x > 15 || y > 15) return;
    const i = (y * 16 + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a;
  }
  get(x, y) { const i = (y * 16 + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2]]; }
  a(x, y) { return x < 0 || y < 0 || x > 15 || y > 15 ? 0 : this.d[(y * 16 + x) * 4 + 3]; }
  v(c, amt) { return mul(c, 1 + (this.r() * 2 - 1) * amt); }
  fill(c, amt = 0) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) this.set(x, y, this.v(c, amt)); }
  speckle(n, c, amt = 0.05) { for (let i = 0; i < n; i++) this.set(this.ri(16), this.ri(16), this.v(c, amt)); }
  scale(x, y, f) { if (this.a(x, y)) this.set(x, y, mul(this.get(x, y), f), this.a(x, y)); }
  border(c) {
    for (let i = 0; i < 16; i++) { this.set(i, 0, c); this.set(i, 15, c); this.set(0, i, c); this.set(15, i, c); }
  }
  rect(x0, y0, x1, y1, c, amt = 0) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, this.v(c, amt));
  }
  // Item look: bevel highlight + dark outline around the opaque shape.
  outline() {
    const src = new Uint8ClampedArray(this.d);
    const op = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && src[(y * 16 + x) * 4 + 3] > 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (op(x, y)) {
          if (!op(x - 1, y) || !op(x, y - 1)) this.scale(x, y, 1.18);
          else if (!op(x + 1, y) || !op(x, y + 1)) this.scale(x, y, 0.78);
          continue;
        }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (op(x + dx, y + dy)) {
            const i = ((y + dy) * 16 + x + dx) * 4;
            this.set(x, y, mul([src[i], src[i + 1], src[i + 2]], 0.3));
            break;
          }
        }
      }
    }
  }
}

// ---------- shared painters ----------
function paintStone(p, base = hex(0x7f7f7f)) {
  p.fill(base, 0.05);
  for (let i = 0; i < 12; i++) {
    const x = p.ri(16), y = p.ri(16), len = 1 + p.ri(3);
    for (let k = 0; k < len; k++) p.set(x + k, y, p.v(mul(base, 0.84), 0.04));
  }
  p.speckle(10, mul(base, 1.12), 0.03);
}

function paintDirt(p) {
  p.fill(hex(0x866043), 0.07);
  p.speckle(26, hex(0x6b4a30), 0.05);
  p.speckle(12, hex(0x9a7352), 0.05);
  p.speckle(5, hex(0x7d7d7d), 0.05);
}

function paintPlanks(p, base = hex(0xa8854f)) {
  for (let y = 0; y < 16; y++) {
    const row = y >> 2;
    const seamX = (row * 7 + 3) % 16;
    for (let x = 0; x < 16; x++) {
      let c = mul(base, row % 2 ? 0.96 : 1.03);
      if (y % 4 === 3) c = mul(base, 0.66);
      else if (x === seamX) c = mul(base, 0.72);
      p.set(x, y, p.v(c, 0.04));
    }
  }
  for (let i = 0; i < 14; i++) {
    const x = p.ri(15), y = p.ri(16);
    if (y % 4 !== 3) { p.scale(x, y, 0.88); p.scale(x + 1, y, 0.9); }
  }
}

function voronoiStones(p, base, mortar) {
  const pts = [];
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      pts.push([(gx + 0.2 + p.r() * 0.6) * 16 / 3, (gy + 0.2 + p.r() * 0.6) * 16 / 3, 0.8 + p.r() * 0.4]);
    }
  }
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let d1 = 1e9, d2 = 1e9, best = 0;
      pts.forEach((pt, k) => {
        for (const ox of [-16, 0, 16]) {
          for (const oy of [-16, 0, 16]) {
            const dx = x + 0.5 - (pt[0] + ox), dy = y + 0.5 - (pt[1] + oy);
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < d1) { d2 = d1; d1 = d; best = k; } else if (d < d2) d2 = d;
          }
        }
      });
      const edge = d2 - d1;
      if (edge < 1.1) p.set(x, y, p.v(mortar, 0.08));
      else {
        let c = mul(base, pts[best][2]);
        if (edge < 2) c = mul(c, 0.86);
        p.set(x, y, p.v(c, 0.06));
      }
    }
  }
}

function ore(p, c1, c2) {
  paintStone(p);
  for (let k = 0; k < 5; k++) {
    const x = 1 + p.ri(13), y = 1 + p.ri(13);
    p.set(x, y, p.v(c1, 0.05));
    p.set(x + 1, y, p.v(p.r() < 0.5 ? c1 : c2, 0.05));
    p.set(x, y + 1, p.v(c2, 0.05));
    if (p.r() < 0.6) p.set(x + 1, y + 1, p.v(c1, 0.05));
  }
}

function metalBlock(p, base) {
  p.fill(base, 0.03);
  for (let i = 0; i < 16; i++) {
    p.set(i, 0, mul(base, 1.25)); p.set(0, i, mul(base, 1.25));
    p.set(i, 15, mul(base, 0.68)); p.set(15, i, mul(base, 0.68));
  }
  for (let i = 2; i < 14; i++) {
    p.set(i, 2, mul(base, 0.85)); p.set(2, i, mul(base, 0.85));
    p.set(i, 13, mul(base, 1.12)); p.set(13, i, mul(base, 1.12));
  }
}

function paintFurnaceSide(p) {
  paintStone(p, hex(0x737373));
  p.border(hex(0x4a4a4a));
}

// flameRand: separate random source for the flames, so they can flicker while the stone stays put.
function furnaceFront(p, lit, flameRand = p.r) {
  paintFurnaceSide(p);
  p.rect(4, 2, 11, 4, hex(0x555555), 0.05);
  p.rect(3, 7, 12, 7, hex(0x3d3d3d));
  p.rect(3, 8, 12, 13, hex(0x161616));
  if (lit) {
    for (let y = 9; y <= 13; y++) {
      for (let x = 4; x <= 11; x++) {
        const t = (y - 9) / 4;
        if (flameRand() < 0.25 + t * 0.7) p.set(x, y, mix(hex(0xff6a00), hex(0xffe14a), flameRand() * t));
      }
    }
  } else {
    p.rect(4, 11, 11, 11, hex(0x2c2c2c));
  }
}

function chestBase(p) {
  p.fill(hex(0xa26b2c), 0.06);
  for (let y = 0; y < 16; y++) if (y % 4 === 0) for (let x = 0; x < 16; x++) p.scale(x, y, 0.85);
  p.border(hex(0x3d2810));
}

function cross(p) { p.d.fill(0); }

// ---------- item painters ----------
const HANDLE = hex(0x6b4c24), HANDLE2 = hex(0x8a6634);

function handle(p, x0, x1) {
  for (let x = x0; x <= x1; x++) p.set(x, 15 - x, x % 2 ? HANDLE2 : HANDLE);
}

function tool(p, type, color) {
  p.d.fill(0);
  const M = hex(color);
  const shade = (along) => mul(M, 0.85 + along * 0.02);
  const each = (fn) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const u = x + 0.5 - 2.5, w = 13.5 - (y + 0.5);
        fn(x, y, (u + w) / Math.SQRT2, (w - u) / Math.SQRT2, u, w);
      }
    }
  };
  if (type === 'pickaxe') {
    handle(p, 2, 10);
    each((x, y, along, perp, u, w) => {
      const d = Math.hypot(u, w);
      const ang = (Math.atan2(w, u) * 180) / Math.PI;
      const off = Math.abs(ang - 45);
      if (off <= 42 && Math.abs(d - 12) < 1.25 - off / 60) p.set(x, y, shade(12 - off / 6));
    });
  } else if (type === 'axe') {
    handle(p, 2, 11);
    each((x, y, along, perp) => {
      if (along > 7 && along < 12.6 && perp > 0.3 && perp < 4.4 - Math.abs(along - 9.8) * 0.6) {
        p.set(x, y, perp > 3 ? mul(M, 1.1) : shade(along));
      }
    });
  } else if (type === 'shovel') {
    handle(p, 2, 9);
    each((x, y, along, perp) => {
      const e = ((along - 12.2) / 3.0) ** 2 + (perp / 2.1) ** 2;
      if (e < 1) p.set(x, y, shade(along));
    });
  } else if (type === 'sword') {
    each((x, y, along, perp) => {
      const ap = Math.abs(perp);
      if (along > 5.4 && along < 15.4 && ap < (along > 14 ? 0.3 : 0.75)) p.set(x, y, shade(along));
      else if (along >= 4.2 && along <= 5.4 && ap < 2.9) p.set(x, y, mul(HANDLE, 0.8));
      else if (along > 1.4 && along < 4.2 && ap < 0.4) p.set(x, y, HANDLE2);
      else if (along > 0.4 && along <= 1.4 && ap < 0.75) p.set(x, y, M);
    });
  }
  p.outline();
}

function ingot(p, base) {
  p.d.fill(0);
  p.rect(5, 5, 12, 5, mul(base, 1.25), 0.03);
  p.rect(4, 6, 12, 6, mul(base, 1.12), 0.03);
  p.rect(3, 7, 12, 9, base, 0.03);
  p.rect(3, 10, 12, 10, mul(base, 0.72), 0.03);
  for (let y = 6; y <= 10; y++) p.set(13, y, mul(base, 0.65));
  p.outline();
}

// ---------- tile table ----------
const TILES = [];
const def = (name, fn) => TILES.push([name, fn]);

def('stone', (p) => paintStone(p));
def('cobblestone', (p) => voronoiStones(p, hex(0x7b7b7b), hex(0x474747)));
def('dirt', paintDirt);
def('grass_top', (p) => {
  p.fill(hex(0x62a83c), 0.09);
  p.speckle(34, hex(0x4e8c2e), 0.05);
  p.speckle(14, hex(0x78bd4c), 0.05);
});
def('grass_side', (p) => {
  paintDirt(p);
  for (let x = 0; x < 16; x++) {
    const h = 3 + (p.r() < 0.5 ? 1 : 0) + (p.r() < 0.25 ? 1 : 0);
    for (let y = 0; y < h; y++) p.set(x, y, p.v(hex(0x62a83c), 0.1));
    if (p.r() < 0.4) p.set(x, h, p.v(hex(0x4e8c2e), 0.05));
  }
});
def('bedrock', (p) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const g = 40 + p.ri(5) * 22; p.set(x, y, [g, g, g]); }
});
def('sand', (p) => {
  p.fill(hex(0xdcd2a0), 0.04);
  p.speckle(25, hex(0xc9bd88), 0.03);
  p.speckle(10, hex(0xeae2b8), 0.02);
});
def('gravel', (p) => {
  const pal = [0x8a8381, 0x6e6765, 0xa29b97, 0x5b5452, 0x7d7570].map(hex);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, p.v(pal[p.ri(5)], 0.04));
});
def('log_side', (p) => {
  const base = hex(0x6b5131);
  const cf = Array.from({ length: 16 }, () => 0.85 + p.r() * 0.3);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = mul(base, cf[x]);
      if (x % 4 === 0) c = mul(c, 0.8);
      p.set(x, y, p.v(c, 0.05));
    }
  }
  for (let i = 0; i < 6; i++) {
    const x = p.ri(16), y = p.ri(14);
    p.set(x, y, mul(base, 0.6)); p.set(x, y + 1, mul(base, 0.65));
  }
});
def('log_top', (p) => {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 6.6) p.set(x, y, p.v(hex(0x6b5131), 0.08));
      else {
        const ring = Math.floor(Math.hypot(dx, dy) * 0.9) % 2;
        p.set(x, y, p.v(ring ? hex(0xb08d57) : hex(0x987444), 0.04));
      }
    }
  }
});
def('leaves', (p) => {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (p.r() < 0.16) p.set(x, y, [0, 0, 0], 0);
      else p.set(x, y, p.v(p.r() < 0.3 ? hex(0x2f6b1f) : hex(0x48912f), 0.12));
    }
  }
});
def('planks', (p) => paintPlanks(p));
def('crafting_top', (p) => {
  paintPlanks(p);
  p.border(hex(0x5c4326));
  for (let i = 1; i < 15; i++) {
    p.set(5, i, hex(0x6b4f2c)); p.set(10, i, hex(0x6b4f2c));
    p.set(i, 5, hex(0x6b4f2c)); p.set(i, 10, hex(0x6b4f2c));
  }
});
const craftingSideBase = (p) => {
  paintPlanks(p);
  for (let x = 0; x < 16; x++) {
    p.set(x, 0, hex(0x5c4326));
    p.set(x, 1, p.v(hex(0x9c7a46), 0.05));
    p.set(x, 2, p.v(hex(0x9c7a46), 0.05));
    p.set(x, 3, hex(0x5c4326));
  }
};
def('crafting_side', (p) => {
  craftingSideBase(p);
  p.rect(2, 6, 6, 10, hex(0xa8a8a8), 0.04); // saw blade
  for (let y = 6; y <= 10; y += 2) p.set(7, y, hex(0x8a8a8a));
  p.rect(3, 11, 5, 13, hex(0x4a3418)); // saw handle
  p.rect(10, 5, 13, 6, hex(0x9a9a9a)); // hammer head
  for (let y = 7; y <= 13; y++) p.set(11, y, hex(0x4a3418));
});
def('crafting_front', (p) => {
  craftingSideBase(p);
  p.rect(3, 5, 12, 6, hex(0xa0a0a0), 0.04);
  p.set(2, 7, hex(0xa0a0a0)); p.set(13, 7, hex(0xa0a0a0));
  for (let y = 7; y <= 13; y++) { p.set(7, y, hex(0x4a3418)); p.set(8, y, hex(0x5e4220)); }
});
def('furnace_top', (p) => { paintStone(p, hex(0x7d7d7d)); p.border(hex(0x555555)); });
def('furnace_side', paintFurnaceSide);
def('furnace_front', (p) => furnaceFront(p, false));
def('furnace_front_lit', (p) => furnaceFront(p, true));
def('chest_top', (p) => { chestBase(p); });
def('chest_side', (p) => {
  chestBase(p);
  for (let x = 1; x < 15; x++) { p.set(x, 5, hex(0x3d2810)); p.set(x, 6, mul(hex(0xa26b2c), 0.8)); }
});
def('chest_front', (p) => {
  chestBase(p);
  for (let x = 1; x < 15; x++) { p.set(x, 5, hex(0x3d2810)); p.set(x, 6, mul(hex(0xa26b2c), 0.8)); }
  p.rect(7, 3, 8, 7, hex(0xc8c8c8));
  p.set(7, 7, hex(0x6e6e6e)); p.set(8, 7, hex(0x6e6e6e));
});
def('glass', (p) => {
  p.d.fill(0);
  p.border(hex(0xdcf0f7));
  for (const [x, y] of [[3, 4], [4, 3], [4, 5], [5, 4], [9, 10], [10, 9], [11, 8], [3, 11], [12, 4]]) {
    p.set(x, y, hex(0xffffff), 200);
  }
});
def('water', (p) => paintFluid(p, 'water', 0));
def('coal_ore', (p) => ore(p, hex(0x262626), hex(0x454545)));
def('iron_ore', (p) => ore(p, hex(0xd8a888), hex(0xa97a5a)));
def('gold_ore', (p) => ore(p, hex(0xfcee4b), hex(0xd8a020)));
def('diamond_ore', (p) => ore(p, hex(0x6cf0ff), hex(0x22b8c8)));
def('snow', (p) => { p.fill(hex(0xf2f7fb), 0.025); p.speckle(14, hex(0xdde8f0), 0.02); });
def('cactus_side', (p) => {
  p.fill(hex(0x2d7a1d), 0.06);
  for (let y = 0; y < 16; y++) for (const x of [1, 6, 10, 14]) p.scale(x, y, 0.75);
  for (let i = 0; i < 8; i++) p.set(p.ri(16), p.ri(16), hex(0xd6d6a8));
});
def('cactus_top', (p) => {
  p.fill(hex(0x4a9a32), 0.05);
  p.border(hex(0x2d6a1d));
  p.rect(6, 6, 9, 9, hex(0x3a8028));
  p.set(7, 7, hex(0xd6d6a8));
});
def('cactus_bottom', (p) => { p.fill(hex(0x5aa83f), 0.04); p.border(hex(0x2d6a1d)); });
def('sandstone_top', (p) => p.fill(hex(0xdccf98), 0.03));
def('sandstone_side', (p) => {
  p.fill(hex(0xd8c88f), 0.03);
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 3; y++) p.set(x, y, p.v(hex(0xe4d8a6), 0.02));
    p.set(x, 3, hex(0xc4b47c));
    p.set(x, 10, p.v(hex(0xc8b880), 0.03));
    p.set(x, 13, p.v(hex(0xc8b880), 0.03));
  }
});
def('sandstone_bottom', (p) => { p.fill(hex(0xd8c88f), 0.04); p.speckle(14, hex(0xc4b47c), 0.03); });
def('stone_bricks', (p) => {
  const base = hex(0x7a7a7a);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = base;
      if (y % 8 === 7 || (y < 8 ? x === 15 : x === 7)) c = mul(base, 0.55);
      else if (y % 8 === 0 || (y < 8 ? x === 0 : x === 8)) c = mul(base, 1.12);
      p.set(x, y, p.v(c, 0.05));
    }
  }
});
def('iron_block', (p) => metalBlock(p, hex(0xd8d8d8)));
def('gold_block', (p) => metalBlock(p, hex(0xf5d63d)));
def('diamond_block', (p) => metalBlock(p, hex(0x5ae6dc)));
def('torch', (p) => {
  p.d.fill(0);
  for (let y = 6; y < 16; y++) {
    for (let x = 7; x <= 8; x++) {
      let c;
      if (y === 6) c = hex(0xfff3a0);
      else if (y === 7) c = hex(0xffc83c);
      else if (y === 8) c = hex(0xff9620);
      else c = x === 7 ? hex(0x8b6a3a) : hex(0x6b4f2a);
      p.set(x, y, c);
    }
  }
});
def('tall_grass', (p) => {
  p.d.fill(0);
  for (let i = 0; i < 10; i++) {
    const x = 1 + p.ri(14), h = 5 + p.ri(10), lean = p.r() < 0.5 ? -1 : 1;
    for (let k = 0; k < h; k++) {
      const xx = x + (k > h * 0.6 ? lean : 0);
      p.set(xx, 15 - k, p.v(mix(hex(0x3d7a26), hex(0x7cc552), k / h), 0.08));
    }
  }
});
def('dandelion', (p) => {
  p.d.fill(0);
  for (let y = 9; y < 16; y++) p.set(7, y, hex(0x3f8a2a));
  p.set(6, 12, hex(0x4f9a35)); p.set(8, 11, hex(0x4f9a35)); p.set(5, 13, hex(0x4f9a35));
  p.rect(6, 5, 9, 8, hex(0xf5d300), 0.06);
  for (const [x, y] of [[6, 5], [9, 5], [6, 8], [9, 8]]) p.set(x, y, [0, 0, 0], 0);
  p.rect(7, 6, 8, 7, hex(0xe0a000));
});
def('poppy', (p) => {
  p.d.fill(0);
  for (let y = 9; y < 16; y++) p.set(7, y, hex(0x3f8a2a));
  p.set(6, 12, hex(0x4f9a35)); p.set(8, 13, hex(0x4f9a35)); p.set(9, 12, hex(0x4f9a35));
  p.rect(5, 3, 10, 8, hex(0xd8241c), 0.08);
  for (const [x, y] of [[5, 3], [10, 3], [5, 8], [10, 8]]) p.set(x, y, [0, 0, 0], 0);
  p.rect(7, 5, 8, 6, hex(0x2a1010));
});
def('stick', (p) => {
  p.d.fill(0);
  for (let i = 0; i < 10; i++) p.set(3 + i, 12 - i, i % 2 ? HANDLE2 : HANDLE);
  p.outline();
});
def('coal', (p) => {
  p.d.fill(0);
  const pal = [0x2a2a2a, 0x1e1e1e, 0x363636, 0x444444].map(hex);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (Math.hypot(x - 7.5, (y - 8) * 1.1) < 4.6 + p.r() * 1.1) p.set(x, y, pal[p.ri(4)]);
    }
  }
  for (const [x, y] of [[6, 5], [5, 6], [9, 7]]) p.set(x, y, hex(0x5e5e5e));
  p.outline();
});
def('iron_ingot', (p) => ingot(p, hex(0xd8d8d8)));
def('gold_ingot', (p) => ingot(p, hex(0xf5d63d)));
def('diamond', (p) => {
  p.d.fill(0);
  const hw = [2, 4, 5, 5, 4, 3, 2, 1, 0.4];
  hw.forEach((w, i) => {
    const y = 3 + i;
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 8;
      if (Math.abs(dx) <= w) {
        let c = hex(0x4fe0d2);
        if (i < 2) c = hex(0x9ff5ec);
        else if (dx < -1) c = hex(0x7aeee2);
        else if (dx > 1) c = hex(0x2aa8a0);
        p.set(x, y, c);
      }
    }
  });
  p.set(6, 5, hex(0xffffff)); p.set(5, 6, hex(0xe0fffb));
  p.outline();
});
for (const m of TOOL_MATERIALS) {
  for (const t of TOOL_TYPES) def(`${m.key}_${t.key}`, (p) => tool(p, t.key, m.color));
}

// ---------- mob drops & food ----------
function meat(p, base, fat, spots = 0) {
  p.d.fill(0);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 8, dy = y + 0.5 - 8.5;
      const u = (dx - dy) / Math.SQRT2, v = (dx + dy) / Math.SQRT2;
      if ((u / 6.4) ** 2 + (v / 4) ** 2 >= 1) continue;
      p.set(x, y, fat && Math.abs(v - 1.6) < 0.7 ? p.v(fat, 0.04) : p.v(base, 0.07));
    }
  }
  for (let i = 0; i < spots; i++) {
    const x = 4 + p.ri(8), y = 4 + p.ri(8);
    if (p.a(x, y)) p.set(x, y, mul(base, 0.6));
  }
  p.outline();
}

function drumstick(p, base) {
  p.d.fill(0);
  for (let i = 0; i < 4; i++) { p.set(3 + i, 12 - i, hex(0xeeeadf)); p.set(3 + i, 13 - i, hex(0xd6d0c0)); }
  p.set(2, 13, hex(0xeeeadf)); p.set(3, 14, hex(0xeeeadf));
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (Math.hypot(x + 0.5 - 10, (y + 0.5 - 6) * 1.1) < 4.6) p.set(x, y, p.v(base, 0.07));
    }
  }
  p.outline();
}

def('wool', (p) => {
  p.fill(hex(0xe9e9e9), 0.03);
  for (let i = 0; i < 40; i++) {
    const x = p.ri(16), y = p.ri(16);
    p.set(x, y, p.v(hex(0xd4d4d4), 0.03));
    p.set(x + 1, y, p.v(hex(0xdadada), 0.03));
  }
});
def('wisp_lamp', (p) => {
  p.fill(hex(0x9fe8ff), 0.06);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d < 3.5) p.set(x, y, p.v(hex(0xf2feff), 0.02));
      else if (d < 5.5) p.set(x, y, p.v(hex(0xc8f4ff), 0.03));
    }
  }
  p.border(hex(0x4a7f99));
  for (let i = 1; i < 15; i++) { p.set(i, 1, hex(0x6aa6c0)); p.set(1, i, hex(0x6aa6c0)); }
});
function bucket(p, water) {
  p.d.fill(0);
  for (let y = 4; y <= 13; y++) {
    const half = 5.5 - (y - 4) * 0.25;
    for (let x = 0; x < 16; x++) {
      const dx = Math.abs(x + 0.5 - 8);
      if (dx > half) continue;
      const edge = dx > half - 1;
      p.set(x, y, edge ? hex(0x8c8c8c) : y === 4 && water ? hex(0x3f6fe4) : y < 6 && !water ? hex(0x4a4a4a) : hex(0xc8c8c8));
    }
  }
  if (water) for (let x = 4; x <= 11; x++) p.set(x, 5, hex(0x2f5fd8));
  for (let x = 3; x <= 12; x++) p.set(x, 3, hex(0xb0b0b0)); // rim
  p.outline();
}
def('bucket', (p) => bucket(p, false));
def('water_bucket', (p) => bucket(p, true));
def('lava_bucket', (p) => {
  bucket(p, true);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const [r, g, b] = p.get(x, y);
      if (p.a(x, y) && b > r + 40) p.set(x, y, mix(hex(0xff6a00), hex(0xffc030), (x + y) % 3 / 3));
    }
  }
});
def('lava', (p) => paintFluid(p, 'lava', 0));
def('obsidian', (p) => {
  p.fill(hex(0x14101e), 0.12);
  for (let i = 0; i < 14; i++) {
    const x = p.ri(15), y = p.ri(15);
    p.set(x, y, hex(0x3a2a5a)); p.set(x + 1, y + 1, hex(0x2a1e44));
  }
});

def('tnt_side', (p) => {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const band = y >= 5 && y <= 10;
      p.set(x, y, p.v(band ? hex(0xe8e8e0) : x % 4 === 3 ? hex(0xa8281c) : hex(0xd8382a), 0.05));
    }
  }
  // "TNT" letters on the white band.
  const L = ['XXX.X..X.XXX', '.X..XX.X..X.', '.X..X.XX..X.', '.X..X..X..X.'];
  L.forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch === 'X') p.set(2 + rx, 6 + ry, hex(0x1a1a1a)); }));
});
def('tnt_top', (p) => {
  p.fill(hex(0xd8382a), 0.05);
  for (const [x, y] of [[4, 4], [11, 4], [4, 11], [11, 11], [7, 7]]) {
    p.rect(x - 1, y - 1, x + 1, y + 1, hex(0x3a3a3a));
    p.set(x, y, hex(0xc8c8c0));
  }
});
def('tnt_bottom', (p) => { p.fill(hex(0xb82a1e), 0.05); p.border(hex(0x7a1a12)); });
def('flint_and_steel', (p) => {
  p.d.fill(0);
  // Steel ring (top-left) and flint (bottom-right).
  for (let a = 0; a < Math.PI * 2; a += 0.12) {
    const x = Math.round(6 + Math.cos(a) * 3.5), y = Math.round(6 + Math.sin(a) * 3.5);
    if (a > 0.3 && a < 1.3) continue; // gap of the C-shaped striker
    p.set(x, y, a < Math.PI ? hex(0x9a9a9a) : hex(0xd0d0d0));
  }
  for (let y = 8; y <= 13; y++) {
    for (let x = 9; x <= 13; x++) if (!(x === 13 && y === 8)) p.set(x, y, p.v(x < 11 ? hex(0x4a4a4e) : hex(0x2e2e32), 0.08));
  }
  p.outline();
});

// Armor icons: simple silhouettes tinted with the material colour.
const ARMOR_SHAPES = {
  helmet: ['................', '................', '................', '....XXXXXXXX....', '...XXXXXXXXXX...',
    '...XXXXXXXXXX...', '...XXX....XXX...', '...XXX....XXX...', '...XX......XX...'],
  chestplate: ['................', '..XXXX....XXXX..', '..XXXXX..XXXXX..', '..XXXXXXXXXXXX..', '..XXXXXXXXXXXX..',
    '...XXXXXXXXXX...', '.....XXXXXX.....', '.....XXXXXX.....', '.....XXXXXX.....', '.....XXXXXX.....',
    '.....XXXXXX.....', '.....XXXXXX.....', '.....XXXXXX.....'],
  leggings: ['................', '................', '....XXXXXXXX....', '....XXXXXXXX....', '....XXXXXXXX....',
    '....XXX..XXX....', '....XXX..XXX....', '....XXX..XXX....', '....XXX..XXX....', '....XXX..XXX....',
    '....XXX..XXX....', '....XXX..XXX....', '....XXX..XXX....'],
  boots: ['................', '................', '................', '................', '................',
    '................', '................', '...XXX....XXX...', '...XXX....XXX...', '...XXX....XXX...',
    '.XXXXX..XXXXX...', '.XXXXX..XXXXX...'],
};
function armorIcon(p, shape, color) {
  p.d.fill(0);
  const c = hex(color);
  ARMOR_SHAPES[shape].forEach((row, y) => {
    for (let x = 0; x < 16; x++) {
      if (row[x] !== 'X') continue;
      const lit = row[x - 1] !== 'X' || ARMOR_SHAPES[shape][y - 1]?.[x] !== 'X';
      p.set(x, y + 1, p.v(lit ? mul(c, 1.15) : c, 0.05));
    }
  });
  p.outline();
}
for (const m of ARMOR_MATERIALS) {
  for (const s of ARMOR_SLOTS) def(`${m.key}_${s.key}`, (p) => armorIcon(p, s.key, m.color));
}

// ---------- animated fire ----------
// Minecraft-style fire: a few licking flame tongues of different heights that sway and flare, their
// edges broken up by noise that scrolls upward (so bits of flame tear off and rise). Each pixel's
// "heat" picks a colour from a stepped palette: white-yellow core, orange body, red tips.
// Everything wraps at 16 px, so the tile repeats seamlessly side by side.
// [upper heat bound, colour], hottest last. Below the first bound the pixel is transparent.
const FIRE_PALETTE = [
  [0.1, null], [0.24, hex(0xa82c08)], [0.38, hex(0xd2480c)], [0.52, hex(0xec7016)], [0.66, hex(0xf8982a)],
  [0.8, hex(0xfcc040)], [0.94, hex(0xfee070)], [9, hex(0xfff8c8)],
];
export class FireSim {
  constructor(seed) {
    const r = (this.r = mkRand(seed));
    this.t = r() * 100;
    this.noise = Float32Array.from({ length: 256 }, () => r());
    this.noise2 = Float32Array.from({ length: 256 }, () => r());
    // Tongues: centre, half-width, base height (px), sway & flare rates.
    this.tongues = Array.from({ length: 5 }, (_, i) => ({
      x: i * 3.2 + r() * 2, w: 2.2 + r() * 1.6, h: 9 + r() * 6,
      sway: 0.6 + r() * 1.2, flare: 2 + r() * 3, ph: r() * 10,
    }));
  }

  step(dt = 0.05) { this.t += dt; }

  // Bilinear value noise on a 16x16 grid that wraps in both directions.
  sample(grid, x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const g = (a, b) => grid[(a & 15) + ((b & 15) << 4)];
    const top = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * fx;
    const bot = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * fx;
    return top + (bot - top) * fy;
  }

  heightAt(x) {
    const t = this.t;
    let best = 3; // there is always a low bed of flame
    for (const g of this.tongues) {
      const cx = g.x + Math.sin(t * g.sway + g.ph) * 1.2;
      let dx = Math.abs(x - cx) % 16;
      dx = Math.min(dx, 16 - dx);
      if (dx >= g.w) continue;
      const h = g.h + Math.sin(t * g.flare + g.ph * 2) * 2.5 + Math.sin(t * g.flare * 2.3 + g.ph) * 1.2;
      best = Math.max(best, h * (1 - (dx / g.w) ** 2));
    }
    return best;
  }

  paint(p) {
    const t = this.t;
    for (let x = 0; x < 16; x++) {
      const h = this.heightAt(x + 0.5);
      for (let y = 0; y < 16; y++) {
        const up = 15.5 - y; // pixels above the bottom
        // Rising noise: big blobs scroll up fast, fine grain a bit slower.
        const n = this.sample(this.noise, x * 0.5, (y + t * 22) * 0.5) * 0.7
          + this.sample(this.noise2, x, y + t * 14) * 0.3;
        const heat = 1.02 - up / h + (n - 0.5) * 0.75 - (up > h ? 0.25 : 0);
        let k = 0;
        while (heat > FIRE_PALETTE[k][0]) k++;
        const c = FIRE_PALETTE[k][1];
        if (!c) p.set(x, y, [0, 0, 0], 0);
        else p.set(x, y, c);
      }
    }
  }
}
const FIRE_SIMS = [new FireSim(17), new FireSim(4242)];
def('fire_0', (p) => FIRE_SIMS[0].paint(p));
def('fire_1', (p) => FIRE_SIMS[1].paint(p));

// ---------- animated liquids ----------
// Built only from sines whose periods divide 16 pixels, so neighbouring blocks join without seams.
const TAU16 = (Math.PI * 2) / 16;
function liquidField(x, y, t) {
  const a = Math.sin((x + Math.sin(y * TAU16 + t * 0.9) * 2.2) * TAU16 * 2 + t * 1.3);
  const b = Math.sin((y + Math.sin(x * TAU16 * 2 - t * 0.7) * 1.8) * TAU16 + t * 0.8);
  const c = Math.sin(x * TAU16 * 3 - t * 1.1) * Math.sin(y * TAU16 * 2 + t * 0.5) * 0.6;
  return (a + b + c) / 5 + 0.5; // ~0..1
}
const LAVA_PALETTE = [hex(0xa0300a), hex(0xc84a0c), hex(0xe06a12), hex(0xf28c1e), hex(0xfab238), hex(0xfdd862)];
function paintFluid(p, kind, t) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const v = liquidField(x, y, t);
      if (kind === 'water') {
        p.set(x, y, mul(hex(0x2f5fd8), 0.86 + Math.round(v * 4) * 0.07));
      } else {
        // Banded pixel-art lava: quantised levels, with a few dark crust specks drifting along.
        const crust = liquidField(x * 2 + 5, y + 9, t * 0.6) < 0.18;
        const k = Math.max(0, Math.min(5, Math.floor(v * 6.5 - 0.6)));
        p.set(x, y, crust ? LAVA_PALETTE[0] : LAVA_PALETTE[k]);
      }
    }
  }
}
def('wisp_dust', (p) => {
  p.d.fill(0);
  for (let i = 0; i < 26; i++) {
    const a = p.r() * Math.PI * 2, r = p.r() * 5;
    p.set(Math.round(8 + Math.cos(a) * r), Math.round(9 + Math.sin(a) * r * 0.7), p.r() < 0.4 ? hex(0xffffff) : hex(0x8ee4ff));
  }
  p.outline();
});
def('apple', (p) => {
  p.d.fill(0);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (Math.hypot(x + 0.5 - 8, (y + 0.5 - 9.5) * 1.05) < 5.2) p.set(x, y, p.v(hex(0xd82a1c), 0.06));
    }
  }
  p.set(6, 7, hex(0xff9a8a)); p.set(5, 8, hex(0xff8070));
  p.set(8, 3, hex(0x5a3a1a)); p.set(8, 4, hex(0x5a3a1a));
  p.set(9, 3, hex(0x3a9a2a)); p.set(10, 2, hex(0x3a9a2a)); p.set(10, 3, hex(0x2f7f22));
  p.outline();
});
def('porkchop', (p) => meat(p, hex(0xef8f8f), hex(0xf8dada)));
def('cooked_porkchop', (p) => meat(p, hex(0xb07a4a), hex(0xe0c49a)));
def('beef', (p) => meat(p, hex(0xc8302a), hex(0xf0d0d0)));
def('steak', (p) => meat(p, hex(0x7a4a28), hex(0xa07040)));
def('chicken', (p) => drumstick(p, hex(0xf2c6b0)));
def('cooked_chicken', (p) => drumstick(p, hex(0xc8823c)));
def('mutton', (p) => meat(p, hex(0xd84a3e), hex(0xf4e0d8)));
def('cooked_mutton', (p) => meat(p, hex(0x8e5232), hex(0xc8a070)));
def('rotten_flesh', (p) => meat(p, hex(0x8a6a3a), hex(0x6a8a3a), 8));
def('leather', (p) => {
  p.d.fill(0);
  p.rect(3, 3, 12, 12, hex(0x9a5a2c), 0.06);
  for (const [x, y] of [[3, 3], [12, 3], [3, 12], [12, 12], [7, 3], [8, 12], [3, 8], [12, 7]]) p.set(x, y, [0, 0, 0], 0);
  p.outline();
});
def('feather', (p) => {
  p.d.fill(0);
  for (let i = 0; i < 11; i++) {
    const x = 3 + i, y = 13 - i;
    p.set(x, y, hex(0xbdbdbd));
    if (i > 2) { p.set(x - 1, y - 1, hex(0xf4f4f4)); p.set(x + 1, y + 1, hex(0xe0e0e0)); }
    if (i > 4 && i < 10) p.set(x - 2, y - 2, hex(0xffffff));
  }
  p.outline();
});
def('string', (p) => {
  p.d.fill(0);
  for (let x = 2; x < 14; x++) p.set(x, Math.round(8 + Math.sin(x * 0.9) * 3 - (x - 8) * 0.3), hex(0xe8e8e8));
  p.outline();
});
def('bone', (p) => {
  p.d.fill(0);
  for (let i = 0; i < 8; i++) { p.set(4 + i, 11 - i, hex(0xeeeadc)); p.set(5 + i, 11 - i, hex(0xd8d4c4)); }
  for (const [x, y] of [[3, 11], [4, 12], [3, 12], [12, 3], [11, 2], [12, 2], [13, 4]]) p.set(x, y, hex(0xf6f2e6));
  p.outline();
});
def('gunpowder', (p) => {
  p.d.fill(0);
  for (let y = 6; y < 14; y++) {
    const half = (y - 5) * 0.9;
    for (let x = 0; x < 16; x++) {
      if (Math.abs(x + 0.5 - 8) < half && p.r() < 0.85) p.set(x, y, p.r() < 0.5 ? hex(0x5a5a5a) : hex(0x3a3a3a));
    }
  }
  p.speckle(6, hex(0x8a8a8a));
  for (let y = 0; y < 6; y++) for (let x = 0; x < 16; x++) p.set(x, y, [0, 0, 0], 0);
  p.outline();
});
def('flint', (p) => {
  p.d.fill(0);
  const poly = [[6, 3], [11, 5], [12, 10], [8, 13], [4, 10]];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y + 0.5) !== (yj > y + 0.5) && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) p.set(x, y, p.v(x < 8 ? hex(0x4a4a4e) : hex(0x2e2e32), 0.08));
    }
  }
  p.outline();
});
def('arrow', (p) => {
  p.d.fill(0);
  for (let i = 0; i < 9; i++) p.set(3 + i, 12 - i, i % 2 ? HANDLE2 : HANDLE);
  for (const [x, y] of [[12, 3], [13, 2], [12, 2], [13, 3], [11, 2], [13, 4]]) p.set(x, y, hex(0xb4b4b4));
  for (const [x, y] of [[2, 13], [1, 13], [2, 14], [3, 14], [1, 12], [2, 12]]) p.set(x, y, hex(0xf4f4f4));
  p.outline();
});
def('bow', (p) => {
  p.d.fill(0);
  for (let a = 0; a <= 90; a += 3) {
    const r = (a * Math.PI) / 180;
    const x = Math.round(13 - Math.cos(r) * 10.5), y = Math.round(13 - Math.sin(r) * 10.5);
    p.set(x, y, a % 12 < 6 ? HANDLE : HANDLE2);
  }
  for (let i = 1; i < 10; i++) p.set(3 + i, 13 - i, hex(0xd8d8d8), 230);
  p.outline();
});

// Block-breaking crack stages: grow random walks outward from the centre.
const crackPixels = (() => {
  const r = mkRand(4242);
  const seen = new Set();
  const list = [];
  const walkers = Array.from({ length: 7 }, () => [7 + Math.floor(r() * 3) - 1, 7 + Math.floor(r() * 3) - 1]);
  for (let step = 0; step < 12; step++) {
    for (const w of walkers) {
      const dx = w[0] - 7.5, dy = w[1] - 7.5;
      w[0] += Math.round(Math.sign(dx || r() - 0.5) * (r() < 0.6 ? 1 : 0) + (r() < 0.3 ? (r() < 0.5 ? -1 : 1) : 0));
      w[1] += Math.round(Math.sign(dy || r() - 0.5) * (r() < 0.6 ? 1 : 0) + (r() < 0.3 ? (r() < 0.5 ? -1 : 1) : 0));
      w[0] = Math.max(0, Math.min(15, w[0]));
      w[1] = Math.max(0, Math.min(15, w[1]));
      const k = w[0] + w[1] * 16;
      if (!seen.has(k)) { seen.add(k); list.push([w[0], w[1]]); }
    }
  }
  return list;
})();
for (let s = 0; s < 10; s++) {
  def(`crack_${s}`, (p) => {
    p.d.fill(0);
    const n = Math.floor((crackPixels.length * (s + 1)) / 10);
    for (let i = 0; i < n; i++) p.set(crackPixels[i][0], crackPixels[i][1], [16, 16, 16], 210);
  });
}

// ---------- build atlas ----------
// In a Web Worker (mesh worker) there's no DOM: only tile indices/UVs are needed, so skip painting.
const HAS_DOM = typeof document !== 'undefined';
export const atlasCanvas = HAS_DOM ? document.createElement('canvas') : null;
if (atlasCanvas) atlasCanvas.width = atlasCanvas.height = ATLAS_SIZE;
const actx = atlasCanvas?.getContext('2d');
const tileIndices = new Map();
export const tileAverage = [];
const tileData = [];

TILES.forEach(([name, fn], i) => {
  tileIndices.set(name, i);
  if (!HAS_DOM) return;
  const p = new Painter(1000 + i * 7919);
  fn(p);
  const img = new ImageData(p.d, TILE, TILE);
  actx.putImageData(img, (i % ATLAS_COLS) * TILE, Math.floor(i / ATLAS_COLS) * TILE);
  tileIndices.set(name, i);
  tileData[i] = p.d;
  let r = 0, g = 0, b = 0, n = 0;
  for (let k = 0; k < p.d.length; k += 4) {
    if (p.d[k + 3] < 128) continue;
    r += p.d[k]; g += p.d[k + 1]; b += p.d[k + 2]; n++;
  }
  tileAverage[i] = n ? [r / n / 255, g / n / 255, b / n / 255] : [1, 1, 1];
});

// Animated tiles. Fire runs at ~20 frames a second (like Minecraft's), liquids and the lit furnace
// slower. Returns true if the atlas changed and needs re-uploading.
const animPainter = new Painter(1);
const anim = { t: 0, fire: 0, slow: 0, frame: 0 };
function putTile(name) {
  const i = tileIndices.get(name);
  actx.putImageData(new ImageData(animPainter.d, TILE, TILE), (i % ATLAS_COLS) * TILE, Math.floor(i / ATLAS_COLS) * TILE);
}
export function animateTiles(dt) {
  if (!actx) return false;
  anim.t += dt;
  anim.fire -= dt;
  anim.slow -= dt;
  let changed = false;
  if (anim.fire <= 0) {
    anim.fire = 0.05;
    FIRE_SIMS.forEach((s, k) => { s.step(0.05); s.paint(animPainter); putTile(`fire_${k}`); });
    changed = true;
  }
  if (anim.slow <= 0) {
    anim.slow = 0.12;
    paintFluid(animPainter, 'water', anim.t);
    putTile('water');
    paintFluid(animPainter, 'lava', anim.t * 0.3);
    putTile('lava');
    // The flames inside a lit furnace flicker.
    animPainter.r = mkRand(1000 + tileIndices.get('furnace_front_lit') * 7919); // same stone as the atlas
    furnaceFront(animPainter, true, mkRand(++anim.frame));
    putTile('furnace_front_lit');
    changed = true;
  }
  return changed;
}

// Copy one tile's current pixels onto a 2D context (used by the burning-screen overlay).
export function drawTile(ctx, name, dx, dy, dw, dh, flip = false) {
  const i = tileIndex(name);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (flip) { ctx.translate(dx + dw, dy); ctx.scale(-1, 1); dx = 0; dy = 0; }
  ctx.drawImage(atlasCanvas, (i % ATLAS_COLS) * TILE, Math.floor(i / ATLAS_COLS) * TILE, TILE, TILE, dx, dy, dw, dh);
  ctx.restore();
}

export function tileIndex(name) {
  const i = tileIndices.get(name);
  if (i === undefined) throw new Error(`Unknown tile ${name}`);
  return i;
}

// Returns a standalone 16x16 canvas for one tile.
export function tileCanvas(name) {
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(tileData[tileIndex(name)]), TILE, TILE), 0, 0);
  return c;
}

// UV rect [u0, v0, u1, v1] for a tile (v up, as three.js flips canvas textures).
export function tileUV(i) {
  const col = i % ATLAS_COLS, row = Math.floor(i / ATLAS_COLS);
  const e = 0.0005;
  const u0 = col / ATLAS_COLS + e, u1 = (col + 1) / ATLAS_COLS - e;
  const v1 = 1 - row / ATLAS_COLS - e, v0 = 1 - (row + 1) / ATLAS_COLS + e;
  return [u0, v0, u1, v1];
}
