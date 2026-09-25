/**
 * Ground vehicle physics: raycast suspension per physical wheel/track, slip-based tyre
 * forces with surface-dependent grip, engine torque curve, automatic gearbox, anti-roll bars.
 */
import * as THREE from 'three';
import type { Machine } from '../machine';
import type { PartRuntime } from '../part';
import type { Controller, Telemetry } from './controller';
import { COLLIDE, GRAVITY } from '../../physics/physics';
import { clamp, clamp01, lerp, smoothstep } from '../../core/math';
import { rand, randRange } from '../../core/random';
import type { Surface } from '../../world/heightfield';

interface Contact {
  // Suspension geometry (machine space)
  top: THREE.Vector3; // ray origin at full compression
  outward: THREE.Vector3;
  travel: number;
  radius: number;
  width: number;
  k: number;
  c: number;
  // state
  compression: number;
  prevCompression: number;
  grounded: boolean;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  surface: Surface;
  load: number;
  slip: number;
  spin: number; // wheel angle
  omega: number;
  vLong: number;
  vLat: number;
  // parts
  wheel: PartRuntime | null;
  sus: PartRuntime | null;
  track: PartRuntime | null;
  steer: boolean;
  side: number;
  axleKey: string;
  drive: boolean;
  visualCenter: THREE.Vector3; // smoothed world wheel center
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

function surfaceGrip(p: PartRuntime | null, s: Surface) {
  const st = p?.def.stats ?? {};
  const base = st.grip ?? 1;
  switch (s) {
    case 'asphalt':
    case 'packed':
      return base * (st.roadGrip ?? 1);
    case 'sand':
      return base * (st.sandGrip ?? 0.8);
    case 'rock':
      return base * (st.rockGrip ?? 0.95);
    case 'gravel':
      return base * 0.92;
    default:
      return base * 0.97;
  }
}

export class GroundController implements Controller {
  m: Machine;
  contacts: Contact[] = [];
  engines: PartRuntime[] = [];
  transmission: PartRuntime | null = null;
  boosters: PartRuntime[] = [];
  gyros: PartRuntime[] = [];
  gear = 1;
  rpm = 900;
  shiftTimer = 0;
  steerAngle = 0;
  throttleSmoothed = 0;
  boostCharge = 1;
  boosting = false;
  airTime = 0;
  upsideDownTime = 0;
  wheelDustTimer = 0;
  exhaustTimer = 0;
  private omni = false;
  private rideDrop = 0;
  flipCooldown = 0;

  constructor(m: Machine) {
    this.m = m;
    this.rebuild();
  }

  rebuild() {
    const m = this.m;
    this.contacts = [];
    this.engines = m.parts.filter((p) => p.def.category === 'engine' && p.functional);
    this.transmission = m.parts.find((p) => p.def.category === 'transmission' && p.functional) ?? null;
    this.boosters = m.parts.filter((p) => p.def.category === 'booster' && p.functional);
    this.gyros = m.parts.filter((p) => p.def.category === 'stabilizer' && p.functional);
    this.omni = false;
    for (const sus of m.parts.filter((p) => p.def.category === 'suspension' && !p.detached)) {
      const wheel = sus.children.find((c) => c.def.category === 'wheel') ?? null;
      const socket = sus.layout.socket!;
      const hubLay = wheel?.layout;
      // knuckle rest (machine space) = hub socket position
      const hubSock = sus.def.sockets?.find((s) => s.id === 'hub');
      const knuckleLocal = new THREE.Vector3(...(hubSock?.pos ?? [0, 0.3, 0]));
      const knuckle = knuckleLocal.applyMatrix4(sus.layout.matrix);
      const outward = new THREE.Vector3(Math.sign(socket.pos[0]) || 1, 0, 0);
      const width = wheel?.def.stats.width ?? 0.3;
      const radius = wheel ? wheel.def.stats.radius ?? 0.4 : 0.12;
      const center = knuckle.clone().addScaledVector(outward, wheel ? width / 2 : 0);
      const travel = sus.def.stats.travel ?? 0.3;
      if (wheel?.def.special?.includes('omni') && wheel.functional) this.omni = true;
      this.contacts.push(this.makeContact(center, outward, travel, radius, width, sus.def.stats.stiffness ?? 30000, sus.def.stats.damping ?? 2600, wheel, sus, null, !!socket.steer, socket.side ?? 1, socket.id.replace(/_[rl]$/, '')));
      void hubLay;
    }
    for (const track of m.parts.filter((p) => p.def.category === 'track' && !p.detached)) {
      const socket = track.layout.socket!;
      const L = track.def.stats.trackLength ?? 3.8;
      const r = track.def.stats.radius ?? 0.38;
      const w = track.def.stats.width ?? 0.5;
      const outward = new THREE.Vector3(Math.sign(socket.pos[0]) || 1, 0, 0);
      const base = new THREE.Vector3(...socket.pos).addScaledVector(outward, w / 2 + 0.05);
      const n = 5;
      for (let i = 0; i < n; i++) {
        const z = -L / 2 + (i / (n - 1)) * L * 0.92 + L * 0.04;
        const center = base.clone().add(new THREE.Vector3(0, -0.05, z));
        this.contacts.push(this.makeContact(center, outward, track.def.stats.travel ?? 0.22, r * 0.9, w, (track.def.stats.stiffness ?? 90000) / n * 1.4, (track.def.stats.damping ?? 8000) / n * 1.4, null, null, track, false, socket.side ?? 1, `track_${socket.side}`));
      }
    }
    this.rideDrop = 0;
  }

