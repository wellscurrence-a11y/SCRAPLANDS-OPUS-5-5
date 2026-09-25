/** Simulated projectiles: bullets, shells, rockets and guided missiles with segment hit tests. */
import * as THREE from 'three';
import type { WorldContext } from '../core/context';
import type { Machine } from '../machines/machine';
import type { PartRuntime } from '../machines/part';
import { COLLIDE } from '../physics/physics';
import { hitPart, splash, surfaceKindAt } from './damage';
import { clamp } from '../core/math';
import { rand, randRange } from '../core/random';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type ProjKind = 'bullet' | 'shell' | 'rocket' | 'missile';

export interface ProjSpec {
  kind: ProjKind;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  owner: Machine;
  damage: number;
  pen: number;
  splash?: number;
  splashDamage?: number;
  gravity?: number;
  maxRange: number;
  tracer?: [number, number, number] | null;
  size?: number;
  target?: { machine: Machine; part: PartRuntime } | null;
  turnRate?: number;
  accel?: number;
  maxSpeed?: number;
}

interface Proj extends ProjSpec {
  alive: boolean;
  traveled: number;
  prev: THREE.Vector3;
  smokeT: number;
  age: number;
  wobble: number;
  decoyed: boolean;
}

const _dir = new THREE.Vector3();
const _n = new THREE.Vector3();

