/**
 * Runtime machine: a physical rigid body built from real parts. Mass, centre of mass and
 * inertia come from the parts; every part can be hit, damaged, destroyed or knocked off.
 */
import * as THREE from 'three';
import { RAPIER, COLLIDE, GRAVITY } from '../physics/physics';
import type { Faction, WorldContext } from '../core/context';
import type { MachineClass, MachineDesign } from './types';
import { computeStats, FUEL_DENSITY, MachineStats } from './stats';
import { MachineMaterials } from './materials';
import { assembleDesign, damageLevelFor, setPartDamageLook } from './visual';
import { detailSettings } from './parts/kit';
import { MachineBatch } from './batch';
import { PartRuntime } from './part';
import { symmetricEigen3, clamp, clamp01, lerp } from '../core/math';
import { rand, randRange } from '../core/random';
import type { Controller } from './controllers/controller';
import { createController } from './controllers/factory';
import { WeaponRuntime } from '../combat/weapons';

export interface MachineInput {
  throttle: number;
  steer: number;
  vertical: number;
  brake: number;
  boost: boolean;
  aimPoint: THREE.Vector3 | null;
  lockTarget: { machine: Machine; part: PartRuntime } | null;
  fire: [boolean, boolean, boolean];
  yawTarget: number | null;
  lights: boolean;
  strafe: number;
}

export function emptyInput(): MachineInput {
  return { throttle: 0, steer: 0, vertical: 0, brake: 0, boost: false, aimPoint: null, lockTarget: null, fire: [false, false, false], yawTarget: null, lights: false, strafe: 0 };
}

export interface SpawnOptions {
  position: THREE.Vector3;
  yaw: number;
  faction: Faction;
  isPlayer?: boolean;
  fuelFraction?: number;
}

const COLLIDER_CATS = new Set([
  'frame', 'cockpit', 'engine', 'generator', 'battery', 'fuel', 'cooling', 'transmission', 'booster', 'ram', 'cargo', 'armor',
  'weapon', 'gear', 'hydraulics', 'jumpjet', 'track', 'wing', 'sensor', 'stabilizer',
]);
const DETACHABLE = new Set(['armor', 'weapon', 'sensor', 'light', 'cargo', 'booster', 'wing', 'gear', 'ram', 'cooling', 'fuel', 'rotor', 'wheel', 'arm', 'countermeasure', 'airbrake', 'jumpjet', 'melee', 'stabilizer', 'battery', 'foot']);

interface HitVolume {
  obj: THREE.Object3D;
  box: THREE.Box3;
  inv: THREE.Matrix4;
  center: THREE.Vector3;
}

