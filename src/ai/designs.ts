/**
 * Enemy machine generator. Factions build from the same catalogue as the player,
 * with recognisable styles. Every visible part is real and salvageable.
 */
import type { Faction } from '../core/context';
import type { MachineClass, MachineDesign, PaintPattern, PaintScheme } from '../machines/types';
import { DesignBuilder } from '../machines/designs';
import { computeStats } from '../machines/stats';
import { RNG } from '../core/random';
import { getPart, PART_MAP } from '../machines/parts/catalog';
import { rarityIndex } from '../machines/types';

type Pool = [id: string, weight: number, minTier: number][];

/** Weighted pick from a tiered pool. Part pools skip ids missing from the catalogue. */
function pick(rng: RNG, pool: Pool, tier: number, bonus = 0, parts = true): string {
  const ok = pool.filter(([id, , t]) => t <= tier + bonus && (!parts || PART_MAP.has(id)));
  const list = ok.length ? ok : pool;
  return rng.weighted(list, ([, w, t]) => w * (1 + Math.max(0, t) * 0.4 * (t <= tier ? 1 : 0)))[0];
}

const SCRAP_COLORS = ['#8c3b1f', '#b5552b', '#6b6b3a', '#3f4f5f', '#9a7a2e', '#5e2e2e', '#7a4f2a', '#4b5a3a'];
const SCRAP_SECOND = ['#d9b25a', '#e0dccb', '#c43a2a', '#2b2b2b', '#e07a2e', '#4a88a8'];

export function factionPaint(f: Faction, rng: RNG): PaintScheme {
  switch (f) {
    case 'scrappers':
      return {
        primary: rng.pick(SCRAP_COLORS),
        secondary: rng.pick(SCRAP_SECOND),
        accent: rng.pick(['#ff7a2a', '#ffd23a', '#ff3a2a']),
        pattern: rng.pick<PaintPattern>(['none', 'stripes', 'hazard', 'twotone', 'none']),
        wear: rng.range(0.6, 0.95),
      };
    case 'authority':
      return {
        primary: rng.pick(['#56603f', '#4a5046', '#6b6a55', '#5a5f4c']),
        secondary: rng.pick(['#2d2f2a', '#3b3d33', '#8a8a74']),
        accent: '#ff5a2a',
        pattern: rng.pick<PaintPattern>(['camo', 'digital', 'camo']),
        wear: rng.range(0.25, 0.45),
      };
    case 'helix':
      return { primary: '#e2e6ea', secondary: '#8f9aa6', accent: '#3fe0ff', pattern: 'twotone', wear: 0.04 };
    case 'independents':
      return {
        primary: rng.pick(['#2f5d7a', '#7a5a2f', '#5a2f4a', '#3a6a5a', '#8a8a8a']),
        secondary: rng.pick(['#e0d6c0', '#222222', '#c9a24a']),
        accent: rng.pick(['#3fdcff', '#ffd23a']),
        pattern: rng.pick<PaintPattern>(['stripes', 'twotone', 'none']),
        wear: rng.range(0.3, 0.6),
      };
    default:
      return { primary: '#777777', secondary: '#333333', accent: '#ffaa33', pattern: 'none', wear: 0.5 };
  }
}

const NAMES: Record<string, string[]> = {
  scrappers: ['Rustmaw', 'Junk Hound', 'Bolt Biter', 'Scrap Jackal', 'Gutter Runner', 'Sparkbucket', 'Clanker', 'Wreckrat', 'Tin Viper', 'Oilskin'],
  authority: ['Warden', 'Sentinel', 'Lancer', 'Bulwark', 'Marshal', 'Enforcer', 'Picket', 'Vanguard'],
  helix: ['Helix Seeker', 'Helix Sentry', 'Helix Prism', 'Helix Lancet', 'Helix Mote'],
  independents: ['Drifter', 'Freeholder', 'Trader', 'Scav', 'Mercenary', 'Prospector'],
};

