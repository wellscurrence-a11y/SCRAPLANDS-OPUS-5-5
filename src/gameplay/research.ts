/**
 * Research unlocks technology *families* (new possibilities), not percentage bonuses.
 * Researching a node lets you fabricate and buy its parts; some rare parts additionally need blueprints.
 */
import type { Profile, Resource, WorkshopUpgrade } from './profile';
import { PARTS } from '../machines/parts/catalog';
import type { PartDef } from '../machines/types';
import { rarityIndex } from '../machines/types';

export interface TechNode {
  id: string;
  name: string;
  tier: number; // required research station level
  requires: string[];
  cost: Partial<Record<Resource, number>> & { credits?: number };
  time: number; // seconds of in-game research
  desc: string;
  unlocks: string; // human summary
  x: number; // tree layout column
  y: number; // row
}

export const TECH: TechNode[] = [
  { id: 'combustion2', name: 'Improved Combustion', tier: 1, requires: [], cost: { credits: 400, scrap: 30, mechanical: 10 }, time: 60, desc: 'Machined blocks, proper fuel injection and gearboxes that do not explode.', unlocks: 'Inline-6, V8 & Diesel engines, 5-speed and race gearboxes', x: 0, y: 0 },
  { id: 'suspension2', name: 'Advanced Suspension', tier: 1, requires: [], cost: { credits: 350, scrap: 25, mechanical: 12 }, time: 60, desc: 'Long-travel geometry and truck-grade struts.', unlocks: 'Heavy struts, long-travel kits, Dart scout chassis', x: 0, y: 1 },
  { id: 'rotors2', name: 'Rotor Dynamics', tier: 1, requires: [], cost: { credits: 450, scrap: 20, mechanical: 10, electronics: 6 }, time: 70, desc: 'Cyclic pitch control, ducted fans and proper helicopter rotor heads.', unlocks: 'Main & coaxial rotors, ducted fans, heli fuselage, military gyros', x: 0, y: 2 },
  { id: 'hydraulics2', name: 'Hydraulic Joints', tier: 1, requires: [], cost: { credits: 400, scrap: 25, mechanical: 14 }, time: 60, desc: 'Servo valves and high-pressure lines for faster, stronger walkers.', unlocks: 'Servo actuators, Strider legs, hydraulic pumps', x: 0, y: 3 },
  { id: 'ballistics2', name: 'Ballistics', tier: 1, requires: [], cost: { credits: 450, scrap: 30, mechanical: 12 }, time: 70, desc: 'Belt feeds, heavier calibres and explosive rounds.', unlocks: '20mm autocannon, Twin .50 HMG', x: 0, y: 4 },
  { id: 'rocketry', name: 'Rocketry', tier: 1, requires: [], cost: { credits: 400, scrap: 25, electronics: 6 }, time: 60, desc: 'Solid-fuel motors for weapons and boosters.', unlocks: 'Rocket pods, rocket boosters, jump jets, flamethrower', x: 0, y: 5 },
  { id: 'armor2', name: 'Armor Plating', tier: 1, requires: [], cost: { credits: 350, scrap: 40 }, time: 50, desc: 'Rolled steel, sloped plate and armoured cabs.', unlocks: 'Steel plates, sloped glacis, armoured cockpits, run-flat tyres', x: 0, y: 6 },
  { id: 'cooling2', name: 'Cooling Systems', tier: 1, requires: [], cost: { credits: 300, scrap: 20, electronics: 4 }, time: 45, desc: 'Heat sinks and forced-air cooling.', unlocks: 'Heat sink arrays, turbo fan coolers', x: 0, y: 7 },
  { id: 'turbines', name: 'Turbines', tier: 2, requires: ['combustion2'], cost: { credits: 1200, mechanical: 30, alloys: 6, data: 10 }, time: 120, desc: 'Gas turbines: enormous power density for engines, generators and jets.', unlocks: 'Gas turbine drive, turbine generator, turbojet, lift jets', x: 1, y: 0 },
  { id: 'tracks', name: 'Track Drives', tier: 2, requires: ['suspension2'], cost: { credits: 1100, scrap: 60, mechanical: 30, data: 8 }, time: 110, desc: 'Torsion bars, drive sprockets and linked tracks.', unlocks: 'Track units, Bastion tracked hull', x: 1, y: 1 },
  { id: 'aero', name: 'Aerodynamics', tier: 2, requires: ['rotors2'], cost: { credits: 1100, scrap: 30, alloys: 6, data: 10 }, time: 110, desc: 'Proper aerofoils and lifting bodies.', unlocks: 'Swept wings, air brakes, Kestrel VTOL airframe', x: 1, y: 2 },
  { id: 'heavyjoints', name: 'Heavy Mech Joints', tier: 2, requires: ['hydraulics2'], cost: { credits: 1300, mechanical: 40, alloys: 8, data: 10 }, time: 120, desc: 'Double-acting rams that carry tonnes.', unlocks: 'Heavy rams, walker legs, heavy weapon arms, crab walker chassis', x: 1, y: 3 },
  { id: 'heavyordnance', name: 'Heavy Ordnance', tier: 2, requires: ['ballistics2'], cost: { credits: 1500, scrap: 60, mechanical: 30, alloys: 8, data: 10 }, time: 130, desc: 'Artillery-grade guns. Mind the recoil.', unlocks: '75mm field cannon', x: 1, y: 4 },
  { id: 'guided', name: 'Guided Missiles', tier: 2, requires: ['rocketry'], cost: { credits: 1500, electronics: 25, data: 14 }, time: 130, desc: 'Seeker heads that lock onto a chosen component.', unlocks: 'Hydra missile racks, flare dispensers', x: 1, y: 5 },
  { id: 'composite', name: 'Composite Armor', tier: 2, requires: ['armor2'], cost: { credits: 1400, alloys: 14, data: 12 }, time: 130, desc: 'Ceramic-steel laminates: half the weight, twice the protection.', unlocks: 'Composite panels', x: 1, y: 6 },
  { id: 'batteries', name: 'Advanced Batteries', tier: 2, requires: ['cooling2'], cost: { credits: 1200, electronics: 30, data: 12 }, time: 120, desc: 'Dense cells and fast-discharge capacitors.', unlocks: 'Li-Ion packs, capacitor banks, fuel cell stacks', x: 1, y: 7 },
  { id: 'heavyframes', name: 'Heavy Frames', tier: 2, requires: ['tracks', 'heavyjoints'], cost: { credits: 2200, scrap: 120, alloys: 20, data: 18 }, time: 160, desc: 'Military chassis engineering for very large machines.', unlocks: 'Mule six-wheeler, Bulwark assault torso, torque converters', x: 2, y: 2 },
  { id: 'radar', name: 'Radar', tier: 2, requires: ['batteries'], cost: { credits: 1300, electronics: 30, data: 16 }, time: 120, desc: 'Rotating radar that shows machines far beyond sight.', unlocks: 'Radar masts', x: 2, y: 7 },
  { id: 'energy', name: 'Energy Weapons', tier: 3, requires: ['batteries', 'ballistics2'], cost: { credits: 3500, electronics: 60, raretech: 4, data: 30 }, time: 200, desc: 'Reverse-engineered Helix optics. Weapons that run on your power grid.', unlocks: 'Pulse lasers, lance beam lasers', x: 2, y: 5 },
  { id: 'vector', name: 'Vector Thrust', tier: 3, requires: ['turbines', 'aero'], cost: { credits: 3800, mechanical: 60, alloys: 25, raretech: 3, data: 30 }, time: 210, desc: 'Gimballed thrust and tilting rotors.', unlocks: 'Tiltrotor nacelles (Hornet VX needs a blueprint)', x: 2, y: 0 },
  { id: 'ew', name: 'Electronic Warfare', tier: 3, requires: ['radar', 'guided'], cost: { credits: 3200, electronics: 70, raretech: 3, data: 28 }, time: 190, desc: 'Jamming and decoys.', unlocks: 'EW jammers', x: 3, y: 6 },
];