export interface PartHit {
  part: PartRuntime;
  t: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

const _v = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _v2 = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Machine {
  static nextId = 1;
  id = Machine.nextId++;
  ctx: WorldContext;
  design: MachineDesign;
  cls: MachineClass;
  faction: Faction;
  isPlayer: boolean;
  name: string;
  root: THREE.Group;
  mats: MachineMaterials;
  parts: PartRuntime[] = [];
  byUid = new Map<string, PartRuntime>();
  volumes = new Map<PartRuntime, HitVolume[]>();
  body!: RAPIER.RigidBody;
  stats: MachineStats;
  input: MachineInput = emptyInput();
  controller!: Controller;
  weapons: WeaponRuntime[] = [];
  alive = true;
  wreck = false;
  immobile = false;
  deathTime = 0;
  killedBy: Machine | null = null;
  /** Why the machine stopped: 'pilot', 'structural', 'bailed' (abandoned intact), … */
  deathCause: string | null = null;
  // Systems
  energy = 0;
  energyCap = 40;
  maxDischarge = 60;
  heat = 0;
  heatCap = 100;
  fuel = 0;
  fuelCap = 0;
  powerGen = 0;
  powerDemand = 0;
  powerDemandLast = 0;
  powerRatio = 1;
  overheated = false;
  cooling = 10;
  antiMass = 1;
  // Physics state
  mass = 1000;
  comLocal = new THREE.Vector3();
  prevPos = new THREE.Vector3();
  prevQuat = new THREE.Quaternion();
  currPos = new THREE.Vector3();
  currQuat = new THREE.Quaternion();
  velocity = new THREE.Vector3();
  angVel = new THREE.Vector3();
  boundRadius = 3;
  worldCom = new THREE.Vector3();
  lightsOn = false;
  headlights: THREE.SpotLight[] = [];
  cargoMass = 0;
  tag: Record<string, any> = {};
  lastDamageTime = -100;
  /** Last machine to hurt us, credited when fire, leaks or heat finish the job. */
  lastAttacker: Machine | null = null;
  lastAttackTime = -100;
  damageTaken = 0;
  /** Seconds since spawn */
  age = 0;
  private fxAccum = 0;

  constructor(ctx: WorldContext, design: MachineDesign, opts: SpawnOptions) {
    this.ctx = ctx;
    this.design = design;
    this.cls = design.cls;
    this.faction = opts.faction;
    this.isPlayer = !!opts.isPlayer;
    this.name = design.name;
    this.stats = computeStats(design, opts.fuelFraction ?? 1);
    this.mats = new MachineMaterials(design.paint);
    const asm = assembleDesign(design, this.mats, { layout: this.stats.layout, detail: detailSettings.world });
    this.root = asm.root;
    for (const lay of this.stats.layout.parts) {
      const pv = asm.parts.get(lay.placed.uid)!;
      const pr = new PartRuntime(lay, pv.node, lay.localBounds.clone());
      pr.meshes = pv.meshes;
      pr.nodes = pv.nodes;
      this.parts.push(pr);
      this.byUid.set(pr.uid, pr);
    }
    for (const p of this.parts) {
      if (p.layout.parent) {
        p.parent = this.byUid.get(p.layout.parent.placed.uid) ?? null;
        p.parent?.children.push(p);
      }
    }
    this.buildVolumes();
    ctx.scene.add(this.root);
    this.fuelCap = this.stats.fuelCap;
    this.fuel = this.fuelCap * (opts.fuelFraction ?? 1);
    this.energyCap = 40 + this.stats.batteryCap;
    this.maxDischarge = 60 + this.stats.batteryDischarge;
    this.energy = this.energyCap;
    this.createBody(opts.position, opts.yaw);
    for (const p of this.parts) {
      if ((p.def.category === 'weapon' || p.def.category === 'melee' || (p.def.category === 'ram' && p.def.stats.melee)) && p.functional) {
        this.weapons.push(new WeaponRuntime(this, p));
      }
    }
    this.controller = createController(this);
    this.refreshMass();
    this.updateHitMatrices();
    if (this.isPlayer) this.createHeadlights();
    // Part roots and socket anchors never move relative to their parent: freeze their local matrices.
    for (const p of this.parts) {
      p.node.traverse((o) => {
        if (o !== p.node && !o.userData.anchor) return;
        o.updateMatrix();
        o.matrixAutoUpdate = false;
      });
    }
    this.batch = new MachineBatch(this.root, this.parts, detailSettings.world >= 1 ? 0 : 0.35);
  }

  /** Swap a part's damage look (and refresh the merged batch). */
  private setLook(p: PartRuntime, level: number) {
    setPartDamageLook(p, this.mats, level, p.def.rarity);
    this.batch?.invalidate();
  }

  // ------------------------------------------------------------------ construction
  private buildVolumes() {
    for (const p of this.parts) {
      const vols = new Map<THREE.Object3D, THREE.Box3>();
      const walk = (o: THREE.Object3D) => {
        for (const c of o.children) {
          if (c.userData.uid && c !== p.node) continue; // child part
          if ((c as THREE.Mesh).isMesh) {
            const mesh = c as THREE.Mesh;
            const slot = mesh.userData.slot;
            if (slot === 'rarity' || slot === 'glow') continue;
            const g = mesh.geometry;
            if (!g.boundingBox) g.computeBoundingBox();
            let box = vols.get(o);
            if (!box) {
              box = new THREE.Box3();
              vols.set(o, box);
            }
            box.union(g.boundingBox!);
          } else walk(c);
        }
      };
      walk(p.node);
      const list: HitVolume[] = [];
      for (const [obj, box] of vols) {
        const size = box.getSize(_v);
        if (size.x * size.y * size.z < 1e-5 && size.length() < 0.05) continue;
        // pad very thin boxes a little so they can be hit
        box.expandByVector(new THREE.Vector3(Math.max(0, 0.03 - size.x / 2), Math.max(0, 0.03 - size.y / 2), Math.max(0, 0.03 - size.z / 2)));
        list.push({ obj, box, inv: new THREE.Matrix4(), center: new THREE.Vector3() });
      }
      this.volumes.set(p, list);
    }
  }

  private createBody(pos: THREE.Vector3, yaw: number) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCcdEnabled(true)
      .setCanSleep(false)
      .setLinearDamping(0.02)
      .setAngularDamping(this.cls === 'air' ? 0.6 : 0.25);
    this.body = this.ctx.physics.world.createRigidBody(desc);
    for (const p of this.parts) this.addCollider(p);
    this.prevPos.copy(pos);
    this.currPos.copy(pos);
    this.prevQuat.copy(q);
    this.currQuat.copy(q);
  }

  private addCollider(p: PartRuntime) {
    if (!COLLIDER_CATS.has(p.def.category) || p.detached) return;
    const b = p.layout.bounds;
    const size = b.getSize(_v);
    const c = b.getCenter(_v2);
    const hx = Math.max(0.05, size.x / 2 - 0.02);
    const hy = Math.max(0.05, size.y / 2 - 0.02);
    const hz = Math.max(0.05, size.z / 2 - 0.02);
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(c.x, c.y, c.z)
      .setDensity(0)
      .setFriction(p.def.category === 'gear' || p.def.category === 'track' ? 0.9 : 0.45)
      .setRestitution(0.05)
      .setCollisionGroups(COLLIDE.machine)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(p.def.category === 'gear' ? 1e9 : 8000 + this.stats.mass * 6);
    p.collider = this.ctx.physics.world.createCollider(desc, this.body);
    this.ctx.physics.owners.set(p.collider.handle, { machine: this, part: p });
  }

