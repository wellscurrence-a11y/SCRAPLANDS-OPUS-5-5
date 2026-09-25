/**
 * Weapon runtime: turret aiming within physical traverse limits, firing, recoil impulses at the
 * mount point, ammo/energy/heat, missile locks, beams, railgun piercing, melee swings.
 */
import * as THREE from 'three';
import type { Machine } from '../machines/machine';
import type { PartRuntime } from '../machines/part';
import type { PartStats, WeaponKind } from '../machines/types';
import { clamp, clamp01, DEG, lerp, wrapAngle } from '../core/math';
import { rand, randRange } from '../core/random';
import { hitPart, splash, surfaceKindAt } from './damage';
import { COLLIDE } from '../physics/physics';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

const TRACER_COLORS: Record<string, [number, number, number]> = {
  scrappers: [4, 2.2, 0.7],
  authority: [4, 1.2, 0.5],
  helix: [0.8, 2.4, 4],
  independents: [4, 3, 1.2],
  player: [4, 2.8, 1.0],
  neutral: [4, 2.5, 1],
};

export class WeaponRuntime {
  m: Machine;
  part: PartRuntime;
  s: PartStats;
  kind: WeaponKind | 'melee';
  group: number;
  yawNode: THREE.Object3D | null;
  pitchNode: THREE.Object3D | null;
  spinNode: THREE.Object3D | null;
  barrels: THREE.Object3D[] = [];
  muzzles: THREE.Object3D[] = [];
  yaw = 0;
  pitch = 0;
  cooldown = 0;
  mag: number;
  reloadT = 0;
  ammo: number;
  ammoUsed = 0;
  spin = 0;
  spinAngle = 0;
  charge = 0;
  barrelIdx = 0;
  recoil: number[] = [];
  disabled = false;
  lockT = 0;
  lockTarget: { machine: Machine; part: PartRuntime } | null = null;
  locked = false;
  beamOn = false;
  swingT = -1;
  swingHit = false;
  aimError = 0; // angle between barrel and aim point (for HUD)
  triggered = false;
  muzzleWorld = new THREE.Vector3();
  muzzleDir = new THREE.Vector3(0, 0, -1);
  private beamSoundT = 0;

  constructor(m: Machine, part: PartRuntime) {
    this.m = m;
    this.part = part;
    this.s = part.def.stats;
    this.kind = part.def.category === 'melee' || this.s.melee ? 'melee' : (this.s.weapon ?? 'mg');
    this.group = part.placed.group ?? (this.kind === 'melee' ? 2 : 1);
    this.yawNode = part.nodes.get('yaw') ?? null;
    this.pitchNode = part.nodes.get('pitch') ?? null;
    this.spinNode = part.nodes.get('spin') ?? null;
    for (let i = 0; i < 16; i++) {
      const b = part.nodes.get(`barrel_${i}`);
      if (b) {
        this.barrels.push(b);
        b.userData.restZ = b.position.z;
      }
      const mz = part.nodes.get(`muzzle_${i}`);
      if (mz) this.muzzles.push(mz);
    }
    this.recoil = this.barrels.map(() => 0);
    this.mag = this.s.magazine ?? Infinity;
    this.ammo = this.s.ammo ?? Infinity;
  }

  get turnRate() {
    const neural = this.m.parts.some((p) => p.functional && p.def.special?.includes('neural')) ? 1.3 : 1;
    const dmg = this.part.damageLevel === 1 ? 0.7 : 1;
    return (this.s.turnRate ?? 2.5) * neural * dmg;
  }

  get label() {
    return this.part.def.name;
  }

  get ready() {
    return !this.disabled && this.part.functional && this.cooldown <= 0 && this.reloadT <= 0;
  }

