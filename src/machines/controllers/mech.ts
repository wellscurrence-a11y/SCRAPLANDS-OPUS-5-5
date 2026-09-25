/**
 * Walker physics. Legs physically support the torso with forces limited by joint strength,
 * hydraulics and power. Feet plant on the real terrain (raycast) and legs articulate with 2-bone IK.
 * Losing a knee makes the machine limp; losing a leg on a biped tips it over.
 */
import * as THREE from 'three';
import type { Machine } from '../machine';
import type { PartRuntime } from '../part';
import type { Controller, Telemetry } from './controller';
import { COLLIDE, GRAVITY } from '../../physics/physics';
import { clamp, clamp01, lerp, smoothstep, wrapAngle } from '../../core/math';
import { rand, randRange } from '../../core/random';

interface Leg {
  part: PartRuntime;
  hipJ: PartRuntime | null;
  kneeJ: PartRuntime | null;
  foot: PartRuntime | null;
  hipLocal: THREE.Vector3; // machine space
  thigh: number;
  shin: number;
  group: number;
  side: number;
  front: number;
  digitigrade: boolean;
  spider: boolean;
  // state
  footPos: THREE.Vector3;
  footNormal: THREE.Vector3;
  planted: boolean;
  swingT: number;
  swingDur: number;
  swingFrom: THREE.Vector3;
  swingTo: THREE.Vector3;
  swingToNormal: THREE.Vector3;
  lift: number;
  load: number;
  capacity: number;
  functional: boolean;
  limp: boolean;
  initialised: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class MechController implements Controller {
  m: Machine;
  legs: Leg[] = [];
  arms: PartRuntime[] = [];
  jets: PartRuntime[] = [];
  hydro = 1;
  jumpCharge = 1;
  jetting = false;
  fallen = false;
  fallTime = 0;
  standHeight = 2;
  walkSpeed = 3;
  grounded = true;
  private armPitch = new Map<PartRuntime, number>();
  private stepSoundCooldown = 0;
  heading = 0;
  private headingInit = false;

  constructor(m: Machine) {
    this.m = m;
    this.rebuild();
  }

  rebuild() {
    const m = this.m;
    const old = this.legs;
    this.legs = [];
    this.hydro = m.parts.filter((p) => p.functional && p.def.category === 'hydraulics').reduce((s, p) => s * (p.def.stats.hydraulicBoost ?? 1), 1);
    const legParts = m.parts.filter((p) => p.def.category === 'leg' && !p.detached);
    for (const lp of legParts) {
      const sock = lp.layout.socket!;
      const hipJ = lp.children.find((c) => c.placed.socket === 'hipjoint' && !c.detached) ?? null;
      const kneeJ = lp.children.find((c) => c.placed.socket === 'kneejoint' && !c.detached) ?? null;
      const foot = lp.children.find((c) => c.def.category === 'foot' && !c.detached) ?? null;
      const hipLocal = new THREE.Vector3(...sock.pos);
      const prev = old.find((l) => l.part === lp);
      const front = sock.pos[2] < -0.3 ? 1 : sock.pos[2] > 0.3 ? -1 : 0;
      const side = sock.side ?? Math.sign(sock.pos[0]);
      // gait groups: bipeds alternate by side; quads trot in diagonal pairs
      const group = legParts.length >= 4 ? (side * (front || 1) > 0 ? 0 : 1) : side > 0 ? 0 : 1;
      const functional = lp.functional && !!hipJ && !!kneeJ && !hipJ.detached;
      const limp = functional && (kneeJ!.destroyed || hipJ!.destroyed);
      this.legs.push({
        part: lp,
        hipJ,
        kneeJ,
        foot,
        hipLocal,
        thigh: lp.def.stats.thigh ?? 1.3,
        shin: lp.def.stats.shin ?? 1.4,
        group,
        side,
        front,
        digitigrade: !!lp.def.look?.digitigrade,
        spider: !!lp.def.look?.spider,
        footPos: prev?.footPos ?? new THREE.Vector3(),
        footNormal: prev?.footNormal ?? new THREE.Vector3(0, 1, 0),
        planted: prev?.planted ?? true,
        swingT: prev?.swingT ?? 0,
        swingDur: 0.4,
        swingFrom: prev?.swingFrom ?? new THREE.Vector3(),
        swingTo: prev?.swingTo ?? new THREE.Vector3(),
        swingToNormal: prev?.swingToNormal ?? new THREE.Vector3(0, 1, 0),
        lift: 0.4,
        load: 0,
        capacity: 0,
        functional,
        limp,
        initialised: prev?.initialised ?? false,
      });
    }
    this.arms = m.parts.filter((p) => p.def.category === 'arm' && !p.detached);
    this.jets = m.parts.filter((p) => p.def.category === 'jumpjet' && p.functional);
    const working = this.legs.filter((l) => l.functional);
    const legLen = working.length ? working.reduce((s, l) => s + l.thigh + l.shin, 0) / working.length : 2.5;
    const hipY = working.length ? working.reduce((s, l) => s + l.hipLocal.y, 0) / working.length : -0.6;
    this.standHeight = legLen * 0.84 - hipY; // body origin height above ground
    this.walkSpeed = Math.max(0.6, this.m.stats.walkSpeed || 2.5);
  }

  onPartChanged(p: PartRuntime) {
    this.rebuild();
    if (p.def.category === 'leg' || p.def.category === 'actuator' || p.def.category === 'foot') {
      const lost = this.legs.filter((l) => !l.functional).length;
      if (lost && this.m.isPlayer) this.m.ctx.events.emit('notify', { text: lost === 1 ? 'LEG DISABLED' : `${lost} LEGS DISABLED`, kind: 'bad' });
    }
  }

  private legCapacity(l: Leg) {
    if (!l.functional) return 0;
    const joints = [l.hipJ!, l.kneeJ!].filter(Boolean);
    const strength = Math.min(...joints.map((j) => (j.destroyed ? 0.3 : (j.def.stats.jointStrength ?? 1) * j.efficiency)));
    const g = GRAVITY;
    return (l.part.def.stats.loadRating ?? 2000) * g * strength * this.hydro * l.part.efficiency * (0.35 + 0.65 * this.m.powerRatio);
  }

  private groundAt(x: number, z: number, fromY: number, outNormal: THREE.Vector3) {
    const phys = this.m.ctx.physics;
    const origin = new THREE.Vector3(x, fromY, z);
    const hit = phys.castRayInto(origin, new THREE.Vector3(0, -1, 0), 20, outNormal, COLLIDE.qWorldAndMachines, this.m.body);
    if (hit.d >= 0) return fromY - hit.d;
    const h = this.m.ctx.terrain.heightAt(x, z);
    this.m.ctx.terrain.normalAt(x, z, outNormal);
    return h;
  }

  fixedUpdate(dt: number) {
    const m = this.m;
    const body = m.body;
    const q = m.currQuat;
    const pos = m.currPos;
    const vel = m.velocity;
    const ang = m.angVel;
    const mass = m.mass;
    const g = GRAVITY * m.antiMass;
    const input = m.alive ? m.input : { throttle: 0, strafe: 0, steer: 0, vertical: 0, yawTarget: null as number | null, boost: false };
    const bodyMat = _m.compose(pos, q, new THREE.Vector3(1, 1, 1));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    if (!this.headingInit) {
      this.heading = Math.atan2(-fwd.x, -fwd.z);
      this.headingInit = true;
    }
    this.fallen = up.y < 0.35;
    if (this.fallen) this.fallTime += dt;
    else this.fallTime = 0;

    // ---- per-leg geometry & initialisation ----
    const working = this.legs.filter((l) => l.functional);
    let totalCap = 0;
    for (const l of this.legs) {
      l.capacity = this.legCapacity(l);
      totalCap += l.capacity;
      if (!l.initialised) {
        const hip = l.hipLocal.clone().applyMatrix4(bodyMat);
        const n = new THREE.Vector3();
        const gy = this.groundAt(hip.x, hip.z, hip.y + 2, n);
        l.footPos.set(hip.x + l.side * 0.25, gy, hip.z);
        l.footNormal.copy(n);
        l.initialised = true;
      }
    }
    const loadRatio = mass * g / Math.max(1, totalCap * (working.length >= 4 ? 0.9 : 0.6));
    const speedFactor = clamp(1.35 - loadRatio * 0.5, 0.2, 1.1);
    const jointSpeed = working.length
      ? Math.min(...working.flatMap((l) => [l.hipJ!, l.kneeJ!].map((j) => (j.def.stats.jointSpeed ?? 1) * (j.destroyed ? 0.5 : 1))))
      : 1;

    // ---- power draw from joints ----
    let jointDraw = 0;
    for (const l of working) for (const j of [l.hipJ!, l.kneeJ!]) jointDraw += j.def.stats.powerDraw ?? 0;
    const moving = Math.min(1, Math.abs(input.throttle) + Math.abs(input.strafe));
    m.demand(jointDraw * (0.35 + 0.65 * moving));
    for (const h of m.parts.filter((p) => p.functional && p.def.category === 'hydraulics')) m.demand((h.def.stats.powerDraw ?? 0) * 0.6);

    // ---- desired horizontal velocity (camera-relative) ----
    const yawT = input.yawTarget ?? this.heading;
    const hf = new THREE.Vector3(-Math.sin(yawT), 0, -Math.cos(yawT));
    const hr = new THREE.Vector3(-hf.z, 0, hf.x).negate();
    const limpFactor = working.some((l) => l.limp) ? 0.45 : 1;
    const legFrac = this.legs.length ? working.length / this.legs.length : 0;
    const legLenAvg = working.length ? working.reduce((s2, l) => s2 + l.thigh + l.shin, 0) / working.length : 2.5;
    const geoMax = Math.sqrt(Math.max(0.2, legLenAvg * legLenAvg * (1 - 0.84 * 0.84))) * 2.2 / 0.3;
    const maxV = Math.min(geoMax, this.walkSpeed * speedFactor * limpFactor * (input.boost ? 1.45 : 1) * (legFrac < 0.99 ? 0.5 : 1));
    const vDes = new THREE.Vector3().addScaledVector(hf, input.throttle).addScaledVector(hr, input.strafe);
    if (vDes.lengthSq() > 1) vDes.normalize();
    vDes.multiplyScalar(maxV);

    // ---- stance support ----
    const planted = working.filter((l) => l.planted);
    let supportN = 0;
    let groundedAny = false;
    const avgFootY = planted.length ? planted.reduce((s, l) => s + l.footPos.y, 0) / planted.length : pos.y - this.standHeight;
    // crouch a little when heavily loaded
    const sag = clamp01(loadRatio - 0.7) * 0.6;
    const targetY = avgFootY + this.standHeight * (1 - sag * 0.35);
    for (const l of planted) {
      const hip = l.hipLocal.clone().applyMatrix4(bodyMat);
      const reach = l.thigh + l.shin;
      const ext = hip.distanceTo(l.footPos.clone().add(new THREE.Vector3(0, 0.25, 0)));
      if (ext > reach * 1.04 && !this.fallen && planted.filter((o) => o.planted).length > Math.max(1, working.length - 2)) {
        // over-extended: foot can't reach, start a recovery step (never the last supporting leg)
        l.planted = false;
        l.swingT = 0;
        l.swingFrom.copy(l.footPos);
        const n0 = new THREE.Vector3();
        const gy0 = this.groundAt(hip.x, hip.z, hip.y + 1, n0);
        l.swingTo.set(hip.x, gy0, hip.z).addScaledVector(new THREE.Vector3(vel.x, 0, vel.z), 0.25);
        l.swingToNormal.copy(n0);
        l.swingDur = 0.22;
        l.lift = 0.25;
        continue;
      }
      groundedAny = true;
      const hipVel = vel.clone().add(ang.clone().cross(hip.clone().sub(m.worldCom)));
      const share = 1 / Math.max(1, planted.length);
      const k = (mass * g * share) / 0.12;
      const c = 2 * Math.sqrt(k * mass * share) * 0.9;
      const bodyErr = targetY - pos.y;
      let f = mass * g * share + k * bodyErr - c * hipVel.y;
      f = clamp(f, 0, l.limp ? l.capacity * 0.35 : l.capacity);
      l.load = f;
      supportN += f;
      if (this.fallen) continue;
      const imp = UP.clone().multiplyScalar(f * dt);
      body.applyImpulseAtPoint({ x: imp.x, y: imp.y, z: imp.z }, { x: hip.x, y: hip.y, z: hip.z }, true);
    }
    this.grounded = groundedAny;

    // ---- locomotion force (traction via planted feet) ----
    if (groundedAny && !this.fallen) {
      const vh = new THREE.Vector3(vel.x, 0, vel.z);
      const dv = vDes.clone().sub(vh);
      const gripMul = planted.reduce((s, l) => s + (l.foot?.def.stats.footGrip ?? 0.7) * (l.foot?.functional ? 1 : 0.6), 0) / Math.max(1, planted.length);
      const maxF = mass * g * 0.9 * gripMul * clamp01(supportN / (mass * g));
      const F = dv.multiplyScalar(mass * 6);
      if (F.length() > maxF) F.setLength(maxF);
      body.applyImpulse({ x: F.x * dt, y: 0, z: F.z * dt }, true);
    }

    // ---- attitude: stay upright & turn toward heading (authority from legs) ----
    const authorityLegs = planted.reduce((s, l) => s + l.load * 0.8, 0) + (working.length >= 2 ? mass * g * 0.15 : 0);
    const turnRate = 1.6 * jointSpeed * speedFactor * limpFactor;
    this.heading += clamp(wrapAngle(yawT - this.heading), -turnRate * dt, turnRate * dt);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(UP, this.heading);
    const qErr = qYaw.clone().multiply(q.clone().invert());
    if (qErr.w < 0) qErr.set(-qErr.x, -qErr.y, -qErr.z, -qErr.w);
    const angle = 2 * Math.acos(clamp(qErr.w, -1, 1));
    const s = Math.sqrt(Math.max(1e-9, 1 - qErr.w * qErr.w));
    const errV = new THREE.Vector3(qErr.x / s, qErr.y / s, qErr.z / s).multiplyScalar(angle > 1e-4 ? angle : 0);
    // Asymmetric support (lost/limping legs) tilts the body: reduce levelling authority
    const balance = working.length >= 2 ? 1 : 0.05;
    const pi = body.principalInertia();
    const I = (pi.x + pi.y + pi.z) / 3;
    const tq = errV.multiplyScalar(9 * balance).sub(ang.clone().multiplyScalar(4.5)).multiplyScalar(I);
    const maxT = (authorityLegs + 50) * 1.3 * balance + mass * 0.5;
    if (tq.length() > maxT) tq.setLength(maxT);
    if (!this.fallen || this.fallTime < 0.3) body.applyTorqueImpulse({ x: tq.x * dt, y: tq.y * dt, z: tq.z * dt }, true);

    // ---- jump jets ----
    const jetTime = Math.max(1, ...this.jets.map((j) => j.def.stats.boostTime ?? 2));
    this.jetting = input.vertical > 0.5 && this.jets.length > 0 && this.jumpCharge > 0.02 && m.hasFuel && !this.fallen;
    if (this.jetting) {
      this.jumpCharge = Math.max(0, this.jumpCharge - dt / jetTime);
      for (const j of this.jets) {
        const dir = new THREE.Vector3(0, -1, 0).transformDirection(j.world);
        const f = dir.multiplyScalar((j.def.stats.thrust ?? 10000) * j.efficiency * dt);
        const p = j.worldCenter;
        body.applyImpulseAtPoint({ x: f.x, y: f.y, z: f.z }, { x: p.x, y: p.y, z: p.z }, true);
        m.useFuel(((j.def.stats.fuelUse ?? 3) / 60) * dt);
        m.addHeat((j.def.stats.heat ?? 8) * dt);
      }
      // air control
      const air = vDes.clone().sub(new THREE.Vector3(vel.x, 0, vel.z)).multiplyScalar(mass * 0.8 * dt);
      body.applyImpulse({ x: air.x, y: 0, z: air.z }, true);
    } else if (groundedAny) {
      this.jumpCharge = Math.min(1, this.jumpCharge + dt / (jetTime * 2.5));
    }

    // ---- gait: pick legs to step ----
    const swinging = working.filter((l) => !l.planted);
    const vFlat = new THREE.Vector3(vel.x, 0, vel.z);
    const stepTimeBase = working.length ? working.reduce((s2, l) => s2 + (l.part.def.stats.stepTime ?? 0.4), 0) / working.length : 0.4;
    const avgLen = working.length ? working.reduce((s2, l) => s2 + l.thigh + l.shin, 0) / working.length : 2.5;
    // horizontal reach of a foot from under the hip at stance height
    const reachH = Math.sqrt(Math.max(0.2, avgLen * avgLen - (avgLen * 0.84) * (avgLen * 0.84)));
    const vNow = Math.hypot(vel.x, vel.z);
    // Cadence rises with speed so feet never fall behind the hips
    const baseDur = clamp(stepTimeBase / jointSpeed / Math.max(0.35, speedFactor), 0.18, 1.1) * (limpFactor < 1 ? 1.4 : 1);
    const stepDur = clamp(Math.min(baseDur, (reachH * 0.85) / Math.max(0.3, vNow)), 0.16, 1.1);
    for (const l of working) {
      if (!l.planted) continue;
      if (this.fallen) continue;
      const hip = l.hipLocal.clone().applyMatrix4(bodyMat);
      const stride = l.part.def.stats.stride ?? 1.6;
      const home = new THREE.Vector3(hip.x, 0, hip.z).addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(q).setY(0).normalize(), l.side * (l.spider ? 0.9 : 0.12));
      if (l.spider) home.addScaledVector(fwd.clone().setY(0).normalize(), l.front * 0.3);
      const leadLen = Math.min(reachH * 0.75, vFlat.length() * stepDur * 1.0);
      const lead = vFlat.clone().setLength(leadLen);
      const target = home.clone().add(lead);
      const dist = new THREE.Vector2(l.footPos.x - target.x, l.footPos.z - target.z).length();
      const reach = l.thigh + l.shin;
      const overExt = hip.distanceTo(l.footPos) > reach * 0.95;
      const threshold = Math.max(0.22, Math.min(stride * 0.45, reachH * 0.55) * (vFlat.length() < 0.3 ? 0.6 : 1));
      if (dist < threshold && !overExt) continue;
      // Only step when no leg of another gait group is in the air
      const otherSwinging = swinging.some((o) => o.group !== l.group);
      const sameGroupPlanted = working.filter((o) => o.group === l.group && o !== l);
      if (otherSwinging) continue;
      if (working.length <= 2 && swinging.length > 0) continue;
      void sameGroupPlanted;
      const n = new THREE.Vector3();
      const gy = this.groundAt(target.x, target.z, hip.y + 1.5, n);
      l.planted = false;
      l.swingT = 0;
      l.swingDur = stepDur;
      l.swingFrom.copy(l.footPos);
      l.swingTo.set(target.x, gy, target.z);
      l.swingToNormal.copy(n);
      l.lift = clamp(stride * 0.22 + Math.max(0, gy - l.footPos.y) * 1.1, 0.2, 1.4);
      swinging.push(l);
    }
    // advance swings
    for (const l of this.legs) {
      if (l.planted) continue;
      if (!l.functional) {
        // dead leg dangles under the hip
        const hip = l.hipLocal.clone().applyMatrix4(bodyMat);
        l.footPos.lerp(hip.clone().add(new THREE.Vector3(0, -(l.thigh + l.shin) * 0.9, 0)), 1 - Math.exp(-dt * 3));
        continue;
      }
      if (!groundedAny && !this.fallen && this.jetting) {
        // in the air: tuck legs
        const hip = l.hipLocal.clone().applyMatrix4(bodyMat);
        l.footPos.lerp(hip.clone().add(new THREE.Vector3(0, -(l.thigh + l.shin) * 0.75, 0)).addScaledVector(fwd, 0.2), 1 - Math.exp(-dt * 6));
        const n = new THREE.Vector3();
        const gy = this.groundAt(l.footPos.x, l.footPos.z, l.footPos.y + 1, n);
        if (l.footPos.y - gy < 0.1) this.plant(l, gy, n);
        continue;
      }
      l.swingT += dt / l.swingDur;
      // retarget toward new home while swinging (smooth steering)
      const t = clamp01(l.swingT);
      const e = t * t * (3 - 2 * t);
      l.footPos.lerpVectors(l.swingFrom, l.swingTo, e);
      l.footPos.y += Math.sin(t * Math.PI) * l.lift;
      if (t >= 1) this.plant(l, l.swingTo.y, l.swingToNormal);
    }
    // Airborne without jets: legs extend to land
    if (!groundedAny && !this.jetting) {
      for (const l of working) {
        if (!l.planted) continue;
        const hip = l.hipLocal.clone().applyMatrix4(bodyMat);
        const reach = l.thigh + l.shin;
        if (hip.distanceTo(l.footPos) > reach * 1.02) {
          l.planted = false;
          l.swingT = 0;
          l.swingFrom.copy(l.footPos);
          const n = new THREE.Vector3();
          const gy = this.groundAt(hip.x, hip.z, hip.y + 1, n);
          l.swingTo.set(hip.x, gy, hip.z);
          l.swingToNormal.copy(n);
          l.swingDur = 0.25;
          l.lift = 0.1;
        }
      }
    }

    // ---- arms: pitch toward aim point ----
    const aim = input === m.input ? m.input.aimPoint : null;
    for (const arm of this.arms) {
      if (!arm.functional) continue;
      const sh = arm.nodes.get('shoulder');
      if (!sh || !aim) continue;
      const held = arm.children.reduce((s2, c) => s2 + c.def.mass, 0);
      const rating = (arm.def.stats.loadRating ?? 300) * this.hydro;
      const rate = (arm.def.stats.turnRate ?? 2) * clamp(rating / Math.max(1, held), 0.25, 1.4) * (arm.damageLevel ? 0.7 : 1);
      const inv = new THREE.Matrix4().copy(arm.world).invert();
      const local = aim.clone().applyMatrix4(inv);
      const handSock = arm.def.sockets?.[0]?.pos ?? [0, 0.45, -1.2];
      const d = new THREE.Vector3(local.x, 0, local.z + 0.0 * handSock[2]);
      const target = clamp(Math.atan2(-d.x, -d.z), -1.1, 1.3);
      const cur = this.armPitch.get(arm) ?? 0;
      const next = cur + clamp(wrapAngle(target - cur), -rate * dt, rate * dt);
      this.armPitch.set(arm, next);
      m.demand(12 * Math.min(1, Math.abs(target - cur)));
    }
    m.immobile = working.length < 2;
    this.stepSoundCooldown -= dt;
  }