  private createHeadlights() {
    const anchors: THREE.Object3D[] = [];
    for (const p of this.parts) {
      for (const [name, n] of p.nodes) if (name.startsWith('light_')) anchors.push(n);
    }
    const use = anchors.slice(0, 2);
    for (const a of use) {
      const l = new THREE.SpotLight(0xfff0d0, 0, 90, 0.55, 0.45, 1.2);
      l.position.set(0, 0, 0);
      const target = new THREE.Object3D();
      target.position.set(0, -0.8, -10);
      a.add(l);
      a.add(target);
      l.target = target;
      l.castShadow = false;
      this.headlights.push(l);
    }
    if (!use.length) {
      const l = new THREE.SpotLight(0xfff0d0, 0, 80, 0.6, 0.5, 1.2);
      l.position.set(0, 1.2, -1);
      const target = new THREE.Object3D();
      target.position.set(0, 0, -12);
      this.root.add(l, target);
      l.target = target;
      this.headlights.push(l);
    }
  }

  // ------------------------------------------------------------------ mass & systems
  refreshMass() {
    let mass = 0;
    const com = new THREE.Vector3();
    const entries: { m: number; c: THREE.Vector3; s: THREE.Vector3 }[] = [];
    const tanks = this.parts.filter((p) => !p.detached && p.def.stats.fuelCap);
    const tankCap = tanks.reduce((s, p) => s + (p.def.stats.fuelCap ?? 0), 0);
    for (const p of this.parts) {
      if (p.detached) continue;
      let m = p.def.mass;
      if (p.def.stats.fuelCap && tankCap > 0) m += (this.fuel * FUEL_DENSITY * (p.def.stats.fuelCap ?? 0)) / tankCap;
      const c = p.layout.bounds.getCenter(new THREE.Vector3());
      entries.push({ m, c, s: p.layout.bounds.getSize(new THREE.Vector3()) });
      mass += m;
      com.addScaledVector(c, m);
    }
    if (this.cargoMass > 0) {
      const frame = this.parts[0];
      const c = frame.layout.bounds.getCenter(new THREE.Vector3());
      entries.push({ m: this.cargoMass, c, s: new THREE.Vector3(1, 0.5, 1) });
      mass += this.cargoMass;
      com.addScaledVector(c, this.cargoMass);
    }
    com.divideScalar(Math.max(1, mass));
    let ixx = 0, iyy = 0, izz = 0, ixy = 0, ixz = 0, iyz = 0;
    for (const e of entries) {
      const r = e.c.clone().sub(com);
      const s = e.s;
      ixx += (e.m / 12) * (s.y * s.y + s.z * s.z) + e.m * (r.y * r.y + r.z * r.z);
      iyy += (e.m / 12) * (s.x * s.x + s.z * s.z) + e.m * (r.x * r.x + r.z * r.z);
      izz += (e.m / 12) * (s.x * s.x + s.y * s.y) + e.m * (r.x * r.x + r.y * r.y);
      ixy -= e.m * r.x * r.y;
      ixz -= e.m * r.x * r.z;
      iyz -= e.m * r.y * r.z;
    }
    const eig = symmetricEigen3([ixx, ixy, ixz, iyy, iyz, izz]);
    const m4 = new THREE.Matrix4().setFromMatrix3(eig.vectors);
    if (m4.determinant() < 0) {
      const el = m4.elements;
      el[8] *= -1;
      el[9] *= -1;
      el[10] *= -1;
    }
    const frameQ = new THREE.Quaternion().setFromRotationMatrix(m4);
    this.mass = mass;
    this.comLocal.copy(com);
    const pi = { x: Math.max(1, eig.values[0]), y: Math.max(1, eig.values[1]), z: Math.max(1, eig.values[2]) };
    this.body.setAdditionalMassProperties(mass, { x: com.x, y: com.y, z: com.z }, pi, { x: frameQ.x, y: frameQ.y, z: frameQ.z, w: frameQ.w }, true);
    // Radius for broad-phase hit tests
    let r = 1;
    for (const p of this.parts) {
      if (p.detached) continue;
      const b = p.layout.bounds;
      r = Math.max(r, b.min.length(), b.max.length());
    }
    this.boundRadius = r + 1.5;
    // Systems from alive parts
    let gen = 0, cool = 6 + mass / 250, bat = 0, dis = 0;
    this.antiMass = 1;
    for (const p of this.parts) {
      if (!p.functional) continue;
      if (p.def.category !== 'engine') gen += (p.def.stats.powerGen ?? 0) * p.efficiency;
      else gen += (p.def.stats.powerGen ?? 0) * p.efficiency;
      cool += (p.def.stats.cooling ?? 0) * p.efficiency;
      bat += p.def.stats.batteryCap ?? 0;
      dis += p.def.stats.maxDischarge ?? 0;
      if (p.def.special?.includes('anti-mass')) this.antiMass = 0.75;
    }
    this.powerGen = gen;
    this.cooling = cool;
    this.energyCap = 40 + bat;
    this.energy = Math.min(this.energy, this.energyCap);
    this.maxDischarge = 60 + dis;
    this.heatCap = 80 + mass / 20;
    this.body.setGravityScale(this.antiMass, true);
  }

