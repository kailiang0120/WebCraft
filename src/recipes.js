import { B, I, TOOL_MATERIALS, ARMOR_MATERIALS, getItem } from './blocks.js';

// Shaped recipes: pattern rows + key map. Shapeless: list of ingredient ids.
const RECIPES = [];
const shaped = (pattern, key, id, count = 1) => RECIPES.push({ pattern, key, out: { id, count } });
const shapeless = (ingredients, id, count = 1) => RECIPES.push({ ingredients, out: { id, count } });

shapeless([B.LOG], B.PLANKS, 4);
shaped(['#', '#'], { '#': B.PLANKS }, I.STICK, 4);
shaped(['##', '##'], { '#': B.PLANKS }, B.CRAFTING_TABLE);
shaped(['###', '# #', '###'], { '#': B.COBBLESTONE }, B.FURNACE);
shaped(['###', '# #', '###'], { '#': B.PLANKS }, B.CHEST);
shaped(['C', 'S'], { C: I.COAL, S: I.STICK }, B.TORCH, 4);
shaped(['##', '##'], { '#': B.SAND }, B.SANDSTONE);
shaped(['##', '##'], { '#': B.STONE }, B.STONE_BRICKS, 4);
for (const [ingot, blk] of [[I.IRON_INGOT, B.IRON_BLOCK], [I.GOLD_INGOT, B.GOLD_BLOCK], [I.DIAMOND, B.DIAMOND_BLOCK]]) {
  shaped(['###', '###', '###'], { '#': ingot }, blk);
  shapeless([blk], ingot, 9);
}
shaped([' #S', '# S', ' #S'], { '#': I.STICK, S: I.STRING }, I.BOW);
shaped(['F', 'S', 'E'], { F: I.FLINT, S: I.STICK, E: I.FEATHER }, I.ARROW, 4);
shaped(['##', '##'], { '#': I.STRING }, B.WOOL);
shaped(['##', '##'], { '#': I.WISP_DUST }, B.WISP_LAMP);
shaped(['# #', ' # '], { '#': I.IRON_INGOT }, I.BUCKET);
shapeless([I.IRON_INGOT, I.FLINT], I.FLINT_AND_STEEL);
shaped(['GSG', 'SGS', 'GSG'], { G: I.GUNPOWDER, S: B.SAND }, B.TNT);
for (const m of ARMOR_MATERIALS) {
  const k = { X: m.item };
  shaped(['XXX', 'X X'], k, I[`${m.key}_helmet`.toUpperCase()]);
  shaped(['X X', 'XXX', 'XXX'], k, I[`${m.key}_chestplate`.toUpperCase()]);
  shaped(['XXX', 'X X', 'X X'], k, I[`${m.key}_leggings`.toUpperCase()]);
  shaped(['X X', 'X X'], k, I[`${m.key}_boots`.toUpperCase()]);
}
for (const m of TOOL_MATERIALS) {
  const k = { X: m.item, S: I.STICK };
  shaped(['XXX', ' S ', ' S '], k, I[`${m.key}_pickaxe`.toUpperCase()]);
  shaped(['XX', 'XS', ' S'], k, I[`${m.key}_axe`.toUpperCase()]);
  shaped(['X', 'S', 'S'], k, I[`${m.key}_shovel`.toUpperCase()]);
  shaped(['X', 'X', 'S'], k, I[`${m.key}_sword`.toUpperCase()]);
}

export const ALL_RECIPES = RECIPES;

// grid: array of stacks (or null), size w*w. Returns {id,count} or null.
export function matchRecipe(grid, w) {
  let minX = w, minY = w, maxX = -1, maxY = -1;
  const items = [];
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const s = grid[y * w + x];
      if (!s) continue;
      items.push(s.id);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (!items.length) return null;
  const gw = maxX - minX + 1, gh = maxY - minY + 1;
  const at = (x, y) => grid[(y + minY) * w + (x + minX)]?.id ?? 0;

  for (const r of RECIPES) {
    if (r.ingredients) {
      if (r.ingredients.length !== items.length) continue;
      const left = [...items];
      let ok = true;
      for (const ing of r.ingredients) {
        const i = left.indexOf(ing);
        if (i < 0) { ok = false; break; }
        left.splice(i, 1);
      }
      if (ok) return { ...r.out };
      continue;
    }
    const ph = r.pattern.length, pw = Math.max(...r.pattern.map((row) => row.length));
    if (ph !== gh || pw !== gw) continue;
    for (const mirror of [false, true]) {
      let ok = true;
      for (let y = 0; y < ph && ok; y++) {
        for (let x = 0; x < pw; x++) {
          const ch = r.pattern[y][mirror ? pw - 1 - x : x] ?? ' ';
          const need = ch === ' ' ? 0 : r.key[ch];
          if (at(x, y) !== need) { ok = false; break; }
        }
      }
      if (ok) return { ...r.out };
    }
  }
  return null;
}

export const SMELT_TIME = 5; // seconds per item

export function smeltResult(id) {
  const s = getItem(id)?.smelt;
  return s != null ? s : null;
}

export function fuelValue(id) {
  return getItem(id)?.fuel || 0;
}
