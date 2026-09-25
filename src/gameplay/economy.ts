/** Prices, repair costs and salvage yields. */
import type { PartDef } from '../machines/types';
import { rarityIndex } from '../machines/types';
import type { Resource } from './profile';

export const FUEL_PRICE = 1.2; // per litre
export const AMMO_PRICE: Record<string, number> = {
  mg: 0.4,
  chaingun: 0.3,
  shotgun: 2,
  autocannon: 6,
  cannon: 30,
  rockets: 18,
  missiles: 45,
};

export function sellPrice(def: PartDef, cond: number) {
  return Math.max(5, Math.round(def.value * 0.42 * (0.25 + 0.75 * cond)));
}

export function buyPrice(def: PartDef, markup = 1) {
  return Math.round(def.value * 1.15 * markup);
}

export function repairCost(def: PartDef, cond: number): { credits: number; res: Partial<Record<Resource, number>> } {
  if (cond >= 0.999) return { credits: 0, res: {} };
  const missing = 1 - cond;
  const wrecked = cond <= 0;
  const credits = Math.round(def.value * missing * 0.22 + (wrecked ? def.value * 0.18 : 0));
  const scrap = Math.ceil((def.mass / 25) * missing * (wrecked ? 1.6 : 1));
  const res: Partial<Record<Resource, number>> = { scrap };
  const ri = rarityIndex(def.rarity);
  if (wrecked && ri >= 2) res.mechanical = ri;
  if (wrecked && ri >= 3) res.alloys = ri - 2;
  return { credits, res };
}

const ELECTRONIC = new Set(['sensor', 'battery', 'generator', 'cockpit', 'countermeasure', 'light', 'stabilizer']);
const MECHANICAL = new Set(['engine', 'transmission', 'suspension', 'actuator', 'hydraulics', 'rotor', 'jet', 'track', 'arm', 'leg', 'gear']);

/** Resources recovered by scrapping a part (or stripping a wreck). */
export function scrapYield(def: PartDef, cond: number, bonus = 1): Partial<Record<Resource, number>> {
  const ri = rarityIndex(def.rarity);
  const k = (0.35 + 0.65 * cond) * bonus;
  const out: Partial<Record<Resource, number>> = {};
  out.scrap = Math.max(1, Math.round((def.mass / 12) * k));
  if (ELECTRONIC.has(def.category) || def.stats.energyPerShot || def.family === 'energy') out.electronics = Math.max(1, Math.round((1 + ri * 1.5) * k));
  if (MECHANICAL.has(def.category) || def.category === 'weapon') out.mechanical = Math.max(1, Math.round((1 + ri) * k));
  if (ri >= 2 && (def.category === 'armor' || def.category === 'frame' || def.family === 'composite')) out.alloys = Math.round((ri - 1) * k + 0.4);
  if (ri >= 3) out.raretech = Math.round((ri - 2) * k * 0.8 + 0.3);
  if (ri >= 2) out.data = Math.round(ri * k);
  return out;
}

export function salvageTime(def: PartDef, fast: boolean) {
  const base = 1.1 + def.mass / 160;
  return Math.min(9, base) * (fast ? 0.7 : 1);
}
