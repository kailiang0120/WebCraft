import * as THREE from 'three';
import { B, I, BLOCKS, getItem, getDrop, breakTime, canHarvest, maxStack, attackDamage, isWater } from './blocks.js';
import { MobManager } from './mobs/manager.js';
import { ItemEntities } from './items.js';
import { Fluids } from './fluids.js';
import { Fire } from './fire.js';
import { Fx } from './fx.js';
import { MOB_TYPES } from './mobs/mob.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Inventory, makeStack } from './inventory.js';
import { UI } from './ui.js';
import { Sky } from './sky.js';
import { Sound } from './audio.js';
import { Hand } from './hand.js';
import { Particles } from './particles.js';
import { worldUniforms, atlasTexture, dynLightTexture } from './materials.js';
import { LIGHT_EMIT, computeDynamicLight, dynamicLevelAt } from './lighting.js';
import { raycast } from './raycast.js';
import { TerrainGenerator, BIOME, BIOME_NAMES } from './terrain.js';
import { smeltResult, fuelValue, SMELT_TIME } from './recipes.js';
import { tileIndex, tileUV, tileAverage, animateTiles, drawTile } from './textures.js';
import { SEA_LEVEL, HEIGHT } from './constants.js';

const DAY_LENGTH = 600; // seconds for a full day/night cycle
const REACH = 5;
const FACING_NAMES = ['东 (+X)', '西 (-X)', '', '', '南 (+Z)', '北 (-Z)'];

export class Game {
  constructor({ canvas, storage, meta, seed, settings, callbacks }) {
    this.canvas = canvas;
    this.storage = storage;
    this.settings = settings;
    this.cb = callbacks;
    this.seed = meta ? meta.seed : seed;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xffffff, 60, 100); // for mobs/particles (terrain does its own fog)
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';

    this.sky = new Sky(this.scene);
    this.world = new World(this.scene, this.seed, storage);
    this.world.renderDistance = settings.renderDistance;
    this.gen = new TerrainGenerator(this.seed);
    this.player = new Player(this.world);
    this.inventory = new Inventory();
    this.sound = new Sound();
    this.sound.volume = settings.volume;
    this.ui = new UI(this);
    this.hand = new Hand();
    this.particles = new Particles(this.scene);
    this.difficulty = 'normal';
    this.mobs = new MobManager(this);
    this.items = new ItemEntities(this);
    this.fluids = new Fluids(this);
    this.fire = new Fire(this);
    this.fx = new Fx(this);
    this.fireOverlay = document.getElementById('fire-overlay');
    this.fireOverlayOn = false;
    this.bufferSize = new THREE.Vector2();

    // Target block outline + crack overlay.
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.crackGeoms = Array.from({ length: 10 }, (_, s) => {
      const g = new THREE.BoxGeometry(1.006, 1.006, 1.006);
      const [u0, v0, u1, v1] = tileUV(tileIndex(`crack_${s}`));
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      return g;
    });
    this.crack = new THREE.Mesh(this.crackGeoms[0], new THREE.MeshBasicMaterial({
      map: atlasTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    }));
    this.crack.visible = false;
    this.scene.add(this.crack);

    // State
    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.locked = false;
    this.paused = false;
    this.dead = false;
    this.running = false;
    this.ready = false;
    this.mining = null;
    this.breakDelay = 0;
    this.useDelay = 0;
    this.elapsed = 0;
    this.time = 0.02;
    this.autosave = 0;
    this.lastStep = 0;
    this.lastSpaceTap = 0;
    this.showDebug = false;
    this.fps = 0;
    this.fpsAcc = [0, 0];
    this.wasInWater = false;
    this.damageFlash = 0;
    this.attackLock = false;
    this.attackQueued = false;
    this.attackCd = 0;
    this.using = null; // { kind: 'eat' | 'bow', t, id }
    this.dynOrigin = null;
    this.dynKey = '';
    this.dynLightT = 0;

    this.gameMode = 'survival';
    if (meta) this.loadMeta(meta);
    else this.newWorld();
    this.applyGameMode();

    this.player.onDamage = () => {
      this.sound.hurt();
      this.damageFlash = 1;
      if (this.player.health <= 0) this.die();
    };
    this.player.armor = () => this.inventory.armorStats();
    this.player.onArmorHit = (n) => {
      if (this.inventory.damageArmor(n)) {
        this.sound.tone('square', 600, 200, 0.2, 0.1);
        this.ui.toast('盔甲损坏了！');
      }
    };