  private makeContact(center: THREE.Vector3, outward: THREE.Vector3, travel: number, radius: number, width: number, k: number, c: number, wheel: PartRuntime | null, sus: PartRuntime | null, track: PartRuntime | null, steer: boolean, side: number, axleKey: string): Contact {
    return {
      top: center.clone().add(new THREE.Vector3(0, travel * 0.35, 0)),
      outward,
      travel,
      radius,
      width,
      k,
      c,
      compression: travel * 0.4,
      prevCompression: travel * 0.4,
      grounded: false,
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0),
      surface: 'dirt',
      load: 0,
      slip: 0,
      spin: 0,
      omega: 0,
      vLong: 0,
      vLat: 0,
      wheel,
      sus,
      track,
      steer,
      side,
      axleKey,
      drive: true,
      visualCenter: new THREE.Vector3(),
    };
  }

  onPartChanged(_p: PartRuntime) {
    // Preserve dynamic state where possible
    const old = this.contacts;
    this.rebuild();
    for (const c of this.contacts) {
      const prev = old.find((o) => o.wheel === c.wheel && o.sus === c.sus && o.track === c.track && o.top.distanceTo(c.top) < 0.01);
      if (prev) {
        c.compression = prev.compression;
        c.spin = prev.spin;
        c.visualCenter.copy(prev.visualCenter);
      }
    }
  }

  alternatorPower() {
    if (!this.m.alive) return 0;
    let p = 0;
    for (const e of this.engines) {
      if (!e.functional) continue;
      const electric = e.def.special?.includes('electric drive');
      if (electric) continue;
      if (!this.m.hasFuel) continue;
      p += (e.def.stats.powerGen ?? 0) * e.efficiency * clamp01(this.rpm / ((e.def.stats.maxRpm ?? 6000) * 0.4));
    }
    return p;
  }

  private torqueAt(rpm: number, throttle: number) {
    let total = 0;
    let maxRpm = 0;
    for (const e of this.engines) {
      if (!e.functional) continue;
      const s = e.def.stats;
      const electric = e.def.special?.includes('electric drive');
      const mr = s.maxRpm ?? 6000;
      maxRpm = Math.max(maxRpm, mr);
      if (!electric && !this.m.hasFuel) continue;
      const x = rpm / mr;
      let curve: number;
      if (electric) curve = x < 0.7 ? 1 : lerp(1, 0.55, (x - 0.7) / 0.3);
      else if (e.def.special?.includes('turbine')) curve = 0.55 + 0.45 * smoothstep(0.25, 0.7, x) - 0.2 * smoothstep(0.9, 1.05, x);
      else if (e.def.special?.includes('diesel')) curve = 0.75 + 0.25 * smoothstep(0.1, 0.4, x) - 0.35 * smoothstep(0.75, 1.0, x);
      else curve = 0.55 + 0.45 * Math.sin(clamp(x, 0, 1) * Math.PI * 0.9 + 0.1);
      let t = (s.torque ?? 0) * curve * e.efficiency;
      if (electric) {
        const draw = (s.powerDraw ?? 0) * Math.abs(throttle);
        this.m.demand(draw);
        t *= this.m.powerRatio;
      } else {
        this.m.useFuel(((s.fuelUse ?? 0) / 60) * (0.15 + 0.85 * Math.abs(throttle)) * (1 / 60));
        this.m.addHeat((s.heat ?? 0) * (0.2 + 0.8 * Math.abs(throttle)) * (1 / 60));
      }
      total += t;
    }
    if (this.m.overheated) total *= 0.5;
    return { torque: total, maxRpm: maxRpm || 6000 };
  }

