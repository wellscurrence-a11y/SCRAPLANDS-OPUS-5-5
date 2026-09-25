/**
 * The single persistent save: money, resources, owned parts, machines, research, workshop,
 * missions and world state. Serialised to localStorage with versioning and rolling backups.
 */
import type { MachineDesign, PartItem } from '../machines/types';
import { starterAir, starterGround, starterMech } from '../machines/designs';
import { uid } from '../core/math';

export type Resource = 'scrap' | 'electronics' | 'mechanical' | 'alloys' | 'data' | 'raretech';
export const RESOURCES: Resource[] = ['scrap', 'electronics', 'mechanical', 'alloys', 'data', 'raretech'];
export const RESOURCE_LABEL: Record<Resource, string> = {
  scrap: 'Scrap',
  electronics: 'Electronics',
  mechanical: 'Mech. Components',
  alloys: 'Advanced Alloys',
  data: 'Research Data',
  raretech: 'Rare Technology',
};

export type WorkshopUpgrade = 'bays' | 'research' | 'salvage' | 'paint' | 'range' | 'storage' | 'electronics' | 'crane';

export interface MissionState {
  id: string;
  stage: number;
  data: Record<string, any>;
}

export interface Profile {
  version: number;
  created: number;
  playTime: number;
  credits: number;
  resources: Record<Resource, number>;
  inventory: PartItem[];
  machines: MachineDesign[];
  activeMachine: string;
  research: { done: string[]; active: string | null; progress: number };
  blueprints: string[];
  workshop: Record<WorkshopUpgrade, number>;
  discovered: string[];
  missions: { active: MissionState[]; done: string[]; board: any[]; boardDay: number; tracked: string | null };
  world: { time: number; day: number; weather: string; clearedZones: Record<string, number>; looted: string[]; bossDefeated: string[] };
  stats: { kills: number; partsSalvaged: number; distance: number; deaths: number; bestRace: number | null };
  rank: { xp: number; level: number };
  reputation: Record<string, number>;
  flags: Record<string, boolean | number | string>;
  cargo: PartItem[];
  lastPos: [number, number, number] | null;
  scannedTypes: string[];
}

export const PROFILE_VERSION = 3;
const KEY = 'scraplands.save.v1';
const BACKUP_KEY = 'scraplands.save.backup';

export function newProfile(): Profile {
  const machines = [starterGround(), starterAir(), starterMech()];
  const inventory: PartItem[] = [
    { uid: uid('p'), defId: 'arm_scrap_s', cond: 1 },
    { uid: uid('p'), defId: 'arm_scrap_s', cond: 0.8 },
    { uid: uid('p'), defId: 'arm_scrap_l', cond: 1 },
    { uid: uid('p'), defId: 'fuel_drum', cond: 1 },
    { uid: uid('p'), defId: 'cool_radiator', cond: 1 },
    { uid: uid('p'), defId: 'whl_bald', cond: 0.7 },
    { uid: uid('p'), defId: 'whl_bald', cond: 0.7 },
    { uid: uid('p'), defId: 'wpn_shotgun', cond: 0.9 },
    { uid: uid('p'), defId: 'crg_rack', cond: 1 },
    { uid: uid('p'), defId: 'stb_gyro', cond: 1 },
    { uid: uid('p'), defId: 'lgt_bar', cond: 1 },
  ];
  return {
    version: PROFILE_VERSION,
    created: Date.now(),
    playTime: 0,
    credits: 600,
    resources: { scrap: 40, electronics: 5, mechanical: 8, alloys: 0, data: 0, raretech: 0 },
    inventory,
    machines,
    activeMachine: machines[0].id,
    research: { done: [], active: null, progress: 0 },
    blueprints: [],
    workshop: { bays: 3, research: 1, salvage: 1, paint: 1, range: 0, storage: 1, electronics: 0, crane: 0 },
    discovered: ['home'],
    missions: { active: [], done: [], board: [], boardDay: 0, tracked: null },
    world: { time: 0.34, day: 1, weather: 'clear', clearedZones: {}, looted: [], bossDefeated: [] },
    stats: { kills: 0, partsSalvaged: 0, distance: 0, deaths: 0, bestRace: null },
    rank: { xp: 0, level: 1 },
    reputation: { independents: 0, scrappers: -20, authority: -10, helix: -30 },
    flags: {},
    cargo: [],
    lastPos: null,
    scannedTypes: [],
  };
}

