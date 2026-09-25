/**
 * THE EXCAVATOR — a four-legged mining walker that never stopped working at the bottom of The Pit.
 * It is assembled from real parts like every other machine: its mega-joints, bucket wheel and
 * reactor are targetable, breakable and salvageable, and its unique frame can be taken home.
 */
import * as THREE from 'three';
import type { App } from '../app';
import type { Machine } from '../machines/machine';
import type { PartDef } from '../machines/types';
import { registerParts, PART_MAP } from '../machines/parts/catalog';
import { sock, surf, sym } from '../machines/parts/sockets';
import { registerMeshes, type MeshFn } from '../machines/parts/meshes/registry';
import { DesignBuilder } from '../machines/designs';
import { AIPilot } from '../ai/pilot';
import { h } from '../ui/dom';

const PI = Math.PI;

// ------------------------------------------------------------------ parts
const BOSS_PARTS: PartDef[] = [
  {
    id: 'frm_excavator',
    name: 'Excavator Chassis',
    category: 'frame',
    rootOf: 'mech',
    classes: ['mech'],
    rarity: 'legendary',
    family: 'heavyframes',
    mount: [],
    mass: 4200,
    hp: 5200,
    armor: 32,
    size: [3.6, 2.4, 5.2],
    value: 60000,
    unique: true,
    mesh: 'torso_excavator',
    stats: {},
    desc: 'The mining walker\'s main hull: four hip sockets, two arm mounts and room for a reactor. A quad walker of absurd size.',
    sockets: [
      sock('cockpit', 'cockpit', [0, 0.95, -1.9], [0, 1, 0], { label: 'Operator Cab' }),
      ...sym(sock('hipf', 'hip', [1.55, -1.05, -1.7], [0, -1, 0], { label: 'Right Front Hip' })),
      ...sym(sock('hipb', 'hip', [1.55, -1.05, 1.8], [0, -1, 0], { label: 'Right Rear Hip' })),
      ...sym(sock('shoulder', 'shoulder', [1.85, 0.35, -2.2], [1, 0, 0], { label: 'Right Boom Mount' })),
      surf('top', [0, 1.2, 0.3], [0, 1, 0], [2.4, 1.6], { label: 'Top Deck' }),
      surf('back', [0, 0.35, 2.62], [0, 0, 1], [2.6, 1.4], { label: 'Reactor Bay' }),
      surf('front', [0, -0.35, -2.62], [0, 0, -1], [2.4, 0.9], { label: 'Front Plate' }),
      ...sym(surf('side', [1.82, 0.1, 0.4], [1, 0, 0], [2.4, 1.2], { label: 'Right Flank' })),
    ],
  },
  {
    id: 'gen_excavator',
    name: 'Excavator Reactor',
    category: 'generator',
    classes: ['ground', 'air', 'mech'],
    rarity: 'legendary',
    family: 'energy',
    mount: ['surface'],
    mass: 380,
    hp: 520,
    armor: 18,
    size: [1.2, 1.0, 0.9],
    value: 42000,
    unique: true,
    mesh: 'generator',
    look: { style: 'fusion' },
    stats: { powerGen: 2600, heat: 40 },
    special: ['volatile'],
    desc: 'Pre-Collapse mining reactor. Enough power to run a walker the size of a house, or ten normal machines.',
  },
];