export interface EnemyOptions {
  faction: Faction;
  cls?: MachineClass;
  tier: number; // 0..4
  seed: number;
  elite?: boolean;
  role?: 'raider' | 'truck' | 'hauler' | 'tank' | 'drone' | 'gunship' | 'vtol' | 'scout' | 'walker' | 'assault' | 'trader';
}

function weaponPool(f: Faction): Pool {
  if (f === 'helix') return [['wpn_laser', 4, 0], ['wpn_beam', 2, 3], ['wpn_missiles', 1, 2], ['wpn_arc', 0.2, 5]];
  if (f === 'authority')
    return [['wpn_hmg', 4, 0], ['wpn_autocannon', 3, 1], ['wpn_bushmaster', 2, 2], ['wpn_missiles', 2, 2], ['wpn_rockets', 1, 1], ['wpn_cannon', 1, 3], ['wpn_swarm', 0.5, 4]];
  if (f === 'independents') return [['wpn_lmg', 3, 0], ['wpn_twinlmg', 2, 0], ['wpn_hmg', 1, 1], ['wpn_autocannon', 1, 2], ['wpn_rockets', 1, 1]];
  return [['wpn_lmg', 5, 0], ['wpn_twinlmg', 3, 0], ['wpn_shotgun', 3, 0], ['wpn_rockets', 2, 1], ['wpn_chaingun', 2, 1], ['wpn_flamer', 1, 1], ['wpn_autocannon', 1, 2], ['wpn_hmg', 1, 2], ['wpn_cannon', 0.5, 3]];
}

function eliteWeapon(f: Faction, rng: RNG, tier: number) {
  const pool = weaponPool(f).filter(([id]) => rarityIndex(getPart(id).rarity) >= Math.min(4, 2 + Math.floor(tier / 2)));
  const extra: Pool = tier >= 3 ? [['wpn_railgun', 0.3, 0], ['wpn_thunder', 0.6, 0], ['wpn_swarm', 0.8, 0], ['wpn_beam', 0.6, 0]] : [['wpn_hmg', 1, 0], ['wpn_chaingun', 1, 0], ['wpn_missiles', 0.8, 0], ['wpn_cannon', 0.5, 0], ['wpn_laser', 0.3, 0]];
  return pick(rng, [...pool, ...extra], 9);
}

function armorPool(f: Faction): Pool {
  if (f === 'helix') return [['arm_ceramic', 2, 0], ['arm_composite', 2, 0]];
  if (f === 'authority') return [['arm_steel_s', 3, 0], ['arm_steel_l', 2, 0], ['arm_composite', 1, 2], ['arm_reactive', 0.5, 3]];
  return [['arm_scrap_s', 4, 0], ['arm_scrap_l', 3, 0], ['arm_steel_s', 1, 1], ['arm_steel_l', 0.5, 2]];
}