export const TECH_MAP = new Map(TECH.map((t) => [t.id, t]));

export function researchStatus(p: Profile, t: TechNode): 'done' | 'active' | 'available' | 'locked' | 'station' {
  if (p.research.done.includes(t.id)) return 'done';
  if (p.research.active === t.id) return 'active';
  if (!t.requires.every((r) => p.research.done.includes(r))) return 'locked';
  if (p.workshop.research < t.tier) return 'station';
  return 'available';
}

/** Can the player fabricate/buy this part? */
export function partUnlocked(p: Profile, def: PartDef): boolean {
  if (def.unique) return false;
  if (def.blueprint && !p.blueprints.includes(def.id)) return false;
  if (def.tech && !p.research.done.includes(def.tech)) return false;
  if (rarityIndex(def.rarity) >= 4 && !p.blueprints.includes(def.id)) return false;
  return true;
}

export function partsUnlockedBy(techId: string): PartDef[] {
  return PARTS.filter((d) => d.tech === techId);
}

// ---------------------------------------------------------------- fabrication
export function fabricationCost(def: PartDef): Partial<Record<Resource, number>> & { credits: number } {
  const ri = rarityIndex(def.rarity);
  const cost: Partial<Record<Resource, number>> & { credits: number } = { credits: Math.round(def.value * 0.45) };
  cost.scrap = Math.max(4, Math.round(def.mass / 6));
  if (['engine', 'transmission', 'suspension', 'actuator', 'rotor', 'jet', 'leg', 'arm', 'track', 'weapon', 'hydraulics'].includes(def.category)) cost.mechanical = Math.max(2, Math.round(def.mass / 40 + ri * 3));
  if (['generator', 'battery', 'sensor', 'cockpit', 'countermeasure'].includes(def.category) || def.stats.energyPerShot || def.family === 'energy') cost.electronics = Math.max(2, 3 + ri * 5);
  if (ri >= 2) cost.alloys = ri * 2 + Math.round(def.mass / 150);
  if (ri >= 3) cost.raretech = ri - 2;
  return cost;
}

