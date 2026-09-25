/**
 * Engineering analysis of a machine design. Everything here is derived from the
 * physical parts (mass, placement, thrust vectors, power budget) — no arbitrary ratings.
 */
import * as THREE from 'three';
import type { MachineDesign, PartDef } from './types';
import { layoutDesign, LayoutResult, PartLayout } from './layout';
import { symmetricEigen3 } from '../core/math';
import { GRAVITY } from '../physics/physics';

export const FUEL_DENSITY = 0.75; // kg per litre

export interface Warning {
  level: 'error' | 'warn' | 'info';
  text: string;
}

export interface MachineStats {
  cls: MachineDesign['cls'];
  mass: number;
  dryMass: number;
  com: THREE.Vector3;
  principalInertia: THREE.Vector3;
  inertiaFrame: THREE.Quaternion;
  bounds: THREE.Box3;
  hp: number;
  armorWeighted: number;
  powerGen: number;
  powerDrawPeak: number;
  powerDrawLocomotion: number;
  batteryCap: number;
  batteryDischarge: number;
  heatPeak: number;
  cooling: number;
  fuelCap: number;
  fuelUsePeak: number;
  cargo: number;
  // ground
  wheelCount: number;
  trackCount: number;
  torque: number;
  maxRpm: number;
  topSpeed: number; // m/s estimate
  accel0to100: number; // seconds estimate
  // air
  thrustVertical: number;
  twr: number;
  hoverPowerFraction: number;
  comLiftOffset: number;
  // mech
  legCount: number;
  legCapacity: number;
  loadRatio: number;
  walkSpeed: number;
  // combat
  weaponCount: number;
  dps: number;
  alphaDamage: number;
  maxRecoilDv: number;
  scanRange: number;
  radarRange: number;
  warnings: Warning[];
  valid: boolean;
  layout: LayoutResult;
}

function sum(parts: PartLayout[], f: (d: PartDef, p: PartLayout) => number | undefined) {
  let s = 0;
  for (const p of parts) s += f(p.def, p) ?? 0;
  return s;
}

export function partCenter(p: PartLayout, out = new THREE.Vector3()) {
  return p.bounds.getCenter(out);
}