const torso_excavator: MeshFn = (b) => {
  // main hull: a long chamfered box with a raised engine deck
  b.plan('paint', [[-1.5, -2.6], [1.5, -2.6], [1.85, -2.1], [1.85, 2.2], [1.5, 2.6], [-1.5, 2.6], [-1.85, 2.2], [-1.85, -2.1]], 1.7, [0, -0.6, 0], 0.08);
  b.box('paint2', 3.2, 0.14, 4.6, [0, 1.12, 0.1], [0, 0, 0], 0.04);
  b.box('dark', 2.8, 0.5, 4.4, [0, -0.9, 0], [0, 0, 0], 0.06);
  // engine deck with exhaust stacks
  b.box('rust', 2.0, 0.5, 1.6, [0, 1.4, 1.3], [0, 0, 0], 0.05);
  for (const x of [-0.6, 0.6]) {
    b.cyl('dark', 0.16, 1.6, [x, 2.2, 1.9], [0, 0, 0], 14);
    b.cyl('heat', 0.13, 0.22, [x, 3.0, 1.9], [0, 0, 0], 14);
    b.anchor(`exhaust_${x > 0 ? 0 : 1}`, [x, 3.1, 1.9]);
  }
  b.grille('dark', 1.6, 0.35, 8, [0, 1.4, 2.12], 0.03);
  // hip housings
  for (const sx of [-1, 1]) {
    for (const z of [-1.7, 1.8]) {
      b.cyl('dark', 0.5, 0.45, [sx * 1.55, -0.9, z], [0, 0, 0], 20);
      b.cyl('metal', 0.34, 0.5, [sx * 1.55, -0.92, z], [0, 0, 0], 16);
      b.bolts('metal', [0, 1, 2, 3, 4, 5].map((i) => [sx * 1.55 + Math.cos(i) * 0.42, -0.66, z + Math.sin(i) * 0.42] as [number, number, number]), 'y', 0.03);
    }
    // boom mounts
    b.cylX('dark', 0.45, 0.4, [sx * 1.75, 0.35, -2.2], 20);
    b.box('paint2', 0.5, 1.2, 1.3, [sx * 1.7, 0.2, -1.5], [0, 0, 0], 0.05);
    b.hazardPanel(0.06, 0.18, 3.6, [sx * 1.86, -0.25, 0.2]);
    b.rivets('metal', [sx * 1.86, 0.6, -1.9], [sx * 1.86, 0.6, 2.0], 14, sx > 0 ? 'x' : '-x', 0.02);
    // hydraulic lines along the flanks
    b.pipe('rubber', [[sx * 1.6, 0.9, 1.2], [sx * 1.9, 0.4, 0.2], [sx * 1.7, -0.3, -1.4]], 0.05, 16, 8);
    // ladder
    for (let i = 0; i < 5; i++) b.box('metal', 0.04, 0.04, 0.5, [sx * 1.92, -0.8 + i * 0.35, 0.9], [0, 0, 0], 0.005);
  }
  // front: scraper blade lip and floodlights
  b.front('dark', [[-1.6, -0.2], [1.6, -0.2], [1.5, 0.25], [-1.5, 0.25]], 0.25, [0, -1.1, -2.65], 0.03);
  for (const x of [-1.2, -0.8, 0.8, 1.2]) {
    b.box('dark', 0.26, 0.2, 0.12, [x, 0.9, -2.62], [0, 0, 0], 0.02);
    b.cylZ('lamp', 0.08, 0.03, [x, 0.9, -2.69], 14);
  }
  b.anchor('light_0', [0, 0.9, -2.75]);
  // warning beacon
  b.cyl('dark', 0.08, 0.12, [1.2, 1.25, -1.0], [0, 0, 0], 10);
  b.sphere('glow', 0.09, [1.2, 1.38, -1.0]);
  b.rivets('metal', [-1.4, 1.2, -2.2], [1.4, 1.2, -2.2], 12, 'y', 0.02);
  void PI;
};

let registered = false;
export function registerBossParts() {
  if (registered || PART_MAP.has('frm_excavator')) {
    registered = true;
    return;
  }
  registered = true;
  registerParts(BOSS_PARTS);
  registerMeshes({ torso_excavator });
}

// ------------------------------------------------------------------ design
export function excavatorDesign() {
  registerBossParts();
  const b = new DesignBuilder('THE EXCAVATOR', 'mech', 'frm_excavator', {
    primary: '#b98a2a',
    secondary: '#3a3430',
    accent: '#e0b040',
    pattern: 'hazard',
    wear: 0.85,
  } as any);
  const f = b.frame;
  b.add('ckp_mech_heavy', f, 'cockpit');
  for (const side of ['hipf_r', 'hipf_l', 'hipb_r', 'hipb_l']) {
    const leg = b.add('leg_titan', f, side);
    b.add('act_excavator', leg, 'hipjoint');
    b.add('act_excavator', leg, 'kneejoint');
    b.add('ft_wide', leg, 'foot');
  }
  const [ar, al] = b.pair('arm_heavy', f, 'shoulder');
  b.add('mel_bucket', ar, 'hand', { group: 2 });
  b.add('wpn_cannon', al, 'hand', { group: 1 });
  b.add('wpn_rockets', f, 'top', { offset: [-0.7, -0.3], group: 3 });
  b.add('wpn_rockets', f, 'top', { offset: [0.7, -0.3], group: 3 });
  b.add('wpn_hmg', f, 'top', { offset: [0, -0.9], group: 1 });
  b.add('gen_excavator', f, 'back', { offset: [0, 0] });
  b.add('arm_steel_l', f, 'back', { offset: [-0.55, 0.35] });
  b.add('arm_steel_l', f, 'back', { offset: [0.55, 0.35] });
  b.add('hyd_mil', f, 'top', { offset: [0, 0.6] });
  b.add('cool_radiator', f, 'top', { offset: [0.9, 0.55] });
  b.add('fuel_drum', f, 'top', { offset: [-0.9, 0.55] });
  b.add('arm_steel_l', f, 'side_r', { offset: [0, 0] });
  b.add('arm_steel_l', f, 'side_l', { offset: [0, 0] });
  b.add('arm_steel_l', f, 'front', { offset: [0, 0] });
  b.add('lgt_spot', f, 'top', { offset: [0, -1.4] });
  return b.build();
}