// ---------------------------------------------------------------- ground
function raider(f: Faction, tier: number, rng: RNG, elite: boolean) {
  const frame = tier >= 3 && rng.chance(0.35) ? 'frm_racer' : 'frm_buggy';
  const b = new DesignBuilder('', 'ground', frame, factionPaint(f, rng));
  const fr = b.frame;
  const cage = b.add('ckp_cage', fr, 'cockpit');
  const sus = pick(rng, [['sus_coil', 4, 0], ['sus_leaf', 2, 0], ['sus_long', 1, 2]], tier);
  const whl = f === 'helix' ? 'whl_mag' : f === 'authority' ? 'whl_runflat' : pick(rng, [['whl_bald', 3, 0], ['whl_knobby', 4, 0], ['whl_spiked', 2, 1], ['whl_street', 1, 1], ['whl_monster', 0.4, 3]], tier);
  for (const ax of ['axle_f', 'axle_r']) {
    const [r, l] = b.pair(sus, fr, ax);
    b.add(whl, r, 'hub', { cond: rng.range(0.6, 1) });
    b.add(whl, l, 'hub', { cond: rng.range(0.6, 1) });
  }
  const eng = pick(rng, [['eng_mower', 2, 0], ['eng_v4', 5, 0], ['eng_i6', 3, 1], ['eng_v8', 2, 2], ['eng_turbine', 1, 3], ['eng_v12', 0.8, 3]], tier);
  b.add(eng, fr, 'top_rear', { offset: [0, 0.05], cond: rng.range(0.5, 1) });
  b.add(pick(rng, [['trn_3spd', 4, 0], ['trn_5spd', 2, 1], ['trn_seq', 1, 3]], tier), fr, 'bottom', { offset: [0, 0.7] });
  b.add(pick(rng, [['fuel_jerry', 3, 0], ['fuel_drum', 1, 0], ['fuel_armored', 1, 2]], tier), fr, 'top_front');
  b.add(elite ? eliteWeapon(f, rng, tier) : pick(rng, weaponPool(f), tier), cage, 'roof', { group: 1, cond: rng.range(0.6, 1) });
  if (f === 'scrappers' || rng.chance(0.3)) b.add(pick(rng, [['ram_bullbar', 3, 0], ['ram_spike', 2, 0], ['ram_saw', 0.3, 3]], tier), fr, 'front');
  if (rng.chance(0.7)) b.pair(pick(rng, armorPool(f), tier), fr, 'side', { cond: rng.range(0.5, 1) });
  if (rng.chance(0.4)) b.add('lgt_bar', cage, 'roof', { offset: [0, -0.28] });
  if (tier >= 2 && rng.chance(0.4)) b.add('bst_nitro', cage, 'back', { rot: 90 });
  return b.build();
}

function truck(f: Faction, tier: number, rng: RNG, elite: boolean) {
  const b = new DesignBuilder('', 'ground', 'frm_pickup', factionPaint(f, rng));
  const fr = b.frame;
  const cab = b.add(f === 'authority' && tier >= 2 ? 'ckp_armored' : rng.chance(0.7) ? 'ckp_cab' : 'ckp_cage', fr, 'cockpit');
  const sus = pick(rng, [['sus_leaf', 3, 0], ['sus_heavy', 3, 1], ['sus_coil', 1, 0]], tier);
  const whl = f === 'authority' ? 'whl_runflat' : pick(rng, [['whl_knobby', 4, 0], ['whl_bald', 2, 0], ['whl_spiked', 1, 1], ['whl_monster', 0.4, 3]], tier);
  for (const ax of ['axle_f', 'axle_r']) {
    const [r, l] = b.pair(sus, fr, ax);
    b.add(whl, r, 'hub');
    b.add(whl, l, 'hub');
  }
  b.add(pick(rng, [['eng_v4', 3, 0], ['eng_i6', 4, 0], ['eng_v8', 2, 1], ['eng_diesel', 2, 2]], tier), fr, 'top_front');
  b.add(pick(rng, [['trn_3spd', 2, 0], ['trn_5spd', 3, 1], ['trn_heavy', 2, 1]], tier), fr, 'bottom', { offset: [0, -0.8] });
  b.add(pick(rng, [['fuel_drum', 3, 0], ['fuel_armored', 2, 1]], tier), fr, 'top_rear', { offset: [0.45, 0.55] });
  b.add(elite ? eliteWeapon(f, rng, tier) : pick(rng, weaponPool(f), tier + 1), fr, 'top_rear', { offset: [-0.1, -0.3], group: 1 });
  if (rng.chance(0.6)) b.add(pick(rng, [['wpn_lmg', 3, 0], ['wpn_hmg', 2, 2], ['wpn_twinlmg', 1, 0]], tier), cab, 'roof', { group: 1 });
  if (rng.chance(0.6)) b.add(pick(rng, [['crg_rack', 3, 0], ['crg_crate', 1, 1]], tier), fr, 'top_rear', { offset: [0.35, 0.6] });
  b.pair(pick(rng, armorPool(f), tier), fr, 'side', { offset: [0, -0.4] });
  if (rng.chance(0.6)) b.add(f === 'scrappers' ? 'ram_spike' : 'ram_bullbar', fr, 'front');
  if (tier >= 3 && f === 'authority') b.add('sen_radar', cab, 'roof', { offset: [0.4, 0.3] });
  return b.build();
}