  /** Register electrical demand for this step (kW). Consumers scale output by powerRatio. */
  demand(kw: number) {
    this.powerDemand += Math.max(0, kw);
  }

  /** Draw instantaneous energy (kJ) for a shot. Returns true if available. */
  drawEnergy(kj: number) {
    if (this.energy >= kj) {
      this.energy -= kj;
      return true;
    }
    return false;
  }

  addHeat(h: number) {
    this.heat += h;
  }

  useFuel(litres: number) {
    if (this.fuel <= 0) return false;
    this.fuel = Math.max(0, this.fuel - litres);
    return true;
  }

  get hasFuel() {
    return this.fuel > 0.01;
  }

  private stepSystems(dt: number) {
    // Generators burn fuel proportional to load
    let gen = 0;
    const load = this.powerGen > 0 ? clamp01(this.powerDemandLast / this.powerGen) : 0;
    for (const p of this.parts) {
      if (!p.functional) continue;
      const g = p.def.stats.powerGen ?? 0;
      if (g <= 0 || p.def.category === 'engine') continue;
      const burns = (p.def.stats.fuelUse ?? 0) > 0;
      if (burns) {
        if (!this.hasFuel) continue;
        this.useFuel(((p.def.stats.fuelUse ?? 0) / 60) * (0.25 + 0.75 * load) * dt);
      }
      gen += g * p.efficiency;
      this.addHeat((p.def.stats.heat ?? 0) * (0.3 + 0.7 * load) * dt);
    }
    // Engine alternators handled by ground controller (they only produce while running)
    gen += this.controller?.alternatorPower?.() ?? 0;
    const demand = this.powerDemand;
    const deficit = demand - gen;
    if (deficit > 0) {
      const discharge = Math.min(deficit, this.maxDischarge, this.energy / dt);
      this.energy -= discharge * dt;
      this.powerRatio = demand > 0 ? clamp01((gen + discharge) / demand) : 1;
    } else {
      this.energy = Math.min(this.energyCap, this.energy - deficit * dt);
      this.powerRatio = 1;
    }
    this.powerDemandLast = demand;
    this.powerDemand = 0;
    // Heat
    this.heat = Math.max(0, this.heat - this.cooling * dt);
    if (this.heat > this.heatCap) {
      if (!this.overheated && this.isPlayer) this.ctx.events.emit('notify', { text: 'OVERHEATING — systems throttled', kind: 'bad' });
      this.overheated = true;
      this.heat = Math.min(this.heat, this.heatCap * 1.3);
      // cook the hottest components slowly
      for (const p of this.parts) {
        if (!p.functional) continue;
        const h = p.def.category === 'weapon' ? 0 : p.def.stats.heat ?? 0;
        if (h > 8) this.damagePartDirect(p, h * 0.04 * dt, null, 'heat');
      }
    } else if (this.overheated && this.heat < this.heatCap * 0.6) {
      this.overheated = false;
    }
    this.mats.uniforms.uHeat.value = clamp01(this.heat / this.heatCap);
  }

