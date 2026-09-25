/**
 * Flight physics. Each rotor / jet is an actuator at its real position and direction on the airframe.
 * A flight computer solves a bounded least-squares allocation every step to produce the force and
 * torque the pilot asks for. Off-centre mass, missing rotors, weak thrust or power all emerge naturally.
 */
import * as THREE from 'three';
import type { Machine } from '../machine';
import type { PartRuntime } from '../part';
import type { Controller, Telemetry } from './controller';
import { GRAVITY } from '../../physics/physics';
import { clamp, clamp01, lerp, wrapAngle } from '../../core/math';
import { rand, randRange } from '../../core/random';

interface Thruster {
  part: PartRuntime;
  kind: 'rotor' | 'jet';
  electric: boolean;
  maxThrust: number;
  spin: number;
  reaction: number;
  radius: number;
  cyclic: number;
  gimbal: number;
  tilt: boolean;
  // per-step
  dir: THREE.Vector3;
  pos: THREE.Vector3;
  avail: number;
  u: number;
  angle: number;
  tiltAngle: number;
  strikeTimer: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class AirController implements Controller {
  m: Machine;
  thrusters: Thruster[] = [];
  wings: PartRuntime[] = [];
  fins: PartRuntime[] = [];
  gyros: PartRuntime[] = [];
  brakes: PartRuntime[] = [];
  altitude = 0;
  grounded = true;
  throttleAvg = 0;
  holdAltitude: number | null = null;
  private u: number[] = [];

  constructor(m: Machine) {
    this.m = m;
    this.rebuild();
  }

  rebuild() {
    const m = this.m;
    const prev = this.thrusters;
    this.thrusters = [];
    for (const p of m.parts) {
      if (!p.functional) continue;
      if (p.def.category !== 'rotor' && p.def.category !== 'jet') continue;
      const s = p.def.stats;
      const c = p.layout.bounds.getCenter(new THREE.Vector3());
      // Automatic counter-rotation pattern (diagonal pairs cancel torque)
      const auto = Math.abs(c.x) < 0.25 && Math.abs(c.z) < 0.25 ? s.spin ?? 1 : Math.sign(c.x * c.z) || 1;
      const old = prev.find((t) => t.part === p);
      this.thrusters.push({
        part: p,
        kind: p.def.category === 'rotor' ? 'rotor' : 'jet',
        electric: p.def.category === 'rotor' || (s.powerDraw ?? 0) > 0,
        maxThrust: s.thrust ?? 0,
        spin: auto,
        reaction: s.reaction ?? 0,
        radius: s.radius ?? 0.5,
        cyclic: s.cyclic ?? 0,
        gimbal: s.gimbal ?? 0,
        tilt: !!p.def.special?.includes('tilts forward'),
        dir: new THREE.Vector3(),
        pos: new THREE.Vector3(),
        avail: 0,
        u: old?.u ?? 0,
        angle: old?.angle ?? rand() * 6,
        tiltAngle: old?.tiltAngle ?? 0,
        strikeTimer: 0,
      });
    }
    this.wings = m.parts.filter((p) => p.functional && p.def.category === 'wing');
    this.fins = m.parts.filter((p) => p.functional && p.def.special?.includes('weathervane'));
    this.gyros = m.parts.filter((p) => p.functional && p.def.category === 'stabilizer' && (p.def.stats.torqueAuthority ?? 0) > 0);
    this.brakes = m.parts.filter((p) => p.functional && p.def.category === 'airbrake');
  }

  onPartChanged() {
    this.rebuild();
  }

  telemetry(): Telemetry {
    const m = this.m;
    const warnings: string[] = [];
    const lost = m.parts.filter((p) => (p.def.category === 'rotor' || p.def.category === 'jet') && !p.functional).length;
    if (lost) warnings.push(`${lost} THRUSTER${lost > 1 ? 'S' : ''} LOST`);
    if (m.powerRatio < 0.8) warnings.push('POWER DEFICIT');
    if (!m.hasFuel && this.thrusters.some((t) => !t.electric)) warnings.push('OUT OF FUEL');
    return { speed: m.velocity.length(), altitude: this.altitude, vspeed: m.velocity.y, throttle: this.throttleAvg, grounded: this.grounded, warnings };
  }

  fixedUpdate(dt: number) {
    const m = this.m;
    const body = m.body;
    const q = m.currQuat;
    const com = m.worldCom;
    const vel = m.velocity;
    const ang = m.angVel;
    const mass = m.mass;
    const g = GRAVITY * m.antiMass;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const ground = m.ctx.terrain.heightAt(com.x, com.z);
    this.altitude = com.y - ground;
    this.grounded = this.altitude < m.boundRadius * 0.5 + 0.8 && Math.abs(vel.y) < 1.5;
    const alive = m.alive;
    const input = m.input;
    const air = 1.0;

    // ---- aero forces from wings, fins, brakes, body drag ----
    const aero = new THREE.Vector3();
    const aeroT = new THREE.Vector3();
    const addForceAt = (f: THREE.Vector3, p: THREE.Vector3) => {
      aero.add(f);
      aeroT.add(_v.copy(p).sub(com).cross(f));
    };
    for (const w of this.wings) {
      if (!w.functional) continue;
      const s = w.def.stats;
      const p = w.worldCenter;
      const pv = vel.clone().add(_w.copy(ang).cross(_v.copy(p).sub(com)));
      const chord = new THREE.Vector3(0, 0, -1).transformDirection(w.world);
      let n = new THREE.Vector3(1, 0, 0).transformDirection(w.world);
      if (n.dot(up) < 0) n.negate();
      const vc = pv.dot(chord);
      const vn = pv.dot(n);
      const vsq = vc * vc + vn * vn;
      if (vsq < 1) continue;
      const alpha = Math.atan2(-vn, Math.max(1, Math.abs(vc))) + 0.06;
      const cl = clamp((s.liftCoef ?? 0.9) * 5.2 * alpha, -1.3, 1.3) * (Math.abs(alpha) > 0.35 ? 0.55 : 1);
      const L = 0.5 * 1.2 * vsq * (s.wingArea ?? 1) * cl * air * w.efficiency;
      const D = 0.5 * 1.2 * vsq * (s.wingArea ?? 1) * ((s.drag ?? 0.05) + 0.06 * cl * cl);
      const dragDir = pv.clone().normalize().negate();
      addForceAt(n.clone().multiplyScalar(L).addScaledVector(dragDir, D), p);
    }
    for (const f of this.fins) {
      const s = f.def.stats;
      const speed = vel.length();
      if (speed < 3) continue;
      const vdir = vel.clone().normalize();
      const t = new THREE.Vector3().crossVectors(fwd, vdir).multiplyScalar(speed * speed * (s.wingArea ?? 0.7) * 0.35);
      aeroT.add(t);
    }
    // parasitic drag
    const size = m.stats.bounds.getSize(new THREE.Vector3());
    const area = Math.max(1, (size.x * size.y + size.z * size.y + size.x * size.z) / 3);
    const brakeOn = this.brakes.length && input.throttle < -0.1;
    const dragK = 0.5 * 1.2 * (0.55 + (brakeOn ? this.brakes.length * 0.9 : 0)) * area * 0.6;
    aero.addScaledVector(vel, -dragK * vel.length());

    // ---- desired motion from pilot input (camera-relative) ----
    const yawTarget = input.yawTarget ?? Math.atan2(-fwd.x, -fwd.z);
    const hf = new THREE.Vector3(-Math.sin(yawTarget), 0, -Math.cos(yawTarget));
    const hr = new THREE.Vector3(-hf.z, 0, hf.x).negate();
    const totalAvail = this.thrusters.reduce((s, t) => s + t.maxThrust * t.part.efficiency, 0);
    const twr = totalAvail / Math.max(1, mass * g);
    const maxSpeed = clamp(18 + (twr - 1) * 22, 12, 48) * (input.boost ? 1.3 : 1);
    const climb = clamp(5 + (twr - 1) * 10, 2, 16);
    const vDes = new THREE.Vector3().addScaledVector(hf, input.throttle * maxSpeed).addScaledVector(hr, input.strafe * maxSpeed * 0.8);
    if (input.vertical !== 0) {
      vDes.y = input.vertical * climb;
      this.holdAltitude = null;
    } else {
      if (this.holdAltitude === null) this.holdAltitude = com.y;
      vDes.y = clamp((this.holdAltitude - com.y) * 1.2, -climb, climb);
    }
    if (!alive) vDes.set(0, -8, 0);
    // Keep clear of terrain ahead
    if (alive && !this.grounded) {
      const ahead = com.clone().addScaledVector(vel, 1.5);
      const hAhead = m.ctx.terrain.heightAt(ahead.x, ahead.z);
      const clearance = ahead.y - hAhead;
      if (clearance < 4 && vDes.y < 3) vDes.y = Math.max(vDes.y, (4 - clearance) * 2);
    }
    const aDes = vDes.clone().sub(vel).multiplyScalar(1.4);
    const aMax = Math.max(2, (twr - 1) * g + 3);
    if (aDes.length() > aMax) aDes.setLength(aMax);
    const Fdes = aDes.clone().add(new THREE.Vector3(0, g, 0)).multiplyScalar(mass).sub(aero);
    if (!alive) Fdes.set(0, 0, 0);

    // ---- thruster geometry this step ----
    for (const t of this.thrusters) {
      const p = t.part;
      if (!p.functional) {
        t.avail = 0;
        continue;
      }
      const tiltNode = t.tilt ? p.nodes.get('tilt') : null;
      if (tiltNode) {
        const fwdSpeed = Math.max(0, vel.dot(fwd));
        t.tiltAngle = lerp(t.tiltAngle, -clamp((fwdSpeed - 10) / 25, 0, 1) * (t.part.def.stats.gimbal ?? 1.2), 1 - Math.exp(-dt * 2));
        tiltNode.rotation.x = t.tiltAngle;
        tiltNode.updateMatrixWorld(true);
        t.dir.set(0, 1, 0).transformDirection(tiltNode.matrixWorld);
      } else {
        t.dir.set(0, t.kind === 'jet' ? -1 : 1, 0).transformDirection(p.world);
      }
      if (t.gimbal > 0) {
        // vector thrusters swing toward the demanded force direction
        const want = Fdes.clone().normalize();
        const a = t.dir.angleTo(want);
        if (a > 1e-3) {
          const k = Math.min(1, t.gimbal / a);
          t.dir.lerp(want, k).normalize();
        }
      }
      t.pos.copy(p.worldCenter);
      let avail = t.maxThrust * p.efficiency;
      if (t.electric) avail *= m.powerRatio;
      else if (!m.hasFuel) avail = 0;
      if (m.overheated) avail *= 0.7;
      // ground effect: a little extra lift near the ground
      if (this.altitude < 4) avail *= 1 + (4 - this.altitude) * 0.03;
      t.avail = alive ? avail : avail * 0.15;
    }

    // ---- desired attitude ----
    const horizCap = this.thrusters.reduce((s, t) => s + t.avail * Math.max(0, t.dir.dot(new THREE.Vector3(Fdes.x, 0, Fdes.z).normalize())) * (Math.abs(t.dir.dot(up)) < 0.5 ? 1 : 0), 0);
    const Fh = new THREE.Vector3(Fdes.x, 0, Fdes.z);
    const tiltPart = Fh.clone().multiplyScalar(Math.max(0, 1 - horizCap / Math.max(1, Fh.length())));
    const upDes = new THREE.Vector3(tiltPart.x, Math.max(Fdes.y, mass * g * 0.3), tiltPart.z).normalize();
    const maxTilt = 0.6;
    if (upDes.angleTo(UP) > maxTilt) {
      const axis = new THREE.Vector3().crossVectors(UP, upDes).normalize();
      upDes.copy(UP).applyAxisAngle(axis, maxTilt);
    }
    // target orientation = heading yaw then tilt to upDes
    const qYaw = new THREE.Quaternion().setFromAxisAngle(UP, yawTarget);
    const qTilt = new THREE.Quaternion().setFromUnitVectors(UP, upDes);
    const qDes = qTilt.multiply(qYaw);
    const qErr = qDes.clone().multiply(q.clone().invert());
    if (qErr.w < 0) {
      qErr.x *= -1;
      qErr.y *= -1;
      qErr.z *= -1;
      qErr.w *= -1;
    }
    const angle = 2 * Math.acos(clamp(qErr.w, -1, 1));
    const s = Math.sqrt(Math.max(1e-9, 1 - qErr.w * qErr.w));
    const errVec = new THREE.Vector3(qErr.x / s, qErr.y / s, qErr.z / s).multiplyScalar(angle > 1e-4 ? angle : 0);
    // yaw rate limit for heavy craft
    const kp = 5.5;
    const kd = 3.2;
    const wDes = errVec.multiplyScalar(kp);
    const alphaDes = wDes.sub(ang).multiplyScalar(kd);
    // world inertia approx from principal inertia (body frame)
    const inv = q.clone().invert();
    const aBody = alphaDes.clone().applyQuaternion(inv);
    const pi = m.body.principalInertia();
    aBody.set(aBody.x * pi.x, aBody.y * pi.y, aBody.z * pi.z);
    const Tdes = aBody.applyQuaternion(q).sub(aeroT);
    if (!alive) Tdes.set(0, 0, 0);

    // ---- allocation ----
    const cols: { f: THREE.Vector3; t: THREE.Vector3; lo: number; hi: number; kind: 'thr' | 'cyc' | 'gyro'; ref: Thruster | PartRuntime | null }[] = [];
    for (const t of this.thrusters) {
      if (t.avail <= 0) continue;
      const f = t.dir.clone().multiplyScalar(t.avail);
      const r = t.pos.clone().sub(com);
      const tq = r.clone().cross(f);
      // rotor reaction torque (opposes spin)
      tq.addScaledVector(t.dir, -t.spin * t.reaction * t.radius * t.avail * 0.25);
      cols.push({ f, t: tq, lo: 0, hi: 1, kind: 'thr', ref: t });
      if (t.cyclic > 0) {
        const e1 = new THREE.Vector3().crossVectors(t.dir, fwd).normalize();
        const e2 = new THREE.Vector3().crossVectors(t.dir, e1).normalize();
        const auth = t.cyclic * t.radius * t.avail * Math.max(0.25, t.u);
        cols.push({ f: new THREE.Vector3(), t: e1.multiplyScalar(auth), lo: -1, hi: 1, kind: 'cyc', ref: t });
        cols.push({ f: new THREE.Vector3(), t: e2.multiplyScalar(auth), lo: -1, hi: 1, kind: 'cyc', ref: t });
      }
    }
    let gyroAuth = 0;
    for (const gy of this.gyros) gyroAuth += (gy.def.stats.torqueAuthority ?? 0) * gy.efficiency * m.powerRatio;
    // Every airframe has a little inherent control authority (control surfaces / pilot trim),
    // weak in yaw: without proper yaw authority a damaged craft spins.
    const bodyX = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const bodyY = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const bodyZ = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const inherent = mass * 0.45;
    cols.push({ f: new THREE.Vector3(), t: bodyX.multiplyScalar(gyroAuth + inherent), lo: -1, hi: 1, kind: 'gyro', ref: null });
    cols.push({ f: new THREE.Vector3(), t: bodyY.multiplyScalar(gyroAuth + inherent * 0.4), lo: -1, hi: 1, kind: 'gyro', ref: null });
    cols.push({ f: new THREE.Vector3(), t: bodyZ.multiplyScalar(gyroAuth + inherent), lo: -1, hi: 1, kind: 'gyro', ref: null });
    const n = cols.length;
    const fS = 1 / (mass * g);
    const tS = 1 / (mass * g * 0.9);
    const W = [0.7, 1.6, 0.7, 4, 4, 4];
    // Rows: Fx Fy Fz Tx Ty Tz (normalised)
    const B: number[][] = cols.map((c) => [c.f.x * fS, c.f.y * fS, c.f.z * fS, c.t.x * tS, c.t.y * tS, c.t.z * tS]);
    const w = [Fdes.x * fS, Fdes.y * fS, Fdes.z * fS, Tdes.x * tS, Tdes.y * tS, Tdes.z * tS];
    const u = new Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      const c = cols[j];
      if (c.kind === 'thr') u[j] = clamp((c.ref as Thruster).u, 0, 1);
    }
    const res = [0, 0, 0, 0, 0, 0];
    for (let k = 0; k < 6; k++) {
      let s2 = -w[k];
      for (let j = 0; j < n; j++) s2 += B[j][k] * u[j];
      res[k] = s2;
    }
    const lambda = 0.002;
    for (let sweep = 0; sweep < 14; sweep++) {
      for (let j = 0; j < n; j++) {
        const bj = B[j];
        let gdot = lambda * u[j];
        let h = lambda;
        for (let k = 0; k < 6; k++) {
          gdot += W[k] * bj[k] * res[k];
          h += W[k] * bj[k] * bj[k];
        }
        if (h < 1e-9) continue;
        const nu = clamp(u[j] - gdot / h, cols[j].lo, cols[j].hi);
        const du = nu - u[j];
        if (du !== 0) {
          for (let k = 0; k < 6; k++) res[k] += bj[k] * du;
          u[j] = nu;
        }
      }
    }
    this.u = u;

    // ---- apply ----
    let thrSum = 0;
    let thrCount = 0;
    for (let j = 0; j < n; j++) {
      const c = cols[j];
      const uj = u[j];
      if (c.kind === 'thr') {
        const t = c.ref as Thruster;
        t.u = lerp(t.u, uj, 1 - Math.exp(-dt * (t.kind === 'jet' ? 10 : 14)));
        const f = c.f.clone().multiplyScalar(t.u * dt);
        body.applyImpulseAtPoint({ x: f.x, y: f.y, z: f.z }, { x: t.pos.x, y: t.pos.y, z: t.pos.z }, true);
        const react = t.dir.clone().multiplyScalar(-t.spin * t.reaction * t.radius * t.avail * 0.25 * t.u * dt);
        body.applyTorqueImpulse({ x: react.x, y: react.y, z: react.z }, true);
        const pd = t.part.def.stats.powerDraw ?? 0;
        if (pd > 0) m.demand(pd * Math.pow(t.u, 1.5));
        if (!t.electric || (t.part.def.stats.fuelUse ?? 0) > 0) m.useFuel(((t.part.def.stats.fuelUse ?? 0) / 60) * t.u * dt);
        m.addHeat((t.part.def.stats.heat ?? 0) * t.u * dt);
        thrSum += t.u;
        thrCount++;
      } else {
        const tq = c.t.clone().multiplyScalar(uj * dt);
        body.applyTorqueImpulse({ x: tq.x, y: tq.y, z: tq.z }, true);
        if (c.kind === 'gyro') for (const gy of this.gyros) m.demand((gy.def.stats.powerDraw ?? 0) * Math.abs(uj) * 0.33);
      }
    }
    for (const t of this.thrusters) if (t.avail <= 0) t.u = lerp(t.u, 0, 1 - Math.exp(-dt * 2));
    // Damaged rotors vibrate and shake the airframe
    for (const t of this.thrusters) {
      if (t.kind !== 'rotor' || !t.part.functional || t.part.cond > 0.5 || t.u < 0.1) continue;
      const k = (0.5 - t.part.cond) * 2 * t.avail * t.radius * 0.35 * t.u;
      const jolt = new THREE.Vector3(Math.sin(m.ctx.time * 37 + t.angle), 0, Math.cos(m.ctx.time * 41 + t.angle * 1.3)).multiplyScalar(k * dt);
      body.applyTorqueImpulse({ x: jolt.x, y: 0, z: jolt.z }, true);
    }
    this.throttleAvg = thrCount ? thrSum / thrCount : 0;
    // aero
    body.applyImpulse({ x: aero.x * dt, y: aero.y * dt, z: aero.z * dt }, true);
    body.applyTorqueImpulse({ x: aeroT.x * dt, y: aeroT.y * dt, z: aeroT.z * dt }, true);
    // angular damping for controllability
    const damp = ang.clone().multiplyScalar(-mass * 0.8 * dt);
    body.applyTorqueImpulse({ x: damp.x, y: damp.y, z: damp.z }, true);

    // ---- rotor strikes ----
    for (const t of this.thrusters) {
      if (t.kind !== 'rotor' || !t.part.functional || t.u < 0.05) continue;
      t.strikeTimer -= dt;
      if (t.strikeTimer > 0) continue;
      const e1 = new THREE.Vector3().crossVectors(t.dir, fwd).normalize();
      const e2 = new THREE.Vector3().crossVectors(t.dir, e1).normalize();
      for (const e of [e1, e2, e1.clone().negate(), e2.clone().negate()]) {
        const tip = t.pos.clone().addScaledVector(e, t.radius * 0.95);
        const h = m.ctx.terrain.heightAt(tip.x, tip.z);
        if (tip.y < h + 0.05) {
          t.strikeTimer = 0.25;
          const shrouded = t.part.def.special?.includes('shrouded');
          m.damagePartDirect(t.part, shrouded ? 4 : 22, null, 'strike');
          m.ctx.fx.sparks(tip, UP, 18, 10, 1);
          m.ctx.fx.dust(tip, 3);
          m.ctx.audio.play('rotorStrike', tip, { volume: 0.8 });
          const kick = e.clone().cross(t.dir).multiplyScalar(mass * 3);
          body.applyTorqueImpulse({ x: kick.x, y: kick.y, z: kick.z }, true);
          break;
        }
      }
    }
    m.immobile = this.thrusters.filter((t) => t.avail > 0).length === 0;
  }

