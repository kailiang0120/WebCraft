// Block & item registry. Pure data (no DOM / three.js) so the worldgen worker can import it.

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLESTONE: 4, BEDROCK: 5, SAND: 6, GRAVEL: 7,
  LOG: 8, LEAVES: 9, PLANKS: 10, CRAFTING_TABLE: 11, FURNACE: 12, CHEST: 13, GLASS: 14,
  WATER: 15, COAL_ORE: 16, IRON_ORE: 17, GOLD_ORE: 18, DIAMOND_ORE: 19, SNOW: 20,
  CACTUS: 21, SANDSTONE: 22, STONE_BRICKS: 23, IRON_BLOCK: 24, GOLD_BLOCK: 25,
  DIAMOND_BLOCK: 26, TORCH: 27, TALL_GRASS: 28, DANDELION: 29, POPPY: 30, WOOL: 31, WISP_LAMP: 32,
  // Flowing water levels 1..7 are ids 33..39; falling water is 40. WATER (15) is a source block.
  WATER_FLOW_1: 33, WATER_FALLING: 40,
  // Lava: source 41, flowing levels 1..7 are 42..48, falling 49.
  LAVA: 41, LAVA_FLOW_1: 42, LAVA_FALLING: 49, OBSIDIAN: 50, FIRE: 51, TNT: 52,
};

export const I = {
  STICK: 256, COAL: 257, IRON_INGOT: 258, GOLD_INGOT: 259, DIAMOND: 260,
  APPLE: 261, PORKCHOP: 262, COOKED_PORKCHOP: 263, BEEF: 264, STEAK: 265, CHICKEN: 266,
  COOKED_CHICKEN: 267, MUTTON: 268, COOKED_MUTTON: 269, ROTTEN_FLESH: 270, LEATHER: 271,
  FEATHER: 272, STRING: 273, BONE: 274, GUNPOWDER: 275, FLINT: 276, ARROW: 277, BOW: 278,
  WISP_DUST: 279, BUCKET: 280, WATER_BUCKET: 281, LAVA_BUCKET: 282, FLINT_AND_STEEL: 283,
};

export const BLOCKS = new Array(256).fill(null);
export const ITEMS = new Map();

BLOCKS[0] = {
  id: 0, key: 'air', name: '空气', render: 'none', solid: false, opaque: false,
  selectable: false, replaceable: true, hardness: 0,
};

function block(id, key, name, tex, o = {}) {
  if (typeof tex === 'string') tex = { all: tex };
  const t = {
    top: tex.top || tex.all || tex.side,
    bottom: tex.bottom || tex.all || tex.side,
    side: tex.side || tex.all,
  };
  t.front = tex.front || t.side;
  const d = {
    id, key, name, tex: t, isBlock: true, render: 'cube', solid: true, opaque: true,
    cullSame: false, hardness: 1, tool: null, tier: 0, sound: 'stone', selectable: true,
    replaceable: false, stack: 64, drop: id, fuel: 0, smelt: null, icon: t.side,
    ...o,
  };
  BLOCKS[id] = d;
  ITEMS.set(id, d);
  return d;
}

function item(id, key, name, tex, o = {}) {
  const d = { id, key, name, tex, icon: tex, isBlock: false, stack: 64, fuel: 0, smelt: null, ...o };
  ITEMS.set(id, d);
  return d;
}

block(B.GRASS, 'grass', '草方块', { top: 'grass_top', bottom: 'dirt', side: 'grass_side' },
  { hardness: 0.6, tool: 'shovel', sound: 'grass', drop: B.DIRT });
block(B.DIRT, 'dirt', '泥土', 'dirt', { hardness: 0.5, tool: 'shovel', sound: 'gravel' });
block(B.STONE, 'stone', '石头', 'stone', { hardness: 1.5, tool: 'pickaxe', tier: 1, drop: B.COBBLESTONE });
block(B.COBBLESTONE, 'cobblestone', '圆石', 'cobblestone',
  { hardness: 2, tool: 'pickaxe', tier: 1, smelt: B.STONE });
block(B.BEDROCK, 'bedrock', '基岩', 'bedrock', { hardness: -1 });
block(B.SAND, 'sand', '沙子', 'sand',
  { hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true, smelt: B.GLASS });