  fixedUpdate(dt: number) {
    const m = this.m;
    const body = m.body;
    const input = m.alive ? m.input : { throttle: 0, steer: 0, brake: 1, boost: false, strafe: 0 };
    const q = m.currQuat;
    const pos = m.currPos;
    const up = _a.set(0, 1, 0).applyQuaternion(q).clone();
    const fwd = _b.set(0, 0, -1).applyQuaternion(q).clone();
    const right = _c.set(1, 0, 0).applyQuaternion(q).clone();
    const vel = m.velocity;
    const speedFwd = vel.dot(fwd);
    const speed = vel.length();

    // ---- steering ----
    const maxSteer = lerp(0.62, 0.2, clamp01(Math.abs(speedFwd) / 38));
    const crab = this.omni && input.brake > 0.5;
    const targetSteer = crab ? 0 : -input.steer * maxSteer;
    this.steerAngle += clamp(targetSteer - this.steerAngle, -3.5 * dt, 3.5 * dt);

    // ---- throttle / reverse logic ----
    let throttle = input.throttle;
    let brake = 0;
    const handbrake = crab ? 0 : input.brake;
    if (throttle < 0 && speedFwd > 1.5) {
      brake = -throttle;
      throttle = 0;
    } else if (throttle > 0 && speedFwd < -1.5) {
      brake = throttle;
      throttle = 0;
    }
    const reversing = throttle < 0 || (speedFwd < -0.5 && throttle <= 0);
    this.throttleSmoothed = lerp(this.throttleSmoothed, Math.abs(throttle), 1 - Math.exp(-dt * 8));

    // ---- gearbox ----
    const trans = this.transmission?.functional ? this.transmission : null;
    const gears = trans?.def.stats.gears ?? [1.3];
    const fd = trans?.def.stats.finalDrive ?? 3.4;
    const eff = trans?.def.stats.efficiency ?? 0.75;
    const shiftTime = trans?.def.stats.shiftTime ?? 0.3;
    const grounded = this.contacts.filter((c) => c.grounded);
    const drivenOmega = grounded.length ? grounded.reduce((s, c) => s + c.omega, 0) / grounded.length : this.contacts.reduce((s, c) => s + c.omega, 0) / Math.max(1, this.contacts.length);
    const g = reversing ? 1 : clamp(this.gear, 1, gears.length);
    const ratio = gears[g - 1] * fd;
    const idle = this.engines[0]?.def.stats.idleRpm ?? 900;
    const { maxRpm } = this.torqueAt(this.rpm, 0);
    const wheelRpm = (Math.abs(drivenOmega) * 60) / (Math.PI * 2);
    let targetRpm = Math.max(idle, wheelRpm * ratio);
    // clutch slip at low speed lets revs rise with throttle
    const slipRpm = idle + this.throttleSmoothed * maxRpm * 0.55;
    if (Math.abs(speedFwd) < 4 || grounded.length === 0) targetRpm = Math.max(targetRpm, slipRpm);
    targetRpm = Math.min(targetRpm, maxRpm * 1.02);
    this.rpm = lerp(this.rpm, targetRpm, 1 - Math.exp(-dt * 12));
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    else if (!reversing && trans) {
      if (this.rpm > maxRpm * 0.9 && this.gear < gears.length && throttle > 0.1) {
        this.gear++;
        this.shiftTimer = shiftTime;
        this.onShift();
      } else if (this.rpm < maxRpm * 0.42 && this.gear > 1) {
        this.gear--;
        this.shiftTimer = shiftTime * 0.6;
      }
    }
    if (Math.abs(speedFwd) < 1 && throttle <= 0) this.gear = 1;

    // ---- boost ----
    const nitro = this.boosters.filter((b) => b.functional && b.def.special?.includes('nitro'));
    const rockets = this.boosters.filter((b) => b.functional && !b.def.special?.includes('nitro'));
    this.boosting = !!input.boost && this.boostCharge > 0.02 && (nitro.length > 0 || rockets.length > 0);
    const boostTime = Math.max(1, ...this.boosters.map((b) => b.def.stats.boostTime ?? 4));
    if (this.boosting) this.boostCharge = Math.max(0, this.boostCharge - dt / boostTime);
    else this.boostCharge = Math.min(1, this.boostCharge + dt / (boostTime * 4));

    let { torque } = this.torqueAt(this.rpm, throttle);
    if (this.rpm >= maxRpm * 1.0) torque *= 0.2; // limiter
    if (this.shiftTimer > 0) torque *= 0.15;
    if (this.boosting && nitro.length) torque *= 1 + nitro.reduce((s, b) => s + (b.def.stats.torque ?? 0.7), 0);
    const driveTorque = torque * Math.abs(throttle) * ratio * eff * (reversing ? -0.7 : 1) * Math.sign(throttle || (reversing ? -1 : 0));

    // ---- suspension & tyres ----
    const physics = m.ctx.physics;
    const mPerContact = m.mass / Math.max(1, this.contacts.length);
    const trackContacts = this.contacts.filter((c) => c.track).length;
    const driveContacts = Math.max(1, grounded.length);
    let anyGrounded = false;
    // anti-roll per axle
    const axleComp = new Map<string, { l: number; r: number }>();
    for (const c of this.contacts) {
      const e = axleComp.get(c.axleKey) ?? { l: 0, r: 0 };
      if (c.side < 0) e.l = c.compression / c.travel;
      else e.r = c.compression / c.travel;
      axleComp.set(c.axleKey, e);
    }
    const bodyMat = _m.compose(pos, q, new THREE.Vector3(1, 1, 1));
    const active = m.parts.some((p) => p.def.special?.includes('self-leveling') && p.functional);
    for (const c of this.contacts) {
      const susEff = c.sus ? (c.sus.functional ? c.sus.efficiency : 0.25) : c.track ? (c.track.functional ? c.track.efficiency : 0) : 1;
      if (c.track && !c.track.functional) {
        c.grounded = false;
        continue;
      }
      const wheelGone = c.wheel ? !c.wheel.functional && c.wheel.detached : false;
      const wheelWrecked = c.wheel ? c.wheel.destroyed && !c.wheel.detached : false;
      const runflat = c.wheel?.def.special?.includes('run-flat');
      let radius = c.radius;
      if (wheelGone) radius = 0.1;
      else if (wheelWrecked && !runflat) radius = c.radius * 0.72;
      const origin = c.top.clone().applyMatrix4(bodyMat);
      const down = up.clone().negate();
      const maxLen = c.travel + radius;
      const hit = physics.castRayInto(origin, down, maxLen + 0.05, _n, COLLIDE.qWorldAndMachines, body);
      c.prevCompression = c.compression;
      if (hit.d >= 0 && hit.d <= maxLen) {
        c.grounded = true;
        anyGrounded = true;
        c.compression = clamp(maxLen - hit.d, 0, c.travel);
        c.point.copy(origin).addScaledVector(down, hit.d);
        c.normal.copy(_n);
        const owner = hit.collider ? physics.owners.get(hit.collider.handle) : null;
        c.surface = owner === 'terrain' ? m.ctx.terrain.surfaceAt(c.point.x, c.point.z) : 'asphalt';
      } else {
        c.grounded = false;
        c.compression = Math.max(0, c.compression - dt * 3);
        c.load = 0;
        c.omega *= 0.995;
        continue;
      }
      // Spring + damper along the body up axis
      const compVel = (c.compression - c.prevCompression) / dt;
      let fSpring = c.k * susEff * c.compression + c.c * susEff * compVel;
      // bump stop
      if (c.compression > c.travel * 0.95) fSpring += (c.compression - c.travel * 0.95) * c.k * 8;
      const axle = axleComp.get(c.axleKey);
      if (axle && !c.track) {
        const diff = c.side < 0 ? axle.l - axle.r : axle.r - axle.l;
        fSpring += diff * c.k * c.travel * (active ? 1.6 : 0.55);
      }
      fSpring = Math.max(0, fSpring);
      c.load = fSpring;
      // Contact frame
      const n = c.normal;
      const steerQ = _q.setFromAxisAngle(up, c.steer ? this.steerAngle : 0);
      const wf = fwd.clone().applyQuaternion(steerQ);
      wf.addScaledVector(n, -wf.dot(n)).normalize();
      const ws = new THREE.Vector3().crossVectors(wf, n).normalize(); // right-ish
      const r = c.point.clone().sub(m.worldCom);
      const angv = m.angVel;
      const pv = vel.clone().add(new THREE.Vector3().crossVectors(angv, r));
      c.vLong = pv.dot(wf);
      c.vLat = pv.dot(ws);
      // Grip
      let mu = surfaceGrip(c.wheel ?? c.track, c.surface);
      if (wheelGone) mu = 0.45;
      else if (wheelWrecked) mu *= runflat ? 0.75 : 0.35;
      else if (c.wheel) mu *= 0.7 + 0.3 * c.wheel.efficiency;
      const wet = m.ctx.env ? (m.ctx.env.current.rain > 0.3 ? 0.85 : 1) : 1;
      mu *= wet;
      const Fz = c.load;
      // Lateral: slip curve with low-speed velocity cancelling
      const slipAngle = Math.atan2(c.vLat, Math.max(Math.abs(c.vLong), 2.5));
      let latGrip = mu * Fz * Math.sin(1.35 * Math.atan(slipAngle * 9));
      const lowSpeed = clamp01(1 - Math.abs(c.vLong) / 5);
      const cancel = clamp((c.vLat * mPerContact) / dt, -mu * Fz, mu * Fz);
      let Fy = -lerp(latGrip, cancel, lowSpeed * 0.8);
      const isRear = !c.steer && !c.track;
      if (handbrake > 0 && isRear) Fy *= 0.45;
      if (c.track) Fy *= 1.15;
      // Longitudinal
      let Fx = 0;
      if (c.drive && !wheelGone) {
        let wheelTorque = driveTorque / driveContacts;
        if (c.track) {
          // skid steer: differential between sides
          const steerMix = -input.steer * (Math.abs(throttle) > 0.05 ? 0.6 : 1.0);
          const sideFactor = 1 + steerMix * c.side * (Math.abs(throttle) > 0.05 ? 1 : 0);
          const pivot = Math.abs(throttle) < 0.05 ? c.side * -input.steer * torque * 2.2 * (gears[0] * fd) / Math.max(1, trackContacts) : 0;
          wheelTorque = wheelTorque * sideFactor + pivot;
        }
        Fx = wheelTorque / Math.max(0.1, radius);
      }
      // Rolling resistance and brakes
      const rr = (c.wheel ?? c.track)?.def.stats.rollResist ?? 0.02;
      const sandDrag = c.surface === 'sand' ? 2.2 : 1;
      Fx -= Math.sign(c.vLong) * Math.min(Math.abs(c.vLong) * mPerContact / dt, Fz * rr * sandDrag);
      const brakeAmt = Math.max(brake, isRear || c.track ? handbrake : 0, !m.alive ? 1 : 0, throttle === 0 && Math.abs(speedFwd) < 1.2 && !input.steer ? 0.6 : 0);
      if (brakeAmt > 0) {
        const bf = brakeAmt * mu * Fz * 1.1;
        Fx -= clamp((c.vLong * mPerContact) / dt, -bf, bf);
      }
      // Omni wheels: strafe with lateral drive, weak lateral grip
      if (crab && c.wheel && input.strafe) {
        Fy = input.strafe * mu * Fz * 0.75 - c.vLat * mPerContact * 0.5;
      }
      // Friction circle
      const maxF = mu * Fz;
      const tot = Math.hypot(Fx, Fy);
      c.slip = 0;
      if (tot > maxF && tot > 0) {
        const sc = maxF / tot;
        c.slip = clamp01(tot / maxF - 1);
        Fx *= sc;
        Fy *= sc;
      }
      // Wheel angular velocity for visuals / rpm (wheelspin when drive exceeds traction)
      const rollOmega = c.vLong / Math.max(0.1, radius);
      const spinBoost = c.drive && Math.abs(driveTorque) > 0 && c.slip > 0.05 ? Math.sign(driveTorque) * c.slip * 25 : 0;
      c.omega = lerp(c.omega, rollOmega + spinBoost, 0.5);
      // Apply forces: suspension at the top point, tyre forces slightly raised (reduces roll-over)
      const suspImpulse = up.clone().multiplyScalar(fSpring * dt);
      body.applyImpulseAtPoint({ x: suspImpulse.x, y: suspImpulse.y, z: suspImpulse.z }, { x: c.point.x, y: c.point.y, z: c.point.z }, true);
      const comH = m.worldCom.clone().sub(c.point).dot(up);
      const apply = c.point.clone().addScaledVector(up, comH * 0.38);
      const tyre = wf.multiplyScalar(Fx).add(ws.multiplyScalar(Fy)).multiplyScalar(dt);
      body.applyImpulseAtPoint({ x: tyre.x, y: tyre.y, z: tyre.z }, { x: apply.x, y: apply.y, z: apply.z }, true);
    }

    // ---- rocket boosters (any direction, at their mount point) ----
    if (this.boosting && rockets.length) {
      for (const b of rockets) {
        const dir = new THREE.Vector3(0, -1, 0).transformDirection(b.world);
        const f = dir.multiplyScalar((b.def.stats.thrust ?? 10000) * b.efficiency * dt);
        const p = b.worldCenter;
        body.applyImpulseAtPoint({ x: f.x, y: f.y, z: f.z }, { x: p.x, y: p.y, z: p.z }, true);
        m.addHeat((b.def.stats.heat ?? 10) * dt);
      }
    }

    // ---- aero drag & downforce ----
    const size = m.stats.bounds.getSize(new THREE.Vector3());
    const frontal = Math.max(1.2, size.x * size.y * 0.75);
    const dragK = 0.5 * 1.2 * 0.42 * frontal;
    const drag = vel.clone().multiplyScalar(-dragK * speed * dt);
    body.applyImpulse({ x: drag.x, y: drag.y, z: drag.z }, true);
    if (anyGrounded) {
      const down = up.clone().multiplyScalar(-0.35 * speed * speed * dt * (m.mass / 1000));
      body.applyImpulse({ x: down.x, y: down.y, z: down.z }, true);
    }

    // ---- airborne attitude control & gyros ----
    if (!anyGrounded) this.airTime += dt;
    else this.airTime = 0;
    const gyroAuth = this.gyros.reduce((s, g) => s + (g.def.stats.torqueAuthority ?? 0) * g.efficiency, 0);
    if (gyroAuth > 0) m.demand(this.gyros.reduce((s, g) => s + (g.def.stats.powerDraw ?? 0), 0) * 0.5);
    if (this.airTime > 0.15 && m.alive) {
      const authority = (m.mass * 1.2 + gyroAuth * 1.5) * m.powerRatio;
      const pitch = input.throttle;
      const roll = -input.steer;
      const t = right.clone().multiplyScalar(-pitch * authority * 0.6).add(fwd.clone().multiplyScalar(roll * authority * 0.5));
      // gyros also self-level a little
      if (gyroAuth > 0) {
        const err = new THREE.Vector3().crossVectors(up, UP);
        t.addScaledVector(err, gyroAuth * 0.8);
        t.addScaledVector(m.angVel, -gyroAuth * 0.25);
      }
      body.applyTorqueImpulse({ x: t.x * dt, y: t.y * dt, z: t.z * dt }, true);
    }

    // ---- upside-down detection ----
    if (up.y < 0.25 && speed < 3) this.upsideDownTime += dt;
    else this.upsideDownTime = 0;
    if (this.flipCooldown > 0) this.flipCooldown -= dt;
    m.immobile = !this.engines.some((e) => e.functional) || this.contacts.filter((c) => c.wheel?.functional || c.track?.functional).length < 2;

    // Engine-derived telemetry smoothing
    void trackContacts;
  }