  // ------------------------------------------------------------------ simulation
  prePhysics(dt: number) {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.age += dt;
    const t = this.body.translation();
    const r = this.body.rotation();
    const lv = this.body.linvel();
    const av = this.body.angvel();
    this.velocity.set(lv.x, lv.y, lv.z);
    this.angVel.set(av.x, av.y, av.z);
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
    const wc = this.body.worldCom();
    this.worldCom.set(wc.x, wc.y, wc.z);
    if (!this.alive) {
      this.input = emptyInput();
    }
    this.controller.fixedUpdate(dt);
    if (this.alive) for (const w of this.weapons) w.fixedUpdate(dt);
    this.stepSystems(dt);
    this.stepPartHazards(dt);
    // Fall out of the world safety net
    if (t.y < this.ctx.terrain.heightAt(t.x, t.z) - 30) {
      const h = this.ctx.terrain.heightAt(t.x, t.z) + 3;
      this.body.setTranslation({ x: t.x, y: h, z: t.z }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /** Move the machine instantly (towing, tests), upright and at rest, feet on the ground. */
  teleport(pos: THREE.Vector3, yaw: number) {
    if (this.disposed) return;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.currPos.copy(pos);
    this.prevPos.copy(pos);
    this.currQuat.copy(q);
    this.prevQuat.copy(q);
    const wc = this.body.worldCom();
    this.worldCom.set(wc.x, wc.y, wc.z);
    this.velocity.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.controller.resetPose?.();
    this.updateHitMatrices();
  }

  postPhysics() {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
    this.updateHitMatrices();
  }

  updateHitMatrices() {
    this.root.position.copy(this.currPos);
    this.root.quaternion.copy(this.currQuat);
    this.root.updateMatrixWorld(true);
    for (const p of this.parts) {
      if (p.detached) continue;
      p.world.copy(p.node.matrixWorld);
      p.invWorld.copy(p.world).invert();
      const vols = this.volumes.get(p)!;
      let n = 0;
      p.worldCenter.set(0, 0, 0);
      for (const v of vols) {
        v.inv.copy(v.obj.matrixWorld).invert();
        v.box.getCenter(v.center).applyMatrix4(v.obj.matrixWorld);
        p.worldCenter.add(v.center);
        n++;
      }
      if (n) p.worldCenter.divideScalar(n);
      else p.worldCenter.setFromMatrixPosition(p.world);
    }
    const wc = this.body.worldCom();
    this.worldCom.set(wc.x, wc.y, wc.z);
  }

  /** Visual update with interpolation factor alpha between the last two physics states. */
  update(dt: number, alpha: number) {
    if (this.batch) {
      this.batch.update(dt);
      const d = detailSettings.smallPartDistance;
      this.batch.setSmallVisible(this.isPlayer || this.root.position.distanceToSquared(this.ctx.camera.position) < d * d);
    }
    this.root.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.root.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    this.mats.uniforms.uRootInv.value.copy(this.root.matrixWorld).invert();
    // Wheel/leg poses and weapon animation are visual only: a quarter rate when off-screen or far
    this.visualDt += dt;
    const cam = this.ctx.camera.position;
    _sphere.center.copy(this.root.position);
    _sphere.radius = this.boundRadius + 2;
    const seen = this.isPlayer || (this.root.position.distanceToSquared(cam) < 250 * 250 && this.ctx.viewFrustum.intersectsSphere(_sphere));
    if (seen || ++this.visualTick % 4 === 0) {
      this.controller.update(this.visualDt);
      for (const w of this.weapons) w.update(this.visualDt);
      this.visualDt = 0;
    }
    this.updateEffects(dt);
    // Lights
    const on = this.input.lights && this.alive;
    if (on !== this.lightsOn) {
      this.lightsOn = on;
      this.mats.setLights(on);
    }
    for (const l of this.headlights) l.intensity = on ? 38 : 0;
    // Only the root here: the renderer updates the rest of the hierarchy once, right before drawing.
    this.root.updateMatrix();
    this.root.matrixWorld.copy(this.root.matrix);
    this.mats.uniforms.uRootInv.value.copy(this.root.matrixWorld).invert();
  }

  // ------------------------------------------------------------------ queries
  get position() {
    return this.currPos;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.currQuat);
  }

  up(out = new THREE.Vector3()) {
    return out.set(0, 1, 0).applyQuaternion(this.currQuat);
  }

  right(out = new THREE.Vector3()) {
    return out.set(1, 0, 0).applyQuaternion(this.currQuat);
  }

  get speed() {
    return this.velocity.length();
  }

  get cockpit() {
    return this.parts.find((p) => p.def.category === 'cockpit') ?? null;
  }

  get frame() {
    return this.parts[0];
  }

  healthFraction() {
    const c = this.cockpit;
    const f = this.frame;
    return Math.min(c ? c.cond : 1, f.cond);
  }

  /** Ray vs all hit volumes. Rotor discs let most rounds through between blades. */
  raycastParts(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, ignore?: Set<PartRuntime>): PartHit | null {
    // sphere prune
    _v.copy(this.worldCom).sub(origin);
    const tc = _v.dot(dir);
    const d2 = _v.lengthSq() - tc * tc;
    if (d2 > this.boundRadius * this.boundRadius) return null;
    if (tc < -this.boundRadius || tc - this.boundRadius > maxDist) return null;
    let best: PartHit | null = null;
    for (const p of this.parts) {
      if (p.detached) continue;
      if (ignore?.has(p)) continue;
      const vols = this.volumes.get(p)!;
      for (const v of vols) {
        _o.copy(origin).applyMatrix4(v.inv);
        _d.copy(dir).transformDirection(v.inv);
        const t = rayBox(_o, _d, v.box);
        if (t === null) continue;
        const tw = t; // node matrices are rigid (unit scale, possibly mirrored)
        if (tw > maxDist || tw < 0) continue;
        if (best && tw >= best.t) continue;
        if (p.def.category === 'rotor' && v.obj.name.startsWith('spin') && rand() > 0.3) continue;
        const point = origin.clone().addScaledVector(dir, tw);
        const localHit = _o.clone().addScaledVector(_d, t);
        const n = boxNormal(localHit, v.box).transformDirection(v.obj.matrixWorld);
        best = { part: p, t: tw, point, normal: n };
      }
    }
    return best;
  }

  /** Nearest part volume centre to a world point, with distance. */
  partsNear(point: THREE.Vector3, radius: number) {
    const out: { part: PartRuntime; dist: number }[] = [];
    for (const p of this.parts) {
      if (p.detached) continue;
      const vols = this.volumes.get(p)!;
      let best = Infinity;
      for (const v of vols) {
        _o.copy(point).applyMatrix4(v.inv);
        const cp = v.box.clampPoint(_o, _v2).applyMatrix4(v.obj.matrixWorld);
        best = Math.min(best, cp.distanceTo(point));
      }
      if (best <= radius) out.push({ part: p, dist: best });
    }
    return out;
  }

  // ------------------------------------------------------------------ damage
  /** Apply raw damage to a part (after armour), handling state changes. */
  damagePartDirect(p: PartRuntime, amount: number, source: Machine | null, kind: string) {
    if (p.destroyed || amount <= 0) return false;
    p.hp -= amount;
    p.lastHitTime = this.ctx.time;
    this.lastDamageTime = this.ctx.time;
    if (source && source !== this) {
      this.lastAttacker = source;
      this.lastAttackTime = this.ctx.time;
    }
    this.damageTaken += amount;
    const lvl = damageLevelFor(p.hp / p.maxHp);
    if (lvl !== p.damageLevel && p.hp > 0) {
      p.damageLevel = lvl;
      this.setLook(p, lvl);
    }
    if (this.isPlayer) this.ctx.events.emit('playerDamaged', { amount });
    if (p.hp <= 0) {
      this.destroyPart(p, source, kind);
      return true;
    }
    // Fuel tanks leak when damaged
    if (p.def.category === 'fuel' && !p.def.special?.includes('self-sealing') && p.hp < p.maxHp * 0.6) {
      p.leaking = Math.max(p.leaking, 0.4 + (1 - p.cond) * 1.2);
      if ((kind === 'fire' || kind === 'explosive' || kind === 'flame') && rand() < 0.35) p.burning = Math.max(p.burning, 8);
    }
    return false;
  }

  destroyPart(p: PartRuntime, source: Machine | null, kind = 'damage') {
    if (p.destroyed) return;
    p.destroyed = true;
    p.hp = 0;
    p.damageLevel = 2;
    this.setLook(p, 2);
    const pos = p.worldCenter.clone();
    const fx = this.ctx.fx;
    fx.sparks(pos, new THREE.Vector3(0, 1, 0), 24, 10, 1);
    fx.smoke(pos, new THREE.Vector3(0, 2, 0), 0.6, 2.5, [0.12, 0.11, 0.1], 0.7, 3);
    fx.glow(pos, 1.2, [3, 1.6, 0.5], 0.12);
    this.ctx.audio.play('partBreak', pos, { volume: 0.9 });
    this.ctx.events.emit('partDestroyed', { machine: this, part: p, source });
    const cat = p.def.category;
    // Category consequences
    if (cat === 'fuel' && !p.def.special?.includes('self-sealing')) {
      this.internalExplosion(p, 3.2, 60, source);
      p.burning = 10;
    } else if (p.def.special?.includes('explosive')) {
      this.internalExplosion(p, 2.5, 55, source);
    } else if (p.def.special?.includes('volatile')) {
      this.internalExplosion(p, 7, 260, source);
    } else if (cat === 'engine' || cat === 'generator') {
      p.burning = 14;
      fx.explosion(pos, 0.7, { debris: true, scorch: false });
    } else if (cat === 'battery') {
      fx.sparks(pos, new THREE.Vector3(0, 1, 0), 40, 6, 1.2, [0.5, 0.8, 1]);
    }
    if (cat === 'cockpit' || cat === 'frame') {
      this.kill(source, cat === 'cockpit' ? 'pilot' : 'structural');
      return;
    }
    // Knock the part off?
    const chance = cat === 'armor' ? 0.95 : cat === 'wheel' ? 0.55 : cat === 'rotor' ? 0.45 : cat === 'arm' ? 0.6 : 0.65;
    if (DETACHABLE.has(cat) && rand() < chance) this.detachPart(p, pos.clone().sub(this.worldCom).normalize().multiplyScalar(4));
    this.controller.onPartChanged(p);
    for (const w of this.weapons) if (w.part === p || !w.part.functional) w.disabled = true;
    this.refreshMass();
  }

  private internalExplosion(p: PartRuntime, radius: number, damage: number, source: Machine | null) {
    const pos = p.worldCenter.clone();
    this.ctx.fx.explosion(pos, radius / 3.2);
    this.ctx.audio.play('explosion', pos, { volume: 1, size: radius / 3 });
    this.ctx.events.emit('explosion', { pos, size: radius / 3 });
    for (const { part, dist } of this.partsNear(pos, radius)) {
      if (part === p) continue;
      const f = 1 - dist / radius;
      const armor = part.def.armor;
      const eff = armor > 20 ? 0.5 : 1;
      this.damagePartDirect(part, damage * f * eff, source, 'explosive');
    }
    const imp = pos.clone().sub(this.worldCom).normalize().multiplyScalar(-damage * 25);
    this.body.applyImpulseAtPoint({ x: imp.x, y: imp.y + damage * 10, z: imp.z }, { x: pos.x, y: pos.y, z: pos.z }, true);
  }

  detachPart(p: PartRuntime, impulseDir: THREE.Vector3, intact = false) {
    if (p.detached) return;
    // Collect subtree
    const subtree: PartRuntime[] = [];
    const collect = (x: PartRuntime) => {
      subtree.push(x);
      for (const c of x.children) collect(c);
    };
    collect(p);
    for (const x of subtree) {
      x.detached = true;
      if (x.collider) {
        this.ctx.physics.owners.delete(x.collider.handle);
        this.ctx.physics.world.removeCollider(x.collider, true);
        x.collider = null;
      }
      this.controller.onPartChanged(x);
      for (const w of this.weapons) if (w.part === x) w.disabled = true;
    }
    // Un-merge before the visual leaves: the debris shows the part's own meshes
    this.batch?.rebuild();
    // Hand the visual over to the debris system with world transform preserved
    p.node.updateMatrixWorld(true);
    const world = p.node.matrixWorld.clone();
    p.node.parent?.remove(p.node);
    const vel = this.velocity.clone().add(impulseDir).add(new THREE.Vector3(randRange(-1.5, 1.5), randRange(2, 5), randRange(-1.5, 1.5)));
    const mass = subtree.reduce((s, x) => s + x.def.mass, 0);
    this.ctx.debris.spawnFromPart(this, p, world, vel, mass, intact && !p.destroyed);
    this.ctx.events.emit('partDetached', { machine: this, part: p });
    this.refreshMass();
  }

  kill(source: Machine | null, cause: string) {
    if (!this.alive) return;
    this.alive = false;
    this.wreck = true;
    this.deathTime = this.ctx.time;
    if (!source && this.lastAttacker && this.ctx.time - this.lastAttackTime < 30) source = this.lastAttacker;
    this.killedBy = source;
    this.deathCause = cause;
    if (cause === 'bailed') {
      // Pilot abandoned the machine: no explosion, everything left intact for salvage.
      this.mats.setLights(false);
      for (const w of this.weapons) w.disabled = true;
      this.ctx.fx.smoke(this.worldCom, new THREE.Vector3(0, 1.5, 0), 0.6, 3, [0.5, 0.5, 0.5], 0.4, 3);
      this.ctx.events.emit('machineKilled', { machine: this, source, cause });
      return;
    }
    const pos = this.worldCom.clone();
    const big = cause === 'structural' || cause === 'explosion';
    this.ctx.fx.explosion(pos, big ? 1.6 + this.boundRadius * 0.15 : 0.9);
    this.ctx.audio.play('explosion', pos, { volume: 1.2, size: big ? 2 : 1 });
    this.ctx.events.emit('explosion', { pos, size: big ? 2 : 1 });
    // Collateral damage to remaining parts: a structural kill wrecks more of the machine.
    for (const p of this.parts) {
      if (p.destroyed || p.detached) continue;
      if (p.def.category === 'frame' || p.def.category === 'cockpit') continue;
      const frac = big ? randRange(0.05, 0.75) : randRange(0, 0.25);
      p.hp -= p.maxHp * frac;
      if (p.hp <= 0) {
        p.hp = 0;
        p.destroyed = true;
        p.damageLevel = 2;
        this.setLook(p, 2);
      } else {
        const lvl = damageLevelFor(p.hp / p.maxHp);
        p.damageLevel = lvl;
        this.setLook(p, lvl);
      }
      if (p.def.category === 'engine' || p.def.category === 'generator' || p.def.category === 'fuel') p.burning = Math.max(p.burning, randRange(8, 25));
    }
    // Some parts get blown clear — intact ones become loot lying on the ground
    if (big) {
      for (const p of [...this.parts]) {
        if (p.detached || !DETACHABLE.has(p.def.category)) continue;
        if (rand() < 0.18) {
          const dir = p.worldCenter.clone().sub(pos).normalize().multiplyScalar(randRange(4, 9));
          this.detachPart(p, dir, true);
        }
      }
    }
    this.frame.burning = randRange(12, 30);
    const up = this.up();
    this.body.applyImpulse({ x: up.x * this.mass * 1.5, y: this.mass * (big ? 4 : 1.5), z: up.z * this.mass * 1.5 }, true);
    this.body.applyTorqueImpulse({ x: randRange(-1, 1) * this.mass * 1.2, y: randRange(-1, 1) * this.mass, z: randRange(-1, 1) * this.mass * 1.2 }, true);
    this.mats.setLights(false);
    for (const w of this.weapons) w.disabled = true;
    this.ctx.events.emit('machineKilled', { machine: this, source, cause });
  }

  private stepPartHazards(dt: number) {
    for (const p of this.parts) {
      if (p.detached) continue;
      if (p.leaking > 0) {
        this.fuel = Math.max(0, this.fuel - p.leaking * dt);
        if (this.fuel <= 0) p.leaking = 0;
      }
      if (p.burning > 0) {
        p.burning -= dt;
        if (this.alive && !p.destroyed) {
          this.damagePartDirect(p, 6 * dt, null, 'fire');
        }
        // spread
        if (this.alive && rand() < dt * 0.08) {
          const near = this.partsNear(p.worldCenter, 1.2);
          const target = near[Math.floor(rand() * near.length)];
          if (target && target.part.burning <= 0 && !target.part.destroyed) target.part.burning = randRange(3, 8);
        }
      }
    }
  }

  private updateEffects(dt: number) {
    this.fxAccum += dt;
    if (this.fxAccum < 0.05) return;
    const step = this.fxAccum;
    this.fxAccum = 0;
    const fx = this.ctx.fx;
    const cam = this.ctx.camera.position;
    const distK = clamp01(1 - cam.distanceTo(this.currPos) / 350);
    if (distK <= 0) return;
    for (const p of this.parts) {
      if (p.detached) continue;
      p.fxTimer -= step;
      if (p.fxTimer > 0) continue;
      const pos = p.worldCenter;
      if (p.burning > 0) {
        p.fxTimer = 0.06;
        fx.fire(pos, 0.5 + p.radius * 0.4);
        if (rand() < 0.5) fx.smoke(_v.copy(pos).add(new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3(randRange(-0.3, 0.3), 2.5, randRange(-0.3, 0.3)), 0.6, 4, [0.08, 0.075, 0.07], 0.7, 4);
        if (rand() < 0.1) this.ctx.fx.flash(pos, 0xff7a30, 6, 12, 0.3, 0);
        continue;
      }
      if (p.leaking > 0) {
        p.fxTimer = 0.12;
        fx.smoke(pos, new THREE.Vector3(0, -2, 0), 0.08, 0.6, [0.25, 0.22, 0.18], 0.5, 1.5);
      }
      if (p.damageLevel === 2 && !this.wreck) {
        p.fxTimer = 0.18 + rand() * 0.2;
        fx.smoke(pos, new THREE.Vector3(randRange(-0.3, 0.3), 1.5, randRange(-0.3, 0.3)), 0.35, 2.2, [0.12, 0.11, 0.1], 0.55, 3);
        if (rand() < 0.3) fx.sparks(pos, new THREE.Vector3(0, 1, 0), 4, 4, 1);
      } else if (p.damageLevel === 1) {
        p.fxTimer = 0.35 + rand() * 0.4;
        const electronic = ['sensor', 'battery', 'generator', 'cockpit'].includes(p.def.category);
        if (electronic && rand() < 0.5) fx.sparks(pos, new THREE.Vector3(0, 1, 0), 5, 3, 1, [0.6, 0.8, 1]);
        else fx.smoke(pos, new THREE.Vector3(randRange(-0.2, 0.2), 1.0, randRange(-0.2, 0.2)), 0.2, 1.6, [0.35, 0.34, 0.33], 0.35, 3);
      } else {
        p.fxTimer = 1 + rand();
      }
      if (this.wreck && p === this.frame && this.ctx.time - this.deathTime < 90) {
        p.fxTimer = 0.25;
        fx.smoke(pos, new THREE.Vector3(randRange(-0.4, 0.4), 2.2, randRange(-0.4, 0.4)), 0.8, 5, [0.1, 0.095, 0.09], 0.6, 4);
      }
    }
  }

  /** Write part condition back into the design (after a sortie). */
  syncDesignCondition() {
    for (const p of this.parts) {
      p.placed.cond = p.detached && !p.destroyed ? Math.max(0, p.cond) : Math.max(0, p.cond);
    }
  }

  /** Set once the physics body is freed; the machine must not be touched after that. */
  disposed = false;
  private visualDt = 0;
  private visualTick = 0;
  /** Rigid meshes merged per material (fewer draw calls); null when batching is off. */
  batch: MachineBatch | null = null;

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.batch?.clear();
    for (const p of this.parts) {
      if (p.collider) this.ctx.physics.owners.delete(p.collider.handle);
    }
    this.ctx.physics.removeBody(this.body);
    this.root.parent?.remove(this.root);
    this.controller.dispose?.();
    this.mats.dispose();
  }
}

/** Slab test: returns entry distance along the (unnormalised) local ray or null. */
function rayBox(o: THREE.Vector3, d: THREE.Vector3, b: THREE.Box3): number | null {
  let tmin = -Infinity,
    tmax = Infinity;
  for (const axis of ['x', 'y', 'z'] as const) {
    const inv = 1 / d[axis];
    let t1 = (b.min[axis] - o[axis]) * inv;
    let t2 = (b.max[axis] - o[axis]) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmax < tmin) return null;
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : 0;
}

function boxNormal(p: THREE.Vector3, b: THREE.Box3) {
  const c = b.getCenter(new THREE.Vector3());
  const s = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const d = p.clone().sub(c);
  const ax = Math.abs(d.x / Math.max(1e-4, s.x));
  const ay = Math.abs(d.y / Math.max(1e-4, s.y));
  const az = Math.abs(d.z / Math.max(1e-4, s.z));
  if (ax > ay && ax > az) return new THREE.Vector3(Math.sign(d.x), 0, 0);
  if (ay > az) return new THREE.Vector3(0, Math.sign(d.y), 0);
  return new THREE.Vector3(0, 0, Math.sign(d.z));
}

export { GRAVITY, lerp, clamp };