function hauler(f: Faction, tier: number, rng: RNG, elite: boolean, trader = false) {
  const b = new DesignBuilder('', 'ground', 'frm_hauler', factionPaint(f, rng));
  const fr = b.frame;
  const cab = b.add(trader ? 'ckp_cab' : 'ckp_armored', fr, 'cockpit');
  for (const ax of ['axle_f', 'axle_m', 'axle_r']) {
    const [r, l] = b.pair('sus_heavy', fr, ax);
    const w = trader ? 'whl_knobby' : 'whl_runflat';
    b.add(w, r, 'hub');
    b.add(w, l, 'hub');
  }
  b.add('eng_diesel', fr, 'top_mid', { offset: [0, -0.1] });
  b.add('trn_heavy', fr, 'bottom', { offset: [0, -1.2] });
  b.add(trader ? 'fuel_drum' : 'fuel_saddle', fr, 'deck', { offset: [0.6, 1.2], rot: 0 });
  if (trader) {
    b.add('crg_crate', fr, 'deck', { offset: [-0.4, 0.6] });
    b.add('crg_crate', fr, 'deck', { offset: [-0.4, -0.5] });
    b.add('crg_rack', fr, 'deck', { offset: [0.5, -0.6] });
    b.add('wpn_lmg', cab, 'roof', { group: 1 });
  } else {
    b.add(elite ? eliteWeapon(f, rng, tier) : pick(rng, [['wpn_cannon', 3, 0], ['wpn_bushmaster', 3, 0], ['wpn_autocannon', 2, 0], ['wpn_thunder', 1, 4]], tier), fr, 'deck', { offset: [0, -0.3], group: 1 });
    b.add(pick(rng, [['wpn_missiles', 2, 0], ['wpn_rockets', 2, 0], ['wpn_hmg', 2, 0]], tier), cab, 'roof', { group: 2 });
    b.add('sen_radar', fr, 'deck', { offset: [0.7, 1.4] });
  }
  b.pair(pick(rng, armorPool(f), tier + 1), fr, 'side', { offset: [0, -1.4] });
  b.pair(pick(rng, armorPool(f), tier + 1), fr, 'side', { offset: [0, 1.0] });
  b.add('ram_bullbar', fr, 'front');
  return b.build();
}

function tank(f: Faction, tier: number, rng: RNG, elite: boolean) {
  const b = new DesignBuilder('', 'ground', 'frm_hull', factionPaint(f, rng));
  const fr = b.frame;
  const cab = b.add('ckp_armored', fr, 'cockpit');
  b.pair(tier >= 4 ? 'trk_mil' : 'trk_scrap', fr, 'track');
  b.add('eng_diesel', fr, 'deck', { offset: [0, 1.0] });
  b.add('trn_heavy', fr, 'bottom', { offset: [0, 1.2] });
  b.add('fuel_armored', fr, 'deck', { offset: [0.55, 0.3] });
  b.add(elite ? 'wpn_thunder' : tier >= 4 ? rng.pick(['wpn_thunder', 'wpn_cannon']) : 'wpn_cannon', fr, 'deck', { offset: [-0.1, -0.35], group: 1 });
  b.add('wpn_hmg', cab, 'roof', { group: 2 });
  b.add('arm_sloped', fr, 'glacis', { rot: 0 });
  b.pair(pick(rng, armorPool(f), tier + 1), fr, 'side');
  b.add('cool_heatsink', fr, 'rear');
  return b.build();
}

