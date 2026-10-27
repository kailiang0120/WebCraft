// DOM-based HUD and container screens (inventory, crafting table, furnace, chest, creative).
import { I, getItem, maxStack, CREATIVE_ITEMS } from './blocks.js';
import { itemIcon, itemIconCanvas } from './icons.js';
import { matchRecipe, smeltResult, fuelValue, SMELT_TIME } from './recipes.js';
import { insertInto, canMerge, makeStack } from './inventory.js';

const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function makeSlotEl(parent, cls = '') {
  const s = el('div', `slot ${cls}`, parent);
  s.img = el('img', '', s);
  s.img.draggable = false;
  s.count = el('span', 'count', s);
  s.dur = el('div', 'dur', s);
  s.durBar = el('div', '', s.dur);
  s._key = '';
  return s;
}

function fillSlot(s, stack) {
  const key = stack ? `${stack.id}:${stack.count}:${stack.dmg || 0}` : '';
  if (s._key === key) return;
  s._key = key;
  if (!stack) {
    s.img.style.display = 'none';
    s.count.textContent = '';
    s.dur.style.display = 'none';
    return;
  }
  s.img.src = itemIcon(stack.id);
  s.img.style.display = 'block';
  s.count.textContent = stack.count > 1 ? stack.count : '';
  const def = getItem(stack.id);
  if (def.durability && stack.dmg > 0) {
    const f = Math.max(0, 1 - stack.dmg / def.durability);
    s.dur.style.display = 'block';
    s.durBar.style.width = `${f * 100}%`;
    s.durBar.style.background = `hsl(${f * 120}, 90%, 50%)`;
  } else s.dur.style.display = 'none';
}