export function computeStats(design: MachineDesign, fuelFraction = 1): MachineStats {
  const layout = layoutDesign(design);
  const parts = layout.parts;
  const warnings: Warning[] = layout.errors.map((e) => ({ level: 'error' as const, text: e }));
  const alive = parts.filter((p) => p.placed.cond > 0);
  const cond = (p: PartLayout) => (p.placed.cond > 0 ? 1 : 0);

  // ---- Mass properties ----
  const fuelCap = sum(parts, (d, p) => (d.stats.fuelCap ?? 0) * cond(p));
  let mass = 0;
  const com = new THREE.Vector3();
  const c = new THREE.Vector3();
  const masses: { m: number; c: THREE.Vector3; size: THREE.Vector3 }[] = [];
  for (const p of parts) {
    let m = p.def.mass;
    if (p.def.stats.fuelCap) m += p.def.stats.fuelCap * FUEL_DENSITY * fuelFraction * cond(p);
    partCenter(p, c);
    masses.push({ m, c: c.clone(), size: p.bounds.getSize(new THREE.Vector3()) });
    mass += m;
    com.addScaledVector(c, m);
  }
  if (mass > 0) com.divideScalar(mass);
  const dryMass = sum(parts, (d) => d.mass);
  // Inertia tensor about COM (parts as solid boxes, axis-aligned in machine space)
  let ixx = 0,
    iyy = 0,
    izz = 0,
    ixy = 0,
    ixz = 0,
    iyz = 0;
  for (const e of masses) {
    const { m, size } = e;
    const r = e.c.clone().sub(com);
    ixx += (m / 12) * (size.y * size.y + size.z * size.z) + m * (r.y * r.y + r.z * r.z);
    iyy += (m / 12) * (size.x * size.x + size.z * size.z) + m * (r.x * r.x + r.z * r.z);
    izz += (m / 12) * (size.x * size.x + size.y * size.y) + m * (r.x * r.x + r.y * r.y);
    ixy -= m * r.x * r.y;
    ixz -= m * r.x * r.z;
    iyz -= m * r.y * r.z;
  }
  const eig = symmetricEigen3([ixx, ixy, ixz, iyy, iyz, izz]);
  const rotM = new THREE.Matrix4().setFromMatrix3(eig.vectors);
  if (rotM.determinant() < 0) {
    // keep a proper rotation
    const e = rotM.elements;
    e[8] = -e[8];
    e[9] = -e[9];
    e[10] = -e[10];
    eig.values[2] = eig.values[2];
  }
  const inertiaFrame = new THREE.Quaternion().setFromRotationMatrix(rotM);
  const principalInertia = new THREE.Vector3(Math.max(eig.values[0], 1), Math.max(eig.values[1], 1), Math.max(eig.values[2], 1));
  const bounds = new THREE.Box3();
  for (const p of parts) bounds.union(p.bounds);

  // ---- Power / heat / fuel ----
  const powerGen = sum(alive, (d) => d.stats.powerGen);
  const batteryCap = sum(alive, (d) => d.stats.batteryCap);
  const batteryDischarge = sum(alive, (d) => d.stats.maxDischarge);
  const cooling = sum(alive, (d) => d.stats.cooling) + 6 + mass / 250;
  const locoCats = new Set(['rotor', 'jet', 'actuator', 'engine', 'hydraulics', 'wheel', 'suspension']);
  const powerDrawLocomotion = sum(alive, (d) => (locoCats.has(d.category) ? d.stats.powerDraw : 0));
  const weaponPower = sum(alive, (d) => {
    if (d.stats.energyPerShot) return d.stats.weapon === 'beam' ? d.stats.energyPerShot : d.stats.energyPerShot * (d.stats.rof ?? 1);
    return 0;
  });
  const powerDrawPeak = sum(alive, (d) => d.stats.powerDraw) + weaponPower;
  const heatPeak = sum(alive, (d) => {
    if (d.category === 'weapon') return (d.stats.heat ?? 0) * (d.stats.weapon === 'beam' || d.stats.weapon === 'flamer' ? 1 : d.stats.rof ?? 1);
    return d.stats.heat;
  });
  const fuelUsePeak = sum(alive, (d) => d.stats.fuelUse);
  const cargo = sum(alive, (d) => d.stats.cargo) + 120;
  const hp = sum(parts, (d) => d.hp);
  const armorWeighted = hp > 0 ? sum(parts, (d) => d.hp * d.armor) / hp : 0;

  // ---- Weapons ----
  const weapons = alive.filter((p) => p.def.category === 'weapon' || p.def.category === 'melee');
  let dps = 0;
  let alpha = 0;
  let maxRecoilDv = 0;
  let scanRange = 0;
  let radarRange = 0;
  for (const w of weapons) {
    const s = w.def.stats;
    const pellets = s.pellets ?? 1;
    const perShot = (s.damage ?? 0) * pellets + (s.splashDamage ?? 0) * 0.5;
    const rof = s.weapon === 'beam' || s.melee === 'drill' || s.melee === 'saw' ? 1 : s.rof ?? (s.swingTime ? 1 / s.swingTime : 1);
    let sustained = perShot * rof;
    if (s.magazine && s.reload) {
      const cycle = s.magazine / (s.rof ?? 1) + s.reload;
      sustained = (perShot * s.magazine) / cycle;
    }
    dps += sustained;
    alpha += perShot;
    if (s.recoil && mass > 0) maxRecoilDv = Math.max(maxRecoilDv, s.recoil / mass);
  }
  for (const p of alive) {
    scanRange = Math.max(scanRange, p.def.stats.scanRange ?? 0);
    radarRange = Math.max(radarRange, p.def.stats.radarRange ?? 0);
  }

  const cls = design.cls;
  const cockpit = parts.find((p) => p.def.category === 'cockpit');
  if (!cockpit) warnings.push({ level: 'error', text: 'Needs a cockpit — nobody is driving this.' });

  // ---- Ground ----
  const wheels = alive.filter((p) => p.def.category === 'wheel');
  const tracks = alive.filter((p) => p.def.category === 'track');
  const engines = alive.filter((p) => p.def.category === 'engine');
  const torque = sum(engines, (d) => d.stats.torque);
  const maxRpm = engines.length ? Math.max(...engines.map((e) => e.def.stats.maxRpm ?? 6000)) : 0;
  let topSpeed = 0;
  let accel0to100 = 0;
  if (cls === 'ground') {
    if (wheels.length + tracks.length * 3 < 3) warnings.push({ level: 'error', text: 'Needs at least 3 wheels or 2 tracks to drive.' });
    const axles = parts.filter((p) => p.def.category === 'suspension');
    for (const a of axles) if (!a.children.some((c) => c.def.category === 'wheel')) warnings.push({ level: 'warn', text: `${a.def.name} has no wheel attached.` });
    if (!engines.length) warnings.push({ level: 'error', text: 'No engine: the machine cannot move.' });
    const trans = alive.find((p) => p.def.category === 'transmission');
    if (!trans && engines.length) warnings.push({ level: 'warn', text: 'No transmission: direct drive gives weak acceleration and low top speed.' });
    const needsFuel = engines.some((e) => (e.def.stats.fuelUse ?? 0) > 0);
    if (needsFuel && fuelCap <= 0) warnings.push({ level: 'error', text: 'No fuel tank for the engine.' });
    // Suspension loading
    const contacts = wheels.length + tracks.length * 4;
    if (contacts > 0) {
      const perWheel = (mass * GRAVITY) / contacts;
      let over = 0;
      for (const w of wheels) {
        const sus = w.parent?.def;
        if (!sus) continue;
        const k = sus.stats.stiffness ?? 30000;
        const travel = sus.stats.travel ?? 0.3;
        if (perWheel / k > travel * 0.85) over++;
      }
      if (over > 0) warnings.push({ level: 'warn', text: `Suspension overloaded on ${over} wheel(s): it will bottom out. Use stiffer struts or lose weight.` });
    }
    // Speed estimate
    if (engines.length) {
      const gears = trans?.def.stats.gears ?? [1.0];
      const fd = trans?.def.stats.finalDrive ?? 3.2;
      const r = wheels.length ? wheels.reduce((a, w) => a + (w.def.stats.radius ?? 0.4), 0) / wheels.length : tracks[0]?.def.stats.radius ?? 0.4;
      const wheelRps = maxRpm / 60 / (gears[gears.length - 1] * fd);
      const gearedTop = wheelRps * 2 * Math.PI * r;
      const power = (torque * maxRpm * 0.85) / 9549; // kW approx
      const frontal = Math.max(1.5, (bounds.max.x - bounds.min.x) * (bounds.max.y - bounds.min.y) * 0.8);
      const dragTop = Math.cbrt((power * 1000 * 0.85) / (0.5 * 1.2 * 0.45 * frontal));
      topSpeed = Math.min(gearedTop, dragTop) * (tracks.length ? 0.6 : 1);
      const avgForce = (torque * gears[0] * fd * 0.5) / r;
      const maxTraction = mass * GRAVITY * 0.9;
      const a = Math.min(avgForce, maxTraction) / mass;
      accel0to100 = topSpeed > 27.8 ? 27.8 / Math.max(0.5, a) + 1.2 : 0;
    }
  }

  // ---- Air ----
  let thrustVertical = 0;
  let twr = 0;
  let hoverPowerFraction = 0;
  let comLiftOffset = 0;
  if (cls === 'air') {
    const lifts = alive.filter((p) => p.def.category === 'rotor' || p.def.category === 'jet');
    const liftCentroid = new THREE.Vector3();
    let rotorPower = 0;
    for (const l of lifts) {
      const dir = new THREE.Vector3(0, 1, 0).transformDirection(l.matrix);
      if (l.def.category === 'jet') dir.negate();
      const t = l.def.stats.thrust ?? 0;
      const up = Math.max(0, dir.y) * t;
      thrustVertical += up;
      liftCentroid.addScaledVector(partCenter(l), up);
      rotorPower += l.def.stats.powerDraw ?? 0;
    }
    if (thrustVertical > 0) liftCentroid.divideScalar(thrustVertical);
    twr = thrustVertical / Math.max(1, mass * GRAVITY);
    comLiftOffset = Math.hypot(liftCentroid.x - com.x, liftCentroid.z - com.z);
    if (!lifts.length) warnings.push({ level: 'error', text: 'No rotors or jets: it will never leave the ground.' });
    else if (twr < 1) warnings.push({ level: 'error', text: `Cannot take off: vertical thrust/weight is ${twr.toFixed(2)}. Add thrust or remove weight.` });
    else if (twr < 1.3) warnings.push({ level: 'warn', text: `Underpowered: thrust/weight ${twr.toFixed(2)} gives a sluggish climb.` });
    const hoverFrac = twr > 0 ? 1 / twr : 1;
    hoverPowerFraction = hoverFrac;
    const hoverPower = rotorPower * Math.pow(Math.min(1, hoverFrac), 1.5);
    if (rotorPower > 0 && hoverPower > powerGen + batteryDischarge * 0.3) warnings.push({ level: 'error', text: `Power deficit: hovering needs ${Math.round(hoverPower)} kW but you generate ${Math.round(powerGen)} kW.` });
    else if (rotorPower > powerGen * 1.15 && rotorPower > 0) warnings.push({ level: 'warn', text: `Full thrust needs ${Math.round(rotorPower)} kW; generators supply ${Math.round(powerGen)} kW. Climbing will drain the battery.` });
    if (comLiftOffset > 0.35) warnings.push({ level: 'warn', text: `Centre of mass is ${comLiftOffset.toFixed(2)} m from the centre of lift. Expect tilt — rebalance or add gyros.` });
    const reactionRotors = lifts.filter((l) => (l.def.stats.reaction ?? 0) > 0.06 && l.def.stats.radius! > 2);
    if (reactionRotors.length === 1) {
      const side = lifts.some((l) => {
        const dir = new THREE.Vector3(0, 1, 0).transformDirection(l.matrix);
        return Math.abs(dir.x) > 0.7 && Math.abs(partCenter(l).z - com.z) > 1.5;
      });
      if (!side) warnings.push({ level: 'error', text: 'Main rotor torque is uncorrected: add a sideways tail rotor at the tail, or it will spin uncontrollably.' });
    }
  }

  // ---- Mech ----
  let legCount = 0;
  let legCapacity = 0;
  let loadRatio = 0;
  let walkSpeed = 0;
  if (cls === 'mech') {
    const legs = parts.filter((p) => p.def.category === 'leg');
    const hydro = alive.filter((p) => p.def.category === 'hydraulics').reduce((m, p) => m * (p.def.stats.hydraulicBoost ?? 1), 1);
    let speedSum = 0;
    for (const leg of legs) {
      const joints = leg.children.filter((c) => c.def.category === 'actuator');
      const hipJ = leg.children.find((c) => c.placed.socket === 'hipjoint');
      const kneeJ = leg.children.find((c) => c.placed.socket === 'kneejoint');
      const foot = leg.children.find((c) => c.def.category === 'foot');
      if (!hipJ) warnings.push({ level: 'error', text: `${leg.def.name}: missing hip actuator.` });
      if (!kneeJ) warnings.push({ level: 'error', text: `${leg.def.name}: missing knee actuator.` });
      if (!foot) warnings.push({ level: 'warn', text: `${leg.def.name}: no foot — it will slip and sink.` });
      if (!hipJ || !kneeJ || leg.placed.cond <= 0) continue;
      legCount++;
      const strength = Math.min(...joints.map((j) => j.def.stats.jointStrength ?? 1));
      const speed = Math.min(...joints.map((j) => j.def.stats.jointSpeed ?? 1));
      legCapacity += (leg.def.stats.loadRating ?? 1500) * strength * hydro;
      speedSum += ((leg.def.stats.stride ?? 1.5) / (leg.def.stats.stepTime ?? 0.4)) * speed;
    }
    if (legCount < 2) warnings.push({ level: 'error', text: 'A walker needs at least two working legs.' });
    // Legs carry everything above the hips; count half the leg mass as self-supported.
    loadRatio = legCapacity > 0 ? mass / (legCapacity * (legCount >= 4 ? 0.9 : legCount === 2 ? 0.6 : 0.7)) : 9;
    walkSpeed = legCount ? (speedSum / legCount) * Math.max(0.25, Math.min(1.1, 1.35 - loadRatio * 0.5)) : 0;
    if (loadRatio > 1.0) warnings.push({ level: 'error', text: `Legs overloaded (${Math.round(loadRatio * 100)}%): they cannot hold this weight. Stronger joints, hydraulics or less mass.` });
    else if (loadRatio > 0.8) warnings.push({ level: 'warn', text: `Legs near their limit (${Math.round(loadRatio * 100)}%): slow and sluggish.` });
    const legDraw = sum(alive, (d) => (d.category === 'actuator' || d.category === 'hydraulics' ? d.stats.powerDraw : 0));
    if (legDraw > powerGen + batteryDischarge * 0.2) warnings.push({ level: 'error', text: `Joints need ${Math.round(legDraw)} kW but generators give ${Math.round(powerGen)} kW. Fit a bigger power core.` });
    for (const arm of parts.filter((p) => p.def.category === 'arm')) {
      const held = arm.children.reduce((m, c) => m + c.def.mass, 0);
      if (held > (arm.def.stats.loadRating ?? 300)) warnings.push({ level: 'warn', text: `${arm.def.name} is carrying ${Math.round(held)} kg (rated ${arm.def.stats.loadRating}): aiming will be slow.` });
    }
  }

  // ---- General engineering warnings ----
  if (heatPeak > cooling * 1.4) warnings.push({ level: 'warn', text: `Heat output ${Math.round(heatPeak)}/s exceeds cooling ${Math.round(cooling)}/s: sustained use will overheat.` });
  const fuelNeeded = alive.some((p) => (p.def.stats.fuelUse ?? 0) > 0);
  if (fuelNeeded && fuelCap <= 0 && cls !== 'ground') warnings.push({ level: 'error', text: 'Fuel-burning parts but no fuel tank.' });
  if (maxRecoilDv > 1.2) warnings.push({ level: 'warn', text: `Heavy recoil: a single shot shoves the machine ${maxRecoilDv.toFixed(1)} m/s. Expect instability.` });
  const drawNoWeapons = powerDrawPeak - weaponPower;
  if (powerGen <= 0 && drawNoWeapons > 0) warnings.push({ level: 'error', text: 'Parts need electrical power but nothing generates it.' });
  if (weaponPower > powerGen + batteryDischarge && weaponPower > 0) warnings.push({ level: 'warn', text: 'Energy weapons exceed your power supply: expect a slow rate of fire.' });
  if (!weapons.length) warnings.push({ level: 'info', text: 'Unarmed. Fine for scouting and hauling.' });

  const valid = !warnings.some((w) => w.level === 'error');
  return {
    cls,
    mass,
    dryMass,
    com,
    principalInertia,
    inertiaFrame,
    bounds,
    hp,
    armorWeighted,
    powerGen,
    powerDrawPeak,
    powerDrawLocomotion,
    batteryCap,
    batteryDischarge,
    heatPeak,
    cooling,
    fuelCap,
    fuelUsePeak,
    cargo,
    wheelCount: wheels.length,
    trackCount: tracks.length,
    torque,
    maxRpm,
    topSpeed,
    accel0to100,
    thrustVertical,
    twr,
    hoverPowerFraction,
    comLiftOffset,
    legCount,
    legCapacity,
    loadRatio,
    walkSpeed,
    weaponCount: weapons.length,
    dps,
    alphaDamage: alpha,
    maxRecoilDv,
    scanRange,
    radarRange,
    warnings,
    valid,
    layout,
  };
}