// ---------------------------------------------------------------- air
function drone(f: Faction, tier: number, rng: RNG, elite: boolean) {
  const b = new DesignBuilder('', 'air', 'frm_quad', factionPaint(f, rng));
  const fr = b.frame;
  b.add(f === 'helix' && tier >= 4 ? 'ckp_helix' : 'ckp_canopy', fr, 'cockpit');
  const rot = f === 'helix' || f === 'authority' ? 'rot_ducted' : pick(rng, [['rot_scrap', 5, 0], ['rot_ducted', 1, 2]], tier);
  b.pair(rot, fr, 'rotor_f');
  b.pair(rot, fr, 'rotor_r');
  const heavyRotors = rot === 'rot_ducted';
  b.add(f === 'helix' ? 'gen_fuelcell' : heavyRotors ? pick(rng, [['gen_diesel', 3, 0], ['gen_fuelcell', 1, 2]], tier) : pick(rng, [['gen_dynamo', 4, 0], ['gen_diesel', 2, 1], ['gen_fuelcell', 1, 3]], tier), fr, 'top', { rot: 90 });
  b.add(f === 'helix' ? 'bat_cap' : pick(rng, [['bat_lead', 4, 0], ['bat_liion', 2, 1], ['bat_cap', 1, 3]], tier), fr, 'side_r', { rot: 90 });
  b.add(pick(rng, [['fuel_jerry', 3, 0], ['fuel_armored', 1, 2]], tier), fr, 'side_l', { rot: 90 });
  b.add('gear_skids', fr, 'bottom');
  b.add(elite ? eliteWeapon(f, rng, Math.min(tier, 2)) : pick(rng, weaponPool(f).filter(([id]) => getPart(id).mass < 200), tier), fr, 'bottom', { offset: [0, -0.35], group: 1 });
  return b.build();
}

function gunship(f: Faction, tier: number, rng: RNG, elite: boolean) {
  const b = new DesignBuilder('', 'air', 'frm_heli', factionPaint(f, rng));
  const fr = b.frame;
  b.add(tier >= 3 ? 'ckp_gunship' : 'ckp_canopy', fr, 'cockpit');
  b.add(tier >= 4 ? 'rot_coax' : 'rot_main', fr, 'mast');
  if (tier < 4) b.add(tier >= 2 ? 'rot_ducted' : 'rot_scrap', fr, 'tail_r', { rot: 0 });
  b.add('gen_turbine', fr, 'top_rear');
  b.add(tier >= 2 ? 'bat_liion' : 'bat_lead', fr, 'bottom', { offset: [0, 0.8] });
  b.add('fuel_armored', fr, 'bottom', { offset: [0, 0.1] });
  b.add('gear_skids', fr, 'bottom');
  b.add(elite ? eliteWeapon(f, rng, tier) : pick(rng, [['wpn_hmg', 3, 0], ['wpn_chaingun', 2, 0], ['wpn_autocannon', 2, 2]], tier), fr, 'bottom', { offset: [0, -1.05], group: 1 });
  if (tier >= 1) {
    const [wr, wl] = b.pair('wng_stub', fr, 'side');
    const pod = pick(rng, [['wpn_rockets', 3, 0], ['wpn_missiles', 2, 2]], tier);
    b.add(pod, wr, 'pylon_b', { group: 2 });
    b.add(pod, wl, 'pylon_b', { group: 2 });
  }
  b.add('stb_fin', fr, 'tail_top');
  b.add('stb_gyro', fr, 'bottom', { offset: [0, 1.3] });
  return b.build();
}