  /** Point turret toward aim point (called every physics step). */
  private aim(dt: number, point: THREE.Vector3 | null) {
    if (!point || (!this.yawNode && !this.pitchNode)) return;
    const inv = this.part.invWorld;
    const local = _v.copy(point).applyMatrix4(inv);
    // account for pivot height
    if (this.yawNode) local.sub(this.yawNode.position);
    const targetYaw = Math.atan2(-local.x, -local.z);
    const horiz = Math.hypot(local.x, local.z);
    const pivotH = this.pitchNode ? this.pitchNode.position.y : 0;
    const targetPitch = Math.atan2(local.y - pivotH, horiz);
    const yl = (this.s.yawLimit ?? 180) * DEG;
    const ty = yl >= Math.PI ? targetYaw : clamp(targetYaw, -yl, yl);
    const tp = clamp(targetPitch, (this.s.pitchMin ?? -15) * DEG, (this.s.pitchMax ?? 60) * DEG);
    const rate = this.turnRate * dt;
    if (yl >= Math.PI) this.yaw += clamp(wrapAngle(ty - this.yaw), -rate, rate);
    else this.yaw += clamp(ty - this.yaw, -rate, rate);
    this.pitch += clamp(tp - this.pitch, -rate * 0.8, rate * 0.8);
    if (this.yawNode) this.yawNode.rotation.y = this.yaw;
    if (this.pitchNode) this.pitchNode.rotation.x = this.pitch;
  }

  private muzzle(i = 0) {
    const mz = this.muzzles[i % Math.max(1, this.muzzles.length)] ?? this.pitchNode ?? this.part.node;
    mz.updateWorldMatrix(true, false);
    this.muzzleWorld.setFromMatrixPosition(mz.matrixWorld);
    const e = mz.matrixWorld.elements;
    this.muzzleDir.set(-e[8], -e[9], -e[10]).normalize();
    return { pos: this.muzzleWorld.clone(), dir: this.muzzleDir.clone() };
  }