block(B.GRAVEL, 'gravel', '沙砾', 'gravel', {
  hardness: 0.6, tool: 'shovel', sound: 'gravel', gravity: true,
  drop: (r) => ({ id: r < 0.12 ? I.FLINT : B.GRAVEL, count: 1 }),
});
// flammable: [encouragement (how readily fire spreads next to it), flammability (how fast it burns away)],
// the same numbers Minecraft uses.
block(B.LOG, 'log', '橡木原木', { top: 'log_top', bottom: 'log_top', side: 'log_side' },
  { hardness: 2, tool: 'axe', sound: 'wood', fuel: 15, smelt: I.COAL, flammable: [5, 5] });
block(B.LEAVES, 'leaves', '树叶', 'leaves', {
  hardness: 0.2, opaque: false, sound: 'grass', flammable: [30, 60],
  drop: (r) => (r < 0.03 ? { id: I.APPLE, count: 1 } : r < 0.12 ? { id: I.STICK, count: 1 } : null),
});
block(B.PLANKS, 'planks', '橡木木板', 'planks', { hardness: 2, tool: 'axe', sound: 'wood', fuel: 15, flammable: [5, 20] });
block(B.CRAFTING_TABLE, 'crafting_table', '工作台',
  { top: 'crafting_top', bottom: 'planks', side: 'crafting_side', front: 'crafting_front' },
  { hardness: 2.5, tool: 'axe', sound: 'wood', fuel: 15, interact: 'crafting', icon: 'crafting_front' });
