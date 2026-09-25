/** Core data types for machine parts and designs. Pure data (no three.js). */

export type MachineClass = 'ground' | 'air' | 'mech';
export const MACHINE_CLASSES: MachineClass[] = ['ground', 'air', 'mech'];
export const CLASS_LABEL: Record<MachineClass, string> = { ground: 'Ground', air: 'Air', mech: 'Mech' };

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'exotic';
export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'exotic'];
export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#c9c4bb',
  uncommon: '#62d26f',
  rare: '#3fa7ff',
  epic: '#b46cff',
  legendary: '#ffab2e',
  exotic: '#ff4fb8',
};
export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  exotic: 'Exotic',
};
export const rarityIndex = (r: Rarity) => RARITIES.indexOf(r);

export type SocketType =
  | 'surface'
  | 'cockpit'
  | 'axle'
  | 'hub'
  | 'track'
  | 'hip'
  | 'shoulder'
  | 'joint'
  | 'foot'
  | 'hand'
  | 'hardpoint';

export type PartCategory =
  | 'frame'
  | 'cockpit'
  | 'engine'
  | 'generator'
  | 'battery'
  | 'fuel'
  | 'cooling'
  | 'transmission'
  | 'suspension'
  | 'wheel'
  | 'track'
  | 'booster'
  | 'ram'
  | 'cargo'
  | 'armor'
  | 'sensor'
  | 'weapon'
  | 'rotor'
  | 'jet'
  | 'wing'
  | 'stabilizer'
  | 'gear'
  | 'airbrake'
  | 'countermeasure'
  | 'leg'
  | 'actuator'
  | 'foot'
  | 'arm'
  | 'melee'
  | 'hydraulics'
  | 'jumpjet'
  | 'light'
  | 'utility';

export const CATEGORY_LABEL: Record<PartCategory, string> = {
  frame: 'Frame',
  cockpit: 'Cockpit',
  engine: 'Engine',
  generator: 'Generator',
  battery: 'Battery',
  fuel: 'Fuel Tank',
  cooling: 'Cooling',
  transmission: 'Transmission',
  suspension: 'Suspension',
  wheel: 'Wheel',
  track: 'Track',
  booster: 'Booster',
  ram: 'Ram',
  cargo: 'Cargo',
  armor: 'Armor',
  sensor: 'Sensor',
  weapon: 'Weapon',
  rotor: 'Rotor',
  jet: 'Jet Engine',
  wing: 'Wing',
  stabilizer: 'Stabilizer',
  gear: 'Landing Gear',
  airbrake: 'Air Brake',
  countermeasure: 'Countermeasure',
  leg: 'Leg',
  actuator: 'Joint Actuator',
  foot: 'Foot',
  arm: 'Arm',
  melee: 'Melee',
  hydraulics: 'Hydraulics',
  jumpjet: 'Jump Jet',
  light: 'Lights',
  utility: 'Utility',
};

export type Vec3 = [number, number, number];

export interface SocketDef {
  id: string;
  type: SocketType;
  pos: Vec3;
  /** Outward normal; attached part's +Y aligns with it. */
  normal: Vec3;
  /** Reference forward tangent; attached part's -Z aligns with it (projected). */
  forward?: Vec3;
  /** Surface extents (width along socket X, depth along socket Z). */
  size?: [number, number];
  /** Id of the mirrored socket (for symmetric placement). */
  mirror?: string;
  /** This socket's frame is the reflection (across machine X=0) of its twin; geometry is mirrored. */
  reflect?: boolean;
  /** Axle sockets: steering axle. */
  steer?: boolean;
  /** Axle/track/hip sockets: which side (-1 left, +1 right). */
  side?: number;
  label?: string;
}

export type WeaponKind =
  | 'mg'
  | 'chaingun'
  | 'shotgun'
  | 'autocannon'
  | 'cannon'
  | 'rockets'
  | 'missiles'
  | 'laser'
  | 'beam'
  | 'railgun'
  | 'flamer'
  | 'arc';

export type MeleeKind = 'claw' | 'drill' | 'fist' | 'saw' | 'blade';