export class Projectiles {
  list: Proj[] = [];
  private mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  constructor(private ctx: WorldContext) {
    const body = new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8);
    body.rotateX(Math.PI / 2);
    const nose = new THREE.ConeGeometry(0.06, 0.18, 8);
    nose.rotateX(-Math.PI / 2);
    nose.translate(0, 0, -0.44);
    const fins = new THREE.BoxGeometry(0.2, 0.01, 0.12);
    fins.translate(0, 0, 0.3);
    const fins2 = new THREE.BoxGeometry(0.01, 0.2, 0.12);
    fins2.translate(0, 0, 0.3);
    const geo = mergeGeometries([body, nose, fins, fins2].map((g) => g.toNonIndexed()));
    const mat = new THREE.MeshStandardMaterial({ color: 0xcfcac0, metalness: 0.6, roughness: 0.4 });
    this.mesh = new THREE.InstancedMesh(geo!, mat, 256);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    ctx.scene.add(this.mesh);
  }

  spawn(spec: ProjSpec) {
    const p: Proj = {
      ...spec,
      alive: true,
      traveled: 0,
      prev: spec.pos.clone(),
      smokeT: 0,
      age: 0,
      wobble: rand() * 10,
      decoyed: false,
      pos: spec.pos.clone(),
      vel: spec.vel.clone(),
    };
    // reuse dead slots
    const i = this.list.findIndex((x) => !x.alive);
    if (i >= 0) this.list[i] = p;
    else this.list.push(p);
    return p;
  }

  fixedUpdate(dt: number) {
    const ctx = this.ctx;
    for (const p of this.list) {
      if (!p.alive) continue;
      p.age += dt;
      p.prev.copy(p.pos);
      // guidance
      if ((p.kind === 'missile' || p.kind === 'rocket') && p.accel) {
        const speed = p.vel.length();
        const ns = Math.min(p.maxSpeed ?? speed, speed + p.accel * dt);
        p.vel.setLength(ns);
      }
      if (p.kind === 'missile' && p.target && !p.decoyed) {
        const t = p.target;
        if (t.part.detached || !t.machine.body) p.target = null;
        else {
          const aimPos = t.part.worldCenter.clone().addScaledVector(t.machine.velocity, clamp(p.pos.distanceTo(t.part.worldCenter) / Math.max(20, p.vel.length()), 0, 1.5));
          const want = aimPos.sub(p.pos).normalize();
          const cur = p.vel.clone().normalize();
          const ang = cur.angleTo(want);
          const maxTurn = (p.turnRate ?? 2) * dt;
          if (ang > 1e-4) {
            const k = Math.min(1, maxTurn / ang);
            cur.lerp(want, k).normalize();
            p.vel.copy(cur.multiplyScalar(p.vel.length()));
          }
          // countermeasures
          if (t.machine.tag.flareTimer === undefined) t.machine.tag.flareTimer = 0;
          const jam = t.machine.parts.find((x) => x.functional && (x.def.stats.jammer ?? 0) > 0);
          if (jam && p.age > 0.3 && p.age < 0.35 && rand() < (jam.def.stats.jammer ?? 0)) p.decoyed = true;
          const flares = t.machine.parts.find((x) => x.functional && (x.def.stats.flares ?? 0) > 0);
          if (flares && p.pos.distanceTo(t.machine.currPos) < 60 && t.machine.tag.flareTimer <= 0) {
            t.machine.tag.flareTimer = 6;
            ctx.fx.sparks(t.machine.currPos, new THREE.Vector3(0, 1, 0), 30, 12, 1.2, [1, 0.8, 0.5]);
            ctx.fx.flash(t.machine.currPos, 0xffcc88, 20, 25, 1.5, 1);
            if (rand() < 0.75) p.decoyed = true;
          }
        }
      }
      if (p.kind === 'rocket') {
        // unguided wobble
        p.wobble += dt * 9;
        const side = new THREE.Vector3(Math.sin(p.wobble), Math.cos(p.wobble * 1.3), 0).multiplyScalar(0.8 * dt);
        p.vel.add(side);
      }
      p.vel.y -= (p.gravity ?? 0) * dt;
      p.pos.addScaledVector(p.vel, dt);
      const seg = p.pos.clone().sub(p.prev);
      const segLen = seg.length();
      if (segLen < 1e-5) continue;
      _dir.copy(seg).divideScalar(segLen);
      // world
      const wh = ctx.physics.castRayInto(p.prev, _dir, segLen, _n, COLLIDE.qWorld);
      let bestT = wh.d >= 0 ? wh.d : Infinity;
      let hitMachine: Machine | null = null;
      let hitPartR: PartRuntime | null = null;
      let hitNormal = _n.clone();
      for (const m of ctx.machines) {
        if (m === p.owner && p.age < 0.5) continue;
        const h = m.raycastParts(p.prev, _dir, Math.min(segLen, bestT));
        if (h && h.t < bestT) {
          bestT = h.t;
          hitMachine = m;
          hitPartR = h.part;
          hitNormal = h.normal;
        }
      }
      // debris blocks projectiles too
      p.traveled += segLen;
      if (bestT < Infinity) {
        const point = p.prev.clone().addScaledVector(_dir, bestT);
        this.impact(p, point, hitNormal, hitMachine, hitPartR, wh.collider);
        continue;
      }
      if (p.traveled > p.maxRange || p.age > 12) {
        if (p.kind !== 'bullet') this.detonate(p, p.pos.clone(), null, null);
        p.alive = false;
      }
    }
  }

  private impact(p: Proj, point: THREE.Vector3, normal: THREE.Vector3, m: Machine | null, part: PartRuntime | null, collider: unknown) {
    const ctx = this.ctx;
    p.alive = false;
    const dir = p.vel.clone().normalize();
    if (m && part) {
      hitPart(ctx, m, part, p.damage, p.pen, point, normal, dir, p.owner, p.splash ? 'explosive' : 'ballistic');
    } else {
      const kind = surfaceKindAt(ctx, point, collider);
      const scale = p.kind === 'bullet' ? clamp(p.damage / 15, 0.4, 1.4) : 1.2;
      ctx.fx.impact(point, normal, kind, scale);
      if (p.kind === 'bullet') ctx.audio.play(kind === 'metal' ? 'hitMetal' : 'hitDirt', point, { volume: 0.35 });
    }
    if (p.splash) this.detonate(p, point, m, part);
  }

  private detonate(p: Proj, point: THREE.Vector3, _m: Machine | null, direct: PartRuntime | null) {
    const ctx = this.ctx;
    const size = clamp((p.splash ?? 2) / 3.5, 0.35, 2.2);
    ctx.fx.explosion(point, size, { debris: size > 0.6 });
    ctx.audio.play(size > 1 ? 'explosionBig' : 'explosion', point, { volume: clamp(size, 0.4, 1.2), size });
    ctx.events.emit('explosion', { pos: point.clone(), size });
    splash(ctx, point, p.splash ?? 2, p.splashDamage ?? p.damage * 0.4, p.pen, p.owner, direct);
  }

  update(dt: number) {
    // visuals
    let n = 0;
    const fx = this.ctx.fx;
    for (const p of this.list) {
      if (!p.alive) continue;
      if (p.kind === 'bullet' || p.kind === 'shell') {
        if (p.tracer) fx.tracer(p.pos, p.vel, p.tracer, p.size ?? 0.06);
        if (p.kind === 'shell') fx.glow(p.pos, 0.25, [3, 2, 1], 0.03);
        continue;
      }
      // rockets & missiles
      this.q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), p.vel.clone().normalize());
      const s = p.size ?? 1;
      this.m.compose(p.pos, this.q, new THREE.Vector3(s, s, s));
      if (n < 256) this.mesh.setMatrixAt(n++, this.m);
      const back = p.vel.clone().normalize().multiplyScalar(-0.5 * s);
      fx.glow(p.pos.clone().add(back), 0.35 * s, [4, 2.2, 0.8], 0.04);
      p.smokeT -= dt;
      if (p.smokeT <= 0) {
        p.smokeT = 0.025;
        fx.smoke(p.pos.clone().add(back), new THREE.Vector3(randRange(-0.3, 0.3), 0.3, randRange(-0.3, 0.3)), 0.18 * s, 2.2, [0.72, 0.7, 0.68], 0.45, 4);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (const p of this.list) p.alive = false;
  }
}