  private onShift() {
    // backfire flames from exhausts on upshift
    for (const e of this.engines) {
      for (const [name, node] of e.nodes) {
        if (!name.startsWith('exhaust')) continue;
        const p = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
        this.m.ctx.fx.glow(p, 0.35, [4, 1.8, 0.4], 0.08);
        if (rand() < 0.6) this.m.ctx.audio.play('backfire', p, { volume: 0.5 });
      }
    }
  }

  selfRight() {
    if (this.flipCooldown > 0) return false;
    const m = this.m;
    const up = m.up();
    if (up.y > 0.6) return false;
    this.flipCooldown = 3;
    const axis = new THREE.Vector3().crossVectors(up, UP).normalize();
    const I = m.mass * 2.2;
    m.body.applyImpulse({ x: 0, y: m.mass * 5, z: 0 }, true);
    m.body.applyTorqueImpulse({ x: axis.x * I * 3, y: axis.y * I * 3, z: axis.z * I * 3 }, true);
    return true;
  }

  update(dt: number) {
    const m = this.m;
    // Wheels & suspension visuals
    const q = m.root.quaternion;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const bodyMat = m.root.matrixWorld;
    for (const c of this.contacts) {
      c.spin += c.omega * dt;
      if (c.track) continue;
      if (!c.sus || c.sus.detached) continue;
      const knuckle = c.sus.nodes.get('knuckle');
      if (!knuckle || !knuckle.parent) continue;
      // Wheel centre from compression
      const ext = c.travel - c.compression; // extension
      const center = c.top.clone().applyMatrix4(bodyMat).addScaledVector(up, -(ext + c.travel * 0.0));
      const hubWorld = center.clone().addScaledVector(c.outward.clone().transformDirection(bodyMat), -(c.wheel ? c.width / 2 : 0));
      if (c.visualCenter.lengthSq() === 0) c.visualCenter.copy(hubWorld);
      c.visualCenter.lerp(hubWorld, 1 - Math.exp(-dt * 40));
      knuckle.parent.updateMatrixWorld(true);
      const local = knuckle.parent.worldToLocal(c.visualCenter.clone());
      knuckle.position.copy(local);
      // steering: rotate around vehicle up expressed in knuckle parent space
      const parentQ = knuckle.parent.getWorldQuaternion(new THREE.Quaternion());
      const steerQ = new THREE.Quaternion().setFromAxisAngle(up, c.steer ? this.steerAngle : 0);
      const restQ = knuckle.userData.restQ ?? (knuckle.userData.restQ = knuckle.quaternion.clone());
      const worldRest = parentQ.clone().multiply(restQ);
      knuckle.quaternion.copy(parentQ.clone().invert().multiply(steerQ).multiply(worldRest));
      // arms aim at the knuckle
      for (const armName of ['arm_upper', 'arm_lower']) {
        const arm = c.sus.nodes.get(armName);
        if (!arm) continue;
        const restPos = arm.userData.restPos ?? (arm.userData.restPos = arm.position.clone());
        const dir = local.clone().sub(restPos);
        const restDir = arm.userData.restDir ?? (arm.userData.restDir = new THREE.Vector3(0, 1, 0));
        arm.quaternion.setFromUnitVectors(restDir, dir.clone().normalize());
        arm.scale.set(1, dir.length() / Math.max(0.05, (arm.userData.restLen ??= restLenFor(c))), 1);
      }
      const shock = c.sus.nodes.get('shock');
      if (shock) {
        const restPos = shock.userData.restPos ?? (shock.userData.restPos = shock.position.clone());
        const target = local.clone().multiplyScalar(0.85);
        const dir = target.clone().sub(restPos);
        shock.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        shock.scale.set(1, dir.length() / 0.36, 1);
      }
      // Wheel spin around its axle (local Y)
      if (c.wheel && !c.wheel.detached) {
        const spin = c.wheel.nodes.get('spin');
        if (spin) spin.rotation.y = -c.spin;
      }
    }
    // Track belts: scroll visual by rotating wheel nodes
    for (const t of m.parts.filter((p) => p.def.category === 'track' && !p.detached)) {
      const side = t.layout.socket?.side ?? 1;
      const cs = this.contacts.filter((c) => c.track === t);
      const omega = cs.length ? cs.reduce((s, c) => s + c.omega, 0) / cs.length : 0;
      const wheels = t.nodes.get('wheels');
      if (wheels) for (const w of wheels.children) w.rotation.x -= omega * dt;
      void side;
    }
    // Steering wheel in cockpit
    for (const p of m.parts) {
      const sw = p.nodes.get('steer');
      if (sw) sw.rotation.z = this.steerAngle * 2.5;
    }
    this.effects(dt);
  }