// ---------------------------------------------------------------- mech
function scoutMech(f: Faction, tier: number, rng: RNG, elite: boolean) {
  const b = new DesignBuilder('', 'mech', 'frm_scout_torso', factionPaint(f, rng));
  const fr = b.frame;
  b.add('ckp_mech', fr, 'cockpit');
  const leg = f === 'helix' ? 'leg_raptor' : pick(rng, [['leg_stilt', 4, 0], ['leg_strider', 2, 1], ['leg_raptor', 1, 3]], tier);
  const act = f === 'helix' ? 'act_servo' : pick(rng, [['act_scrap', 4, 0], ['act_servo', 2, 1], ['act_heavy', 1, 2]], tier);
  const foot = f === 'helix' ? 'ft_mag' : pick(rng, [['ft_pad', 4, 0], ['ft_claw', 2, 1], ['ft_wide', 1, 1]], tier);
  for (const side of ['hip_r', 'hip_l']) {
    const l = b.add(leg, fr, side);
    b.add(act, l, 'hipjoint');
    b.add(act, l, 'kneejoint');
    b.add(foot, l, 'foot');
  }
  const arm = pick(rng, [['arm_light', 4, 0], ['arm_industrial', 2, 1]], tier);
  const [ar, al] = b.pair(arm, fr, 'shoulder');
  b.add(elite ? eliteWeapon(f, rng, Math.min(tier, 2)) : pick(rng, weaponPool(f).filter(([id]) => getPart(id).mass < 200), tier), ar, 'hand', { group: 1 });
  if (f === 'helix') b.add('wpn_laser', al, 'hand', { group: 1 });
  else b.add(pick(rng, [['mel_claw', 3, 0], ['mel_drill', 2, 1], ['wpn_shotgun', 2, 0], ['mel_blade', 0.4, 3], ['mel_fist', 0.6, 2]], tier), al, 'hand', { group: 2 });
  b.add(f === 'helix' ? 'gen_fuelcell' : pick(rng, [['gen_core_scrap', 4, 0], ['gen_fuelcell', 1, 2], ['gen_core_mil', 1, 3]], tier), fr, 'back');
  b.add('fuel_jerry', fr, 'top', { offset: [0, 0.05] });
  if (rng.chance(0.7)) b.add(pick(rng, armorPool(f), tier), fr, 'front');
  if (tier >= 2 && rng.chance(0.5)) b.pair(pick(rng, armorPool(f), tier), fr, 'side');
  return b.build();
}

function walker(f: Faction, tier: number, rng: RNG, elite: boolean) {
  const b = new DesignBuilder('', 'mech', 'frm_walker_torso', factionPaint(f, rng));
  const fr = b.frame;
  b.add('ckp_mech_heavy', fr, 'cockpit');
  for (const side of ['hip_f_r', 'hip_f_l', 'hip_r_r', 'hip_r_l']) {
    const l = b.add('leg_crab', fr, side);
    b.add(tier >= 3 ? 'act_heavy' : 'act_scrap', l, 'hipjoint');
    b.add(tier >= 3 ? 'act_heavy' : 'act_scrap', l, 'kneejoint');
    b.add('ft_claw', l, 'foot');
  }
  const [ar, al] = b.pair('arm_heavy', fr, 'shoulder');
  b.add(elite ? eliteWeapon(f, rng, tier) : pick(rng, [['wpn_autocannon', 3, 0], ['wpn_bushmaster', 2, 2], ['wpn_cannon', 1, 3]], tier), ar, 'hand', { group: 1 });
  b.add(pick(rng, [['wpn_rockets', 2, 0], ['wpn_missiles', 2, 2], ['wpn_hmg', 2, 0]], tier), al, 'hand', { group: 2 });
  b.add(tier >= 3 ? 'gen_core_mil' : 'gen_core_scrap', fr, 'top', { offset: [0, 0.3] });
  b.add('gen_core_scrap', fr, 'back');
  b.add('fuel_armored', fr, 'top', { offset: [0, -0.4] });
  b.add('hyd_pump', fr, 'bottom');
  b.pair(pick(rng, armorPool(f), tier), fr, 'side');
  b.add(pick(rng, armorPool(f), tier), fr, 'front');
  return b.build();
}

