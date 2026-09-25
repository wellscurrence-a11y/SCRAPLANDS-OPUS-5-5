/**
 * AI pilots drive enemy machines through exactly the same MachineInput the player uses,
 * so their machines obey the same physics, power and damage rules.
 */
import * as THREE from 'three';
import type { Machine } from '../machines/machine';
import type { PartRuntime } from '../machines/part';
import { COLLIDE } from '../physics/physics';
import { clamp, wrapAngle } from '../core/math';
import { rand, randRange } from '../core/random';
import { Noise } from '../core/noise';

const swayNoise = new Noise(77);
const UP = new THREE.Vector3(0, 1, 0);

export type AIState = 'idle' | 'patrol' | 'engage' | 'flee' | 'follow' | 'goto' | 'race' | 'dead';

export interface AIOptions {
  skill: number; // 0..1
  aggression: number; // 0..1
  home: THREE.Vector3;
  patrolRadius: number;
  detection?: number;
  /** Doctrine for choosing which component to shoot. */
  doctrine?: 'center' | 'weapons' | 'locomotion' | 'cockpit';
  path?: THREE.Vector3[];
  leader?: Machine | null;
  passive?: boolean;
}

export class AIPilot {
  m: Machine;
  state: AIState = 'patrol';
  target: Machine | null = null;
  targetPart: PartRuntime | null = null;
  waypoint = new THREE.Vector3();
  opts: AIOptions;
  private think = rand() * 0.3;
  private stuckT = 0;
  private reverseT = 0;
  private reverseSteer = 1;
  private orbitDir = rand() < 0.5 ? 1 : -1;
  private orbitSwitch = randRange(4, 9);
  private flipT = 0;
  private lastSeen = new THREE.Vector3();
  private lostT = 0;
  preferredRange = 60;
  maxRange = 400;
  hasMelee = false;
  hasRam = false;
  pathIndex = 0;
  gotoPoint: THREE.Vector3 | null = null;
  provoked = false;
  t = rand() * 100;

  constructor(m: Machine, opts: AIOptions) {
    this.m = m;
    this.opts = opts;
    this.waypoint.copy(opts.home);
    this.analyseLoadout();
    if (opts.path) this.state = 'race';
  }

  analyseLoadout() {
    const ranges: number[] = [];
    this.hasMelee = false;
    for (const w of this.m.weapons) {
      if (!w.part.functional) continue;
      if (w.kind === 'melee') {
        this.hasMelee = true;
        continue;
      }
      ranges.push(w.s.range ?? 300);
    }
    this.hasRam = this.m.parts.some((p) => p.functional && p.def.category === 'ram');
    const r = ranges.length ? Math.min(...ranges) : 30;
    this.maxRange = ranges.length ? Math.max(...ranges) : 40;
    this.preferredRange = this.hasMelee && ranges.length === 0 ? 4 : clamp(r * 0.45, 18, 140);
    if (this.m.cls === 'air') this.preferredRange = clamp(r * 0.5, 30, 160);
  }

  get detection() {
    return (this.opts.detection ?? 260) * this.m.ctx.env.visibility();
  }

  private canSee(target: Machine) {
    const from = this.m.worldCom.clone().add(new THREE.Vector3(0, 1, 0));
    const to = target.worldCom.clone();
    const dir = to.clone().sub(from);
    const d = dir.length();
    dir.normalize();
    const hit = this.m.ctx.physics.castRayInto(from, dir, d, null, COLLIDE.qWorld);
    return hit.d < 0 || hit.d > d - 1;
  }

  private pickTargetPart(t: Machine): PartRuntime {
    const parts = t.parts.filter((p) => !p.detached && !p.destroyed);
    const doc = this.opts.doctrine ?? 'center';
    const skill = this.opts.skill;
    let pool: PartRuntime[] = [];
    if (doc === 'weapons') pool = parts.filter((p) => p.def.category === 'weapon');
    else if (doc === 'locomotion') pool = parts.filter((p) => ['wheel', 'rotor', 'leg', 'track', 'actuator'].includes(p.def.category));
    else if (doc === 'cockpit') pool = parts.filter((p) => p.def.category === 'cockpit');
    if (!pool.length || rand() > skill) return t.frame.detached ? parts[0] ?? t.frame : t.frame;
    return pool[Math.floor(rand() * pool.length)];
  }