  private effects(dt: number) {
    const m = this.m;
    const fx = m.ctx.fx;
    this.wheelDustTimer -= dt;
    this.exhaustTimer -= dt;
    const camDist = m.ctx.camera.position.distanceTo(m.currPos);
    if (camDist > 260) return;
    if (this.wheelDustTimer <= 0) {
      this.wheelDustTimer = 0.05;
      for (const c of this.contacts) {
        if (!c.grounded) continue;
        const speed = Math.abs(c.vLong) + Math.abs(c.vLat);
        const slip = c.slip + Math.min(1, Math.abs(c.vLat) / 6);
        const soft = c.surface === 'sand' || c.surface === 'dirt' || c.surface === 'gravel';
        let amount = soft ? speed / 14 + slip * 1.5 : slip * 1.2;
        if (c.track) amount *= 0.4;
        if (amount < 0.15 || rand() > amount) continue;
        const col: [number, number, number] =
          c.surface === 'sand' ? [0.78, 0.63, 0.45] : c.surface === 'asphalt' ? [0.55, 0.55, 0.55] : c.surface === 'rock' ? [0.6, 0.5, 0.42] : [0.6, 0.48, 0.36];
        const v = m.velocity.clone().multiplyScalar(0.2).add(new THREE.Vector3(randRange(-1, 1), randRange(0.5, 1.8), randRange(-1, 1)));
        fx.smoke(c.point.clone().add(new THREE.Vector3(0, 0.2, 0)), v, 0.5 + Math.min(0.8, speed * 0.03), randRange(1.2, 2.6), col, c.surface === 'asphalt' ? 0.45 : 0.42, 3.5);
        if (c.wheel && c.wheel.destroyed && c.surface === 'asphalt') fx.sparks(c.point, new THREE.Vector3(0, 1, 0), 3, 5, 1);
        if (c.sus && (!c.wheel || c.wheel.detached)) fx.sparks(c.point, new THREE.Vector3(0, 1, 0), 5, 7, 1);
      }
    }
    // Exhaust smoke
    if (this.exhaustTimer <= 0) {
      this.exhaustTimer = 0.08;
      const load = this.throttleSmoothed;
      for (const e of this.engines) {
        if (!e.functional) continue;
        for (const [name, node] of e.nodes) {
          if (!name.startsWith('exhaust')) continue;
          if (rand() > 0.3 + load * 0.7) continue;
          const p = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
          const dmg = e.damageLevel;
          const col: [number, number, number] = dmg > 0 ? [0.1, 0.1, 0.1] : [0.42, 0.42, 0.42];
          fx.smoke(p, new THREE.Vector3(randRange(-0.2, 0.2), 0.8, randRange(-0.2, 0.2)).add(m.velocity.clone().multiplyScalar(0.6)), 0.12 + load * 0.15, 0.9 + load, col, 0.18 + load * 0.2 + dmg * 0.2, 4);
        }
      }
      if (this.boosting) {
        for (const b of this.boosters) {
          const nz = b.nodes.get('nozzle');
          const p = nz ? new THREE.Vector3().setFromMatrixPosition(nz.matrixWorld) : b.worldCenter;
          const dir = new THREE.Vector3(0, 1, 0).transformDirection(b.world);
          if (b.def.special?.includes('nitro')) {
            for (const e of this.engines)
              for (const [name, node] of e.nodes) {
                if (!name.startsWith('exhaust')) continue;
                const ep = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
                fx.glow(ep, 0.4, [0.8, 1.4, 4], 0.08, m.velocity.clone().multiplyScalar(0.8));
              }
          } else {
            fx.glow(p, 0.9, [4, 2, 0.6], 0.08, dir.clone().multiplyScalar(6));
            fx.smoke(p, dir.clone().multiplyScalar(6).add(m.velocity.clone().multiplyScalar(0.5)), 0.4, 1.4, [0.5, 0.48, 0.45], 0.5, 4);
          }
        }
      }
    }
  }