function foodIcon(kind) {
  // Drumstick: meat (M) + bone (B); "half" keeps only the right half filled.
  const mask = ['....MMM..', '...MMMMM.', '...MMMMM.', '...MMMMM.', '..BMMMM..', '.B.......', 'BB.......', '.B.......'];
  const c = document.createElement('canvas');
  c.width = 11; c.height = 10;
  const g = c.getContext('2d');
  const on = (x, y) => mask[y]?.[x] && mask[y][x] !== '.';
  for (let y = -1; y <= 8; y++) {
    for (let x = -1; x <= 9; x++) {
      const ch = mask[y]?.[x];
      if (on(x, y)) {
        const filled = kind === 'full' || (kind === 'half' && x >= 5);
        if (!filled) g.fillStyle = '#3a2410';
        else g.fillStyle = ch === 'B' ? '#efe8d8' : y < 2 ? '#d88a4a' : '#a8582a';
      } else if (on(x + 1, y) || on(x - 1, y) || on(x, y + 1) || on(x, y - 1)) g.fillStyle = '#000';
      else continue;
      g.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  return c.toDataURL();
}

function armorIcon(kind) {
  // Chestplate outline; "half" fills only the left half.
  const mask = ['XX...XX.', 'XXX.XXX.', 'XXXXXXX.', '.XXXXX..', '.XXXXX..', '.XXXXX..', '.XXXXX..'];
  const c = document.createElement('canvas');
  c.width = 11; c.height = 10;
  const g = c.getContext('2d');
  const on = (x, y) => mask[y]?.[x] === 'X';
  for (let y = -1; y <= 7; y++) {
    for (let x = -1; x <= 8; x++) {
      if (on(x, y)) {
        const filled = kind === 'full' || (kind === 'half' && x < 3.5);
        g.fillStyle = filled ? (y < 2 ? '#e8e8e8' : '#b8b8c0') : '#3a3a3a';
      } else if (on(x + 1, y) || on(x - 1, y) || on(x, y + 1) || on(x, y - 1)) g.fillStyle = '#000';
      else continue;
      g.fillRect(x + 2, y + 2, 1, 1);
    }
  }
  return c.toDataURL();
}

// Faint outline shown in an empty armor slot.
function armorPlaceholder(id) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.filter = 'grayscale(1) brightness(0.55)';
  g.globalAlpha = 0.45;
  g.drawImage(itemIconCanvas(id), 0, 0);
  return `url(${c.toDataURL()})`;
}

function heartIcon(kind) {
  const mask = ['.XX...XX.', 'XXXX.XXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....'];
  const c = document.createElement('canvas');
  c.width = 11; c.height = 10;
  const g = c.getContext('2d');
  const on = (x, y) => mask[y]?.[x] === 'X';
  for (let y = -1; y <= 8; y++) {
    for (let x = -1; x <= 9; x++) {
      if (on(x, y)) {
        const red = kind === 'full' || (kind === 'half' && x < 4.5);
        g.fillStyle = red ? (y < 2 && x > 0 && x < 3 ? '#ff8080' : '#e01818') : '#3a1010';
      } else if (on(x + 1, y) || on(x - 1, y) || on(x, y + 1) || on(x, y - 1)) g.fillStyle = '#000';
      else continue;
      g.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  return c.toDataURL();
}

export class UI {
  constructor(game) {
    this.game = game;
    this.inv = game.inventory;
    this.cursor = null;
    this.screen = null;
    this.hover = null;
    this.mouse = [0, 0];
    this.screenEl = document.getElementById('screen');
    this.cursorEl = document.getElementById('cursor-item');
    this.tooltipEl = document.getElementById('tooltip');
    this.toastEl = document.getElementById('toast');
    this.itemNameEl = document.getElementById('item-name');
    this.healthEl = document.getElementById('health');
    this.cursorSlot = makeSlotEl(this.cursorEl, 'ghost');
    this.hearts = { full: heartIcon('full'), half: heartIcon('half'), empty: heartIcon('empty') };
    this.heartEls = range(0, 10).map(() => el('img', 'heart', this.healthEl));
    this.foodEl = document.getElementById('food');
    this.foods = { full: foodIcon('full'), half: foodIcon('half'), empty: foodIcon('empty') };
    this.foodEls = range(0, 10).map(() => el('img', 'heart', this.foodEl));
    this.armorEl = document.getElementById('armor');
    this.armorIcons = { full: armorIcon('full'), half: armorIcon('half'), empty: armorIcon('empty') };
    this.armorEls = range(0, 10).map(() => el('img', 'heart', this.armorEl));
    this.lastArmor = -1;
    this.armorPlaceholders = [I.IRON_HELMET, I.IRON_CHESTPLATE, I.IRON_LEGGINGS, I.IRON_BOOTS].map(armorPlaceholder);
    this.drag = null; // left/right-drag distributing the held stack over several slots
    this.lastClick = null; // for double-click collecting
    this.lastFood = -1;
    this.lastHealth = -1;
    this.lastSelected = -1;
    this.lastHeldId = null;
    this.itemNameTimer = 0;

    const hb = document.getElementById('hotbar');
    hb.innerHTML = '';
    this.hotbarSlots = range(0, 9).map(() => makeSlotEl(hb));

    document.addEventListener('mousemove', (e) => {
      this.mouse = [e.clientX, e.clientY];
      this.positionFloating();
    });
    document.addEventListener('mouseup', () => this.endDrag());
    this.screenEl.addEventListener('contextmenu', (e) => e.preventDefault());
    this.screenEl.addEventListener('mousedown', (e) => {
      // Clicking outside the panel with an item in hand throws it (right click: just one).
      if (e.target === this.screenEl && this.cursor && !this.drag) {
        const n = e.button === 2 ? 1 : this.cursor.count;
        this.game.throwStack({ ...this.cursor, count: n });
        this.cursor.count -= n;
        if (this.cursor.count <= 0) this.cursor = null;
        this.refresh();
      }
    });
  }

  get isOpen() {
    return !!this.screen;
  }

  // ---------- HUD ----------
  updateHUD(dt, player, creative) {
    const inv = this.inv;
    this.hotbarSlots.forEach((s, i) => {
      fillSlot(s, inv.slots[i]);
      s.classList.toggle('selected', i === inv.selected);
    });
    this.healthEl.style.visibility = creative ? 'hidden' : 'visible';
    this.foodEl.style.visibility = creative ? 'hidden' : 'visible';
    // Armor points above the hearts (hidden with no armor on), 2 points per icon.
    const def = inv.armorStats().defense;
    this.armorEl.style.visibility = creative || !def ? 'hidden' : 'visible';
    if (def !== this.lastArmor) {
      this.lastArmor = def;
      this.armorEls.forEach((h, i) => {
        const v = def - i * 2;
        h.src = v >= 2 ? this.armorIcons.full : v === 1 ? this.armorIcons.half : this.armorIcons.empty;
      });
    }
    if (player.food !== this.lastFood) {
      this.lastFood = player.food;
      // Drumsticks fill from the right, like Minecraft.
      this.foodEls.forEach((h, i) => {
        const v = player.food - (9 - i) * 2;
        h.src = v >= 2 ? this.foods.full : v === 1 ? this.foods.half : this.foods.empty;
      });
    }
    // Shake the bar when starving.
    this.foodEl.classList.toggle('low', player.food <= 6 && !creative);
    const hp = Math.ceil(player.health);
    if (hp !== this.lastHealth) {
      this.lastHealth = hp;
      this.heartEls.forEach((h, i) => {
        const v = hp - i * 2;
        h.src = v >= 2 ? this.hearts.full : v === 1 ? this.hearts.half : this.hearts.empty;
      });
    }
    const held = inv.held;
    const heldId = held ? held.id : null;
    if (inv.selected !== this.lastSelected || heldId !== this.lastHeldId) {
      this.lastSelected = inv.selected;
      this.lastHeldId = heldId;
      this.itemNameEl.textContent = held ? getItem(held.id).name : '';
      this.itemNameTimer = 2;
    }
    this.itemNameTimer -= dt;
    this.itemNameEl.style.opacity = Math.max(0, Math.min(1, this.itemNameTimer));
    if (this.screen) this.refresh();
  }

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
  }

  // ---------- screens ----------
  open(type, entity = null) {
    this.screen = { type, entity, result: null };
    if (type === 'inventory') this.screen.craft = { w: 2, slots: new Array(4).fill(null) };
    if (type === 'crafting') this.screen.craft = { w: 3, slots: new Array(9).fill(null) };
    this.build();
    this.screenEl.classList.remove('hidden');
    this.refresh();
  }

  close() {
    const s = this.screen;
    if (!s) return;
    // Leftovers go back to the inventory; anything that doesn't fit is dropped, never lost.
    this.drag = null;
    if (s.craft) for (const st of s.craft.slots) if (st) this.game.giveOrDrop(st);
    if (this.cursor) this.game.giveOrDrop(this.cursor);
    this.cursor = null;
    this.screen = null;
    this.hover = null;
    this.screenEl.classList.add('hidden');
    this.screenEl.innerHTML = '';
    this.tooltipEl.style.display = 'none';
    this.cursorEl.style.display = 'none';
  }

  build() {
    const s = this.screen;
    const root = this.screenEl;
    root.innerHTML = '';
    this.slotEls = [];
    const panel = el('div', 'panel', root);
    const add = (parent, b, cls) => {
      const e = makeSlotEl(parent, cls);
      e.binding = b;
      e.addEventListener('mousedown', (ev) => this.onSlotDown(b, ev));
      e.addEventListener('mouseenter', () => { this.hover = b; this.dragOver(b); this.refreshTooltip(); });
      e.addEventListener('mouseleave', () => { if (this.hover === b) this.hover = null; this.refreshTooltip(); });
      this.slotEls.push(e);
      return e;
    };
    const grid = (parent, cols, bindings, cls = '') => {
      const g = el('div', `grid ${cls}`, parent);
      g.style.gridTemplateColumns = `repeat(${cols}, var(--slot))`;
      bindings.forEach((b) => add(g, b));
      return g;
    };

    if (s.type === 'inventory') {
      // Armor column on the left, 2x2 crafting on the right.
      const top = el('div', 'inv-top', panel);
      const col = el('div', 'armor-col', top);
      range(0, 4).forEach((i) => {
        const e = add(col, { kind: 'armor', i }, 'armor-slot');
        e.style.setProperty('--ph', this.armorPlaceholders[i]);
      });
      const right = el('div', 'inv-craft', top);
      el('div', 'title', right, '合成（2×2）');
      const row = el('div', 'craft-row', right);
      grid(row, 2, range(0, 4).map((i) => ({ kind: 'craft', i })));
      el('div', 'arrow', row);
      add(row, { kind: 'result' }, 'big');
      el('div', 'hint', panel, '提示：原木→木板，木板→工作台。左侧 4 格穿戴盔甲。拖动可平均分配，双击收集同类物品。');
    } else if (s.type === 'crafting') {
      el('div', 'title', panel, '合成');
      const row = el('div', 'craft-row', panel);
      grid(row, s.craft.w, range(0, s.craft.w * s.craft.w).map((i) => ({ kind: 'craft', i })));
      el('div', 'arrow', row);
      add(row, { kind: 'result' }, 'big');
    } else if (s.type === 'furnace') {
      el('div', 'title', panel, '熔炉');
      const row = el('div', 'furnace-row', panel);
      const col = el('div', 'furnace-col', row);
      add(col, { kind: 'furnace', i: 0 });
      const flame = el('div', 'flame', col);
      this.flameFill = el('div', 'fill', flame);
      add(col, { kind: 'furnace', i: 1 });
      const prog = el('div', 'progress', row);
      this.progressFill = el('div', 'fill', prog);
      add(row, { kind: 'furnace', i: 2 }, 'big');
      el('div', 'hint', panel, '上：要烧炼的物品　下：燃料（煤炭、木头等）');
    } else if (s.type === 'chest') {
      el('div', 'title', panel, '箱子');
      grid(panel, 9, range(0, 27).map((i) => ({ kind: 'chest', i })));
    } else if (s.type === 'creative') {
      el('div', 'title', panel, '创造模式物品');
      grid(panel, 9, CREATIVE_ITEMS.map((id) => ({ kind: 'palette', id })), 'palette');
      el('div', 'hint', panel, '左键取一组，右键取一个；手持物品点击此处可删除。');
    }

    el('div', 'title', panel, '物品栏');
    grid(panel, 9, range(9, 36).map((i) => ({ kind: 'inv', i })));
    grid(panel, 9, range(0, 9).map((i) => ({ kind: 'inv', i })), 'hotbar-grid');
  }

  refresh() {
    if (!this.screen) return;
    for (const e of this.slotEls) {
      const st = this.getSlot(e.binding);
      fillSlot(e, st);
      if (e.binding.kind === 'armor') e.classList.toggle('empty', !st);
    }
    fillSlot(this.cursorSlot, this.cursor);
    this.cursorEl.style.display = this.cursor ? 'block' : 'none';
    const s = this.screen;
    if (s.type === 'furnace') {
      const f = s.entity;
      this.flameFill.style.height = `${f.burn > 0 ? (f.burn / f.burnMax) * 100 : 0}%`;
      this.progressFill.style.width = `${(f.cook / SMELT_TIME) * 100}%`;
    }
    this.refreshTooltip();
  }

  refreshTooltip() {
    const st = this.hover && !this.cursor ? this.getSlot(this.hover) : null;
    if (!st) {
      this.tooltipEl.style.display = 'none';
      return;
    }
    const def = getItem(st.id);
    let text = def.name;
    if (def.durability) text += `  耐久 ${def.durability - (st.dmg || 0)}/${def.durability}`;
    if (def.food) text += `  饱食度 +${def.food}`;
    if (def.attack) text += `  攻击 ${def.attack}`;
    if (def.armor) text += `  护甲 +${def.armor.defense}`;
    this.tooltipEl.textContent = text;
    this.tooltipEl.style.display = 'block';
    this.positionFloating();
  }

  positionFloating() {
    const [x, y] = this.mouse;
    this.cursorEl.style.left = `${x}px`;
    this.cursorEl.style.top = `${y}px`;
    this.tooltipEl.style.left = `${x + 14}px`;
    this.tooltipEl.style.top = `${y - 28}px`;
  }

  getSlot(b) {
    const s = this.screen;
    switch (b.kind) {
      case 'inv': return this.inv.slots[b.i];
      case 'armor': return this.inv.armor[b.i];
      case 'craft': return s.craft.slots[b.i];
      case 'result': return s.result;
      case 'chest':
      case 'furnace': return s.entity.slots[b.i];
      case 'palette': return makeStack(b.id, maxStack(b.id));
    }
    return null;
  }

  setSlot(b, v) {
    if (v && v.count <= 0) v = null;
    const s = this.screen;
    switch (b.kind) {
      case 'inv': this.inv.slots[b.i] = v; break;
      case 'armor': this.inv.armor[b.i] = v; break;
      case 'craft': s.craft.slots[b.i] = v; break;
      case 'chest':
      case 'furnace': s.entity.slots[b.i] = v; break;
    }
  }

  accepts(b, stack) {
    if (b.kind === 'result' || b.kind === 'palette') return false;
    if (b.kind === 'armor') return getItem(stack.id).armor?.slot === b.i;
    if (b.kind === 'furnace') {
      if (b.i === 2) return false;
      if (b.i === 1) return fuelValue(stack.id) > 0;
    }
    return true;
  }

  onSlotDown(b, e) {
    e.preventDefault();
    e.stopPropagation();
    this.game.sound.click();
    const btn = e.button;
    if (btn !== 0 && btn !== 2) return;

    if (b.kind === 'palette') {
      if (this.cursor) this.cursor = null;
      else {
        const st = makeStack(b.id, btn === 2 ? 1 : maxStack(b.id));
        if (e.shiftKey) this.inv.addStack(st);
        else this.cursor = st;
      }
      return this.refresh();
    }
    if (b.kind === 'result') {
      this.takeResult(e.shiftKey);
      return this.refresh();
    }
    if (e.shiftKey) {
      this.quickMove(b);
      this.afterChange();
      return this.refresh();
    }
    if (this.drag) return;

    // Double-click with a stack in hand gathers matching items from every slot on screen.
    const now = performance.now();
    if (btn === 0 && this.cursor && this.lastClick && this.lastClick.b === b && now - this.lastClick.t < 300) {
      this.lastClick = null;
      this.collect();
      this.afterChange();
      return this.refresh();
    }
    this.lastClick = btn === 0 ? { b, t: now } : null;

    // Holding a stack: the click happens on release, so dragging across slots can spread it out.
    const outputSlot = b.kind === 'furnace' && b.i === 2;
    if (this.cursor && !outputSlot) {
      this.drag = { btn, start: { ...this.cursor }, slots: [b], snap: [this.snapshot(b)] };
      return;
    }
    this.clickSlot(b, btn);
  }

  snapshot(b) {
    const st = this.getSlot(b);
    return st ? { ...st } : null;
  }

  dragOver(b) {
    const d = this.drag;
    if (!d || d.slots.includes(b) || !this.accepts(b, d.start)) return;
    const slot = this.getSlot(b);
    if (slot && (!canMerge(slot, d.start) || slot.count >= maxStack(slot.id))) return;
    // Left drag splits evenly (needs at least one item per slot); right drag puts one in each.
    if (d.slots.length >= d.start.count) return;
    d.slots.push(b);
    d.snap.push(this.snapshot(b));
    this.applyDrag();
  }

  applyDrag() {
    const d = this.drag;
    d.slots.forEach((b, i) => this.setSlot(b, d.snap[i] ? { ...d.snap[i] } : null));
    let left = d.start.count;
    const per = d.btn === 2 ? 1 : Math.floor(d.start.count / d.slots.length);
    for (const b of d.slots) {
      const cur = this.getSlot(b);
      if ((cur && !canMerge(cur, d.start)) || !this.accepts(b, d.start)) continue; // the slot the drag began on
      const room = maxStack(d.start.id) - (cur ? cur.count : 0);
      const n = Math.min(per, room, left);
      if (n <= 0) continue;
      if (cur) cur.count += n;
      else this.setSlot(b, { ...d.start, count: n });
      left -= n;
    }
    this.cursor = left > 0 ? { ...d.start, count: left } : null;
    this.afterChange();
    this.refresh();
  }

  endDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (!this.screen) return;
    if (d.slots.length === 1) this.clickSlot(d.slots[0], d.btn); // a plain click
    else this.game.sound.pop();
  }

  collect() {
    const cur = this.cursor;
    const max = maxStack(cur.id);
    const sources = this.slotEls.map((e) => e.binding).filter((b) => b.kind !== 'result' && b.kind !== 'palette');
    // Partial stacks first, like Minecraft, so full stacks stay intact when possible.
    for (const pass of [0, 1]) {
      for (const b of sources) {
        if (cur.count >= max) return;
        const st = this.getSlot(b);
        if (!st || !canMerge(st, cur) || (pass === 0) !== (st.count < max)) continue;
        const n = Math.min(st.count, max - cur.count);
        cur.count += n;
        st.count -= n;
        if (!st.count) this.setSlot(b, null);
      }
    }
  }

  // Keys while a screen is open: 1-9 swap the hovered slot with that hotbar slot, Q drops from it.
  onKey(e) {
    const b = this.hover;
    if (!b || this.cursor || b.kind === 'result' || b.kind === 'palette') return;
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5)) - 1;
      if (n < 0 || n > 8 || (b.kind === 'inv' && b.i === n)) return;
      const a = this.getSlot(b), h = this.inv.slots[n];
      if ((h && !this.accepts(b, h)) || (b.kind === 'furnace' && b.i === 2 && h)) return;
      this.setSlot(b, h);
      this.inv.slots[n] = a;
    } else if (e.code === 'KeyQ') {
      const st = this.getSlot(b);
      if (!st) return;
      const n = e.ctrlKey ? st.count : 1;
      this.game.throwStack({ ...st, count: n });
      st.count -= n;
      if (!st.count) this.setSlot(b, null);
    } else return;
    this.game.sound.click();
    this.afterChange();
    this.refresh();
  }

  clickSlot(b, btn) {
    const slot = this.getSlot(b);
    const cur = this.cursor;
    if (b.kind === 'furnace' && b.i === 2) {
      if (slot && !cur) { this.cursor = slot; this.setSlot(b, null); }
      else if (slot && canMerge(cur, slot) && cur.count + slot.count <= maxStack(slot.id)) {
        cur.count += slot.count;
        this.setSlot(b, null);
      }
      return this.refresh();
    }

    if (btn === 0) {
      if (!cur && slot) { this.cursor = slot; this.setSlot(b, null); }
      else if (cur && !slot) {
        if (this.accepts(b, cur)) { this.setSlot(b, cur); this.cursor = null; }
      } else if (cur && slot) {
        if (canMerge(cur, slot)) {
          const n = Math.min(cur.count, maxStack(slot.id) - slot.count);
          slot.count += n;
          cur.count -= n;
          if (!cur.count) this.cursor = null;
        } else if (this.accepts(b, cur)) {
          this.setSlot(b, cur);
          this.cursor = slot;
        }
      }
    } else {
      if (!cur && slot) {
        const half = Math.ceil(slot.count / 2);
        this.cursor = { ...slot, count: half };
        slot.count -= half;
        if (!slot.count) this.setSlot(b, null);
      } else if (cur && this.accepts(b, cur)) {
        if (!slot) {
          this.setSlot(b, { ...cur, count: 1 });
          cur.count--;
        } else if (canMerge(cur, slot)) {
          if (slot.count < maxStack(slot.id)) { slot.count++; cur.count--; }
        } else {
          this.setSlot(b, cur);
          this.cursor = slot;
        }
        if (this.cursor && this.cursor.count <= 0) this.cursor = null;
      }
    }
    this.afterChange();
    this.refresh();
  }

  afterChange() {
    const s = this.screen;
    if (s?.craft) {
      const r = matchRecipe(s.craft.slots, s.craft.w);
      s.result = r ? makeStack(r.id, r.count) : null;
    }
  }

  consumeCraft() {
    const slots = this.screen.craft.slots;
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i]) continue;
      slots[i].count--;
      if (slots[i].count <= 0) slots[i] = null;
    }
    this.afterChange();
  }

  takeResult(shift) {
    const s = this.screen;
    if (!s.result) return;
    if (shift) {
      for (let guard = 0; guard < 64 && s.result; guard++) {
        const trial = this.inv.slots.map((x) => (x ? { ...x } : null));
        if (insertInto(trial, range(0, 36), { ...s.result })) break;
        this.inv.slots = trial;
        this.consumeCraft();
      }
    } else {
      const r = s.result;
      if (!this.cursor) this.cursor = { ...r };
      else if (canMerge(this.cursor, r) && this.cursor.count + r.count <= maxStack(r.id)) this.cursor.count += r.count;
      else return;
      this.consumeCraft();
    }
    this.game.sound.pop();
  }

  quickMove(b) {
    const stack = this.getSlot(b);
    if (!stack) return;
    const s = this.screen;
    let rem;
    const armorSlot = getItem(stack.id).armor?.slot;
    if (b.kind === 'inv') {
      if (s.type === 'inventory' && armorSlot != null && !this.inv.armor[armorSlot]) {
        this.inv.armor[armorSlot] = stack; // shift-click armor to wear it
        rem = null;
      } else if (s.type === 'chest') rem = insertInto(s.entity.slots, range(0, 27), stack);
      else if (s.type === 'furnace' && smeltResult(stack.id) != null) rem = insertInto(s.entity.slots, [0], stack);
      else if (s.type === 'furnace' && fuelValue(stack.id) > 0) rem = insertInto(s.entity.slots, [1], stack);
      else rem = insertInto(this.inv.slots, b.i < 9 ? range(9, 36) : range(0, 9), stack);
    } else {
      rem = insertInto(this.inv.slots, range(0, 36), stack);
    }
    this.setSlot(b, rem);
  }
}