    this.bindEvents();
    this.onResize();
  }

  // ---------- world setup / persistence ----------
  newWorld() {
    const [x, z] = this.findSpawn();
    this.spawn = [x + 0.5, null, z + 0.5];
    this.player.pos.set(x + 0.5, 100, z + 0.5);
    this.needsGroundSnap = true;
    this.player.yaw = Math.PI * 0.75;
  }

  findSpawn() {
    for (let i = 0; i < 3000; i++) {
      const a = i * 2.39996, r = Math.sqrt(i) * 12;
      const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
      const c = this.gen.column(x, z);
      if (c.h > SEA_LEVEL + 1 && c.h < 88 && c.biome !== BIOME.OCEAN && c.biome !== BIOME.BEACH) return [x, z];
    }
    return [0, 0];
  }

  loadMeta(m) {
    const p = m.player;
    this.player.pos.set(p.pos[0], p.pos[1], p.pos[2]);
    this.player.yaw = p.yaw;
    this.player.pitch = p.pitch;
    this.player.health = p.health ?? 20;
    this.player.food = p.food ?? 20;
    this.player.saturation = p.saturation ?? 5;
    this.player.flying = !!p.flying;
    this.difficulty = m.difficulty || 'normal';
    this.mobs.load(m.mobs);
    this.items.load(m.items);
    this.spawn = m.spawn;
    this.needsGroundSnap = false;
    this.time = m.time ?? 0.02;
    this.gameMode = m.gameMode || 'survival';
    this.inventory.load(m.inventory);
    for (const [k, e] of m.entities || []) this.world.entities.set(k, e);
  }

  serialize() {
    const p = this.player;
    return {
      version: 1,
      seed: this.seed,
      time: this.time,
      gameMode: this.gameMode,
      spawn: this.spawn,
      savedAt: Date.now(),
      difficulty: this.difficulty,
      player: {
        pos: [p.pos.x, p.pos.y, p.pos.z], yaw: p.yaw, pitch: p.pitch, health: p.health,
        food: p.food, saturation: p.saturation, flying: p.flying,
      },
      inventory: JSON.parse(JSON.stringify(this.inventory.toJSON())),
      entities: JSON.parse(JSON.stringify([...this.world.entities])),
      mobs: this.mobs.serialize(),
      items: JSON.parse(JSON.stringify(this.items.serialize())),
    };
  }

  async save(showToast = false) {
    if (!this.ready) return;
    try {
      await Promise.all([this.storage.putMeta(this.serialize()), this.world.saveChunks()]);
      if (showToast) this.ui.toast('游戏已保存');
    } catch (e) {
      console.error('Save failed', e);
    }
  }

  setGameMode(mode) {
    this.gameMode = mode;
    this.applyGameMode();
    this.ui.toast(mode === 'creative' ? '已切换到创造模式' : '已切换到生存模式');
  }

  applyGameMode() {
    const c = this.gameMode === 'creative';
    this.player.creative = c;
    if (!c) this.player.flying = false;
    else this.player.health = 20;
  }

  applySettings(s) {
    this.settings = s;
    this.world.renderDistance = s.renderDistance;
    this.camera.fov = s.fov;
    this.sound.volume = s.volume;
    this.camera.updateProjectionMatrix();
  }

  // ---------- input ----------
  bindEvents() {
    this.handlers = {
      keydown: (e) => this.onKeyDown(e),
      keyup: (e) => this.keys.delete(e.code),
      mousedown: (e) => this.onMouseDown(e),
      mouseup: (e) => {
        if (e.button === 0) { this.mouse.left = false; this.attackLock = false; }
        if (e.button === 2) this.mouse.right = false;
      },
      mousemove: (e) => this.onMouseMove(e),
      wheel: (e) => this.onWheel(e),
      pointerlockchange: () => this.onLockChange(),
      resize: () => this.onResize(),
      contextmenu: (e) => e.preventDefault(),
      blur: () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; },
    };
    const h = this.handlers;
    window.addEventListener('keydown', h.keydown);
    window.addEventListener('keyup', h.keyup);
    this.canvas.addEventListener('mousedown', h.mousedown);
    window.addEventListener('mouseup', h.mouseup);
    window.addEventListener('mousemove', h.mousemove);
    window.addEventListener('wheel', h.wheel, { passive: true });
    document.addEventListener('pointerlockchange', h.pointerlockchange);
    window.addEventListener('resize', h.resize);
    this.canvas.addEventListener('contextmenu', h.contextmenu);
    window.addEventListener('blur', h.blur);
  }

  unbindEvents() {
    const h = this.handlers;
    window.removeEventListener('keydown', h.keydown);
    window.removeEventListener('keyup', h.keyup);
    this.canvas.removeEventListener('mousedown', h.mousedown);
    window.removeEventListener('mouseup', h.mouseup);
    window.removeEventListener('mousemove', h.mousemove);
    window.removeEventListener('wheel', h.wheel);
    document.removeEventListener('pointerlockchange', h.pointerlockchange);
    window.removeEventListener('resize', h.resize);
    this.canvas.removeEventListener('contextmenu', h.contextmenu);
    window.removeEventListener('blur', h.blur);
  }

  lock() {
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* ignored: user can click to retry */ }
  }

  onLockChange() {
    this.locked = document.pointerLockElement === this.canvas;
    if (this.locked) return;
    this.keys.clear();
    this.mouse.left = this.mouse.right = false;
    if (!this.ui.isOpen && !this.dead && this.running && this.ready) {
      this.paused = true;
      this.cb.onPause();
    }
  }

  onKeyDown(e) {
    if (!this.running || this.paused || this.dead) return;
    const code = e.code;
    if (code === 'F3') {
      e.preventDefault();
      this.showDebug = !this.showDebug;
      document.getElementById('debug').style.display = this.showDebug ? 'block' : 'none';
      return;
    }
    if (code === 'KeyE') {
      if (this.ui.isOpen) this.closeScreen();
      else if (this.locked) this.openScreen(this.gameMode === 'creative' ? 'creative' : 'inventory');
      return;
    }
    if (code === 'Escape' && this.ui.isOpen) {
      this.closeScreen();
      return;
    }
    if (this.ui.isOpen) {
      this.ui.onKey(e);
      return;
    }
    if (code.startsWith('Digit')) {
      const n = Number(code.slice(5));
      if (n >= 1 && n <= 9) this.inventory.selected = n - 1;
    }
    if (code === 'KeyF' && this.gameMode === 'creative') this.player.flying = !this.player.flying;
    // Creative helper: G spawns a random mob in front of you.
    if (code === 'KeyG' && this.gameMode === 'creative') this.spawnInFront(e.shiftKey ? null : undefined);
    if (code === 'Space' && !e.repeat && this.gameMode === 'creative') {
      const now = performance.now();
      if (now - this.lastSpaceTap < 300) { this.player.flying = !this.player.flying; this.lastSpaceTap = 0; }
      else this.lastSpaceTap = now;
    }
    if (code === 'KeyQ' && this.inventory.held) this.throwHeld(e.ctrlKey);
    if (['Space', 'Tab'].includes(code)) e.preventDefault();
    this.keys.add(code);
  }

  onMouseDown(e) {
    if (!this.running || this.paused || this.dead) return;
    this.sound.ensure();
    if (!this.locked) {
      if (!this.ui.isOpen) this.lock();
      return;
    }
    if (e.button === 0) {
      this.mouse.left = true;
      this.hand.swing();
      // Fire has no hitbox: hitting the block face it sits on puts it out.
      const t = this.target;
      if (t && this.world.getBlock(t.x + t.normal[0], t.y + t.normal[1], t.z + t.normal[2]) === B.FIRE) {
        this.fire.extinguish(t.x + t.normal[0], t.y + t.normal[1], t.z + t.normal[2]);
        this.sound.fizz();
        this.fx.puff(t.x + t.normal[0], t.y + t.normal[1], t.z + t.normal[2], 5);
        this.breakDelay = 0.3;
        this.attackLock = true;
        return;
      }
      this.attackQueued = true;
    } else if (e.button === 2) {
      this.mouse.right = true;
      this.useDelay = 0;
      this.useItem();
      this.useDelay = 0.25;
    } else if (e.button === 1) {
      e.preventDefault();
      this.pickBlock();
    }
  }

  onMouseMove(e) {
    if (!this.locked || this.paused) return;
    const s = this.settings.sensitivity * 0.0022;
    this.player.yaw -= e.movementX * s;
    this.player.pitch -= e.movementY * s;
    this.player.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.player.pitch));
  }

  onWheel(e) {
    if (!this.locked || this.ui.isOpen) return;
    const d = Math.sign(e.deltaY);
    this.inventory.selected = (this.inventory.selected + d + 9) % 9;
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  openScreen(type, entity) {
    this.ui.open(type, entity);
    this.mouse.left = this.mouse.right = false;
    this.mining = null;
    this.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  closeScreen() {
    this.ui.close();
    this.lock();
  }

  // ---------- block interaction ----------
  hasSupport(def, x, y, z) {
    const below = this.world.getBlock(x, y - 1, z);
    if (def.support === 'solid') return BLOCKS[below].solid;
    return def.support.includes(below);
  }

  breakBlock(t, harvest) {
    const { x, y, z, id } = t;
    const def = BLOCKS[id];
    const w = this.world;
    const ent = w.getEntity(x, y, z);
    if (ent) {
      for (const st of ent.slots) if (st) this.items.dropAt(st, x, y, z); // container spills its contents
      w.setEntity(x, y, z, null);
    }
    w.setBlock(x, y, z, B.AIR); // neighbouring water flows in via the fluid simulation
    this.sound.breakBlock(def.sound);
    this.particles.spawn(x, y, z, tileAverage[tileIndex(def.tex.side)]);
    if (harvest && this.gameMode === 'survival') {
      this.player.exhaust(0.005);
      if (canHarvest(def, this.inventory.held)) {
        const drop = getDrop(def);
        if (drop) this.items.dropAt(makeStack(drop.id, drop.count), x, y, z);
      }
      if (def.hardness > 0 && this.inventory.damageHeld(1)) this.sound.tone('square', 600, 200, 0.2, 0.1);
    }
    this.onBlockRemoved(x, y, z);
  }

  onBlockRemoved(x, y, z) {
    const above = this.world.getBlock(x, y + 1, z);
    const ad = BLOCKS[above];
    if (ad.support && !this.hasSupport(ad, x, y + 1, z)) this.breakBlock({ x, y: y + 1, z, id: above }, true);
    else if (ad.gravity) this.settle(x, y + 1, z);
  }

  settle(x, y, z) {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    let ny = y;
    while (ny > 0) {
      const below = BLOCKS[w.getBlock(x, ny - 1, z)];
      if (below.solid) break;
      ny--;
    }
    if (ny === y) return;
    const replaced = w.getBlock(x, ny, z);
    w.setBlock(x, y, z, B.AIR);
    w.setBlock(x, ny, z, id);
    if (BLOCKS[replaced].support) this.particles.spawn(x, ny, z, [0.4, 0.7, 0.3], 6);
    this.onBlockRemoved(x, y, z);
  }

  facingFromYaw() {
    const fx = -Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw);
    if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 1 : 0;
    return fz > 0 ? 5 : 4;
  }

  useItem() {
    if (this.using) return;
    const t = this.target;
    const w = this.world;
    this.sound.ensure();
    const tdef = t && BLOCKS[t.id];
    if (tdef?.interact && !this.player.sneaking) {
      let ent = null;
      if (tdef.entity) {
        ent = w.getEntity(t.x, t.y, t.z);
        if (!ent) { ent = this.makeEntity(tdef.entity, 4, [t.x, t.y, t.z]); w.setEntity(t.x, t.y, t.z, ent); }
      }
      this.openScreen(tdef.interact, ent);
      return;
    }
    const held = this.inventory.held;
    if (!held) return;
    const idef = getItem(held.id);
    if (held.id === I.BUCKET || held.id === I.WATER_BUCKET || held.id === I.LAVA_BUCKET) { this.useBucket(held); return; }
    if (held.id === I.FLINT_AND_STEEL) { this.useFlint(t); return; }
    // Right-click armor to put it on (swapping with what you're wearing).
    if (idef.armor) {
      const inv = this.inventory, slot = idef.armor.slot;
      [inv.armor[slot], inv.slots[inv.selected]] = [held, inv.armor[slot]];
      this.sound.place('metal');
      this.hand.swing();
      this.useDelay = 0.5;
      return;
    }
    // Hold-to-use items: food and bows.
    if (idef.food && (this.player.food < 20 || this.gameMode === 'creative')) {
      this.using = { kind: 'eat', t: 0, id: held.id, slot: this.inventory.selected };
      return;
    }
    if (idef.bow && (this.gameMode === 'creative' || this.inventory.slots.some((s) => s?.id === I.ARROW))) {
      this.using = { kind: 'bow', t: 0, id: held.id, slot: this.inventory.selected };
      return;
    }
    if (!t) return;
    if (!idef.isBlock) return;
    let x = t.x + t.normal[0], y = t.y + t.normal[1], z = t.z + t.normal[2];
    if (tdef.replaceable) { x = t.x; y = t.y; z = t.z; }
    if (y < 0 || y >= HEIGHT) return;
    if (!BLOCKS[w.getBlock(x, y, z)].replaceable) return;
    if (idef.solid && this.player.intersectsBlock(x, y, z)) return;
    if (idef.support && !this.hasSupport(idef, x, y, z)) return;
    if (idef.entity) w.setEntity(x, y, z, this.makeEntity(idef.entity, this.facingFromYaw(), [x, y, z]));
    w.setBlock(x, y, z, idef.id);
    if (idef.gravity) this.settle(x, y, z);
    this.sound.place(idef.sound);
    this.hand.swing();
    if (this.gameMode === 'survival') this.inventory.consumeHeld();
  }

  makeEntity(type, facing, pos) {
    if (type === 'chest') return { type, facing, pos, slots: new Array(27).fill(null) };
    return { type, facing, pos, slots: [null, null, null], burn: 0, burnMax: 0, cook: 0, lit: false };
  }

  pickBlock() {
    const t = this.target;
    if (!t || !getItem(t.id)) return;
    const inv = this.inventory;
    const idx = inv.slots.slice(0, 9).findIndex((s) => s && s.id === t.id);
    if (idx >= 0) inv.selected = idx;
    else if (this.gameMode === 'creative') inv.slots[inv.selected] = makeStack(t.id, maxStack(t.id));
  }

  tickFurnace(e, dt) {
    const [input, fuel, out] = e.slots;
    const res = input ? smeltResult(input.id) : null;
    const canSmelt = res != null && (!out || (out.id === res && out.count < maxStack(res)));
    if (e.burn > 0) e.burn -= dt;
    if (e.burn <= 0 && canSmelt && fuel && fuelValue(fuel.id) > 0) {
      e.burn = e.burnMax = (fuelValue(fuel.id) * SMELT_TIME) / 10;
      if (fuel.id === I.LAVA_BUCKET) e.slots[1] = { id: I.BUCKET, count: 1 }; // the bucket is returned
      else {
        fuel.count--;
        if (fuel.count <= 0) e.slots[1] = null;
      }
    }
    if (e.burn > 0 && canSmelt) {
      e.cook += dt;
      if (e.cook >= SMELT_TIME) {
        e.cook = 0;
        input.count--;
        if (input.count <= 0) e.slots[0] = null;
        if (out) out.count++;
        else e.slots[2] = makeStack(res, 1);
      }
    } else e.cook = canSmelt ? Math.max(0, e.cook - dt * 2) : 0;
    if (e.burn < 0) e.burn = 0;
    const lit = e.burn > 0;
    if (lit !== e.lit) {
      e.lit = lit;
      this.world.markDirty(...e.pos);
      this.world.markLightChange(e.pos[0], e.pos[2]); // lit furnaces glow
    }
  }

  // Minecraft-style 0..15 light level: sky (scaled by time of day), placed lights, optionally moving lights.
  lightLevel(x, y, z, dynamic = true) {
    const w = this.world;
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const sky = Math.round(w.getSkyLight(xi, yi, zi) * (0.27 + 0.73 * this.sky.daylight));
    let level = Math.max(sky, w.getBlockLight(xi, yi, zi));
    if (dynamic && this.dynOrigin) level = Math.max(level, dynamicLevelAt(this.dynOrigin, x, y, z));
    return level;
  }

  // ---------- combat & held-item use ----------
  tryAttack() {
    const p = this.player;
    const hit = this.mobs.raycast(p.eye(), p.lookDir(), 3.5);
    if (!hit || (this.target && this.target.dist < hit.dist)) return false;
    this.attackLock = true;
    if (this.attackCd > 0) return true;
    this.attackCd = 0.3;
    const held = this.inventory.held;
    const crit = !p.onGround && p.vel.y < -1 && !p.inWater && !p.flying;
    if (this.mobs.playerAttack(hit.mob, attackDamage(held), crit) && this.gameMode === 'survival') {
      const type = getItem(held?.id)?.tool?.type;
      if (type) this.inventory.damageHeld(type === 'sword' ? 1 : 2);
      p.exhaust(0.1);
    }
    return true;
  }

  updateUsing(dt) {
    const u = this.using;
    const inv = this.inventory;
    const held = inv.held;
    if (!held || held.id !== u.id || inv.selected !== u.slot) { this.using = null; return; }
    u.t += dt;
    const eye = this.player.eye();
    if (u.kind === 'eat') {
      if (!this.mouse.right) { this.using = null; return; }
      if (Math.floor(u.t * 5) !== Math.floor((u.t - dt) * 5)) {
        this.sound.eat();
        const d = this.player.lookDir();
        const tile = tileIndex(getItem(u.id).icon);
        this.particles.spawn(eye.x + d.x * 0.5 - 0.5, eye.y - 0.8, eye.z + d.z * 0.5 - 0.5, tileAverage[tile], 3, 0.2);
      }
      if (u.t >= 1.6) {
        const def = getItem(u.id);
        this.player.eat(def.food, def.saturation);
        if (this.gameMode === 'survival') inv.consumeHeld();
        this.sound.burp();
        this.using = null;
      }
    } else if (u.kind === 'bow' && !this.mouse.right) {
      const power = Math.min(1, u.t / 1.0);
      this.using = null;
      if (power < 0.15) return;
      const survival = this.gameMode === 'survival';
      if (survival) {
        const ai = inv.slots.findIndex((s) => s?.id === I.ARROW);
        if (ai < 0) return;
        inv.slots[ai].count--;
        if (!inv.slots[ai].count) inv.slots[ai] = null;
        inv.damageHeld(1);
      }
      const dir = this.player.lookDir();
      this.mobs.shootArrow(eye.clone().addScaledVector(dir, 0.4), dir.multiplyScalar(42 * power), 'player',
        Math.round(2 + 7 * power * power));
      this.sound.bow();
      this.hand.swing();
    }
  }

  // Empty bucket scoops a water/lava source; full buckets pour one.
  useBucket(held) {
    const p = this.player, w = this.world, inv = this.inventory;
    const hit = raycast(w, p.eye(), p.lookDir(), REACH, true);
    if (!hit) return;
    const survival = this.gameMode === 'survival';
    const isSource = (id) => id === B.WATER || id === B.LAVA;
    if (held.id === I.BUCKET) {
      if (!isSource(hit.id)) return;
      const full = hit.id === B.WATER ? I.WATER_BUCKET : I.LAVA_BUCKET;
      w.setBlock(hit.x, hit.y, hit.z, B.AIR);
      if (full === I.WATER_BUCKET) this.sound.splash(); else this.sound.fizz();
      if (!survival) return;
      if (held.count === 1) inv.slots[inv.selected] = { id: full, count: 1 };
      else { held.count--; this.giveOrDrop({ id: full, count: 1 }); }
    } else {
      const fluid = held.id === I.WATER_BUCKET ? B.WATER : B.LAVA;
      let x = hit.x, y = hit.y, z = hit.z;
      if (!BLOCKS[hit.id].replaceable || isSource(hit.id)) { x += hit.normal[0]; y += hit.normal[1]; z += hit.normal[2]; }
      const cur = w.getBlock(x, y, z);
      if (!BLOCKS[cur].replaceable || isSource(cur)) return;
      w.setBlock(x, y, z, fluid);
      if (fluid === B.WATER) this.sound.splash(); else this.sound.fizz();
      this.hand.swing();
      if (survival) inv.slots[inv.selected] = { id: I.BUCKET, count: 1 };
    }
  }

  // Flint & steel lights a fire on the clicked face, or lights TNT.
  useFlint(t) {
    if (!t) return;
    const fx = t.x + t.normal[0], fy = t.y + t.normal[1], fz = t.z + t.normal[2];
    if (t.id === B.TNT) this.fire.primeTnt(t.x, t.y, t.z);
    else if (!this.fire.ignite(fx, fy, fz, 0, true)) return;
    this.fx.sparks(fx + 0.5, fy + 0.2, fz + 0.5, 8);
    this.sound.flint();
    this.hand.swing();
    if (this.gameMode === 'survival' && this.inventory.damageHeld(1)) this.sound.tone('square', 600, 200, 0.2, 0.1);
  }

  // Q: throw one (or the whole stack with Ctrl) in front of you.
  throwHeld(all) {
    const held = this.inventory.held;
    const n = all ? held.count : 1;
    const stack = { ...held, count: n };
    this.inventory.consumeHeld(n);
    this.throwStack(stack);
  }

  throwStack(stack) {
    const eye = this.player.eye(), d = this.player.lookDir();
    this.items.spawn(stack, eye.x + d.x * 0.4, eye.y - 0.35 + d.y * 0.4, eye.z + d.z * 0.4,
      new THREE.Vector3(d.x * 4, d.y * 4 + 2, d.z * 4), 1.5);
  }

  // Put a stack into the inventory; whatever doesn't fit drops at the player's feet.
  giveOrDrop(stack) {
    const rem = this.inventory.addStack(stack);
    if (rem) this.items.spawn(rem, this.player.pos.x, this.player.pos.y + 1, this.player.pos.z, new THREE.Vector3(), 1.5);
  }

  spawnInFront(type) {
    const types = Object.keys(MOB_TYPES);
    const t = type || types[Math.floor(Math.random() * types.length)];
    const p = this.player, d = p.lookDir();
    const x = Math.floor(p.pos.x + d.x * 4), z = Math.floor(p.pos.z + d.z * 4);
    const y = this.world.getTopY(x, z) + 1;
    const m = this.mobs.spawn(t, x + 0.5, Math.max(y, Math.floor(p.pos.y)), z + 0.5);
    if (m.def.mimic) m.goDormant();
    this.ui.toast(`生成了：${m.def.name}`);
  }

  deathMessage() {
    const s = this.player.lastDamageSource;
    const names = {
      fall: '你摔死了', starve: '你饿死了', explosion: '你被苦力怕炸死了', void: '你掉出了这个世界',
      lava: '你试图在岩浆里游泳', fire: '你被烧死了', infire: '你在火焰中化为灰烬', tnt: '你被 TNT 炸飞了',
      skeleton: '你被骷髅射杀了',
    };
    if (names[s]) return names[s];
    if (MOB_TYPES[s]) return `你被${MOB_TYPES[s].name}杀死了`;
    return '你死了！';
  }

  // ---------- lifecycle ----------
  die() {
    this.dead = true;
    this.mouse.left = this.mouse.right = false;
    this.using = null;
    if (this.ui.isOpen) this.ui.close();
    if (document.pointerLockElement) document.exitPointerLock();
    this.cb.onDeath(this.deathMessage());
  }

  respawn() {
    const p = this.player;
    p.health = 20;
    p.food = 20;
    p.saturation = 5;
    p.exhaustion = 0;
    p.vel.set(0, 0, 0);
    p.fallDistance = 0;
    p.pos.set(this.spawn[0], 100, this.spawn[2]);
    this.needsGroundSnap = true;
    this.dead = false;
    this.lock();
  }

  start() {
    this.running = true;
    this.last = performance.now();
    const frame = (t) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.fpsAcc[0] += dt; this.fpsAcc[1]++;
      if (this.fpsAcc[0] >= 0.5) { this.fps = Math.round(this.fpsAcc[1] / this.fpsAcc[0]); this.fpsAcc = [0, 0]; }
      if (!this.paused) this.update(dt);
      this.render();
    };
    this.raf = requestAnimationFrame(frame);
  }

  async stop() {
    await this.save();
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.unbindEvents();
    this.ui.close();
    this.mobs.dispose();
    this.items.dispose();
    this.fire.dispose();
    this.fx.dispose();
    this.drawFireOverlay(false);
    this.world.dispose();
    this.renderer.dispose();
  }

  // ---------- per-frame ----------
  update(dt) {
    const p = this.player;
    const w = this.world;
    this.elapsed += dt;
    this.time = (this.time + dt / DAY_LENGTH) % 1;

    if (this.needsGroundSnap && w.isLoaded(p.pos.x, p.pos.z)) {
      const y = w.getTopY(Math.floor(p.pos.x), Math.floor(p.pos.z)) + 1;
      p.pos.y = y;
      if (this.spawn[1] == null) this.spawn[1] = y;
      this.needsGroundSnap = false;
    }

    const active = this.locked && !this.ui.isOpen && !this.dead;
    const k = this.keys;
    const input = active ? {
      forward: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
      strafe: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
      jump: k.has('Space'),
      sneak: k.has('ShiftLeft') || k.has('ShiftRight'),
      sprint: k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyR'),
    } : { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
    if (!this.dead && !this.needsGroundSnap) p.update(dt, input);
    p.postUpdate();
    if (p.onGround && this.gameMode === 'creative' && p.flying && input.sneak) p.flying = false;

    w.update(dt, p.pos.x, p.pos.z);

    if (!this.ready) {
      // Ready once every chunk within radius 2 of the player is meshed.
      const pcx = Math.floor(p.pos.x) >> 4, pcz = Math.floor(p.pos.z) >> 4;
      let total = 0, done = 0;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dz * dz > 6.25) continue;
          total++;
          const ch = w.getChunk(pcx + dx, pcz + dz);
          if (ch?.meshed) done++;
        }
      }
      this.cb.onProgress?.(done / total);
      if (done === total && !this.needsGroundSnap) {
        this.ready = true;
        this.cb.onReady();
      }
    }

    // Camera
    const eye = p.eye();
    this.camera.position.copy(eye);
    this.camera.rotation.set(p.pitch, p.yaw, 0);
    const draw = this.using?.kind === 'bow' ? Math.min(1, this.using.t) : 0;
    const targetFov = this.settings.fov * (p.sprinting ? 1.12 : 1) * (p.flying && p.sprinting ? 1.05 : 1) * (1 - draw * 0.15);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }

    // Targeting
    this.target = active ? raycast(w, eye, p.lookDir(), REACH) : null;
    const t = this.target;
    this.highlight.visible = !!t;
    if (t) this.highlight.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);

    // Mobs & dropped items
    if (this.ready) {
      this.fluids.update(dt);
      this.fire.update(dt);
      this.mobs.update(dt);
      this.items.update(dt);
      if (p.inWater && !p.flying) {
        const f = this.fluids.flowAt(p.pos.x, p.pos.y + 0.2, p.pos.z); // water currents push you
        p.vel.x += f.x * 9 * dt;
        p.vel.z += f.z * 9 * dt;
      }
    }

    // Melee: a fresh click hits the mob under the crosshair (if it's closer than the block).
    this.attackCd -= dt;
    if (this.attackQueued) {
      this.attackQueued = false;
      if (active) this.tryAttack();
    }
    if (this.using) {
      if (active) this.updateUsing(dt);
      else this.using = null;
    }

    // Mining
    this.breakDelay -= dt;
    if (this.mouse.left && t && active && !this.attackLock && !this.using) {
      this.hand.swing();
      if (this.gameMode === 'creative') {
        if (this.breakDelay <= 0) { this.breakBlock(t, false); this.breakDelay = 0.22; }
      } else if (this.breakDelay <= 0) {
        const m = this.mining;
        if (!m || m.x !== t.x || m.y !== t.y || m.z !== t.z || m.id !== t.id) {
          this.mining = { x: t.x, y: t.y, z: t.z, id: t.id, progress: 0, sound: 0 };
        }
        const mm = this.mining;
        const def = BLOCKS[t.id];
        const bt = breakTime(def, this.inventory.held);
        mm.progress += bt === 0 ? 1 : dt / bt;
        mm.sound -= dt;
        if (mm.sound <= 0 && bt > 0) {
          mm.sound = 0.24;
          this.sound.dig(def.sound);
          this.particles.spawn(t.x, t.y, t.z, tileAverage[tileIndex(def.tex.side)], 2, 1.1);
        }
        if (mm.progress >= 1) {
          this.breakBlock(t, true);
          this.mining = null;
          this.breakDelay = 0.25;
        }
      }
    } else this.mining = null;
    const mm = this.mining;
    this.crack.visible = !!(mm && mm.progress > 0);
    if (mm) {
      this.crack.position.set(mm.x + 0.5, mm.y + 0.5, mm.z + 0.5);
      this.crack.geometry = this.crackGeoms[Math.min(9, Math.floor(mm.progress * 10))];
    }

    // Repeated placing while holding right click.
    if (this.mouse.right && active && !this.using) {
      this.useDelay -= dt;
      if (this.useDelay <= 0) { this.useItem(); this.useDelay = 0.25; }
    }

    for (const e of w.entities.values()) if (e.type === 'furnace') this.tickFurnace(e, dt);

    // Environment
    this.sky.update(this.time, this.camera, this.elapsed);
    const u = worldUniforms;
    u.uSkyLight.value.copy(this.sky.lightColor);
    if (p.headInLava) {
      this.clearColor = new THREE.Color(0.9, 0.35, 0.05);
      u.uFogNear.value = 0.2;
      u.uFogFar.value = 2.5;
    } else if (p.headInWater) {
      this.clearColor = new THREE.Color(0.05, 0.12, 0.35).multiplyScalar(0.3 + 0.7 * this.sky.daylight);
      u.uFogNear.value = 1;
      u.uFogFar.value = 22;
    } else {
      this.clearColor = this.sky.skyColor;
      u.uFogFar.value = w.renderDistance * 16 - 4;
      u.uFogNear.value = u.uFogFar.value * 0.55;
    }
    u.uFogColor.value.copy(this.clearColor);
    this.scene.fog.color.copy(this.clearColor);
    this.scene.fog.near = u.uFogNear.value;
    this.scene.fog.far = u.uFogFar.value;

    // Moving lights (torch in hand, glowing mobs) are flood-filled into a 3D texture around the player,
    // so walls block them just like placed torches.
    const held = this.inventory.held;
    const dyn = [];
    if (held && LIGHT_EMIT[held.id]) dyn.push([eye.x, eye.y, eye.z, LIGHT_EMIT[held.id]]);
    dyn.push(...this.mobs.lightSources());
    this.dynLightT -= dt;
    const dynKey = dyn.map((l) => `${Math.floor(l[0])},${Math.floor(l[1])},${Math.floor(l[2])},${l[3]}`).join('|');
    if (dynKey !== this.dynKey || this.dynLightT <= 0) {
      this.dynKey = dynKey;
      this.dynLightT = 0.25; // also refresh periodically so block edits show up
      if (dyn.length) {
        this.dynOrigin = computeDynamicLight(w, eye.x, eye.y, eye.z, dyn);
        u.uDynOrigin.value.set(...this.dynOrigin);
        dynLightTexture.needsUpdate = true;
      }
      u.uDynOn.value = dyn.length ? 1 : 0;
      if (!dyn.length) this.dynOrigin = null;
    }

    // Brightness for hand/particles from the real light level at the eye.
    const bright = Math.pow(0.8, 15 - this.lightLevel(eye.x, eye.y, eye.z));
    this.hand.setItem(held ? held.id : null);
    this.hand.use = this.using ? { kind: this.using.kind, t: this.using.t } : null;
    const moving = p.onGround && Math.hypot(p.vel.x, p.vel.z) > 0.5;
    this.hand.update(dt, bright, p.walkDist, moving, this.camera.aspect);
    this.particles.update(dt, w, bright);

    // Smoke, flames & embers from fire sources, and flames wrapped around burning mobs.
    if (this.ready) this.fx.ambient(dt);
    this.fx.beginBurns();
    for (const m of this.mobs.mobs) {
      if (m.alive && (m.fireT > 0 || m.burning)) this.fx.burn(m.pos.x, m.pos.y, m.pos.z, m.def.w, m.height, p.yaw);
    }
    this.fx.endBurns();
    this.renderer.getDrawingBufferSize(this.bufferSize);
    this.fx.update(dt, this.camera, this.bufferSize.y);

    // Footsteps & splashes
    if (p.onGround && p.walkDist - this.lastStep > 2.1) {
      this.lastStep = p.walkDist;
      const below = w.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y - 0.2), Math.floor(p.pos.z));
      if (below) this.sound.step(BLOCKS[below].sound);
    }
    if (p.inWater && !this.wasInWater && p.vel.y < -3) this.sound.splash();
    this.wasInWater = p.inWater;

    // HUD
    this.ui.updateHUD(dt, p, this.gameMode === 'creative');
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.5);
    document.getElementById('damage-overlay').style.opacity = this.damageFlash * 0.5;
    document.getElementById('water-overlay').style.opacity = p.headInWater ? 1 : 0;
    document.getElementById('lava-overlay').style.opacity = p.headInLava ? 1 : 0;
    this.drawFireOverlay(p.fireT > 0 && !p.creative && !this.dead);

    // Animated fire, water, lava & furnace textures (repainted into the atlas).
    if (animateTiles(dt)) atlasTexture.needsUpdate = true;
    document.getElementById('click-hint').style.display =
      this.ready && !this.locked && !this.ui.isOpen && !this.dead && !this.paused ? 'flex' : 'none';
    if (this.showDebug) this.updateDebug();

    this.autosave += dt;
    if (this.autosave > 30) { this.autosave = 0; this.save(); }
  }

  // While you burn, two animated flame sprites lick up from the bottom corners of the screen
  // (Minecraft's first-person fire), using the same animated fire texture as fire blocks.
  drawFireOverlay(on) {
    const c = this.fireOverlay;
    if (!on) {
      if (this.fireOverlayOn) { c.getContext('2d').clearRect(0, 0, c.width, c.height); this.fireOverlayOn = false; }
      return;
    }
    this.fireOverlayOn = true;
    const W = Math.ceil(window.innerWidth / 3), H = Math.ceil(window.innerHeight / 3);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 0.9;
    const s = Math.min(W * 0.5, H * 0.65);
    drawTile(ctx, 'fire_1', W * 0.5 - s * 1.02, H - s * 0.72, s, s);
    drawTile(ctx, 'fire_0', W * 0.5 + s * 0.02, H - s * 0.72, s, s, true);
    ctx.globalAlpha = 1;
  }

  updateDebug() {
    const p = this.player;
    const col = this.gen.column(Math.floor(p.pos.x), Math.floor(p.pos.z));
    const t = this.target;
    const hours = Math.floor(((this.time * 24 + 6) % 24));
    const mins = Math.floor((this.time * 24 * 60) % 60);
    const facing = FACING_NAMES[[5, 0, 4, 1][((Math.round(-p.yaw / (Math.PI / 2)) % 4) + 4) % 4]];
    document.getElementById('debug').textContent = [
      `WebCraft  ${this.fps} FPS`,
      `XYZ: ${p.pos.x.toFixed(2)} / ${p.pos.y.toFixed(2)} / ${p.pos.z.toFixed(2)}`,
      `区块: ${Math.floor(p.pos.x) >> 4}, ${Math.floor(p.pos.z) >> 4}   已加载: ${this.world.chunks.size}`,
      `朝向: ${facing}`,
      `生物群系: ${BIOME_NAMES[col.biome]}   地表高度: ${col.h}`,
      `时间: ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`,
      `模式: ${this.gameMode === 'creative' ? '创造' : '生存'}${p.flying ? '（飞行）' : ''}`,
      `种子: ${this.seed}`,
      t ? `目标方块: ${BLOCKS[t.id].name} (${t.x}, ${t.y}, ${t.z})` : '',
      `生物: 友好 ${this.mobs.counts().passive}  敌对 ${this.mobs.counts().hostile}  箭 ${this.mobs.arrows.length}`,
      `饥饿: ${p.food}  饱和: ${p.saturation.toFixed(1)}  护甲: ${this.inventory.armorStats().defense}  难度: ${this.difficulty === 'peaceful' ? '和平' : '普通'}`,
      `火: ${this.fire.count}  TNT: ${this.fire.tnt.length}`,
      `绘制调用: ${this.renderer.info.render.calls}  三角形: ${this.renderer.info.render.triangles}`,
    ].join('\n');
  }

  render() {
    const r = this.renderer;
    r.info.reset();
    r.setClearColor(this.clearColor || this.sky.skyColor);
    r.clear();
    r.render(this.scene, this.camera);
    if (this.ready && !this.dead) this.hand.render(r);
  }
}