// ------------------------------------------------------------------ spawn
export function spawnExcavator(app: App, pos: THREE.Vector3): Machine {
  const game = app.game;
  const design = excavatorDesign();
  const p = new THREE.Vector3(pos.x, game.terrain.heightAt(pos.x, pos.z) + 5.5, pos.z);
  const player = game.player;
  const yaw = player ? Math.atan2(-(player.currPos.x - pos.x), -(player.currPos.z - pos.z)) : 0;
  const m = game.spawnMachine(design, p, yaw, 'scrappers', false, 1);
  m.name = 'THE EXCAVATOR';
  m.tag.boss = true;
  m.tag.tier = 4;
  const pilot = new AIPilot(m, {
    skill: 0.8,
    aggression: 1,
    home: pos.clone(),
    patrolRadius: 110,
    detection: 320,
    doctrine: 'locomotion',
  });
  pilot.preferredRange = 22;
  pilot.provoked = true;
  app.director.pilots.set(m, pilot);
  new BossBar(app, m);
  game.audio.play('boss_roar', m.currPos, { volume: 1 });
  return m;
}

// ------------------------------------------------------------------ HUD bar
const BOSS_CSS = `
#boss-bar{position:absolute;top:18px;left:50%;transform:translateX(-50%);width:min(560px,70vw);pointer-events:none;z-index:6;text-align:center;font-family:var(--font-ui,sans-serif)}
#boss-bar .bn{font-family:var(--font-display,sans-serif);letter-spacing:.3em;font-size:15px;color:#f3d38a;text-shadow:0 1px 6px #000}
#boss-bar .bb{height:9px;background:rgba(0,0,0,.55);border:1px solid rgba(243,211,138,.45);margin-top:5px;position:relative}
#boss-bar .bb i{position:absolute;inset:0;right:auto;background:linear-gradient(90deg,#b8321e,#e8702a);transition:width .25s}
#boss-bar .bc{display:flex;gap:6px;justify-content:center;margin-top:6px;flex-wrap:wrap}
#boss-bar .bc span{font-size:11px;padding:2px 6px;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.15);color:#ddd}
#boss-bar .bc span.dead{color:#777;text-decoration:line-through}
#boss-bar .bc span.hurt{color:#f0a040;border-color:#f0a04066}
`;

class BossBar {
  private el: HTMLElement;
  private fill: HTMLElement;
  private comps: HTMLElement;
  private t = 0;
  constructor(private app: App, private m: Machine) {
    if (!document.getElementById('boss-css')) {
      const s = document.createElement('style');
      s.id = 'boss-css';
      s.textContent = BOSS_CSS;
      document.head.appendChild(s);
    }
    document.getElementById('boss-bar')?.remove();
    this.fill = h('i');
    this.comps = h('div', { class: 'bc' });
    this.el = h('div', { id: 'boss-bar' }, h('div', { class: 'bn' }, 'THE EXCAVATOR'), h('div', { class: 'bb' }, this.fill), this.comps);
    app.ui.appendChild(this.el);
    const hook = (dt: number) => {
      if (!this.update(dt)) {
        const i = app.game.hooks.frame.indexOf(hook);
        if (i >= 0) app.game.hooks.frame.splice(i, 1);
        this.el.remove();
      }
    };
    app.game.hooks.frame.push(hook);
  }

  private update(dt: number): boolean {
    const m = this.m;
    const game = this.app.game;
    if (!game.ctx.machines.includes(m) || this.app.mode !== 'world') return false;
    const pl = game.player;
    const near = !!pl && pl.currPos.distanceTo(m.currPos) < 260;
    this.el.style.display = near && m.alive ? '' : 'none';
    if (!m.alive) return pl ? pl.currPos.distanceTo(m.currPos) < 400 : false;
    this.t -= dt;
    if (this.t > 0) return true;
    this.t = 0.2;
    // core integrity: frame + reactor + cockpit
    const core = m.parts.filter((p) => ['frame', 'generator', 'cockpit'].includes(p.def.category));
    const frac = core.reduce((s, p) => s + Math.max(0, p.hp), 0) / Math.max(1, core.reduce((s, p) => s + p.maxHp, 0));
    this.fill.style.width = `${Math.round(frac * 100)}%`;
    const legs = m.parts.filter((p) => p.def.category === 'leg');
    const joints = m.parts.filter((p) => p.def.id === 'act_excavator');
    const wheel = m.parts.find((p) => p.def.id === 'mel_bucket');
    const reactor = m.parts.find((p) => p.def.id === 'gen_excavator');
    const chip = (label: string, parts: (typeof m.parts)[number][]) => {
      const alive = parts.filter((p) => !p.destroyed && !p.detached);
      const hurt = alive.some((p) => p.hp < p.maxHp * 0.5);
      const cls = alive.length === 0 ? 'dead' : hurt ? 'hurt' : '';
      return `<span class="${cls}">${label}${parts.length > 1 ? ` ${alive.length}/${parts.length}` : ''}</span>`;
    };
    this.comps.innerHTML = [chip('Legs', legs), chip('Mega-joints', joints), wheel ? chip('Bucket wheel', [wheel]) : '', reactor ? chip('Reactor', [reactor]) : ''].join('');
    return true;
  }
}
