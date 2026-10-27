import * as THREE from 'three';
import { B, isWater, isLava } from './blocks.js';

const GRAVITY = 32;
// Damage armor can't soften (as in Minecraft: falling, hunger, the void and being on fire).
const BYPASS_ARMOR = new Set(['fall', 'starve', 'void', 'fire']);
const JUMP_SPEED = 8.7;
const HALF_W = 0.3;
const EPS = 1e-4;

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3(0.5, 80, 0.5);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.height = 1.8;
    this.onGround = false;
    this.flying = false;
    this.inWater = false;
    this.headInWater = false;
    this.sneaking = false;
    this.sprinting = false;
    this.health = 20;
    this.food = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.invuln = 0;
    this.fireT = 0;
    this.lastDamageSource = null;
    this.fallDistance = 0;
    this.regenTimer = 0;
    this.walkDist = 0;
    this.creative = false;
    this.onDamage = null;
    this.armor = null; // () => { defense, toughness } of the worn armor
    this.onArmorHit = null; // (damage) => wear the armor down
  }

  get eyeHeight() {
    return this.sneaking && !this.flying ? 1.5 : 1.62;
  }

  eye(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  lookDir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  // Does an AABB at (x,y,z) feet position overlap any solid block?
  collides(x, y, z) {
    const w = this.world;
    const x0 = Math.floor(x - HALF_W), x1 = Math.floor(x + HALF_W - EPS);
    const y0 = Math.floor(y), y1 = Math.floor(y + this.height - EPS);
    const z0 = Math.floor(z - HALF_W), z1 = Math.floor(z + HALF_W - EPS);
    for (let by = y0; by <= y1; by++) {
      for (let bz = z0; bz <= z1; bz++) {
        for (let bx = x0; bx <= x1; bx++) if (w.isSolid(bx, by, bz)) return true;
      }
    }
    return false;
  }

  intersectsBlock(bx, by, bz) {
    const p = this.pos;
    return p.x + HALF_W > bx && p.x - HALF_W < bx + 1 && p.y + this.height > by && p.y < by + 1
      && p.z + HALF_W > bz && p.z - HALF_W < bz + 1;
  }

  standingSupport(x, z) {
    return this.collides(x, this.pos.y - 0.05, z);
  }

  // Is any cell overlapping the player's body this block?
  touches(id) {
    const w = this.world, p = this.pos;
    const x0 = Math.floor(p.x - HALF_W), x1 = Math.floor(p.x + HALF_W - EPS);
    const y0 = Math.floor(p.y), y1 = Math.floor(p.y + this.height - EPS);
    const z0 = Math.floor(p.z - HALF_W), z1 = Math.floor(p.z + HALF_W - EPS);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (w.getBlock(x, y, z) === id) return true;
    }
    return false;
  }

  update(dt, input) {
    const w = this.world;
    if (!w.isLoaded(this.pos.x, this.pos.z)) return; // wait for terrain

    const feet = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z));
    const body = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.9), Math.floor(this.pos.z));
    this.inWater = isWater(feet) || isWater(body);
    this.inLava = isLava(feet) || isLava(body);
    const eyeY = this.pos.y + this.eyeHeight;
    const eyeBlock = w.getBlock(Math.floor(this.pos.x), Math.floor(eyeY), Math.floor(this.pos.z));
    this.headInWater = isWater(eyeBlock);
    this.headInLava = isLava(eyeBlock);
    const liquid = this.inWater || this.inLava;

    // Lava burns; you keep burning for a while after leaving it, unless you jump in water.
    if (this.inLava) {
      this.damage(4, 'lava');
      if (!this.creative) this.fireT = 7;
    } else if (this.touches(B.FIRE)) {
      // Standing in fire: 1 damage per hit-cooldown and you catch fire.
      this.damage(1, 'infire');
      if (!this.creative) this.fireT = Math.max(this.fireT, 8);
    }
    if (this.fireT > 0) {
      if (this.inWater) this.fireT = 0;
      else {
        this.fireT -= dt;
        this.fireTick = (this.fireTick || 0) + dt;
        if (this.fireTick >= 1 && !this.inLava) { this.fireTick = 0; this.damage(1, 'fire'); }
      }
    }

    this.sneaking = input.sneak && !this.flying;
    this.invuln = Math.max(0, this.invuln - dt);
    if (input.sprint && input.forward > 0 && !this.sneaking && (this.food > 6 || this.creative)) this.sprinting = true;
    if (input.forward <= 0 || this.sneaking) this.sprinting = false;

    // Horizontal movement.
    let fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    let rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let wx = fx * input.forward + rx * input.strafe;
    let wz = fz * input.forward + rz * input.strafe;
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }
    let speed;
    if (this.flying) speed = this.sprinting ? 21 : 10.9;
    else if (this.inLava) speed = 1.3;
    else if (this.inWater) speed = 2.6;
    else if (this.sneaking) speed = 1.3;
    else speed = this.sprinting ? 5.6 : 4.3;
    const accel = this.flying ? 8 : this.onGround || liquid ? 18 : 5;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (wx * speed - this.vel.x) * k;
    this.vel.z += (wz * speed - this.vel.z) * k;

    // Vertical movement.
    if (this.flying) {
      const vy = ((input.jump ? 1 : 0) - (input.sneak ? 1 : 0)) * 8;
      this.vel.y += (vy - this.vel.y) * (1 - Math.exp(-10 * dt));
    } else if (liquid) {
      const thick = this.inLava ? 0.5 : 1; // lava is harder to swim in
      this.vel.y -= GRAVITY * 0.25 * dt;
      if (input.jump) this.vel.y += 30 * thick * dt;
      this.vel.y *= Math.exp(-3 / thick * dt);
      this.vel.y = Math.max(-3, Math.min(this.vel.y, 3.2 * thick));
      // Hop out of water onto a ledge.
      if (input.jump && this.horizontalBlocked) this.vel.y = Math.max(this.vel.y, 5);
    } else {
      this.vel.y -= GRAVITY * dt;
      this.vel.y = Math.max(this.vel.y, -60);
      if (input.jump && this.onGround) {
        this.vel.y = JUMP_SPEED;
        this.exhaust(this.sprinting ? 0.2 : 0.05);
      }
    }

    // Integrate with sub-steps so we never skip through a block.
    const steps = Math.max(1, Math.ceil((this.vel.length() * dt) / 0.4));
    const sdt = dt / steps;
    const wasOnGround = this.onGround;
    this.onGround = false;
    this.horizontalBlocked = false;
    for (let i = 0; i < steps; i++) {
      this.moveAxis(0, this.vel.x * sdt);
      this.moveAxis(2, this.vel.z * sdt);
      this.moveAxis(1, this.vel.y * sdt);
    }

    if (this.onGround && !wasOnGround) this.land();
    if (!this.onGround && !this.flying && !liquid && this.vel.y < 0) this.fallDistance += -this.vel.y * dt;
    if (liquid || this.flying) this.fallDistance = 0;
    const moved = Math.hypot(this.vel.x, this.vel.z) * dt;
    if (this.onGround) this.walkDist += moved;
    if (this.sprinting && !this.flying) this.exhaust(0.1 * moved);
    else if (this.inWater) this.exhaust(0.015 * moved);

    this.tickHunger(dt);
    if (this.pos.y < -20) this.damage(4, 'void');
  }

  exhaust(n) {
    if (!this.creative) this.exhaustion += n;
  }

  // Minecraft-style hunger: exhaustion drains saturation, then food; full food heals, empty food starves.
  tickHunger(dt) {
    if (this.creative) return;
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.food = Math.max(0, this.food - 1);
    }
    this.regenTimer += dt;
    if (this.regenTimer < 4) return;
    if (this.food >= 18 && this.health < 20) {
      this.regenTimer = 0;
      this.health = Math.min(20, this.health + 1);
      this.exhaust(6);
    } else if (this.food === 0 && this.health > 1) {
      this.regenTimer = 0;
      this.damage(1, 'starve');
    } else if (this.food > 0) this.regenTimer = 4;
  }

  eat(food, saturation) {
    this.food = Math.min(20, this.food + food);
    this.saturation = Math.min(this.food, this.saturation + saturation);
  }

  knockback(dx, dz, strength) {
    if (this.creative) return;
    const l = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / l) * strength;
    this.vel.z += (dz / l) * strength;
    this.vel.y = Math.max(this.vel.y, Math.min(8, 3 + strength * 0.3));
  }

  moveAxis(axis, d) {
    if (d === 0) return;
    const p = this.pos;
    const nx = axis === 0 ? p.x + d : p.x;
    const ny = axis === 1 ? p.y + d : p.y;
    const nz = axis === 2 ? p.z + d : p.z;
    // Sneaking keeps you from walking off ledges.
    if (axis !== 1 && this.sneaking && this.onGroundPrev && !this.collides(nx, p.y - 0.6, nz)) {
      if (axis === 0) this.vel.x = 0; else this.vel.z = 0;
      return;
    }
    if (!this.collides(nx, ny, nz)) {
      p.set(nx, ny, nz);
      return;
    }
    // Snap flush against the obstacle.
    if (axis === 1) {
      if (d < 0) { p.y = Math.floor(p.y + d) + 1; this.onGround = true; }
      else p.y = Math.ceil(p.y + this.height + d) - 1 - this.height - EPS;
      if (this.collides(p.x, p.y, p.z)) p.y -= d; // safety
      this.vel.y = 0;
    } else {
      const c = axis === 0 ? p.x : p.z;
      const snapped = d > 0 ? Math.floor(c + HALF_W + d) - HALF_W - EPS : Math.floor(c - HALF_W + d) + 1 + HALF_W + EPS;
      const test = axis === 0 ? this.collides(snapped, p.y, p.z) : this.collides(p.x, p.y, snapped);
      if (!test) { if (axis === 0) p.x = snapped; else p.z = snapped; }
      if (axis === 0) this.vel.x = 0; else this.vel.z = 0;
      this.horizontalBlocked = true;
      if (this.sprinting) this.sprinting = false;
    }
  }

  land() {
    const dmg = Math.floor(this.fallDistance - 3);
    if (dmg > 0) {
      this.invuln = 0;
      this.damage(dmg, 'fall');
    }
    this.fallDistance = 0;
  }

  damage(n, source = 'generic') {
    if (this.creative || this.health <= 0 || n <= 0) return;
    if (this.invuln > 0 && source !== 'starve' && source !== 'void') return;
    this.invuln = 0.5;
    this.lastDamageSource = source;
    // Minecraft's armor formula: each defense point blocks 4%, less against big hits unless the
    // armor is tough (diamond). The armor wears down with every hit it absorbs.
    const a = !BYPASS_ARMOR.has(source) && this.armor?.();
    if (a && a.defense > 0) {
      const eff = Math.min(20, Math.max(a.defense / 5, a.defense - n / (2 + a.toughness / 4)));
      this.onArmorHit?.(n);
      n *= 1 - eff / 25;
    }
    this.health = Math.max(0, this.health - n);
    this.exhaust(0.1);
    this.onDamage?.(n);
  }

  postUpdate() {
    this.onGroundPrev = this.onGround || this.standingSupport(this.pos.x, this.pos.z);
  }
}