export interface PartStats {
  // Power & heat
  powerGen?: number; // kW produced
  powerDraw?: number; // kW consumed at full use
  heat?: number; // heat/s at full load (or per shot for weapons)
  cooling?: number; // heat/s dissipated
  fuelUse?: number; // litres per minute at full load
  fuelCap?: number; // litres
  batteryCap?: number; // kJ
  maxDischarge?: number; // kW
  // Ground drivetrain
  torque?: number; // Nm peak
  maxRpm?: number;
  idleRpm?: number;
  gears?: number[];
  finalDrive?: number;
  efficiency?: number;
  shiftTime?: number;
  stiffness?: number; // N/m
  damping?: number; // Ns/m
  travel?: number; // m
  radius?: number; // m (wheels, rotors)
  width?: number; // m
  grip?: number; // base friction coefficient
  sandGrip?: number; // multiplier on sand
  roadGrip?: number; // multiplier on asphalt
  rockGrip?: number; // multiplier on rock
  rollResist?: number;
  trackLength?: number;
  // Thrust
  thrust?: number; // N
  gimbal?: number; // radians (vector thrusters)
  cyclic?: number; // rotor torque authority fraction
  spin?: number; // rotor spin direction +1/-1 (reaction torque)
  reaction?: number; // reaction torque coefficient (Nm per N thrust)
  boostTime?: number; // seconds of boost per charge
  // Aero
  wingArea?: number; // m^2
  liftCoef?: number;
  drag?: number;
  torqueAuthority?: number; // Nm (stabilizers)
  // Mech
  thigh?: number;
  shin?: number;
  loadRating?: number; // kg supported per leg / arm
  stride?: number;
  stepTime?: number;
  jointStrength?: number; // multiplier on leg/arm load rating
  jointSpeed?: number; // multiplier on step speed / arm turn speed
  footGrip?: number;
  footSize?: number;
  armLength?: number;
  turnRate?: number; // rad/s for arms/turrets
  hydraulicBoost?: number; // multiplier on all joint strength
  // Weapons
  weapon?: WeaponKind;
  damage?: number;
  pen?: number;
  rof?: number; // shots per second
  projSpeed?: number;
  spread?: number; // degrees
  range?: number;
  recoil?: number; // N*s impulse per shot
  splash?: number; // radius
  splashDamage?: number;
  pellets?: number;
  ammo?: number;
  magazine?: number;
  reload?: number;
  energyPerShot?: number; // kJ
  chargeTime?: number;
  lockTime?: number;
  turnRateMissile?: number;
  yawLimit?: number; // degrees either side (180 = full rotation)
  pitchMin?: number; // degrees
  pitchMax?: number;
  barrels?: number;
  spinUp?: number;
  // Melee
  melee?: MeleeKind;
  reach?: number;
  swingTime?: number;
  // Misc
  cargo?: number; // kg of cargo capacity
  scanRange?: number;
  radarRange?: number;
  jammer?: number; // chance to break missile locks
  flares?: number;
  lightRange?: number;
  ramDamage?: number; // multiplier
  ramArmor?: number;
  repairRate?: number; // hp/s field repair
  reactive?: boolean;
}

export interface PartDef {
  id: string;
  name: string;
  category: PartCategory;
  /** Which machine classes may use this part. */
  classes: MachineClass[];
  rarity: Rarity;
  /** Tech family (research) this part belongs to. */
  family: string;
  mount: SocketType[];
  mass: number;
  hp: number;
  armor: number;
  /** Approximate bounding size in part space (x, y, z). */
  size: Vec3;
  /** Base value in credits. */
  value: number;
  stats: PartStats;
  sockets?: SocketDef[];
  /** Mesh builder key. */
  mesh: string;
  /** Free-form visual parameters for the mesh builder. */
  look?: Record<string, number | string | boolean>;
  desc: string;
  /** Special rules text (shown in UI) and flags interpreted by systems. */
  special?: string[];
  /** Crafting requires owning a blueprint. */
  blueprint?: boolean;
  /** Research node that unlocks crafting/buying this part. */
  tech?: string;
  /** Faction style (for enemy generation). */
  faction?: string;
  /** Parts may be tilted around their local X axis in the builder. */
  tiltable?: boolean;
  /** Not available from merchants/crafting (boss/unique drops). */
  unique?: boolean;
  /** Part is a root frame for this class. */
  rootOf?: MachineClass;
}

/** An owned physical part (inventory item). Condition persists across sorties. */
export interface PartItem {
  uid: string;
  defId: string;
  cond: number; // 0..1 (0 = wrecked, needs rebuild)
}

export interface PlacedPart {
  uid: string; // PartItem uid
  defId: string;
  parent: string | null; // parent placed-part uid
  socket: string | null; // socket id on the parent
  offset: [number, number]; // along socket X / Z (surfaces)
  rot: number; // yaw around socket normal, degrees
  tilt: number; // tilt around local X, degrees
  cond: number;
  group?: number; // weapon fire group (1..3)
  /** Mirror the part across its socket's local YZ plane. */
  mirror?: boolean;
}

export type PaintPattern = 'none' | 'stripes' | 'camo' | 'hazard' | 'twotone' | 'digital';

export interface PaintScheme {
  primary: string;
  secondary: string;
  accent: string;
  pattern: PaintPattern;
  wear: number; // 0 fresh .. 1 rusted
}

export interface MachineDesign {
  id: string;
  name: string;
  cls: MachineClass;
  parts: PlacedPart[];
  paint: PaintScheme;
  created?: number;
  kills?: number;
  distance?: number;
}