  update(dt: number) {
    const m = this.m;
    this.t += dt;
    if (!m.alive) {
      this.state = 'dead';
      return;
    }
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.35;
      this.perceive();
    }
    const input = m.input;
    input.fire = [false, false, false];
    input.boost = false;
    input.vertical = 0;
    input.brake = 0;
    input.lights = m.ctx.env.headlightsWanted();
    // Self-right if flipped
    const up = m.up();
    if (up.y < 0.3) {
      this.flipT += dt;
      if (this.flipT > 2.5) {
        m.controller.selfRight?.();
        this.flipT = 0;
      }
    } else this.flipT = 0;
    switch (this.state) {
      case 'engage':
        this.engage(dt);
        break;
      case 'flee':
        this.flee(dt);
        break;
      case 'follow':
        this.follow(dt);
        break;
      case 'goto':
        if (this.gotoPoint) this.moveTo(this.gotoPoint, dt, 0.8);
        break;
      case 'race':
        this.race(dt);
        break;
      default:
        this.patrol(dt);
    }
  }

  private perceive() {
    const m = this.m;
    const ctx = m.ctx;
    // Health check: flee when badly hurt (not everyone)
    const hp = m.healthFraction();
    const locoBroken = m.immobile;
    if ((hp < 0.3 || (locoBroken && m.cls !== 'mech')) && this.opts.aggression < 0.7 && this.state !== 'flee' && this.state !== 'race') {
      // Scrapper pilots sometimes bail out, leaving an intact machine behind
      if (locoBroken && m.faction === 'scrappers' && rand() < 0.35) {
        m.kill(null, 'bailed');
        return;
      }
      this.state = 'flee';
    }
    if (this.opts.passive && !this.provoked) {
      if (this.state !== 'follow' && this.state !== 'race' && this.state !== 'goto') this.state = this.opts.leader ? 'follow' : 'patrol';
      return;
    }
    // Retaliate against whoever hurt us recently
    if (m.ctx.time - m.lastDamageTime < 1 && m.killedBy === null) {
      /* handled via events in spawner */
    }
    let best: Machine | null = null;
    let bestD = this.detection;
    for (const o of ctx.machines) {
      if (o === m || !o.alive) continue;
      if (!ctx.hostile(m.faction, o.faction) && !(this.provoked && o === ctx.player)) continue;
      const d = o.currPos.distanceTo(m.currPos);
      const engaged = this.target === o;
      const range = engaged ? bestD * 1.6 : bestD;
      if (d < range && (engaged || this.canSee(o))) {
        best = o;
        bestD = d;
      }
    }
    if (best) {
      if (this.target !== best || !this.targetPart || this.targetPart.detached || this.targetPart.destroyed || rand() < 0.1) this.targetPart = this.pickTargetPart(best);
      this.target = best;
      this.lastSeen.copy(best.currPos);
      this.lostT = 0;
      if (this.state !== 'flee' && this.state !== 'race') this.state = 'engage';
    } else if (this.state === 'engage') {
      this.lostT += 0.35;
      if (this.lostT > 8) {
        this.target = null;
        this.state = this.opts.leader ? 'follow' : 'patrol';
      }
    }
  }

  // ---------------------------------------------------------------- behaviours
  private patrol(dt: number) {
    const m = this.m;
    const d = m.currPos.distanceTo(this.waypoint);
    if (d < 12 || this.stuckT > 6) {
      const a = rand() * Math.PI * 2;
      const r = rand() * this.opts.patrolRadius;
      this.waypoint.set(this.opts.home.x + Math.cos(a) * r, 0, this.opts.home.z + Math.sin(a) * r);
      this.waypoint.y = m.ctx.terrain.heightAt(this.waypoint.x, this.waypoint.z);
      this.stuckT = 0;
    }
    this.moveTo(this.waypoint, dt, 0.45);
    this.aimAt(null);
  }

  private follow(dt: number) {
    const leader = this.opts.leader;
    if (!leader || !leader.alive) {
      this.state = 'patrol';
      return;
    }
    const behind = leader.currPos.clone().addScaledVector(leader.forward(), -14).addScaledVector(leader.right(), (this.m.id % 2 ? 1 : -1) * 5);
    const d = this.m.currPos.distanceTo(behind);
    this.moveTo(behind, dt, clamp(d / 25, 0.2, 1));
  }

  private race(dt: number) {
    const path = this.opts.path!;
    const target = path[this.pathIndex % path.length];
    if (this.m.currPos.distanceTo(target) < 18) this.pathIndex++;
    this.moveTo(path[this.pathIndex % path.length], dt, 1, true);
  }

  private flee(dt: number) {
    const m = this.m;
    const from = this.target?.currPos ?? this.lastSeen;
    const away = m.currPos.clone().sub(from).setY(0).normalize().multiplyScalar(120).add(m.currPos);
    this.moveTo(away, dt, 1, true);
    if (this.target && m.currPos.distanceTo(this.target.currPos) > 350) {
      this.state = 'patrol';
      this.target = null;
    }
    // still shoot back over the shoulder
    if (this.target) this.aimAt(this.target);
  }

  private engage(dt: number) {
    const m = this.m;
    const t = this.target;
    if (!t || !t.alive) {
      this.state = 'patrol';
      this.target = null;
      return;
    }
    this.orbitSwitch -= dt;
    if (this.orbitSwitch <= 0) {
      this.orbitSwitch = randRange(4, 10);
      this.orbitDir *= -1;
    }
    const toT = t.currPos.clone().sub(m.currPos);
    const dist = toT.length();
    const flat = toT.clone().setY(0).normalize();
    const side = new THREE.Vector3().crossVectors(UP, flat).multiplyScalar(this.orbitDir);
    let goal: THREE.Vector3;
    let speed = 1;
    const ramming = this.hasRam && m.cls === 'ground' && this.opts.aggression > 0.5;
    if (ramming || (this.hasMelee && m.cls === 'mech' && this.preferredRange < 6)) {
      goal = t.currPos.clone().addScaledVector(t.velocity, 0.6);
    } else if (dist > this.preferredRange * 1.3) {
      goal = t.currPos.clone().addScaledVector(side, this.preferredRange * 0.5);
    } else if (dist < this.preferredRange * 0.6) {
      goal = m.currPos.clone().addScaledVector(flat, -25).addScaledVector(side, 15);
    } else {
      goal = m.currPos.clone().addScaledVector(side, 30).addScaledVector(flat, (dist - this.preferredRange) * 0.5);
      speed = m.cls === 'ground' ? 0.7 : 0.6;
    }
    this.moveTo(goal, dt, speed, m.cls !== 'ground', t);
    this.aimAt(t);
  }

  /** Steer toward a world point using the class-appropriate input mapping. */
  private moveTo(goal: THREE.Vector3, dt: number, speed: number, _urgent = false, lookAt?: Machine) {
    const m = this.m;
    const input = m.input;
    const pos = m.currPos;
    const to = goal.clone().sub(pos);
    const flatDist = Math.hypot(to.x, to.z);
    const desiredYaw = Math.atan2(-to.x, -to.z);
    if (m.cls === 'ground') {
      const fwd = m.forward();
      const heading = Math.atan2(-fwd.x, -fwd.z);
      let err = wrapAngle(desiredYaw - heading);
      // obstacle whiskers
      const avoid = this.whiskers(fwd);
      err += avoid;
      input.steer = clamp(-err * 1.8, -1, 1);
      const turnSlow = clamp(1 - Math.abs(err) / 1.8, 0.35, 1);
      input.throttle = flatDist > 6 ? speed * turnSlow : 0;
      if (Math.abs(err) > 2.2 && flatDist < 40) input.throttle = -0.6;
      // stuck recovery
      if (input.throttle > 0.3 && m.speed < 1.2) this.stuckT += dt;
      else this.stuckT = Math.max(0, this.stuckT - dt * 0.5);
      if (this.stuckT > 2.5 && this.reverseT <= 0) {
        this.reverseT = 1.6;
        this.reverseSteer = rand() < 0.5 ? 1 : -1;
        this.stuckT = 0;
      }
      if (this.reverseT > 0) {
        this.reverseT -= dt;
        input.throttle = -0.8;
        input.steer = this.reverseSteer;
      }
      input.boost = speed >= 1 && Math.abs(err) < 0.3 && flatDist > 60;
    } else if (m.cls === 'air') {
      const look = lookAt ? lookAt.currPos.clone().sub(pos) : to;
      const yaw = Math.atan2(-look.x, -look.z);
      input.yawTarget = yaw;
      const hf = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const hr = new THREE.Vector3(-hf.z, 0, hf.x).negate();
      const dir = new THREE.Vector3(to.x, 0, to.z);
      const k = clamp(flatDist / 30, 0, 1) * speed;
      if (dir.lengthSq() > 0) dir.normalize();
      input.throttle = clamp(dir.dot(hf) * k, -1, 1);
      input.strafe = clamp(dir.dot(hr) * k, -1, 1);
      // altitude: stay above terrain and a little above the target
      const ground = m.ctx.terrain.heightAt(pos.x, pos.z);
      const want = Math.max(ground + 22, (lookAt ? lookAt.currPos.y + 14 : goal.y + 20));
      input.vertical = clamp((want - pos.y) / 8, -1, 1);
    } else {
      const look = lookAt ? lookAt.currPos.clone().sub(pos) : to;
      const yaw = Math.atan2(-look.x, -look.z);
      input.yawTarget = yaw;
      const hf = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const hr = new THREE.Vector3(-hf.z, 0, hf.x).negate();
      const dir = new THREE.Vector3(to.x, 0, to.z);
      if (dir.lengthSq() > 0) dir.normalize();
      const k = clamp(flatDist / 8, 0, 1) * speed;
      input.throttle = clamp(dir.dot(hf) * k, -1, 1);
      input.strafe = clamp(dir.dot(hr) * k, -1, 1);
      const avoid = this.whiskers(m.forward());
      if (Math.abs(avoid) > 0.3) input.strafe = clamp(input.strafe - Math.sign(avoid), -1, 1);
      // jump obstacles if we have jets and are blocked
      if (this.stuckT > 1.5) input.vertical = 1;
      if (m.speed < 0.4 && flatDist > 10) this.stuckT += dt;
      else this.stuckT = 0;
    }
  }

  private whiskers(fwd: THREE.Vector3): number {
    const m = this.m;
    const origin = m.currPos.clone().add(new THREE.Vector3(0, 0.8, 0));
    const len = 8 + m.speed * 1.2;
    let steer = 0;
    for (const [ang, w] of [
      [0.35, -1],
      [-0.35, 1],
      [0, 0],
    ] as [number, number][]) {
      const dir = fwd.clone().setY(0).normalize().applyAxisAngle(UP, ang);
      const h = m.ctx.physics.castRayInto(origin, dir, len, null, COLLIDE.qWorldAndMachines, m.body);
      if (h.d >= 0) {
        const k = 1 - h.d / len;
        steer += (w === 0 ? (rand() < 0.5 ? 1 : -1) : w) * k * 0.9;
      }
    }
    return steer;
  }

  private aimAt(t: Machine | null) {
    const m = this.m;
    const input = m.input;
    if (!t) {
      input.aimPoint = m.currPos.clone().addScaledVector(m.forward(), 50).add(new THREE.Vector3(0, 1, 0));
      input.lockTarget = null;
      return;
    }
    const part = this.targetPart && !this.targetPart.detached ? this.targetPart : t.frame;
    const tp = part.worldCenter.clone();
    const dist = tp.distanceTo(m.currPos);
    // Lead the target using the dominant weapon's projectile speed
    const w0 = m.weapons.find((w) => w.part.functional && w.kind !== 'melee');
    const speed = w0?.s.projSpeed ?? 600;
    const tLead = dist / speed;
    const relV = t.velocity.clone().sub(m.velocity.clone().multiplyScalar(0.5));
    tp.addScaledVector(relV, tLead * (0.5 + this.opts.skill * 0.5));
    if (w0?.kind === 'cannon' || w0?.kind === 'autocannon') tp.y += 0.5 * 9 * tLead * tLead;
    // Human-ish sway (less with skill)
    const sway = (1.4 - this.opts.skill) * (0.6 + dist * 0.012);
    tp.x += swayNoise.noise2(this.t * 0.9, m.id) * sway;
    tp.y += swayNoise.noise2(this.t * 0.9, m.id + 50) * sway * 0.6;
    tp.z += swayNoise.noise2(this.t * 0.9, m.id + 100) * sway;
    input.aimPoint = tp;
    input.lockTarget = { machine: t, part };
    // Fire groups whose weapons are roughly aligned and in range
    for (const w of m.weapons) {
      if (!w.part.functional || w.disabled) continue;
      const range = w.kind === 'melee' ? (w.s.reach ?? 3) + t.boundRadius : w.s.range ?? 300;
      if (dist > range) continue;
      const tol = w.kind === 'missiles' ? 0.6 : w.kind === 'melee' ? 1.2 : 0.12 + (1 - this.opts.skill) * 0.08;
      if (w.aimError < tol || w.kind === 'melee') {
        if (w.kind === 'missiles' && !w.locked && rand() > 0.02) continue;
        input.fire[w.group - 1] = true;
      }
    }
    // Burst discipline: occasionally pause firing
    if (swayNoise.noise2(this.t * 0.4, m.id + 7) > 0.55 - this.opts.aggression * 0.3) input.fire = [false, false, false];
  }
}