  private plant(l: Leg, y: number, n: THREE.Vector3) {
    l.planted = true;
    l.footPos.y = y;
    l.footNormal.copy(n);
    const m = this.m;
    const weight = m.mass / Math.max(1, this.legs.length);
    m.ctx.events.emit('footstep', { machine: m, pos: l.footPos.clone(), weight });
    const surf = m.ctx.terrain.surfaceAt(l.footPos.x, l.footPos.z);
    const col: [number, number, number] = surf === 'sand' ? [0.78, 0.64, 0.46] : surf === 'asphalt' ? [0.5, 0.5, 0.5] : [0.62, 0.5, 0.38];
    if (m.ctx.camera.position.distanceTo(l.footPos) < 150) {
      m.ctx.fx.dust(l.footPos.clone().add(new THREE.Vector3(0, 0.15, 0)), Math.min(5, 1 + weight / 800), col, undefined, 0.5 + Math.min(1.2, weight / 2500));
      if (weight > 1500) m.ctx.fx.impact(l.footPos, n, surf === 'sand' ? 'sand' : 'dirt', 0.6);
    }
    m.ctx.audio.play(weight > 2500 ? 'stompHeavy' : 'stomp', l.footPos, { volume: Math.min(1, 0.35 + weight / 4000), pitch: clamp(1.4 - weight / 5000, 0.6, 1.3) });
  }