function assault(f: Faction, tier: number, rng: RNG, elite: boolean) {
  const b = new DesignBuilder('', 'mech', 'frm_heavy_torso', factionPaint(f, rng));
  const fr = b.frame;
  b.add('ckp_mech_heavy', fr, 'cockpit');
  for (const side of ['hip_r', 'hip_l']) {
    const l = b.add(tier >= 4 ? 'leg_titan' : 'leg_walker', fr, side);
    b.add('act_heavy', l, 'hipjoint');
    b.add('act_heavy', l, 'kneejoint');
    b.add('ft_claw', l, 'foot');
  }
  const [ar, al] = b.pair('arm_heavy', fr, 'shoulder');
  b.add(elite ? eliteWeapon(f, rng, tier) : 'wpn_bushmaster', ar, 'hand', { group: 1 });
  b.add(pick(rng, [['wpn_missiles', 2, 0], ['wpn_rockets', 1, 0]], tier), al, 'hand', { group: 2 });
  b.add('gen_core_mil', fr, 'back');
  b.add('fuel_armored', fr, 'top', { offset: [0.35, 0] });
  b.add('hyd_mil', fr, 'top', { offset: [-0.35, 0] });
  b.add('arm_steel_l', fr, 'front');
  b.pair('arm_steel_s', fr, 'side');
  return b.build();
}

const ROLES: Record<string, (f: Faction, tier: number, rng: RNG, elite: boolean) => MachineDesign> = {
  raider,
  truck,
  hauler: (f, t, r, e) => hauler(f, t, r, e),
  trader: (f, t, r, e) => hauler(f, t, r, e, true),
  tank,
  drone,
  gunship,
  scout: scoutMech,
  walker,
  assault,
};

export const ROLE_CLASS: Record<string, MachineClass> = {
  raider: 'ground',
  truck: 'ground',
  hauler: 'ground',
  trader: 'ground',
  tank: 'ground',
  drone: 'air',
  gunship: 'air',
  scout: 'mech',
  walker: 'mech',
  assault: 'mech',
};

/** Pick a role suited to faction & tier. */
export function pickRole(f: Faction, tier: number, rng: RNG, cls?: MachineClass): string {
  const pool: Pool =
    f === 'authority'
      ? [['raider', 2, 0], ['truck', 3, 0], ['drone', 2, 0], ['gunship', 2, 2], ['scout', 2, 1], ['hauler', 1, 3], ['tank', 1, 3], ['walker', 1, 3], ['assault', 1, 4]]
      : f === 'helix'
        ? [['drone', 4, 0], ['scout', 3, 0], ['raider', 1, 2]]
        : f === 'independents'
          ? [['raider', 3, 0], ['truck', 3, 0], ['drone', 1, 0], ['scout', 1, 1]]
          : [['raider', 5, 0], ['truck', 3, 0], ['drone', 2, 0], ['scout', 2, 0], ['gunship', 0.6, 2], ['walker', 0.6, 3]];
  const filtered = cls ? pool.filter(([r]) => ROLE_CLASS[r] === cls) : pool;
  return pick(rng, filtered.length ? filtered : pool, tier, 0, false);
}

export function generateEnemy(opts: EnemyOptions): MachineDesign {
  const rng = new RNG(opts.seed);
  const tier = Math.max(0, Math.min(5, opts.tier));
  let role = opts.role ?? pickRole(opts.faction, tier, rng, opts.cls);
  for (let attempt = 0; attempt < 6; attempt++) {
    const d = ROLES[role](opts.faction, tier, rng, !!opts.elite);
    const s = computeStats(d);
    if (s.valid) {
      const base = rng.pick(NAMES[opts.faction] ?? NAMES.scrappers);
      d.name = opts.elite ? `Elite ${base}` : base;
      return d;
    }
    if (attempt === 3) role = ROLE_CLASS[role] === 'air' ? 'drone' : ROLE_CLASS[role] === 'mech' ? 'scout' : 'raider';
  }
  const d = raider(opts.faction, 0, rng, false);
  d.name = rng.pick(NAMES[opts.faction] ?? NAMES.scrappers);
  return d;
}