  telemetry(): Telemetry {
    const m = this.m;
    const fwd = m.forward();
    const gears = this.transmission?.def.stats.gears ?? [1];
    const reversing = m.velocity.dot(fwd) < -0.5;
    const warnings: string[] = [];
    if (!this.engines.some((e) => e.functional)) warnings.push('ENGINE DESTROYED');
    if (!m.hasFuel && this.engines.some((e) => !e.def.special?.includes('electric drive'))) warnings.push('OUT OF FUEL');
    if (this.contacts.some((c) => c.wheel && c.wheel.detached)) warnings.push('WHEEL LOST');
    if (this.upsideDownTime > 1) warnings.push('FLIPPED — HOLD [R] TO RIGHT');
    return {
      speed: m.velocity.length(),
      rpm: this.rpm,
      maxRpm: Math.max(...this.engines.map((e) => e.def.stats.maxRpm ?? 6000), 1000),
      gear: reversing ? 'R' : `${this.gear}/${gears.length}`,
      throttle: this.throttleSmoothed,
      grounded: this.airTime < 0.2,
      boost: this.boosters.length ? this.boostCharge : undefined,
      warnings,
    };
  }
}

function restLenFor(c: Contact) {
  return c.sus?.def.sockets?.[0]?.pos[1] ?? 0.34;
}

export { GRAVITY };
