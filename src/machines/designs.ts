/** Helpers to author machine designs in code, plus the three starter machines. */
import type { MachineClass, MachineDesign, PaintScheme, PartItem, PlacedPart } from './types';
import { uid } from '../core/math';
import { getPart } from './parts/catalog';

export interface AddOpts {
  offset?: [number, number];
  rot?: number;
  tilt?: number;
  mirror?: boolean;
  cond?: number;
  group?: number;
}

export class DesignBuilder {
  design: MachineDesign;
  constructor(name: string, cls: MachineClass, frameId: string, paint: PaintScheme) {
    getPart(frameId);
    this.design = {
      id: uid('mach'),
      name,
      cls,
      paint,
      parts: [],
      created: Date.now(),
      kills: 0,
      distance: 0,
    };
    this.design.parts.push({ uid: uid('p'), defId: frameId, parent: null, socket: null, offset: [0, 0], rot: 0, tilt: 0, cond: 1 });
  }

  get frame() {
    return this.design.parts[0].uid;
  }

  add(defId: string, parent: string, socket: string, o: AddOpts = {}): string {
    getPart(defId);
    const p: PlacedPart = {
      uid: uid('p'),
      defId,
      parent,
      socket,
      offset: o.offset ?? [0, 0],
      rot: o.rot ?? 0,
      tilt: o.tilt ?? 0,
      cond: o.cond ?? 1,
      mirror: o.mirror,
      group: o.group,
    };
    this.design.parts.push(p);
    return p.uid;
  }

  /** Add the same part to a right/left socket pair (ids "<base>_r" / "<base>_l"). Returns [right, left]. */
  pair(defId: string, parent: string, socketBase: string, o: AddOpts = {}): [string, string] {
    return [this.add(defId, parent, `${socketBase}_r`, o), this.add(defId, parent, `${socketBase}_l`, o)];
  }

  build() {
    return this.design;
  }
}

export const PAINTS: Record<string, PaintScheme> = {
  rustbucket: { primary: '#b5552b', secondary: '#d9b25a', accent: '#ff9d2e', pattern: 'stripes', wear: 0.7 },
  skeeter: { primary: '#4f7f8f', secondary: '#e7d7a4', accent: '#7dffea', pattern: 'twotone', wear: 0.45 },
  stilt: { primary: '#6f7a3a', secondary: '#2d2d28', accent: '#ffd23a', pattern: 'hazard', wear: 0.55 },
};

export function starterGround(): MachineDesign {
  const b = new DesignBuilder('Rustbucket', 'ground', 'frm_buggy', PAINTS.rustbucket);
  const f = b.frame;
  const cage = b.add('ckp_cage', f, 'cockpit');
  for (const axle of ['axle_f', 'axle_r']) {
    const [r, l] = b.pair('sus_coil', f, axle);
    b.add('whl_knobby', r, 'hub');
    b.add('whl_knobby', l, 'hub');
  }
  b.add('eng_v4', f, 'top_rear', { offset: [0, 0.05] });
  b.add('trn_3spd', f, 'bottom', { offset: [0, 0.7] });
  b.add('fuel_jerry', f, 'top_front', { offset: [0, 0.0] });
  b.add('wpn_lmg', cage, 'roof', { group: 1 });
  b.add('ram_bullbar', f, 'front');
  b.pair('arm_scrap_s', f, 'side', { rot: 0 });
  b.add('lgt_bar', cage, 'roof', { offset: [0, -0.28] });
  return b.build();
}

export function starterAir(): MachineDesign {
  const b = new DesignBuilder('Skeeter', 'air', 'frm_quad', PAINTS.skeeter);
  const f = b.frame;
  b.add('ckp_canopy', f, 'cockpit');
  b.pair('rot_scrap', f, 'rotor_f');
  b.pair('rot_scrap', f, 'rotor_r');
  b.add('gen_dynamo', f, 'top', { rot: 90 });
  b.add('bat_lead', f, 'side_r', { rot: 90 });
  b.add('fuel_jerry', f, 'side_l', { rot: 90 });
  b.add('gear_skids', f, 'bottom');
  b.add('wpn_lmg', f, 'bottom', { offset: [0, -0.35], group: 1 });
  return b.build();
}

export function starterMech(): MachineDesign {
  const b = new DesignBuilder('Stilt', 'mech', 'frm_scout_torso', PAINTS.stilt);
  const f = b.frame;
  b.add('ckp_mech', f, 'cockpit');
  for (const side of ['hip_r', 'hip_l']) {
    const leg = b.add('leg_stilt', f, side);
    b.add('act_scrap', leg, 'hipjoint');
    b.add('act_scrap', leg, 'kneejoint');
    b.add('ft_pad', leg, 'foot');
  }
  const [ar, al] = b.pair('arm_light', f, 'shoulder');
  b.add('wpn_lmg', ar, 'hand', { group: 1 });
  b.add('mel_claw', al, 'hand', { group: 2 });
  b.add('gen_core_scrap', f, 'back');
  b.add('fuel_jerry', f, 'top', { offset: [0, 0.05] });
  b.add('arm_scrap_s', f, 'front');
  return b.build();
}

/** Convert a design's placed parts to inventory items (for bookkeeping). */
export function designItems(d: MachineDesign): PartItem[] {
  return d.parts.map((p) => ({ uid: p.uid, defId: p.defId, cond: p.cond }));
}

export function cloneDesign(d: MachineDesign): MachineDesign {
  return JSON.parse(JSON.stringify(d));
}