  fixedUpdate(dt: number) {
    const m = this.m;
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.mag = this.s.magazine ?? Infinity;
    }
    if (!this.part.functional) {
      this.disabled = true;
      this.beamOn = false;
      return;
    }
    const aimPoint = m.input.aimPoint;
    // Update hit-test matrices of turret nodes are refreshed in machine.updateHitMatrices
    this.aim(dt, aimPoint);
    const trigger = !this.disabled && m.alive && m.input.fire[this.group - 1];
    this.triggered = trigger;
    // aim error for HUD/AI
    if (aimPoint) {
      const mz = this.muzzle(this.barrelIdx);
      const want = aimPoint.clone().sub(mz.pos).normalize();
      this.aimError = mz.dir.angleTo(want);
    }
    // spin-up weapons
    if (this.s.spinUp) this.spin = clamp01(this.spin + (trigger ? dt / this.s.spinUp : -dt / (this.s.spinUp * 1.5)));
    // missile lock
    if (this.kind === 'missiles') this.updateLock(dt);
    if (this.kind === 'beam') {
      this.beamOn = trigger && !m.overheated;
      if (this.beamOn) this.fireBeam(dt);
      return;
    }
    if (this.kind === 'flamer') {
      if (trigger && m.hasFuel) this.fireFlamer(dt);
      return;
    }
    if (this.kind === 'melee') {
      this.updateMelee(dt, trigger);
      return;
    }
    if (this.kind === 'railgun') {
      if (trigger && this.ready && !m.overheated) {
        this.charge = Math.min(1, this.charge + dt / (this.s.chargeTime ?? 1));
        m.demand(60);
        if (this.charge >= 1) {
          if (m.drawEnergy(this.s.energyPerShot ?? 300)) this.fireRailgun();
          else if (m.isPlayer && rand() < dt * 2) m.ctx.events.emit('notify', { text: 'Railgun needs more stored energy (fit a capacitor)', kind: 'bad' });
          this.charge = 0;
        }
      } else this.charge = Math.max(0, this.charge - dt * 2);
      return;
    }
    if (!trigger || !this.ready) return;
    if (m.overheated && this.kind !== 'laser') return;
    if (this.s.spinUp && this.spin < 0.95) return;
    if (this.ammo <= 0) return;
    this.fire();
  }

  private updateLock(dt: number) {
    const t = this.m.input.lockTarget;
    if (!t || t.part.detached || !t.machine.alive) {
      this.lockT = Math.max(0, this.lockT - dt * 2);
      if (this.lockT <= 0) this.lockTarget = null;
      this.locked = false;
      return;
    }
    const mz = this.muzzle(0);
    const to = t.part.worldCenter.clone().sub(mz.pos);
    const dist = to.length();
    const inCone = mz.dir.angleTo(to.normalize()) < 0.5 && dist < (this.s.range ?? 800);
    if (this.lockTarget && this.lockTarget.part !== t.part) this.lockT = 0;
    this.lockTarget = t;
    if (inCone) this.lockT = Math.min(this.s.lockTime ?? 1.4, this.lockT + dt);
    else this.lockT = Math.max(0, this.lockT - dt);
    this.locked = this.lockT >= (this.s.lockTime ?? 1.4);
  }

  private fire() {
    const m = this.m;
    const ctx = m.ctx;
    const s = this.s;
    const n = this.muzzles.length || 1;
    const idx = this.barrelIdx % n;
    this.barrelIdx++;
    const { pos, dir } = this.muzzle(idx);
    let rof = s.rof ?? 1;
    // Energy weapons draw stored energy per shot
    if (s.energyPerShot && this.kind !== 'beam') {
      if (!m.drawEnergy(s.energyPerShot)) {
        this.cooldown = 0.15;
        return;
      }
    }
    this.cooldown = 1 / rof;
    if (s.magazine) {
      this.mag--;
      if (this.mag <= 0) this.reloadT = s.reload ?? 3;
    }
    if (s.ammo) {
      this.ammo--;
      this.ammoUsed++;
    }
    m.addHeat(s.heat ?? 0.5);
    const faction = m.faction;
    const tracer = TRACER_COLORS[faction] ?? TRACER_COLORS.neutral;
    const spread = (s.spread ?? 1) * DEG * (m.cls === 'mech' ? 0.8 : 1) * (1 + (1 - this.part.efficiency) * 2);
    const shotDir = () => {
      const d = dir.clone();
      const r1 = randRange(-1, 1) * spread;
      const r2 = randRange(-1, 1) * spread;
      const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, d).normalize();
      return d.addScaledVector(right, r1).addScaledVector(up, r2).normalize();
    };
    switch (this.kind) {
      case 'mg':
      case 'chaingun':
      case 'shotgun':
      case 'autocannon':
      case 'cannon': {
        const pellets = s.pellets ?? 1;
        const kind = this.kind === 'cannon' ? 'shell' : this.kind === 'autocannon' ? 'shell' : 'bullet';
        for (let i = 0; i < pellets; i++) {
          const d = shotDir();
          ctx.projectiles.spawn({
            kind: kind as any,
            pos: pos.clone(),
            vel: d.multiplyScalar(s.projSpeed ?? 600).add(m.velocity),
            owner: m,
            damage: s.damage ?? 10,
            pen: s.pen ?? 5,
            splash: s.splash,
            splashDamage: s.splashDamage,
            gravity: kind === 'shell' ? 9 : 2,
            maxRange: (s.range ?? 400) * 1.3,
            tracer: this.kind === 'shotgun' ? (i % 3 === 0 ? tracer : null) : this.ammoUsed % (this.kind === 'mg' ? 2 : 1) === 0 ? tracer : null,
            size: this.kind === 'cannon' ? 0.2 : this.kind === 'autocannon' ? 0.1 : 0.06,
          });
        }
        const flashSize = this.kind === 'cannon' ? 1.6 : this.kind === 'autocannon' ? 0.8 : this.kind === 'shotgun' ? 0.9 : this.kind === 'chaingun' ? 0.32 : 0.28;
        ctx.fx.muzzleFlash(pos, dir, flashSize);
        if (flashSize > 0.7) ctx.fx.flash(pos, 0xffb060, flashSize * 12, 10 + flashSize * 6, 0.07, 1);
        if (this.kind === 'cannon') {
          ctx.fx.dust(pos.clone().addScaledVector(dir, 1.5), 4, [0.6, 0.58, 0.55], dir.clone().multiplyScalar(4), 1.4);
          // ground blast under the muzzle
          const gy = ctx.terrain.heightAt(pos.x, pos.z);
          if (pos.y - gy < 3) ctx.fx.dust(new THREE.Vector3(pos.x, gy + 0.3, pos.z), 6, [0.62, 0.5, 0.38], undefined, 1.5);
        }
        // shell casings
        if (this.kind !== 'shotgun' && rand() < 0.7) {
          const side = new THREE.Vector3(1, 0, 0).transformDirection(this.part.world);
          const big = this.kind === 'cannon' ? 3.2 : this.kind === 'autocannon' ? 1.8 : 1;
          ctx.fx.casings.spawn(this.part.worldCenter.clone(), side.multiplyScalar(randRange(2, 4)).add(new THREE.Vector3(0, 2, 0)).add(m.velocity), big, 2.5, ctx.fx.ground);
        }
        ctx.audio.play(`fire_${this.kind}`, pos, { volume: 1, pitch: randRange(0.94, 1.06) });
        ctx.events.emit('shot', { machine: m, kind: this.kind, pos, size: flashSize });
        break;
      }
      case 'rockets':
      case 'missiles': {
        const guided = this.kind === 'missiles' && this.locked && this.lockTarget;
        const d = guided ? dir.clone() : shotDir();
        ctx.projectiles.spawn({
          kind: this.kind === 'missiles' ? 'missile' : 'rocket',
          pos: pos.clone(),
          vel: d.multiplyScalar((s.projSpeed ?? 100) * 0.5).add(m.velocity),
          owner: m,
          damage: s.damage ?? 60,
          pen: s.pen ?? 10,
          splash: s.splash ?? 3,
          splashDamage: s.splashDamage ?? 30,
          gravity: guided ? 0 : 1.5,
          maxRange: (s.range ?? 600) * 1.2,
          target: guided ? this.lockTarget : null,
          turnRate: s.turnRateMissile ?? 2,
          accel: (s.projSpeed ?? 100) * 1.5,
          maxSpeed: s.projSpeed ?? 100,
          size: this.part.def.look?.swarm ? 0.6 : 1,
        });
        ctx.fx.muzzleFlash(pos, dir, 0.6, [4, 2.5, 1]);
        ctx.fx.smoke(pos, dir.clone().multiplyScalar(-4), 0.5, 1.5, [0.7, 0.68, 0.65], 0.5, 3);
        ctx.audio.play(this.kind === 'missiles' ? 'fire_missile' : 'fire_rocket', pos, { volume: 0.9, pitch: randRange(0.9, 1.1) });
        // hide fired round on racks
        const round = this.part.nodes.get(`round_${idx}`);
        if (round) round.visible = false;
        if (this.mag >= (s.magazine ?? 0)) for (let i = 0; i < 16; i++) { const r = this.part.nodes.get(`round_${i}`); if (r) r.visible = true; }
        ctx.events.emit('shot', { machine: m, kind: this.kind, pos, size: 0.6 });
        break;
      }
      case 'laser': {
        const d = shotDir();
        this.hitscan(pos, d, s.range ?? 600, s.damage ?? 20, s.pen ?? 10, 'energy', false);
        ctx.fx.glow(pos, 0.5, [1, 2.5, 4], 0.06);
        ctx.audio.play('fire_laser', pos, { volume: 0.7, pitch: randRange(0.95, 1.1) });
        ctx.events.emit('shot', { machine: m, kind: 'laser', pos, size: 0.3 });
        break;
      }
      case 'arc': {
        this.fireArc(pos, dir);
        break;
      }
    }
    // Recoil: physical impulse at the mount point, opposite the shot
    const recoil = s.recoil ?? 0;
    if (recoil > 0) {
      const imp = dir.clone().multiplyScalar(-recoil);
      const mp = this.part.worldCenter;
      m.body.applyImpulseAtPoint({ x: imp.x, y: imp.y, z: imp.z }, { x: mp.x, y: mp.y, z: mp.z }, true);
      if (this.barrels.length) this.recoil[idx % this.barrels.length] = 1;
      if (m.isPlayer) m.tag.recoilKick = Math.min(1.5, (m.tag.recoilKick ?? 0) + recoil / Math.max(200, m.mass) * 0.9);
    }
  }

  /** Instant ray weapon. Returns hit point. */
  private hitscan(from: THREE.Vector3, dir: THREE.Vector3, range: number, damage: number, pen: number, kind: 'energy' | 'pierce', pierce: boolean) {
    const ctx = this.m.ctx;
    const wh = ctx.physics.castRayInto(from, dir, range, _n, COLLIDE.qWorld);
    let end = wh.d >= 0 ? wh.d : range;
    const ignore = new Set<PartRuntime>();
    let remaining = damage;
    let lastPoint = from.clone().addScaledVector(dir, end);
    for (let iter = 0; iter < (pierce ? 8 : 1); iter++) {
      let best: { m: Machine; h: NonNullable<ReturnType<Machine['raycastParts']>> } | null = null;
      for (const m of ctx.machines) {
        if (m === this.m) continue;
        const h = m.raycastParts(from, dir, end, ignore);
        if (h && (!best || h.t < best.h.t)) best = { m, h };
      }
      if (!best) break;
      hitPart(ctx, best.m, best.h.part, remaining, pen, best.h.point, best.h.normal, dir, this.m, kind === 'pierce' ? 'pierce' : 'energy');
      lastPoint = best.h.point;
      if (!pierce) {
        end = best.h.t;
        break;
      }
      ignore.add(best.h.part);
      remaining *= best.h.part.def.category === 'armor' ? 0.75 : 0.88;
    }
    if (!pierce) lastPoint = from.clone().addScaledVector(dir, end);
    if (wh.d >= 0 && (pierce || end >= wh.d - 0.01)) {
      const p = from.clone().addScaledVector(dir, wh.d);
      ctx.fx.impact(p, _n.clone(), 'energy', 0.8);
      if (pierce) lastPoint = p;
    }
    const col = new THREE.Color(this.kind === 'railgun' ? 0x9fd8ff : 0x55c8ff);
    ctx.fx.beams.add(from, lastPoint, col.multiplyScalar(this.kind === 'railgun' ? 6 : 4), this.kind === 'railgun' ? 0.35 : 0.12, this.kind === 'railgun' ? 0.5 : 0.08);
    return lastPoint;
  }

  private fireBeam(dt: number) {
    const m = this.m;
    const s = this.s;
    const need = (s.energyPerShot ?? 100) * dt;
    if (!m.drawEnergy(need)) {
      this.beamOn = false;
      return;
    }
    m.addHeat((s.heat ?? 10) * dt);
    const { pos, dir } = this.muzzle(0);
    const ctx = m.ctx;
    const wh = ctx.physics.castRayInto(pos, dir, s.range ?? 600, _n, COLLIDE.qWorld);
    let end = wh.d >= 0 ? wh.d : s.range ?? 600;
    let hit: { m: Machine; h: NonNullable<ReturnType<Machine['raycastParts']>> } | null = null;
    for (const o of ctx.machines) {
      if (o === m) continue;
      const h = o.raycastParts(pos, dir, end);
      if (h && (!hit || h.t < hit.h.t)) hit = { m: o, h };
    }
    if (hit) {
      end = hit.h.t;
      hitPart(ctx, hit.m, hit.h.part, (s.damage ?? 100) * dt, s.pen ?? 15, hit.h.point, hit.h.normal, dir, m, 'energy', rand() > 0.3);
      if (rand() < 0.3) hit.h.part.burning = Math.max(hit.h.part.burning, 0.5);
    } else if (wh.d >= 0 && rand() < 0.5) {
      ctx.fx.impact(pos.clone().addScaledVector(dir, end), _n.clone(), 'energy', 0.6);
    }
    this.beamEnd = pos.clone().addScaledVector(dir, end);
    this.beamSoundT -= dt;
    if (this.beamSoundT <= 0) {
      this.beamSoundT = 0.12;
      ctx.audio.play('beam', pos, { volume: 0.4 });
    }
  }
  beamEnd = new THREE.Vector3();

  private fireRailgun() {
    const m = this.m;
    const s = this.s;
    const { pos, dir } = this.muzzle(0);
    this.hitscan(pos, dir, s.range ?? 1400, s.damage ?? 500, s.pen ?? 90, 'pierce', true);
    m.ctx.fx.muzzleFlash(pos, dir, 1.4, [1.5, 2.5, 4]);
    m.ctx.fx.flash(pos, 0x88ccff, 40, 25, 0.15, 2);
    m.ctx.audio.play('fire_railgun', pos, { volume: 1.2 });
    m.addHeat(s.heat ?? 20);
    const imp = dir.clone().multiplyScalar(-(s.recoil ?? 3000));
    const mp = this.part.worldCenter;
    m.body.applyImpulseAtPoint({ x: imp.x, y: imp.y, z: imp.z }, { x: mp.x, y: mp.y, z: mp.z }, true);
    if (this.barrels.length) this.recoil[0] = 1;
    this.cooldown = 1 / (s.rof ?? 0.4);
    if (m.isPlayer) m.tag.recoilKick = Math.min(1.5, (m.tag.recoilKick ?? 0) + 0.8);
    m.ctx.events.emit('shot', { machine: m, kind: 'railgun', pos, size: 1.4 });
  }

  private fireFlamer(dt: number) {
    const m = this.m;
    const s = this.s;
    const ctx = m.ctx;
    const { pos, dir } = this.muzzle(0);
    m.useFuel(((s.fuelUse ?? 1) / 60) * dt * 10);
    m.addHeat((s.heat ?? 3) * dt);
    for (let i = 0; i < 3; i++) {
      const d = dir.clone().add(new THREE.Vector3(randRange(-0.08, 0.08), randRange(-0.08, 0.08), randRange(-0.08, 0.08))).normalize();
      ctx.fx.fire(pos, 0.35, d.multiplyScalar(randRange(16, 24)).add(m.velocity));
    }
    // damage cone via a few rays
    const range = s.range ?? 25;
    for (let k = 0; k < 2; k++) {
      const d = dir.clone().add(new THREE.Vector3(randRange(-0.12, 0.12), randRange(-0.12, 0.12), randRange(-0.12, 0.12))).normalize();
      for (const o of ctx.machines) {
        if (o === m) continue;
        const h = o.raycastParts(pos, d, range);
        if (h) {
          hitPart(ctx, o, h.part, (s.damage ?? 40) * dt, s.pen ?? 8, h.point, h.normal, d, m, 'flame', true);
          if (rand() < dt * 3) h.part.burning = Math.max(h.part.burning, randRange(3, 7));
        }
      }
    }
    this.beamSoundT -= dt;
    if (this.beamSoundT <= 0) {
      this.beamSoundT = 0.15;
      ctx.audio.play('flamer', pos, { volume: 0.5 });
    }
  }

  private fireArc(pos: THREE.Vector3, dir: THREE.Vector3) {
    const m = this.m;
    const s = this.s;
    const ctx = m.ctx;
    if (!m.drawEnergy(s.energyPerShot ?? 60)) {
      this.cooldown = 0.2;
      return;
    }
    this.cooldown = 1 / (s.rof ?? 2);
    m.addHeat(s.heat ?? 5);
    // find first part in a narrow cone
    let best: { m: Machine; part: PartRuntime; score: number } | null = null;
    for (const o of ctx.machines) {
      if (o === m) continue;
      for (const p of o.parts) {
        if (p.detached) continue;
        const to = p.worldCenter.clone().sub(pos);
        const d = to.length();
        if (d > (s.range ?? 120)) continue;
        const ang = dir.angleTo(to.normalize());
        if (ang > 0.25) continue;
        const score = ang * 30 + d * 0.05;
        if (!best || score < best.score) best = { m: o, part: p, score };
      }
    }
    let from = pos.clone();
    const hitSet = new Set<PartRuntime>();
    let cur = best;
    for (let jump = 0; jump < 5 && cur; jump++) {
      const to = cur.part.worldCenter.clone();
      this.lightning(from, to);
      hitPart(ctx, cur.m, cur.part, (s.damage ?? 60) * (jump === 0 ? 1 : 0.7), 999, to, new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize(), m, 'arc');
      hitSet.add(cur.part);
      from = to;
      // chain to nearest other part (any machine) within 8 m
      let next: typeof best = null;
      for (const o of ctx.machines) {
        if (o === m) continue;
        for (const p of o.parts) {
          if (p.detached || hitSet.has(p)) continue;
          const d = p.worldCenter.distanceTo(from);
          if (d < 8 && (!next || d < next.score)) next = { m: o, part: p, score: d };
        }
      }
      cur = next;
    }
    if (!best) {
      const end = pos.clone().addScaledVector(dir, s.range ?? 120);
      const wh = ctx.physics.castRayInto(pos, dir, s.range ?? 120, _n, COLLIDE.qWorld);
      if (wh.d >= 0) end.copy(pos).addScaledVector(dir, wh.d);
      this.lightning(pos, end);
    }
    ctx.fx.flash(pos, 0x88bbff, 25, 20, 0.12, 2);
    ctx.audio.play('fire_arc', pos, { volume: 1 });
  }

  private lightning(a: THREE.Vector3, b: THREE.Vector3) {
    const ctx = this.m.ctx;
    const segs = 7;
    let prev = a.clone();
    const len = a.distanceTo(b);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const p = a.clone().lerp(b, t);
      if (i < segs) p.add(new THREE.Vector3(randRange(-1, 1), randRange(-1, 1), randRange(-1, 1)).multiplyScalar(len * 0.06));
      ctx.fx.beams.add(prev, p, new THREE.Color(3, 4.5, 8), 0.12, 0.15);
      prev = p;
    }
    ctx.fx.glow(b, 1, [2, 3, 6], 0.15);
  }

  private updateMelee(dt: number, trigger: boolean) {
    const m = this.m;
    const s = this.s;
    const ctx = m.ctx;
    const tool = this.part;
    const continuous = s.melee === 'drill' || s.melee === 'saw';
    const reach = s.reach ?? 3;
    const toolPos = tool.worldCenter.clone();
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(tool.world);
    if (continuous) {
      this.spin = clamp01(this.spin + (trigger ? dt * 3 : -dt * 2));
      if (trigger) m.demand(s.powerDraw ?? 40);
      if (this.spin > 0.6) {
        // anything within reach in front of the tool gets ground down
        const tip = toolPos.clone().addScaledVector(fwd, reach * 0.4);
        for (const o of ctx.machines) {
          if (o === m) continue;
          if (o.currPos.distanceTo(tip) > o.boundRadius + reach) continue;
          const near = o.partsNear(tip, reach * 0.55);
          near.sort((a, b) => a.dist - b.dist);
          const t = near[0];
          if (t) {
            hitPart(ctx, o, t.part, (s.damage ?? 70) * dt * this.spin * m.powerRatio, s.pen ?? 30, t.part.worldCenter, fwd.clone().negate(), fwd, m, 'melee', rand() > 0.25);
            if (rand() < 0.5) ctx.fx.sparks(tip, fwd.clone().negate(), 6, 8, 0.8);
            this.beamSoundT -= dt;
            if (this.beamSoundT <= 0) {
              this.beamSoundT = 0.1;
              ctx.audio.play('grind', tip, { volume: 0.6 });
            }
          }
        }
      }
      return;
    }
    // swing weapons (claw, fist, blade)
    if (this.swingT < 0 && trigger && this.cooldown <= 0) {
      this.swingT = 0;
      this.swingHit = false;
      this.cooldown = s.swingTime ?? 1;
      ctx.audio.play('swing', toolPos, { volume: 0.6 });
    }
    if (this.swingT >= 0) {
      this.swingT += dt / (s.swingTime ?? 1);
      if (!this.swingHit && this.swingT > 0.45) {
        this.swingHit = true;
        const tip = toolPos.clone().addScaledVector(fwd, reach * 0.5);
        let best: { o: Machine; part: PartRuntime; dist: number } | null = null;
        for (const o of ctx.machines) {
          if (o === m) continue;
          if (o.currPos.distanceTo(tip) > o.boundRadius + reach) continue;
          for (const n of o.partsNear(tip, reach * 0.6)) if (!best || n.dist < best.dist) best = { o, part: n.part, dist: n.dist };
        }
        if (best) {
          const dmg = (s.damage ?? 90) * m.powerRatio;
          hitPart(ctx, best.o, best.part, dmg, s.pen ?? 25, best.part.worldCenter.clone(), fwd.clone().negate(), fwd, m, 'melee');
          ctx.fx.sparks(best.part.worldCenter, fwd.clone().negate(), 30, 12, 0.9);
          ctx.audio.play('melee_hit', best.part.worldCenter, { volume: 1 });
          const kb = fwd.clone().multiplyScalar((s.recoil ?? 3000) + dmg * 30);
          best.o.body.applyImpulseAtPoint({ x: kb.x, y: kb.y + dmg * 10, z: kb.z }, { x: tip.x, y: tip.y, z: tip.z }, true);
          // claws tear armour plates off
          if (s.melee === 'claw' && best.part.def.category === 'armor' && rand() < 0.5) best.o.detachPart(best.part, fwd.clone().multiplyScalar(-6));
          if (m.isPlayer) m.tag.recoilKick = Math.min(1.5, (m.tag.recoilKick ?? 0) + 0.6);
        }
      }
      if (this.swingT >= 1) this.swingT = -1;
    }
  }

  update(dt: number) {
    // barrel recoil animation & spin
    for (let i = 0; i < this.barrels.length; i++) {
      const b = this.barrels[i];
      this.recoil[i] = Math.max(0, this.recoil[i] - dt * (this.kind === 'cannon' ? 2.2 : 12));
      const kick = this.kind === 'cannon' ? 0.45 : this.kind === 'autocannon' ? 0.15 : this.kind === 'railgun' ? 0.25 : 0.05;
      b.position.z = b.userData.restZ + this.recoil[i] * this.recoil[i] * kick;
    }
    if (this.spinNode) {
      const sp = this.kind === 'melee' ? this.spin * 30 : this.s.spinUp ? this.spin * 40 : 0;
      this.spinAngle += sp * dt;
      if (this.kind === 'melee' || this.s.spinUp) this.spinNode.rotation.z = this.spinAngle;
      if (this.part.def.look?.style === 'bucket') this.spinNode.rotation.z = this.spinAngle * 0.3;
    }
    // melee swing animation on the tool's jaws / piston
    if (this.kind === 'melee') {
      const t = this.swingT >= 0 ? this.swingT : 0;
      const open = this.swingT >= 0 ? Math.sin(Math.min(1, t * 2.2) * Math.PI) : 0;
      const ja = this.part.nodes.get('jaw_a');
      const jb = this.part.nodes.get('jaw_b');
      if (ja) ja.rotation.y = -0.25 - open * 0.5 + (t > 0.45 ? 0.4 : 0);
      if (jb) jb.rotation.y = 0.25 + open * 0.5 - (t > 0.45 ? 0.4 : 0);
      const piston = this.part.nodes.get('piston');
      if (piston) piston.position.z = -0.25 - (t > 0.4 && t < 0.7 ? 0.35 : 0);
      // swing the whole arm forward during a strike
      const arm = this.part.parent;
      const sh = arm?.nodes.get('shoulder');
      if (sh && this.swingT >= 0) sh.rotation.y += Math.sin(t * Math.PI) * 0.5 * (t < 0.5 ? 1 : -0.4);
    }
    // continuous beam visual
    if (this.beamOn) {
      const { pos } = this.muzzle(0);
      this.m.ctx.fx.beams.add(pos, this.beamEnd, new THREE.Color(1.5, 3, 5), 0.18, 0.04);
      this.m.ctx.fx.glow(this.beamEnd, 0.7, [1, 2.5, 4], 0.05);
    }
    // railgun charge glow
    if (this.charge > 0.05) {
      const { pos } = this.muzzle(0);
      this.m.ctx.fx.glow(pos, 0.2 + this.charge * 0.6, [0.8 * this.charge, 1.8 * this.charge, 4 * this.charge], 0.04);
    }
    void lerp;
    void splash;
    void surfaceKindAt;
  }
}
