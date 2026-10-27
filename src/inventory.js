import { maxStack, getItem } from './blocks.js';

export const makeStack = (id, count = 1) => {
  const s = { id, count };
  if (getItem(id)?.durability) s.dmg = 0;
  return s;
};

export const canMerge = (a, b) => a && b && a.id === b.id && maxStack(a.id) > 1;

// Moves as much of `stack` into slots[indices] as possible (merging first). Returns remainder or null.
export function insertInto(slots, indices, stack) {
  if (!stack) return null;
  let left = stack.count;
  const max = maxStack(stack.id);
  if (max > 1) {
    for (const i of indices) {
      const s = slots[i];
      if (s && s.id === stack.id && s.count < max) {
        const n = Math.min(left, max - s.count);
        s.count += n;
        left -= n;
        if (!left) return null;
      }
    }
  }
  for (const i of indices) {
    if (!slots[i]) {
      const n = Math.min(left, max);
      slots[i] = { ...stack, count: n };
      left -= n;
      if (!left) return null;
    }
  }
  return { ...stack, count: left };
}

export class Inventory {
  constructor() {
    this.slots = new Array(36).fill(null); // 0-8 hotbar, 9-35 main
    this.armor = [null, null, null, null]; // helmet, chestplate, leggings, boots
    this.selected = 0;
  }

  armorStats() {
    let defense = 0, toughness = 0;
    for (const s of this.armor) {
      const a = s && getItem(s.id).armor;
      if (a) { defense += a.defense; toughness += a.toughness; }
    }
    return { defense, toughness };
  }

  // Every worn piece loses durability when it absorbs a hit. Returns true if a piece broke.
  damageArmor(amount) {
    const n = Math.max(1, Math.floor(amount / 4));
    let broke = false;
    this.armor.forEach((s, i) => {
      if (!s) return;
      s.dmg = (s.dmg || 0) + n;
      if (s.dmg >= getItem(s.id).durability) { this.armor[i] = null; broke = true; }
    });
    return broke;
  }

  get held() {
    return this.slots[this.selected];
  }

  // Adds items, hotbar first. Returns number that didn't fit.
  add(id, count = 1) {
    const order = [...Array(36).keys()];
    const rem = insertInto(this.slots, order, makeStack(id, count));
    return rem ? rem.count : 0;
  }

  addStack(stack) {
    return insertInto(this.slots, [...Array(36).keys()], stack);
  }

  consumeHeld(n = 1) {
    const s = this.held;
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
  }

  damageHeld(n = 1) {
    const s = this.held;
    const def = s && getItem(s.id);
    if (!def?.durability) return false;
    s.dmg = (s.dmg || 0) + n;
    if (s.dmg >= def.durability) {
      this.slots[this.selected] = null;
      return true; // broke
    }
    return false;
  }

  toJSON() {
    return { slots: this.slots, armor: this.armor, selected: this.selected };
  }

  load(data) {
    if (!data) return;
    const valid = (s) => (s && getItem(s.id) ? s : null);
    this.slots = data.slots.map(valid);
    while (this.slots.length < 36) this.slots.push(null);
    this.armor = [0, 1, 2, 3].map((i) => valid(data.armor?.[i]));
    this.selected = data.selected || 0;
  }
}
