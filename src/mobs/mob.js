import * as THREE from 'three';
import { B, I, isWater, isLava } from '../blocks.js';
import { moveBody } from '../physics.js';
import { buildModel } from './models.js';
import { findPath } from './pathfind.js';

export const MOB_TYPES = {
  pig: { name: '猪', health: 10, w: 0.9, h: 0.9, speed: 1.2, panic: 2.6, drops: [[I.PORKCHOP, 1, 3]] },
  cow: { name: '牛', health: 10, w: 0.9, h: 1.4, speed: 1.0, panic: 2.4, drops: [[I.BEEF, 1, 3], [I.LEATHER, 0, 2]] },
  sheep: { name: '羊', health: 8, w: 0.9, h: 1.3, speed: 1.1, panic: 2.5, drops: [[B.WOOL, 1, 1], [I.MUTTON, 1, 2]] },
  chicken: { name: '鸡', health: 4, w: 0.4, h: 0.7, speed: 1.0, panic: 2.4, drops: [[I.CHICKEN, 1, 1], [I.FEATHER, 0, 2]] },
  zombie: {
    name: '僵尸', hostile: true, health: 20, w: 0.6, h: 1.95, speed: 2.3, damage: 3, burns: true,
    drops: [[I.ROTTEN_FLESH, 0, 2]],
  },
  skeleton: {
    name: '骷髅', hostile: true, health: 20, w: 0.6, h: 1.99, speed: 2.4, burns: true, ranged: true,
    drops: [[I.BONE, 0, 2], [I.ARROW, 0, 2]],
  },
  creeper: { name: '苦力怕', hostile: true, health: 20, w: 0.6, h: 1.7, speed: 2.1, explodes: true, drops: [[I.GUNPOWDER, 0, 2]] },
  spider: {
    name: '蜘蛛', hostile: true, health: 16, w: 1.4, h: 0.9, speed: 3.0, damage: 2, climbs: true,
    drops: [[I.STRING, 0, 2]],
  },
  // ---- Original monsters ----
  // Disguises itself as a stone block until you get close. Pickaxes deal double damage, other weapons half.
  rock_golem: {
    name: '岩傀', hostile: true, health: 30, w: 0.98, h: 1.35, speed: 1.7, damage: 5, mimic: true, armored: true,
    drops: [[B.COBBLESTONE, 2, 4], [I.IRON_INGOT, 0, 1]], rare: [I.DIAMOND, 0.06],
  },
  // Glowing spirit that circles you at night, then dashes in. Lights up the area around it.
  wisp: {
    name: '幽光灵', hostile: true, health: 8, w: 0.6, h: 0.6, speed: 4, damage: 3, flying: true, glow: true,
    drops: [[I.WISP_DUST, 1, 2]],
  },
};

