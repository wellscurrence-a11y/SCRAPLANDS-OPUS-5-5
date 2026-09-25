/** Third-person chase camera with collision, shake, recoil kick and an aim ray. */
import * as THREE from 'three';
import type { Machine } from '../machines/machine';
import type { PartRuntime } from '../machines/part';
import type { WorldContext } from './context';
import { COLLIDE } from '../physics/physics';
import { clamp, damp, lerp } from './math';
import { Noise } from './noise';

const shakeNoise = new Noise(31);

export class ChaseCamera {
  camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = -0.18;
  distance = 8;
  zoom = 1;
  trauma = 0;
  focus = new THREE.Vector3();
  aimPoint = new THREE.Vector3();
  aimMachine: Machine | null = null;
  aimPart: PartRuntime | null = null;
  aimDistance = 100;
  baseFov = 68;
  private smoothTarget = new THREE.Vector3();
  private initialised = false;
  private t = 0;
  private kick = 0;
  sensitivity = 0.0022;

  constructor(private ctx: WorldContext) {
    this.camera = ctx.camera;
  }

  addTrauma(a: number) {
    this.trauma = clamp(this.trauma + a, 0, 1);
  }

  snapTo(m: Machine) {
    this.initialised = false;
    const f = m.forward();
    this.yaw = Math.atan2(-f.x, -f.z);
    this.update(0.016, m, 0, 0, 0);
  }

  update(dt: number, m: Machine | null, mouseDx: number, mouseDy: number, wheel: number) {
    this.t += dt;
    this.yaw -= mouseDx * this.sensitivity;
    this.pitch = clamp(this.pitch - mouseDy * this.sensitivity, -1.2, 0.75);
    if (wheel) this.zoom = clamp(this.zoom * (wheel > 0 ? 1.1 : 0.9), 0.45, 2.4);
    if (!m) return;
    const radius = m.boundRadius;
    this.distance = (radius * 1.15 + 3.0) * this.zoom;
    const target = m.root.position.clone().add(m.comLocal.clone().applyQuaternion(m.root.quaternion));
    target.y += radius * 0.25 + 0.9;
    if (!this.initialised) {
      this.smoothTarget.copy(target);
      this.initialised = true;
    }
    this.smoothTarget.lerp(target, damp(18, dt));
    this.focus.copy(this.smoothTarget);
    const cp = Math.cos(this.pitch);
    const offset = new THREE.Vector3(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.distance);
    const desired = this.focus.clone().add(offset);
    // Collide with world geometry
    const dir = offset.clone().normalize();
    const hit = this.ctx.physics.castRayInto(this.focus, dir, this.distance, null, COLLIDE.qWorld);
    if (hit.d >= 0) desired.copy(this.focus).addScaledVector(dir, Math.max(1.2, hit.d - 0.4));
    const gh = this.ctx.terrain.heightAt(desired.x, desired.z);
    if (desired.y < gh + 0.6) desired.y = gh + 0.6;
    this.camera.position.copy(desired);
    this.camera.lookAt(this.focus.clone().add(new THREE.Vector3(0, radius * 0.1, 0)));
    // Recoil kick (pitch up) and shake
    this.kick = lerp(this.kick, m.tag.recoilKick ?? 0, damp(30, dt));
    m.tag.recoilKick = Math.max(0, (m.tag.recoilKick ?? 0) - dt * 4);
    this.camera.rotateX(this.kick * 0.035);
    this.trauma = Math.max(0, this.trauma - dt * 1.1);
    const s = this.trauma * this.trauma;
    if (s > 0.0001) {
      const t = this.t * 25;
      this.camera.rotateX(shakeNoise.noise2(t, 1) * 0.05 * s);
      this.camera.rotateY(shakeNoise.noise2(t, 7) * 0.05 * s);
      this.camera.rotateZ(shakeNoise.noise2(t, 13) * 0.06 * s);
      this.camera.position.add(new THREE.Vector3(shakeNoise.noise2(t, 21), shakeNoise.noise2(t, 29), shakeNoise.noise2(t, 37)).multiplyScalar(0.25 * s));
    }
    // Speed FOV
    const speed = m.velocity.length();
    const fov = this.baseFov + clamp((speed - 10) * 0.25, 0, 12) + (m.input.boost ? 4 : 0);
    this.camera.fov = lerp(this.camera.fov, fov, damp(4, dt));
    this.camera.updateProjectionMatrix();
    this.updateAim(m);
  }

  /** Cast from the screen centre to find what the pilot is aiming at. */
  updateAim(m: Machine) {
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    // Remove kick/shake influence on aim by using the un-shaken focus direction
    const toFocus = this.focus.clone().sub(this.camera.position).normalize();
    if (toFocus.angleTo(dir) < 0.2) dir.lerp(dir, 1);
    const maxD = 1200;
    let best = maxD;
    const wh = this.ctx.physics.castRayInto(origin, dir, maxD, null, COLLIDE.qWorld);
    if (wh.d >= 0) best = wh.d;
    this.aimMachine = null;
    this.aimPart = null;
    for (const o of this.ctx.machines) {
      if (o === m) continue;
      const h = o.raycastParts(origin, dir, best);
      if (h && h.t < best) {
        best = h.t;
        this.aimMachine = o;
        this.aimPart = h.part;
      }
    }
    // Ignore points too close to the camera (would aim at own vehicle)
    const minD = this.distance + m.boundRadius;
    this.aimDistance = Math.max(best, minD);
    this.aimPoint.copy(origin).addScaledVector(dir, this.aimDistance);
  }
}