  update(dt: number) {
    const m = this.m;
    const fx = m.ctx.fx;
    const near = m.ctx.camera.position.distanceTo(m.currPos) < 300;
    for (const t of this.thrusters) {
      const p = t.part;
      if (p.detached) continue;
      const running = p.functional ? t.u : 0;
      const rpm = t.kind === 'rotor' ? lerp(3, 38, Math.sqrt(running)) * (1.2 / Math.max(0.6, Math.sqrt(t.radius))) : 60 * running;
      if (!p.functional) t.angle += 0; // stopped
      else t.angle += rpm * dt * t.spin;
      const spin = p.nodes.get('spin');
      if (spin) spin.rotation.y = t.angle;
      const spin2 = p.nodes.get('spin2');
      if (spin2) spin2.rotation.y = -t.angle;
      if (t.gimbal > 0) {
        const gim = p.nodes.get('gimbal');
        if (gim && gim.parent) {
          // nozzle exhaust (+Y) points opposite to the thrust direction
          const localExhaust = t.dir.clone().negate().transformDirection(new THREE.Matrix4().copy(gim.parent.matrixWorld).invert());
          gim.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), localExhaust);
        }
      }
      if (!near) continue;
      if (t.kind === 'jet' && running > 0.05) {
        const nz = p.nodes.get('nozzle');
        const pos = nz ? new THREE.Vector3().setFromMatrixPosition(nz.matrixWorld) : t.pos;
        const exhaust = t.dir.clone().negate();
        const vector = p.def.special?.includes('vectored thrust');
        const col: [number, number, number] = vector ? [0.9, 1.8, 4] : [4, 1.9, 0.6];
        fx.glow(pos.clone().addScaledVector(exhaust, 0.2), 0.35 + running * 0.5, col, 0.06, exhaust.clone().multiplyScalar(10).add(m.velocity));
        if (rand() < 0.5) fx.glow(pos.clone().addScaledVector(exhaust, 0.6), 0.2 + running * 0.3, col, 0.08, exhaust.clone().multiplyScalar(14).add(m.velocity));
        if (!vector && rand() < running * 0.3) fx.smoke(pos.clone().addScaledVector(exhaust, 1), exhaust.clone().multiplyScalar(8).add(m.velocity), 0.3, 1.2, [0.35, 0.34, 0.33], 0.25, 4);
      }
      // rotor wash dust near the ground
      if (t.kind === 'rotor' && running > 0.3 && t.dir.y > 0.6) {
        const h = t.pos.y - m.ctx.terrain.heightAt(t.pos.x, t.pos.z);
        if (h < t.radius * 4 && rand() < 0.35 * running) {
          const a = rand() * Math.PI * 2;
          const r = randRange(0.5, t.radius * 2);
          const gp = new THREE.Vector3(t.pos.x + Math.cos(a) * r, m.ctx.terrain.heightAt(t.pos.x, t.pos.z) + 0.3, t.pos.z + Math.sin(a) * r);
          fx.smoke(gp, new THREE.Vector3(Math.cos(a) * 6, 0.8, Math.sin(a) * 6), 0.6, 1.6, [0.66, 0.55, 0.42], 0.35, 3);
        }
      }
    }
    // Airbrake flap visual
    for (const b of this.brakes) {
      const flap = b.nodes.get('flap');
      if (flap) flap.rotation.x = lerp(flap.rotation.x, m.input.throttle < -0.1 ? -1.0 : 0, 1 - Math.exp(-dt * 6));
    }
  }

  selfRight() {
    const m = this.m;
    if (m.up().y > 0.5) return false;
    m.body.applyImpulse({ x: 0, y: m.mass * 4, z: 0 }, true);
    const axis = new THREE.Vector3().crossVectors(m.up(), UP).normalize();
    m.body.applyTorqueImpulse({ x: axis.x * m.mass * 6, y: 0, z: axis.z * m.mass * 6 }, true);
    return true;
  }
}

export { wrapAngle };