const GRAVITY = 32;
const FUSE_TIME = 1.5;
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class Mob {
  constructor(type, x, y, z) {
    this.type = type;
    this.def = MOB_TYPES[type];
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.headYaw = this.yaw;
    this.headPitch = 0;
    this.health = this.def.health;
    this.hw = this.def.w / 2;
    this.height = this.def.h;
    this.onGround = false;
    this.blocked = false;
    this.inWater = false;
    this.invuln = 0;
    this.hurtFlash = 0;
    this.dying = -1;
    this.dead = false;
    this.panic = 0;
    this.wanderT = Math.random() * 3;
    this.wander = null;
    this.attackCd = 0;
    this.attackAnim = 0;
    this.shootCd = 2;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = 0;
    this.fuse = 0;
    this.walkPhase = 0;
    this.walkAmt = 0;
    this.light = 15;
    this.burning = false;
    this.fireT = 0;
    this.burnT = 0;
    this.fallDistance = 0;
    this.los = false;
    this.losT = 0;
    this.lastHitByPlayer = -1e9;
    this.age = 0;
    const m = buildModel(type);
    this.model = m;
    this.model.root.position.copy(this.pos);
    if (this.def.mimic) this.goDormant();
    this.path = null;
    this.pathIdx = 0;
    this.pathT = 0;
    this.pathGoal = null;
    this.stuckT = 0;
    this.lastPos = this.pos.clone();
    this.mode = 'orbit';
    this.phaseT = 2 + Math.random() * 2;
    this.orbitA = Math.random() * Math.PI * 2;
    this.fade = 0;
  }

  goDormant() {
    this.dormant = true;
    this.wake = 0;
    this.idleT = 0;
    this.pos.x = Math.floor(this.pos.x) + 0.5;
    this.pos.z = Math.floor(this.pos.z) + 0.5;
    this.yaw = this.headYaw = Math.round(this.yaw / (Math.PI / 2)) * (Math.PI / 2);
  }

  get alive() {
    return this.dying < 0;
  }

  center(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.height / 2, this.pos.z);
  }

  eye(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.height * 0.85, this.pos.z);
  }

  // Returns true if the hit landed.
  hurt(amount, kx, kz, byPlayer, M) {
    if (!this.alive || this.invuln > 0) return false;
    this.health -= amount;
    this.invuln = 0.5;
    this.hurtFlash = 0.35;
    const l = Math.hypot(kx, kz) || 1;
    this.vel.x += (kx / l) * 6;
    this.vel.z += (kz / l) * 6;
    this.vel.y = Math.max(this.vel.y, 5);
    if (byPlayer) this.lastHitByPlayer = this.age;
    if (!this.def.hostile) { this.panic = 5; this.wander = null; }
    if (this.dormant) { this.dormant = false; M.sound.mob(this.type, 'say', 1); }
    M.sound.mob(this.type, 'hurt', M.volumeAt(this.pos));
    if (this.health <= 0) this.die(M);
    return true;
  }

  die(M) {
    this.dying = 0;
    this.fuse = 0;
    M.sound.mob(this.type, 'death', M.volumeAt(this.pos));
    M.onMobKilled(this, this.age - this.lastHitByPlayer < 5);
  }

  update(dt, M) {
    const w = M.world, g = M.game, p = g.player;
    this.age += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.attackCd -= dt;
    this.attackAnim = Math.max(0, this.attackAnim - dt * 3);

    const feet = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.2), Math.floor(this.pos.z));
    const mid = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + this.height * 0.6), Math.floor(this.pos.z));
    this.inWater = isWater(feet) || isWater(mid);
    const inLava = isLava(feet) || isLava(mid);
    if (inLava && this.alive) {
      this.hurt(4, 0, 0, false, M);
      this.fireT = 6;
      this.vel.y = Math.max(this.vel.y, 3); // scramble out
    } else if ((feet === B.FIRE || mid === B.FIRE) && this.alive) {
      this.hurt(1, 0, 0, false, M);
      this.fireT = Math.max(this.fireT, 8);
    }
    if (this.fireT > 0) {
      this.fireT -= dt;
      if (this.inWater) this.fireT = 0;
      if (Math.floor(this.fireT) !== Math.floor(this.fireT + dt) && this.alive) this.hurt(1, 0, 0, false, M);
    }
    if (this.inWater && !this.def.flying) {
      const f = M.game.fluids.flowAt(this.pos.x, this.pos.y + 0.2, this.pos.z); // carried by currents
      this.vel.x += f.x * 6 * dt;
      this.vel.z += f.z * 6 * dt;
    }

    if (!this.alive) {
      this.dying += dt;
      this.vel.x *= 0.9;
      this.vel.z *= 0.9;
      this.vel.y -= GRAVITY * dt;
      moveBody(this, w, dt);
      if (this.dying > 1) this.dead = true;
      this.animate(dt, g);
      return;
    }

    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    const dy = p.pos.y - this.pos.y;
    const hdist = Math.hypot(dx, dz);
    const toPlayer = Math.atan2(-dx, -dz);
    let moveYaw = null, speed = 0, lookYaw = null;

    const canTarget = this.def.hostile && !p.creative && !g.dead && hdist < 16 && Math.abs(dy) < 10;
    if (canTarget) {
      this.losT -= dt;
      if (this.losT <= 0) { this.losT = 0.4; this.los = M.lineOfSight(this.eye(), p.eye()); }
    } else this.los = false;
    // Hostiles notice you by sight, or by "hearing" within 12 blocks, and keep hunting for a while after
    // losing sight — the pathfinder then routes them around walls.
    if (canTarget && (this.los || hdist < 12)) this.aggro = 8;
    else this.aggro = Math.max(0, (this.aggro || 0) - dt);
    const chasing = canTarget && this.aggro > 0;

    if (this.def.flying) {
      this.updateFlying(dt, M, canTarget, hdist);
      return;
    }

    if (this.def.mimic) {
      this.wake += ((this.dormant ? 0 : 1) - this.wake) * Math.min(1, dt * 4);
      if (this.dormant) {
        if (canTarget && hdist < 4 && Math.abs(dy) < 3) {
          this.dormant = false;
          M.sound.mob(this.type, 'say', 1);
        } else {
          this.vel.set(0, this.vel.y - GRAVITY * dt, 0);
          moveBody(this, w, dt);
          this.animate(dt, g);
          return;
        }
      } else if (!chasing) {
        this.idleT += dt;
        if (this.idleT > 10 && this.onGround) this.goDormant();
      } else this.idleT = 0;
    }

    this.wantJump = false;
    this.following = false;
    this.pathT -= dt;
    // Route toward the player: steer straight when close and visible, otherwise follow an A* path.
    const pg = [Math.floor(p.pos.x), Math.floor(p.pos.y + 0.01), Math.floor(p.pos.z)];
    const chaseYaw = () => {
      if (this.los && hdist < 4 && Math.abs(dy) < 1.5) { this.path = null; return toPlayer; }
      const opts = this.def.climbs ? { maxDrop: 6, maxNodes: 700, climb: true, height: 1 } : { maxDrop: 3, maxNodes: 700 };
      return this.follow(M, pg, opts) ?? toPlayer;
    };

    if (chasing) {
      lookYaw = toPlayer;
      const t = this.type;
      if (t === 'zombie' || t === 'spider' || t === 'rock_golem') {
        moveYaw = chaseYaw();
        speed = this.def.speed;
        const reach = this.hw + 0.3 + 0.8;
        if (hdist < reach && dy > -1.5 && dy < this.height && this.attackCd <= 0) {
          this.attackCd = t === 'rock_golem' ? 1.4 : 1;
          this.attackAnim = 1;
          p.damage(this.def.damage, t);
          p.knockback(dx, dz, t === 'rock_golem' ? 10 : 5);
        }
        if (t === 'spider' && this.onGround && hdist > 2 && hdist < 4 && Math.random() < dt * 1.5) {
          this.vel.x += (dx / hdist) * 5;
          this.vel.z += (dz / hdist) * 5;
          this.vel.y = 6;
        }
      } else if (t === 'skeleton') {
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafeT = 1.5 + Math.random() * 2; this.strafe = -this.strafe; }
        if (hdist > 10 || !this.los) moveYaw = chaseYaw();
        else if (hdist < 5) moveYaw = toPlayer + Math.PI;
        else moveYaw = toPlayer + (this.strafe * Math.PI) / 2;
        speed = this.def.speed * (hdist > 10 ? 1 : 0.6);
        this.shootCd -= dt;
        if (this.los && this.shootCd <= 0 && hdist < 15) {
          this.shootCd = 1.6 + Math.random();
          this.attackAnim = 1;
          M.mobShoot(this, p);
        }
      } else if (t === 'creeper') {
        if (hdist < 3 && this.los) {
          if (this.fuse === 0) M.sound.mob('creeper', 'fuse', M.volumeAt(this.pos));
          this.fuse += dt;
          if (this.fuse >= FUSE_TIME) {
            M.explode(this.pos.x, this.pos.y + 0.8, this.pos.z, 3, 'creeper');
            this.dead = true;
            return;
          }
        } else {
          this.fuse = Math.max(0, this.fuse - dt);
          moveYaw = chaseYaw();
          speed = this.def.speed;
        }
      }
    } else {
      this.fuse = Math.max(0, this.fuse - dt);
      if (this.panic > 0) this.panic -= dt;
      this.wanderT -= dt;
      if (this.wanderT <= 0 || (this.panic > 0 && !this.wander)) {
        this.wanderT = this.panic > 0 ? 1 + Math.random() : 3 + Math.random() * 6;
        if (this.panic > 0 || Math.random() < 0.55) {
          const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 7;
          this.wander = [Math.floor(this.pos.x + Math.cos(a) * r), Math.floor(this.pos.y + 0.01), Math.floor(this.pos.z + Math.sin(a) * r)];
        } else this.wander = null;
        this.path = null; // new destination -> new route
      }
      if (this.wander) {
        // Animals avoid water and big drops; panicking ones are a bit less careful.
        const yaw = this.follow(M, this.wander, {
          maxDrop: this.panic > 0 ? 3 : 2, avoidWater: !this.inWater, maxNodes: 250, keepGoal: true,
        });
        if (yaw === null) this.wander = null;
        else if (yaw !== undefined) {
          moveYaw = yaw;
          speed = this.panic > 0 ? this.def.panic : this.def.speed * (this.def.hostile ? 0.5 : 1);
        }
      }
      // Occasionally glance at a nearby player.
      if (hdist < 8 && !this.def.hostile && Math.sin(this.age * 0.7 + this.pos.x) > 0.3) lookYaw = toPlayer;
    }

    // Fallback when steering without a path: don't walk off cliffs (chasing hostiles are braver).
    if (moveYaw !== null && this.onGround && !chasing && !this.following) {
      const fx = this.pos.x - Math.sin(moveYaw) * (this.hw + 0.5);
      const fz = this.pos.z - Math.cos(moveYaw) * (this.hw + 0.5);
      let drop = 0;
      while (drop < 4 && !w.isSolid(Math.floor(fx), Math.floor(this.pos.y) - 1 - drop, Math.floor(fz))) drop++;
      const wet = isWater(w.getBlock(Math.floor(fx), Math.floor(this.pos.y) - 1, Math.floor(fz)));
      if (drop >= 3 || (wet && this.panic <= 0)) { this.wander = null; moveYaw = null; }
    }

    // Steering
    let tvx = 0, tvz = 0;
    if (moveYaw !== null) {
      const turn = angleDiff(moveYaw, this.yaw);
      this.yaw += Math.sign(turn) * Math.min(Math.abs(turn), dt * 8);
      tvx = -Math.sin(this.yaw) * speed;
      tvz = -Math.cos(this.yaw) * speed;
    }
    const k = 1 - Math.exp(-(this.onGround || this.inWater ? 10 : 2) * dt);
    this.vel.x += (tvx - this.vel.x) * k;
    this.vel.z += (tvz - this.vel.z) * k;

    if (this.inWater) {
      this.vel.y -= GRAVITY * 0.2 * dt;
      if (isWater(mid)) this.vel.y += 14 * dt; // float
      this.vel.y *= Math.exp(-2 * dt);
      if (this.blocked) this.vel.y = Math.max(this.vel.y, 4);
    } else {
      this.vel.y -= GRAVITY * dt;
      if ((this.blocked || this.wantJump) && moveYaw !== null) {
        if (this.def.climbs && this.blocked) this.vel.y = 3.5;
        else if (this.onGround) this.vel.y = 8.4;
      }
    }

    // Stuck detection: if we meant to move but barely did, drop the route and re-plan.
    this.stuckT += dt;
    if (this.stuckT > 1) {
      if (moveYaw !== null && speed > 0 && this.pos.distanceTo(this.lastPos) < 0.3) {
        this.path = null;
        this.pathT = 0;
        if (!chasing) { this.wander = null; this.wanderT = 0.5; }
      }
      this.lastPos.copy(this.pos);
      this.stuckT = 0;
    }
    this.vel.y = Math.max(this.vel.y, -50);

    const wasGround = this.onGround;
    moveBody(this, w, dt);
    if (!this.onGround && !this.inWater && this.vel.y < 0) this.fallDistance += -this.vel.y * dt;
    if (this.inWater || this.def.climbs) this.fallDistance = 0;
    if (this.onGround && !wasGround) {
      const dmg = Math.floor(this.fallDistance - 3);
      if (dmg > 0 && this.type !== 'chicken') this.hurt(dmg, 0, 0, false, M);
      this.fallDistance = 0;
    }
    if (this.type === 'chicken' && !this.onGround && this.vel.y < -3) this.vel.y = -3; // flutter

    // Undead burn in daylight.
    this.burnT -= dt;
    if (this.burnT <= 0) {
      this.burnT = 1;
      this.burning = this.def.burns && g.sky.daylight > 0.55 && !this.inWater
        && w.getSkyY(Math.floor(this.pos.x), Math.floor(this.pos.z)) < this.pos.y;
      if (this.burning) {
        this.invuln = 0;
        this.hurt(1, 0, 0, false, M);
        M.game.particles.spawn(this.pos.x - 0.5, this.pos.y + 0.4, this.pos.z - 0.5, [1, 0.55, 0.1], 6, 0.6);
      }
    }
    if (this.pos.y < -10) { this.dead = true; return; }

    // Head direction
    const targetHead = lookYaw ?? this.yaw;
    this.headYaw += angleDiff(targetHead, this.headYaw) * Math.min(1, dt * 6);
    const headDiff = angleDiff(this.headYaw, this.yaw);
    if (Math.abs(headDiff) > 1.2) this.headYaw = this.yaw + Math.sign(headDiff) * 1.2;
    this.headPitch = lookYaw !== null && hdist > 0.5
      ? Math.max(-0.6, Math.min(0.6, Math.atan2(p.pos.y + 1.5 - (this.pos.y + this.height), hdist)))
      : this.headPitch * 0.9;

    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walkAmt += (Math.min(1, sp / 2) - this.walkAmt) * Math.min(1, dt * 8);
    this.walkPhase += sp * dt * (this.type === 'chicken' ? 5 : this.type === 'spider' ? 2.5 : 3.2);
    this.animate(dt, g);
  }

  /**
   * Follow an A* route to `goal` ([x,y,z] cell). Returns a yaw to walk toward,
   * null when the route is finished/impossible, or undefined while waiting for a path (budget).
   * opts.keepGoal: fixed destination (wandering) - don't periodically re-plan.
   */
  follow(M, goal, opts) {
    const pg = this.pathGoal;
    const goalMoved = !pg || Math.abs(pg[0] - goal[0]) + Math.abs(pg[1] - goal[1]) + Math.abs(pg[2] - goal[2]) > (opts.keepGoal ? 0 : 2);
    if (!this.path || goalMoved || (!opts.keepGoal && this.pathT <= 0)) {
      if (M.pathBudget <= 0) return this.path?.length ? this.nextWaypointYaw() : undefined;
      M.pathBudget--;
      this.pathT = 0.7 + Math.random() * 0.5;
      this.pathGoal = goal.slice();
      const [sx, sz] = this.footprintCell();
      this.path = findPath(M.world, sx, Math.floor(this.pos.y + 0.01), sz,
        goal[0], goal[1], goal[2], { height: this.height, width: this.def.w, ...opts }) || [];
      this.pathIdx = 0;
    }
    return this.nextWaypointYaw();
  }

  // Footprint cells across (1 for most mobs, 2 for spiders) and the min-corner cell we occupy.
  get footW() {
    return Math.max(1, Math.ceil(this.def.w - 0.05));
  }

  footprintCell() {
    const half = this.footW / 2;
    return [Math.floor(this.pos.x - half + 0.5), Math.floor(this.pos.z - half + 0.5)];
  }

  nextWaypointYaw() {
    const path = this.path;
    const half = this.footW / 2; // waypoint = footprint min corner; aim for the footprint centre
    while (this.pathIdx < path.length) {
      const wp = path[this.pathIdx];
      const ddx = wp[0] + half - this.pos.x, ddz = wp[2] + half - this.pos.z;
      if (Math.hypot(ddx, ddz) < 0.4 && Math.abs(wp[1] - this.pos.y) < 1.1) this.pathIdx++;
      else break;
    }
    if (this.pathIdx >= path.length) return null;
    let wp = path[this.pathIdx];
    // Climbing: waypoints straight above us — steer toward the next waypoint that moves sideways
    // (that pushes into the wall, which makes climbers climb).
    const [cx, cz] = this.footprintCell();
    for (let k = this.pathIdx; k < path.length && wp[0] === cx && wp[2] === cz; k++) wp = path[k];
    const ddx = wp[0] + half - this.pos.x, ddz = wp[2] + half - this.pos.z;
    this.following = true;
    if (wp[1] > Math.floor(this.pos.y + 0.01) && Math.hypot(ddx, ddz) < 1.3) this.wantJump = true;
    return Math.atan2(-ddx, -ddz);
  }

  // Wisp: hovers, circles the player, then dashes in. Fades away in sunlight.
  updateFlying(dt, M, canTarget, hdist) {
    const w = M.world, g = M.game, p = g.player;
    if (g.sky.daylight > 0.6 && w.getSkyY(Math.floor(this.pos.x), Math.floor(this.pos.z)) < this.pos.y) {
      this.fade += dt;
      if (this.fade > 1.5) {
        g.particles.spawn(this.pos.x - 0.5, this.pos.y, this.pos.z - 0.5, [0.6, 0.9, 1], 12, 0.8);
        this.dead = true;
        return;
      }
    }
    const c = this.center();
    const pe = p.eye();
    let tx, ty, tz, maxSpeed = this.def.speed;
    if (canTarget && (this.los || hdist < 6)) {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.mode = this.mode === 'dash' ? 'orbit' : 'dash';
        this.phaseT = this.mode === 'dash' ? 1.2 : 2.5 + Math.random() * 2;
        if (this.mode === 'dash') M.sound.mob('wisp', 'say', M.volumeAt(this.pos));
      }
      if (this.mode === 'dash') {
        tx = pe.x; ty = pe.y - 0.4; tz = pe.z;
        maxSpeed = 9;
        if (c.distanceTo(pe) < 1.1 && this.attackCd <= 0) {
          this.attackCd = 1;
          p.damage(this.def.damage, 'wisp');
          p.knockback(pe.x - c.x, pe.z - c.z, 4);
          this.mode = 'orbit';
          this.phaseT = 3;
        }
      } else {
        this.orbitA += dt * 0.9;
        tx = p.pos.x + Math.cos(this.orbitA) * 5;
        tz = p.pos.z + Math.sin(this.orbitA) * 5;
        ty = p.pos.y + 2.5 + Math.sin(this.age * 2) * 0.7;
      }
      this.headYaw = Math.atan2(-(pe.x - c.x), -(pe.z - c.z));
    } else {
      this.wanderT -= dt;
      if (this.wanderT <= 0 || !this.wander) {
        this.wanderT = 3 + Math.random() * 4;
        const a = Math.random() * Math.PI * 2;
        this.wander = [this.pos.x + Math.cos(a) * 6, this.pos.z + Math.sin(a) * 6];
      }
      let ground = Math.floor(this.pos.y);
      for (let k = 0; k < 8 && !w.isSolid(Math.floor(this.pos.x), ground - 1, Math.floor(this.pos.z)); k++) ground--;
      [tx, tz] = this.wander;
      ty = ground + 2.5 + Math.sin(this.age * 1.5) * 0.5;
      maxSpeed = 2;
    }
    const want = new THREE.Vector3(tx - c.x, ty - c.y, tz - c.z);
    const len = want.length();
    if (len > 0.01) want.multiplyScalar(Math.min(maxSpeed, len * 2) / len);
    this.vel.lerp(want, 1 - Math.exp(-4 * dt));
    moveBody(this, w, dt);
    if (Math.hypot(this.vel.x, this.vel.z) > 0.3) this.yaw = Math.atan2(-this.vel.x, -this.vel.z);
    if (Math.random() < dt * 6) g.particles.spawn(c.x - 0.5, c.y - 0.6, c.z - 0.5, [0.55, 0.9, 1], 1, 0.3);
    this.animate(dt, g);
  }

  animate(dt, g) {
    const { root, inner, parts, material, glowMaterial } = this.model;
    root.position.copy(this.pos);
    root.rotation.y = this.yaw;
    const s = Math.sin(this.walkPhase) * 0.8 * this.walkAmt;
    const P = parts;
    if (P.legFL) { P.legFL.rotation.x = s; P.legBR && (P.legBR.rotation.x = s); }
    if (P.legFR) { P.legFR.rotation.x = -s; P.legBL && (P.legBL.rotation.x = -s); }
    if (P.legL) { P.legL.rotation.x = s; P.legR.rotation.x = -s; }
    if (P.head) {
      P.head.rotation.y = angleDiff(this.headYaw, this.yaw);
      P.head.rotation.x = this.headPitch;
    }
    if (this.type === 'zombie') {
      const sw = Math.sin(this.age * 2) * 0.05 + this.attackAnim * 0.5;
      P.armL.rotation.x = Math.PI / 2 - sw;
      P.armR.rotation.x = Math.PI / 2 + sw;
    } else if (this.type === 'skeleton') {
      const aim = this.los ? Math.PI / 2 : 0;
      P.armL.rotation.x = aim || -s;
      P.armR.rotation.x = aim ? aim + 0.2 - this.attackAnim * 0.4 : s;
      P.armL.rotation.y = aim ? 0.3 : 0;
    } else if (P.armL) {
      P.armL.rotation.x = -s; P.armR.rotation.x = s;
    }
    if (this.type === 'chicken') {
      const flap = this.onGround ? 0 : Math.sin(this.age * 30) * 0.8 + 0.8;
      P.wingL.rotation.z = flap; P.wingR.rotation.z = -flap;
    }
    if (this.type === 'spider') {
      for (const key in P) {
        const leg = P[key];
        if (!key.startsWith('leg')) continue;
        const { base, side, idx } = leg.userData;
        const ph = Math.sin(this.walkPhase * 2 + idx * 1.6 + (side > 0 ? Math.PI : 0)) * 0.4 * this.walkAmt;
        leg.rotation.y = base[1] + ph;
        leg.rotation.z = base[2] + Math.abs(ph) * 0.4 * side;
      }
    }
    if (this.type === 'rock_golem') {
      // Rises up on its legs when awake; legs & eyes vanish while posing as a block.
      const wk = this.wake;
      P.body.position.y = (8 + wk * 6) / 16;
      P.eyes.visible = wk > 0.3;
      for (const k of ['legFL', 'legFR', 'legBL', 'legBR']) {
        P[k].visible = wk > 0.1;
        P[k].scale.y = Math.max(0.01, wk);
      }
      P.body.rotation.x = this.attackAnim * 0.35;
    }
    if (this.type === 'wisp') {
      P.shell.rotation.set(this.age * 1.1, this.age * 1.7, 0);
      P.core.rotation.y = -this.age * 2;
      P.tail1.position.y = (1 + Math.sin(this.age * 5) * 0.8) / 16;
      P.tail2.position.y = (-1 + Math.sin(this.age * 5 - 1) * 1.2) / 16;
      const s = 1 - Math.min(1, this.fade / 1.5);
      inner.scale.setScalar(s * (1 + Math.sin(this.age * 6) * 0.05));
    }
    // Creeper swells & flashes while the fuse burns.
    const fuseT = this.fuse / FUSE_TIME;
    if (this.type === 'creeper') inner.scale.setScalar(1 + fuseT * fuseT * 0.25);
    // Death tilt
    if (!this.alive) inner.rotation.z = Math.min(1, this.dying * 2.5) * (Math.PI / 2);

    const b = this.def.glow ? 1.2 : Math.pow(0.8, 15 - this.light);
    if (this.hurtFlash > 0 || !this.alive) glowMaterial.color.setRGB(1.5, 0.4, 0.4);
    else glowMaterial.color.setScalar(1.25);
    if (this.hurtFlash > 0 || !this.alive) material.color.setRGB(b * 1.2, b * 0.35, b * 0.35);
    else if (this.fuse > 0 && Math.floor(this.fuse * 8) % 2 === 0) material.color.setRGB(2, 2, 2);
    else if (this.burning || this.fireT > 0) material.color.setScalar(Math.max(b, 0.85)); // lit by its own flames
    else material.color.setScalar(b);
  }

  serialize() {
    const s = { type: this.type, pos: [this.pos.x, this.pos.y, this.pos.z], yaw: this.yaw, health: this.health };
    if (this.def.mimic) s.dormant = !!this.dormant;
    return s;
  }
}