  selfRight() {
    const m = this.m;
    if (!this.fallen || this.legs.filter((l) => l.functional).length < 2) return false;
    const up = m.up();
    const axis = new THREE.Vector3().crossVectors(up, UP).normalize();
    m.body.applyImpulse({ x: 0, y: m.mass * 6, z: 0 }, true);
    m.body.applyTorqueImpulse({ x: axis.x * m.mass * 7, y: 0, z: axis.z * m.mass * 7 }, true);
    for (const l of this.legs) l.initialised = false;
    return true;
  }

  update(dt: number) {
    const m = this.m;
    m.root.updateMatrixWorld(true);
    const fwdW = new THREE.Vector3(0, 0, -1).applyQuaternion(m.root.quaternion);
    for (const l of this.legs) {
      if (l.part.detached) continue;
      const hipNode = l.part.nodes.get('hip');
      const kneeNode = l.part.nodes.get('knee');
      const ankleNode = l.part.nodes.get('ankle');
      if (!hipNode || !kneeNode || !ankleNode) continue;
      hipNode.parent!.updateMatrixWorld(true);
      const hipW = new THREE.Vector3().setFromMatrixPosition(hipNode.matrixWorld);
      const ankleTarget = l.footPos.clone().add(new THREE.Vector3(0, 0.25, 0));
      const T = l.thigh;
      const S = l.shin;
      const d = ankleTarget.clone().sub(hipW);
      let dist = d.length();
      dist = clamp(dist, Math.abs(T - S) + 0.05, T + S - 0.001);
      const dn = d.clone().normalize();
      // bend pole
      let pole: THREE.Vector3;
      if (l.spider) pole = new THREE.Vector3(0, 1, 0).addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(m.root.quaternion), l.side * 0.6);
      else pole = fwdW.clone().multiplyScalar(l.digitigrade ? -1 : 1);
      pole.addScaledVector(dn, -pole.dot(dn)).normalize();
      const cosA = clamp((T * T + dist * dist - S * S) / (2 * T * dist), -1, 1);
      const a = Math.acos(cosA);
      const kneeW = hipW.clone().addScaledVector(dn, Math.cos(a) * T).addScaledVector(pole, Math.sin(a) * T);
      const ankleW = hipW.clone().addScaledVector(dn, dist);
      // hip: local +Y toward knee
      const hipParentInv = new THREE.Matrix4().copy(hipNode.parent!.matrixWorld).invert();
      const toKnee = kneeW.clone().sub(hipW).normalize().transformDirection(hipParentInv);
      hipNode.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toKnee);
      hipNode.updateMatrixWorld(true);
      const kneeParentInv = new THREE.Matrix4().copy(hipNode.matrixWorld).invert();
      const toAnkle = ankleW.clone().sub(kneeW).normalize().transformDirection(kneeParentInv);
      kneeNode.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toAnkle);
      kneeNode.updateMatrixWorld(true);
      // ankle: foot flat on the ground normal, toes forward
      const ankleParentInv = new THREE.Matrix4().copy(kneeNode.matrixWorld).invert();
      const n = l.planted ? l.footNormal : new THREE.Vector3(0, 1, 0);
      const upL = n.clone().transformDirection(ankleParentInv);
      const fwdL = fwdW.clone().transformDirection(ankleParentInv);
      const z = fwdL.clone().negate();
      z.addScaledVector(upL, -z.dot(upL)).normalize();
      const x = new THREE.Vector3().crossVectors(upL, z).normalize();
      const basis = new THREE.Matrix4().makeBasis(x, upL, z);
      ankleNode.quaternion.setFromRotationMatrix(basis);
    }
    // Arms
    for (const arm of this.arms) {
      const sh = arm.nodes.get('shoulder');
      if (!sh) continue;
      const target = this.armPitch.get(arm) ?? 0;
      sh.rotation.y = lerp(sh.rotation.y, target, 1 - Math.exp(-dt * 20));
    }
    // Jet flames
    if (this.jetting) {
      for (const j of this.jets) {
        for (const [name, node] of j.nodes) {
          if (!name.startsWith('nozzle')) continue;
          const p = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
          const dir = new THREE.Vector3(0, 1, 0).transformDirection(j.world);
          m.ctx.fx.glow(p, 0.6, [4, 2, 0.6], 0.07, dir.clone().multiplyScalar(8).add(m.velocity));
          if (rand() < 0.4) m.ctx.fx.smoke(p.clone().addScaledVector(dir, 0.5), dir.clone().multiplyScalar(6), 0.4, 1.2, [0.5, 0.48, 0.45], 0.45, 4);
        }
      }
    }
  }

  telemetry(): Telemetry {
    const m = this.m;
    const warnings: string[] = [];
    const broken = this.legs.filter((l) => !l.functional).length;
    if (broken) warnings.push(`${broken} LEG${broken > 1 ? 'S' : ''} DOWN`);
    if (this.legs.some((l) => l.limp)) warnings.push('JOINT DAMAGE — LIMPING');
    if (this.fallen) warnings.push('FALLEN — HOLD [R] TO STAND');
    if (m.powerRatio < 0.8) warnings.push('POWER DEFICIT');
    return {
      speed: new THREE.Vector3(m.velocity.x, 0, m.velocity.z).length(),
      grounded: this.grounded,
      boost: this.jets.length ? this.jumpCharge : undefined,
      throttle: Math.min(1, Math.abs(m.input.throttle) + Math.abs(m.input.strafe)),
      warnings,
    };
  }
}

export { smoothstep, randRange };
