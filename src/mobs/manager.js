import * as THREE from 'three';
import { B, BLOCKS, I, getItem, getDrop, isFluid } from '../blocks.js';
import { rayBox } from '../physics.js';
import { Mob, MOB_TYPES } from './mob.js';
import { buildArrowMesh } from './models.js';
import { BIOME } from '../terrain.js';

const PASSIVE_CAP = 12;
const HOSTILE_CAP = 16;
const PASSIVE = ['pig', 'cow', 'sheep', 'chicken'];
const HOSTILE = [['zombie', 35], ['skeleton', 25], ['creeper', 25], ['spider', 15], ['wisp', 12], ['rock_golem', 10]];

function pickWeighted(list) {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of list) { r -= w; if (r <= 0) return k; }
  return list[0][0];
}

export class MobManager {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.sound = game.sound;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.mobs = [];
    this.arrows = [];
    this.hostileT = 0;
    this.passiveT = 2;
    this.ambientT = 3;
  }

  get peaceful() {
    return this.game.difficulty === 'peaceful';
  }

  spawn(type, x, y, z) {
    const m = new Mob(type, x, y, z);
    this.mobs.push(m);
    this.group.add(m.model.root);
    m.light = this.lightLevel(x, y + 0.5, z);
    m.animate(0, this.game);
    return m;
  }

  remove(m) {
    this.group.remove(m.model.root);
    m.model.material.dispose();
    m.model.glowMaterial.dispose();
  }

  volumeAt(pos) {
    return Math.max(0, 1 - pos.distanceTo(this.game.player.pos) / 24);
  }

  // 0..15 light level; spawning ignores moving lights (dynamic = false).
  lightLevel(x, y, z, dynamic = true) {
    return this.game.lightLevel(x, y, z, dynamic);
  }

  lineOfSight(a, b) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    d.divideScalar(len);
    for (let t = 0.5; t < len; t += 0.4) {
      const id = this.world.getBlock(Math.floor(a.x + d.x * t), Math.floor(a.y + d.y * t), Math.floor(a.z + d.z * t));
      const def = BLOCKS[id];
      if (def.solid && def.opaque) return false;
    }
    return true;
  }

  // ---------- spawning ----------
  canStand(x, y, z, h) {
    const w = this.world;
    const below = BLOCKS[w.getBlock(x, y - 1, z)];
    if (!below.solid || below.render !== 'cube' || below.id === B.LEAVES || below.id === B.BEDROCK) return false;
    for (let k = 0; k < Math.ceil(h); k++) {
      const id = w.getBlock(x, y + k, z);
      if (BLOCKS[id].solid || isFluid(id)) return false;
    }
    return true;
  }

  trySpawn(hostile) {
    const p = this.game.player.pos;
    const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 22;
    const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
    const w = this.world;
    if (!w.isLoaded(x, z) || !w.isLoaded(x + 1, z + 1) || !w.isLoaded(x - 1, z - 1)) return;
    let y;
    if (hostile && Math.random() < 0.5) {
      // Try a cave floor around the player's depth.
      y = Math.floor(p.y) + Math.floor(Math.random() * 24) - 12;
      let found = false;
      for (let k = 0; k < 16 && y > 2; k++, y--) if (this.canStand(x, y, z, 2)) { found = true; break; }
      if (!found) return;
    } else {
      y = w.getTopY(x, z) + 1;
    }
    if (hostile) {
      let type = pickWeighted(HOSTILE);
      // Rock golems only lurk underground or in the mountains.
      if (type === 'rock_golem' && y > 50 && this.game.gen.column(x, z).biome !== BIOME.MOUNTAINS) type = 'zombie';
      if (!this.canStand(x, y, z, MOB_TYPES[type].h)) return;
      if (this.lightLevel(x, y, z, false) > 7) return;
      this.spawn(type, x + 0.5, y, z + 0.5);
    } else {
      if (w.getBlock(x, y - 1, z) !== B.GRASS || this.lightLevel(x, y, z, false) < 9) return;
      const biome = this.game.gen.column(x, z).biome;
      const pool = biome === BIOME.SNOW ? ['sheep', 'sheep', 'cow'] : PASSIVE;
      const type = pool[Math.floor(Math.random() * pool.length)];
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const sx = x + Math.floor(Math.random() * 5) - 2, sz = z + Math.floor(Math.random() * 5) - 2;
        const sy = w.getTopY(sx, sz) + 1;
        if (w.getBlock(sx, sy - 1, sz) === B.GRASS && this.canStand(sx, sy, sz, MOB_TYPES[type].h)) {
          this.spawn(type, sx + 0.5, sy, sz + 0.5);
        }
      }
    }
  }

  // ---------- combat ----------
  raycast(origin, dir, maxDist) {
    let best = null;
    for (const m of this.mobs) {
      if (!m.alive) continue;
      const t = rayBox(origin, dir, m.pos.x - m.hw, m.pos.y, m.pos.z - m.hw, m.pos.x + m.hw, m.pos.y + m.height, m.pos.z + m.hw);
      if (t >= 0 && t <= maxDist && (!best || t < best.dist)) best = { mob: m, dist: t };
    }
    return best;
  }

  playerAttack(mob, damage, crit) {
    const p = this.game.player;
    if (mob.def.armored) {
      const held = this.game.inventory.held;
      damage *= getItem(held?.id)?.tool?.type === 'pickaxe' ? 2 : 0.5;
    }
    const hit = mob.hurt(crit ? damage * 1.5 : damage, mob.pos.x - p.pos.x, mob.pos.z - p.pos.z, true, this);
    if (hit) {
      if (mob.def.armored) this.sound.dig('stone');
      this.sound.hit();
      if (crit) {
        const c = mob.center();
        this.game.particles.spawn(c.x - 0.5, c.y - 0.5, c.z - 0.5, [1, 1, 0.85], 10, 0.8);
      }
    }
    return hit;
  }

  onMobKilled(mob, byPlayer) {
    const c = mob.center();
    this.game.particles.spawn(c.x - 0.5, c.y - 0.5, c.z - 0.5, [0.85, 0.85, 0.85], 14, 1);
    // Animals that die while on fire drop their meat already cooked (and drop loot even if you
    // didn't land the last hit, so a fire pit works as a cooker).
    const burnt = mob.fireT > 0 || mob.burning;
    if ((!byPlayer && !burnt) || this.game.gameMode !== 'survival') return;
    const drop = (id, n) => {
      const def = getItem(id);
      this.game.items.spawn({ id: burnt && def.food && def.smelt ? def.smelt : id, count: n }, c.x, c.y, c.z);
    };
    for (const [id, min, max] of mob.def.drops) {
      const n = min + Math.floor(Math.random() * (max - min + 1));
      if (n > 0) drop(id, n);
    }
    if (mob.def.rare && Math.random() < mob.def.rare[1]) {
      drop(mob.def.rare[0], 1);
      this.game.ui.toast(`稀有掉落：${getItem(mob.def.rare[0]).name}！`);
    }
  }

  mobShoot(mob, player) {
    const from = mob.eye();
    const to = player.eye();
    to.y -= 0.3;
    const d = new THREE.Vector3().subVectors(to, from);
    const dist = d.length();
    const speed = 22;
    d.normalize();
    d.y += (dist / speed) * 0.45 * (20 / speed) * 1.1; // compensate for gravity drop
    d.x += (Math.random() - 0.5) * 0.08;
    d.z += (Math.random() - 0.5) * 0.08;
    d.normalize().multiplyScalar(speed);
    this.shootArrow(from.addScaledVector(d, 0.05), d, mob, 2 + Math.floor(Math.random() * 3));
    this.sound.bow(this.volumeAt(mob.pos));
  }

  shootArrow(pos, vel, owner, damage) {
    const mesh = buildArrowMesh();
    this.group.add(mesh);
    this.arrows.push({ pos: pos.clone(), vel: vel.clone(), owner, damage, stuck: false, life: 60, mesh, age: 0 });
  }

  updateArrows(dt) {
    const p = this.game.player;
    const w = this.world;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.age += dt;
      a.life -= dt;
      let remove = a.life <= 0;
      if (!a.stuck && !remove) {
        const steps = Math.max(1, Math.ceil((a.vel.length() * dt) / 0.25));
        const sdt = dt / steps;
        for (let s = 0; s < steps && !a.stuck && !remove; s++) {
          a.vel.y -= 20 * sdt;
          a.vel.multiplyScalar(Math.exp(-0.15 * sdt));
          a.pos.addScaledVector(a.vel, sdt);
          const id = w.getBlock(Math.floor(a.pos.x), Math.floor(a.pos.y), Math.floor(a.pos.z));
          if (BLOCKS[id].solid) {
            a.pos.addScaledVector(a.vel, -sdt * 0.5);
            a.stuck = true;
            a.life = a.owner === 'player' ? 60 : 4;
            this.sound.dig('wood');
            break;
          }
          if (a.owner === 'player') {
            for (const m of this.mobs) {
              if (!m.alive) continue;
              if (Math.abs(a.pos.x - m.pos.x) < m.hw + 0.1 && Math.abs(a.pos.z - m.pos.z) < m.hw + 0.1
                && a.pos.y > m.pos.y && a.pos.y < m.pos.y + m.height) {
                m.hurt(m.def.armored ? a.damage * 0.5 : a.damage, a.vel.x, a.vel.z, true, this);
                this.sound.hit();
                remove = true;
                break;
              }
            }
          } else if (a.age > 0.05 && !this.game.dead
            && Math.abs(a.pos.x - p.pos.x) < 0.4 && Math.abs(a.pos.z - p.pos.z) < 0.4
            && a.pos.y > p.pos.y && a.pos.y < p.pos.y + 1.8) {
            p.damage(a.damage, 'skeleton');
            p.knockback(a.vel.x, a.vel.z, 3);
            remove = true;
          }
        }
      }
      // Pick your own arrows back up.
      if (a.stuck && a.owner === 'player' && a.pos.distanceTo(p.pos.clone().setY(p.pos.y + 0.9)) < 1.6) {
        if (this.game.gameMode === 'survival') this.game.inventory.add(I.ARROW, 1);
        this.sound.pop();
        remove = true;
      }
      if (remove) {
        this.group.remove(a.mesh);
        a.mesh.material.dispose();
        this.arrows.splice(i, 1);
        continue;
      }
      a.mesh.position.copy(a.pos);
      if (!a.stuck) a.mesh.lookAt(a.pos.x + a.vel.x, a.pos.y + a.vel.y, a.pos.z + a.vel.z);
      const b = Math.pow(0.8, 15 - this.lightLevel(a.pos.x, a.pos.y, a.pos.z));
      a.mesh.material.color.setScalar(b);
    }
  }

  explode(x, y, z, power, source, breakBlocks = true) {
    const w = this.world;
    const r = power;
    for (let dx = -r; dx <= r && breakBlocks; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.hypot(dx, dy, dz) + Math.random() * 0.8 > r) continue;
          const bx = Math.floor(x + dx), by = Math.floor(y + dy), bz = Math.floor(z + dz);
          const id = w.getBlock(bx, by, bz);
          if (!id || id === B.BEDROCK || id === B.OBSIDIAN || isFluid(id)) continue;
          // Other TNT in the blast is set off with a short random fuse (chain reactions).
          if (id === B.TNT) { this.game.fire.primeTnt(bx, by, bz, 0.5 + Math.random()); continue; }
          const ent = w.getEntity(bx, by, bz);
          if (ent) {
            for (const st of ent.slots) if (st) this.game.items.dropAt(st, bx, by, bz);
            w.setEntity(bx, by, bz, null);
          }
          w.setBlock(bx, by, bz, B.AIR);
          // Like Minecraft, only some of the blasted blocks survive as drops.
          if (Math.random() < 0.3) {
            const d = getDrop(BLOCKS[id]);
            if (d) this.game.items.dropAt({ id: d.id, count: d.count }, bx, by, bz);
          }
        }
      }
    }
    for (let i = 0; i < 6; i++) {
      this.game.particles.spawn(x - 0.5 + (Math.random() - 0.5) * 3, y - 0.5 + (Math.random() - 0.5) * 2,
        z - 0.5 + (Math.random() - 0.5) * 3, [0.55, 0.55, 0.55], 10, 2);
    }
    // Billowing pale smoke where the blast was.
    for (let i = 0; i < 18; i++) {
      this.game.fx.smoke(x + (Math.random() - 0.5) * r * 1.4, y + (Math.random() - 0.5) * r, z + (Math.random() - 0.5) * r * 1.4,
        true, 0.55 + Math.random() * 0.35);
    }
    this.sound.explosion(this.volumeAt(new THREE.Vector3(x, y, z)) * 0.7 + 0.3);
    const reach = r * 2;
    const p = this.game.player;
    const pd = Math.hypot(p.pos.x - x, p.pos.y + 0.9 - y, p.pos.z - z);
    if (pd < reach) {
      p.damage(Math.ceil((1 - pd / reach) * 22), source === 'creeper' ? 'explosion' : source);
      p.knockback(p.pos.x - x, p.pos.z - z, (1 - pd / reach) * 14);
    }
    // The blast also flings primed TNT and dropped items.
    const c = new THREE.Vector3(x, y - 0.5, z);
    for (const e of [...this.game.fire.tnt, ...this.game.items.list]) {
      const d = e.pos.distanceTo(c);
      if (d < reach && d > 0.01) e.vel.add(e.pos.clone().sub(c).normalize().multiplyScalar((1 - d / reach) * 10));
    }
    for (const m of this.mobs) {
      const md = m.center().distanceTo(new THREE.Vector3(x, y, z));
      if (m.alive && md < reach) {
        m.invuln = 0;
        m.hurt(Math.ceil((1 - md / reach) * 22), m.pos.x - x, m.pos.z - z, false, this);
      }
    }
  }

  // ---------- per frame ----------
  update(dt) {
    const g = this.game, p = g.player;
    this.pathBudget = 4; // A* searches allowed this frame, shared by all mobs

    // Spawning
    const passives = this.mobs.filter((m) => !m.def.hostile).length;
    const hostiles = this.mobs.length - passives;
    this.hostileT -= dt;
    if (this.hostileT <= 0) {
      this.hostileT = 0.4;
      if (!this.peaceful && hostiles < HOSTILE_CAP) this.trySpawn(true);
    }
    this.passiveT -= dt;
    if (this.passiveT <= 0) {
      this.passiveT = 3;
      if (passives < PASSIVE_CAP) this.trySpawn(false);
    }

    // Update & despawn
    for (const m of this.mobs) {
      const d = m.pos.distanceTo(p.pos);
      if (m.def.hostile && (this.peaceful || d > 80 || (d > 40 && Math.random() < dt * 0.02))) { m.dead = true; continue; }
      if (!m.def.hostile && d > 128) { m.dead = true; continue; }
      if (!this.world.isLoaded(m.pos.x, m.pos.z)) continue;
      m.light = this.lightLevel(m.pos.x, m.pos.y + m.height * 0.7, m.pos.z);
      m.update(dt, this);
    }

    // Push overlapping mobs (and the player) apart.
    const all = this.mobs;
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (!b.alive) continue;
        this.separate(a, b, dt);
      }
      if (!g.dead) this.separate(a, p, dt, 0.3);
    }

    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].dead) { this.remove(all[i]); all.splice(i, 1); }
    }

    // Ambient sounds from a random nearby mob.
    this.ambientT -= dt;
    if (this.ambientT <= 0) {
      this.ambientT = 2 + Math.random() * 5;
      const near = all.filter((m) => m.alive && m.pos.distanceTo(p.pos) < 20);
      if (near.length) {
        const m = near[Math.floor(Math.random() * near.length)];
        this.sound.mob(m.type, 'say', this.volumeAt(m.pos));
      }
    }

    this.updateArrows(dt);
  }

  separate(a, b, dt, bw = b.hw) {
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
    const min = a.hw + bw;
    if (Math.abs(dx) >= min || Math.abs(dz) >= min) return;
    if (a.pos.y + a.height < b.pos.y || b.pos.y + 1.8 < a.pos.y) return;
    const d = Math.hypot(dx, dz) || 0.01;
    const push = (min - d) * 4 * dt;
    a.vel.x -= (dx / d) * push * 10;
    a.vel.z -= (dz / d) * push * 10;
    if (b.vel) { b.vel.x += (dx / d) * push * 6; b.vel.z += (dz / d) * push * 6; }
  }

  // Glowing mobs act as moving light sources: [x, y, z, level].
  lightSources() {
    const out = [];
    for (const m of this.mobs) {
      if (!m.def.glow || !m.alive) continue;
      const c = m.center();
      out.push([c.x, c.y, c.z, 12]);
    }
    return out;
  }

  counts() {
    const hostile = this.mobs.filter((m) => m.def.hostile).length;
    return { passive: this.mobs.length - hostile, hostile };
  }

  // Everything except wisps is saved (they'd fade at dawn anyway).
  serialize() {
    return this.mobs.filter((m) => m.alive && !m.def.flying).map((m) => m.serialize());
  }

  load(list) {
    for (const s of list || []) {
      if (!MOB_TYPES[s.type]) continue;
      const m = this.spawn(s.type, s.pos[0], s.pos[1], s.pos[2]);
      m.yaw = m.headYaw = s.yaw;
      m.health = s.health;
      if (m.def.mimic && s.dormant === false) { m.dormant = false; m.wake = 1; }
    }
  }

  dispose() {
    for (const m of this.mobs) this.remove(m);
    this.mobs = [];
    this.game.scene.remove(this.group);
  }
}