export function fabricationTime(def: PartDef) {
  return 10 + rarityIndex(def.rarity) * 12;
}

export function needsElectronicsBench(def: PartDef) {
  return ['sensor', 'countermeasure'].includes(def.category) || def.family === 'energy' || def.tech === 'guided' || def.tech === 'radar' || def.tech === 'ew';
}

// ---------------------------------------------------------------- workshop upgrades
export interface UpgradeDef {
  id: WorkshopUpgrade;
  name: string;
  levels: { cost: { credits: number } & Partial<Record<Resource, number>>; desc: string }[];
  icon: string;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'bays',
    name: 'Vehicle Bays',
    icon: '▦',
    levels: [
      { cost: { credits: 0 }, desc: '3 machines' },
      { cost: { credits: 0 }, desc: '3 machines' },
      { cost: { credits: 0 }, desc: '3 machines' },
      { cost: { credits: 0 }, desc: '3 machines' },
      { cost: { credits: 2500, scrap: 150 }, desc: '4 machines' },
      { cost: { credits: 6000, scrap: 300, alloys: 20 }, desc: '5 machines' },
      { cost: { credits: 12000, scrap: 500, alloys: 40 }, desc: '6 machines' },
    ],
  },
  {
    id: 'research',
    name: 'Research Station',
    icon: '⌬',
    levels: [
      { cost: { credits: 0 }, desc: 'Locked' },
      { cost: { credits: 0 }, desc: 'Tier I technologies' },
      { cost: { credits: 3000, electronics: 40, data: 10 }, desc: 'Tier II technologies' },
      { cost: { credits: 9000, electronics: 90, raretech: 4, data: 30 }, desc: 'Tier III technologies' },
    ],
  },
  {
    id: 'salvage',
    name: 'Salvage Processor',
    icon: '⚙',
    levels: [
      { cost: { credits: 0 }, desc: 'Locked' },
      { cost: { credits: 0 }, desc: 'Scrapping yields standard resources' },
      { cost: { credits: 2000, scrap: 120, mechanical: 20 }, desc: '+25% resources from scrapping and stripping' },
      { cost: { credits: 6000, scrap: 300, mechanical: 50, alloys: 10 }, desc: '+50% resources from scrapping and stripping' },
    ],
  },
  {
    id: 'storage',
    name: 'Parts Storage',
    icon: '▤',
    levels: [
      { cost: { credits: 0 }, desc: 'Locked' },
      { cost: { credits: 0 }, desc: '40 parts' },
      { cost: { credits: 1500, scrap: 100 }, desc: '70 parts' },
      { cost: { credits: 4000, scrap: 220 }, desc: '110 parts' },
      { cost: { credits: 9000, scrap: 400, alloys: 20 }, desc: '160 parts' },
    ],
  },
  {
    id: 'paint',
    name: 'Painting Station',
    icon: '◈',
    levels: [
      { cost: { credits: 0 }, desc: 'Locked' },
      { cost: { credits: 0 }, desc: 'Basic colours' },
      { cost: { credits: 1200, scrap: 40 }, desc: 'All colours, stripes & two-tone' },
      { cost: { credits: 3500, scrap: 80, electronics: 10 }, desc: 'Camo, digital, hazard & custom accents' },
    ],
  },
  {
    id: 'electronics',
    name: 'Electronics Bench',
    icon: '⌁',
    levels: [
      { cost: { credits: 0 }, desc: 'Not installed' },
      { cost: { credits: 2200, electronics: 30, scrap: 50 }, desc: 'Fabricate sensors, guidance and energy components' },
    ],
  },
  {
    id: 'crane',
    name: 'Heavy Construction Crane',
    icon: '⊥',
    levels: [
      { cost: { credits: 0 }, desc: 'Machines up to 4.5 t' },
      { cost: { credits: 2800, scrap: 200, mechanical: 30 }, desc: 'Machines up to 8 t' },
      { cost: { credits: 7000, scrap: 400, mechanical: 60, alloys: 20 }, desc: 'Machines up to 14 t' },
      { cost: { credits: 15000, scrap: 700, alloys: 50 }, desc: 'Machines up to 30 t' },
    ],
  },
  {
    id: 'range',
    name: 'Weapon Test Range',
    icon: '◎',
    levels: [
      { cost: { credits: 0 }, desc: 'Not built' },
      { cost: { credits: 1500, scrap: 80 }, desc: 'Target dummies with damage readouts next to the garage' },
    ],
  },
];

export function baysFor(p: Profile) {
  return Math.max(3, p.workshop.bays);
}