block(B.FURNACE, 'furnace', '熔炉',
  { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' },
  { hardness: 3.5, tool: 'pickaxe', tier: 1, interact: 'furnace', entity: 'furnace', facing: true });
block(B.CHEST, 'chest', '箱子', { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', front: 'chest_front' },
  {
    hardness: 2.5, tool: 'axe', sound: 'wood', fuel: 15, interact: 'chest', entity: 'chest', facing: true,
    render: 'box', opaque: false, box: [1 / 16, 0, 1 / 16, 15 / 16, 14 / 16, 15 / 16],
  });
block(B.GLASS, 'glass', '玻璃', 'glass', { hardness: 0.3, opaque: false, cullSame: true, sound: 'glass', drop: null });
const waterProps = {
  render: 'liquid', solid: false, opaque: false, cullSame: true, selectable: false,
  replaceable: true, hardness: -1, drop: null, fluid: 'water',
};
block(B.WATER, 'water', '水', 'water', { ...waterProps, level: 0 });
for (let l = 1; l <= 7; l++) block(B.WATER_FLOW_1 + l - 1, `water_flow_${l}`, '流动的水', 'water', { ...waterProps, level: l });
block(B.WATER_FALLING, 'water_falling', '流动的水', 'water', { ...waterProps, level: 8 });
const lavaProps = { ...waterProps, fluid: 'lava', light: true };
block(B.LAVA, 'lava', '岩浆', 'lava', { ...lavaProps, level: 0 });
for (let l = 1; l <= 7; l++) block(B.LAVA_FLOW_1 + l - 1, `lava_flow_${l}`, '流动的岩浆', 'lava', { ...lavaProps, level: l });
block(B.LAVA_FALLING, 'lava_falling', '流动的岩浆', 'lava', { ...lavaProps, level: 8 });
block(B.OBSIDIAN, 'obsidian', '黑曜石', 'obsidian', { hardness: 50, tool: 'pickaxe', tier: 4 });
// Fire has no hitbox: clicking the block it sits on puts it out (see Game.extinguishAt).
block(B.FIRE, 'fire', '火', 'fire_0', {
  render: 'fire', solid: false, opaque: false, selectable: false, replaceable: true, hardness: 0,
  drop: null, light: true, sound: 'grass', flatIcon: true,
});
block(B.TNT, 'tnt', 'TNT', { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' },
  { hardness: 0, sound: 'grass', flammable: [15, 100] });
block(B.COAL_ORE, 'coal_ore', '煤矿石', 'coal_ore', { hardness: 3, tool: 'pickaxe', tier: 1, drop: I.COAL });
block(B.IRON_ORE, 'iron_ore', '铁矿石', 'iron_ore',
  { hardness: 3, tool: 'pickaxe', tier: 2, smelt: I.IRON_INGOT });
block(B.GOLD_ORE, 'gold_ore', '金矿石', 'gold_ore',
  { hardness: 3, tool: 'pickaxe', tier: 3, smelt: I.GOLD_INGOT });
block(B.DIAMOND_ORE, 'diamond_ore', '钻石矿石', 'diamond_ore',
  { hardness: 3, tool: 'pickaxe', tier: 3, drop: I.DIAMOND });
block(B.SNOW, 'snow', '雪块', 'snow', { hardness: 0.2, tool: 'shovel', sound: 'snow' });
block(B.CACTUS, 'cactus', '仙人掌', { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' },
  {
    hardness: 0.4, sound: 'grass', render: 'box', opaque: false,
    box: [1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16], support: [B.SAND, B.CACTUS],
  });
block(B.SANDSTONE, 'sandstone', '砂岩', { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' },
  { hardness: 0.8, tool: 'pickaxe', tier: 1 });
block(B.STONE_BRICKS, 'stone_bricks', '石砖', 'stone_bricks', { hardness: 1.5, tool: 'pickaxe', tier: 1 });
block(B.IRON_BLOCK, 'iron_block', '铁块', 'iron_block', { hardness: 5, tool: 'pickaxe', tier: 2, sound: 'metal' });
block(B.GOLD_BLOCK, 'gold_block', '金块', 'gold_block', { hardness: 3, tool: 'pickaxe', tier: 3, sound: 'metal' });
block(B.DIAMOND_BLOCK, 'diamond_block', '钻石块', 'diamond_block',
  { hardness: 5, tool: 'pickaxe', tier: 3, sound: 'metal' });
block(B.TORCH, 'torch', '火把', 'torch', {
  render: 'torch', solid: false, opaque: false, hardness: 0, sound: 'wood', light: true,
  support: 'solid', flatIcon: true,
});
const plant = {
  render: 'cross', solid: false, opaque: false, hardness: 0, sound: 'grass',
  support: [B.GRASS, B.DIRT], flatIcon: true, flammable: [60, 100],
};
block(B.TALL_GRASS, 'tall_grass', '草', 'tall_grass', { ...plant, replaceable: true, drop: null });
block(B.DANDELION, 'dandelion', '蒲公英', 'dandelion', plant);
block(B.POPPY, 'poppy', '虞美人', 'poppy', plant);
block(B.WOOL, 'wool', '白色羊毛', 'wool', { hardness: 0.8, sound: 'snow', fuel: 5, flammable: [30, 60] });
// Original block: crafted from wisp dust, glows like a torch.
block(B.WISP_LAMP, 'wisp_lamp', '幽光灯', 'wisp_lamp', { hardness: 0.3, sound: 'glass', light: true });

item(I.STICK, 'stick', '木棍', 'stick', { fuel: 5 });
item(I.COAL, 'coal', '煤炭', 'coal', { fuel: 80 });
item(I.IRON_INGOT, 'iron_ingot', '铁锭', 'iron_ingot');
item(I.GOLD_INGOT, 'gold_ingot', '金锭', 'gold_ingot');
item(I.DIAMOND, 'diamond', '钻石', 'diamond');

// Food: hunger points restored + saturation.
item(I.APPLE, 'apple', '苹果', 'apple', { food: 4, saturation: 2.4 });
item(I.PORKCHOP, 'porkchop', '生猪排', 'porkchop', { food: 3, saturation: 1.8, smelt: I.COOKED_PORKCHOP });
item(I.COOKED_PORKCHOP, 'cooked_porkchop', '熟猪排', 'cooked_porkchop', { food: 8, saturation: 12.8 });
item(I.BEEF, 'beef', '生牛肉', 'beef', { food: 3, saturation: 1.8, smelt: I.STEAK });
item(I.STEAK, 'steak', '牛排', 'steak', { food: 8, saturation: 12.8 });
item(I.CHICKEN, 'chicken', '生鸡肉', 'chicken', { food: 2, saturation: 1.2, smelt: I.COOKED_CHICKEN });
item(I.COOKED_CHICKEN, 'cooked_chicken', '熟鸡肉', 'cooked_chicken', { food: 6, saturation: 7.2 });
item(I.MUTTON, 'mutton', '生羊肉', 'mutton', { food: 2, saturation: 1.2, smelt: I.COOKED_MUTTON });
item(I.COOKED_MUTTON, 'cooked_mutton', '熟羊肉', 'cooked_mutton', { food: 6, saturation: 9.6 });
item(I.ROTTEN_FLESH, 'rotten_flesh', '腐肉', 'rotten_flesh', { food: 4, saturation: 0.8 });
// Mob drops & ranged combat.
item(I.LEATHER, 'leather', '皮革', 'leather');
item(I.FEATHER, 'feather', '羽毛', 'feather');
item(I.STRING, 'string', '线', 'string');
item(I.BONE, 'bone', '骨头', 'bone');
item(I.GUNPOWDER, 'gunpowder', '火药', 'gunpowder');
item(I.FLINT, 'flint', '燧石', 'flint');
item(I.ARROW, 'arrow', '箭', 'arrow');
item(I.BOW, 'bow', '弓', 'bow', { stack: 1, durability: 384, bow: true, fuel: 15 });
item(I.WISP_DUST, 'wisp_dust', '幽光粉', 'wisp_dust');
item(I.BUCKET, 'bucket', '铁桶', 'bucket', { stack: 16 });
item(I.WATER_BUCKET, 'water_bucket', '水桶', 'water_bucket', { stack: 1 });
item(I.LAVA_BUCKET, 'lava_bucket', '岩浆桶', 'lava_bucket', { stack: 1, fuel: 1000 });
item(I.FLINT_AND_STEEL, 'flint_and_steel', '打火石', 'flint_and_steel', { stack: 1, durability: 64 });

// Fluid helpers: level 0 = source, 1..7 = flowing (7 = weakest), 8 = falling.
// FLUID kind per id: 0 none, 1 water, 2 lava.
export const FLUID_KIND = new Uint8Array(256);
for (const d of BLOCKS) if (d?.fluid) FLUID_KIND[d.id] = d.fluid === 'water' ? 1 : 2;
export const isWater = (id) => FLUID_KIND[id] === 1;
export const isLava = (id) => FLUID_KIND[id] === 2;
export const isFluid = (id) => FLUID_KIND[id] !== 0;
export const fluidLevel = (id) => (FLUID_KIND[id] ? BLOCKS[id].level : -1);
export const waterLevel = (id) => (FLUID_KIND[id] === 1 ? BLOCKS[id].level : -1);
export const flowingWater = (level) => (level === 8 ? B.WATER_FALLING : B.WATER_FLOW_1 + level - 1);

export const TOOL_MATERIALS = [
  { key: 'wooden', name: '木', tier: 1, speed: 2, durability: 59, color: 0xa8834b, item: B.PLANKS },
  { key: 'stone', name: '石', tier: 2, speed: 4, durability: 131, color: 0x8e8e8e, item: B.COBBLESTONE },
  { key: 'iron', name: '铁', tier: 3, speed: 6, durability: 250, color: 0xe2e2e2, item: I.IRON_INGOT },
  { key: 'golden', name: '金', tier: 1, speed: 12, durability: 32, color: 0xf5d63d, item: I.GOLD_INGOT },
  { key: 'diamond', name: '钻石', tier: 4, speed: 8, durability: 1561, color: 0x4fe0d2, item: I.DIAMOND },
];
export const TOOL_TYPES = [
  { key: 'pickaxe', name: '镐' },
  { key: 'axe', name: '斧' },
  { key: 'shovel', name: '锹' },
  { key: 'sword', name: '剑' },
];

// Melee damage per tool type, indexed like TOOL_MATERIALS (wood, stone, iron, gold, diamond).
const ATTACK = {
  sword: [4, 5, 6, 4, 7],
  axe: [3, 4, 5, 3, 6],
  pickaxe: [2, 3, 4, 2, 5],
  shovel: [2, 2, 3, 2, 4],
};

let nextToolId = 300;
TOOL_MATERIALS.forEach((m, mi) => {
  for (const t of TOOL_TYPES) {
    const key = `${m.key}_${t.key}`;
    I[key.toUpperCase()] = nextToolId;
    item(nextToolId++, key, m.name + t.name, key, {
      stack: 1,
      tool: { type: t.key, tier: m.tier, speed: m.speed },
      durability: m.durability,
      attack: ATTACK[t.key][mi],
      fuel: m.key === 'wooden' ? 10 : 0,
    });
  }
});

// Armor: defense points and durability per piece follow Minecraft (leather, iron, gold, diamond).
export const ARMOR_MATERIALS = [
  { key: 'leather', name: '皮革', defense: [1, 3, 2, 1], mult: 5, toughness: 0, color: 0xa0653a, item: I.LEATHER },
  { key: 'iron', name: '铁', defense: [2, 6, 5, 2], mult: 15, toughness: 0, color: 0xdadada, item: I.IRON_INGOT },
  { key: 'golden', name: '金', defense: [2, 5, 3, 1], mult: 7, toughness: 0, color: 0xf5d63d, item: I.GOLD_INGOT },
  { key: 'diamond', name: '钻石', defense: [3, 8, 6, 3], mult: 33, toughness: 2, color: 0x4fe0d2, item: I.DIAMOND },
];
export const ARMOR_SLOTS = [
  { key: 'helmet', name: '头盔', base: 11 },
  { key: 'chestplate', name: '胸甲', base: 16 },
  { key: 'leggings', name: '护腿', base: 15 },
  { key: 'boots', name: '靴子', base: 13 },
];
let nextArmorId = 320;
for (const m of ARMOR_MATERIALS) {
  ARMOR_SLOTS.forEach((s, slot) => {
    const key = `${m.key}_${s.key}`;
    I[key.toUpperCase()] = nextArmorId;
    item(nextArmorId++, key, m.name + s.name, key, {
      stack: 1,
      armor: { slot, defense: m.defense[slot], toughness: m.toughness },
      durability: s.base * m.mult,
    });
  });
}

export function attackDamage(held) {
  return (held && ITEMS.get(held.id)?.attack) || 1;
}

export function getItem(id) {
  return ITEMS.get(id);
}

export function maxStack(id) {
  return ITEMS.get(id)?.stack ?? 64;
}

export function getDrop(def, rand = Math.random()) {
  const d = def.drop;
  if (d == null) return null;
  if (typeof d === 'function') return d(rand);
  return { id: d, count: 1 };
}

function properTool(def, held) {
  const t = held && ITEMS.get(held.id)?.tool;
  return t && def.tool && t.type === def.tool ? t : null;
}

export function canHarvest(def, held) {
  if (!def.tier) return true;
  const t = properTool(def, held);
  return !!t && t.tier >= def.tier;
}

// Seconds needed to break a block with the held item (Minecraft formula).
export function breakTime(def, held) {
  if (def.hardness < 0) return Infinity;
  if (def.hardness === 0) return 0;
  const t = properTool(def, held);
  const speed = t ? t.speed : 1;
  return (def.hardness * (canHarvest(def, held) ? 1.5 : 5)) / speed;
}

export const CREATIVE_ITEMS = [
  B.GRASS, B.DIRT, B.STONE, B.COBBLESTONE, B.STONE_BRICKS, B.BEDROCK, B.SAND, B.SANDSTONE, B.GRAVEL,
  B.LOG, B.PLANKS, B.LEAVES, B.GLASS, B.SNOW, B.CACTUS, B.CRAFTING_TABLE, B.FURNACE, B.CHEST,
  B.TORCH, B.TALL_GRASS, B.DANDELION, B.POPPY, B.COAL_ORE, B.IRON_ORE, B.GOLD_ORE, B.DIAMOND_ORE,
  B.IRON_BLOCK, B.GOLD_BLOCK, B.DIAMOND_BLOCK, B.WOOL,
  I.STICK, I.COAL, I.IRON_INGOT, I.GOLD_INGOT, I.DIAMOND, I.FLINT, I.LEATHER, I.FEATHER, I.STRING,
  I.BONE, I.GUNPOWDER, I.BOW, I.ARROW, I.WISP_DUST, B.WISP_LAMP, I.BUCKET, I.WATER_BUCKET, I.LAVA_BUCKET,
  B.OBSIDIAN, B.TNT, I.FLINT_AND_STEEL,
  I.APPLE, I.PORKCHOP, I.COOKED_PORKCHOP, I.BEEF, I.STEAK, I.CHICKEN, I.COOKED_CHICKEN,
  I.MUTTON, I.COOKED_MUTTON, I.ROTTEN_FLESH,
  ...Array.from({ length: TOOL_MATERIALS.length * TOOL_TYPES.length }, (_, i) => 300 + i),
  ...Array.from({ length: ARMOR_MATERIALS.length * ARMOR_SLOTS.length }, (_, i) => 320 + i),
];

// Fire spread data per block id: encouragement / flammability (0 = won't burn).
export const FIRE_ENCOURAGE = new Uint8Array(256);
export const FLAMMABILITY = new Uint8Array(256);
for (const d of BLOCKS) {
  if (d?.flammable) { FIRE_ENCOURAGE[d.id] = d.flammable[0]; FLAMMABILITY[d.id] = d.flammable[1]; }
}