function migrate(p: any): Profile {
  const base = newProfile();
  // fill missing fields from a fresh profile
  for (const k of Object.keys(base) as (keyof Profile)[]) {
    if (p[k] === undefined) p[k] = (base as any)[k];
  }
  for (const k of Object.keys(base.workshop)) if (p.workshop[k] === undefined) p.workshop[k] = (base.workshop as any)[k];
  for (const k of Object.keys(base.resources)) if (p.resources[k] === undefined) p.resources[k] = 0;
  for (const k of Object.keys(base.world)) if (p.world[k] === undefined) p.world[k] = (base.world as any)[k];
  for (const k of Object.keys(base.stats)) if (p.stats[k] === undefined) p.stats[k] = (base.stats as any)[k];
  for (const k of Object.keys(base.missions)) if (p.missions[k] === undefined) p.missions[k] = (base.missions as any)[k];
  p.version = PROFILE_VERSION;
  return p as Profile;
}

export function hasSave() {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.warn('save corrupted, trying backup', e);
    try {
      const raw = localStorage.getItem(BACKUP_KEY);
      if (raw) return migrate(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    return null;
  }
}

export function saveProfile(p: Profile) {
  try {
    const prev = localStorage.getItem(KEY);
    if (prev) localStorage.setItem(BACKUP_KEY, prev);
    localStorage.setItem(KEY, JSON.stringify(p));
    return true;
  } catch (e) {
    console.error('save failed', e);
    return false;
  }
}

export function deleteSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function exportSave(p: Profile) {
  const blob = new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `scraplands-save-day${p.world.day}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function importSave(text: string): Profile {
  return migrate(JSON.parse(text));
}

// ---------------------------------------------------------------- helpers
export function addResources(p: Profile, r: Partial<Record<Resource, number>>) {
  for (const [k, v] of Object.entries(r)) p.resources[k as Resource] = Math.max(0, (p.resources[k as Resource] ?? 0) + (v ?? 0));
}

export function canAfford(p: Profile, credits: number, r: Partial<Record<Resource, number>> = {}) {
  if (p.credits < credits) return false;
  for (const [k, v] of Object.entries(r)) if ((p.resources[k as Resource] ?? 0) < (v ?? 0)) return false;
  return true;
}

export function spend(p: Profile, credits: number, r: Partial<Record<Resource, number>> = {}) {
  if (!canAfford(p, credits, r)) return false;
  p.credits -= credits;
  for (const [k, v] of Object.entries(r)) p.resources[k as Resource] -= v ?? 0;
  return true;
}

export const RANK_TITLES = ['Scrap Rat', 'Tinkerer', 'Grease Monkey', 'Wrench', 'Fabricator', 'Machinist', 'Engineer', 'Chief Engineer', 'Master Builder', 'Legend of the Basin'];

export function xpForLevel(level: number) {
  return Math.round(400 * Math.pow(level, 1.55));
}

export function addXp(p: Profile, xp: number): number {
  p.rank.xp += xp;
  let ups = 0;
  while (p.rank.xp >= xpForLevel(p.rank.level)) {
    p.rank.xp -= xpForLevel(p.rank.level);
    p.rank.level++;
    ups++;
  }
  return ups;
}

export function storageCapacity(p: Profile) {
  return [0, 40, 70, 110, 160][p.workshop.storage] ?? 160;
}

export function craneLimit(p: Profile) {
  return [4500, 8000, 14000, 30000][p.workshop.crane] ?? 30000;
}
