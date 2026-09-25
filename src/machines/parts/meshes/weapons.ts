/**
 * Weapon meshes. Convention: base ring at y=0; node 'yaw' rotates around Y;
 * node 'pitch' (inside yaw) rotates around X; barrels point along -Z;
 * anchors 'muzzle_i' mark barrel tips; nodes 'barrel_i' recoil along +Z.
 */
import { PartBuilder } from '../kit';
import type { MeshFn } from './registry';

const PI = Math.PI;

function turretBase(b: PartBuilder, r: number, h: number, slot: 'dark' | 'paint' = 'dark') {
  b.cyl(slot, r, h, [0, h / 2, 0], [0, 0, 0], 20);
  b.torus('metal', r * 0.98, 0.012, [0, h, 0], [PI / 2, 0, 0], 24);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2;
    b.bolts('metal', [[Math.cos(a) * r * 0.8, h + 0.005, Math.sin(a) * r * 0.8]], 'y', 0.012);
  }
}

const w_mg: MeshFn = (b, def) => {
  const barrels = Number(def.look?.barrels ?? 1);
  turretBase(b, 0.13, 0.06);
  b.node('yaw', [0, 0.06, 0]);
  b.box('dark', 0.05, 0.22, 0.06, [0.1, 0.11, 0], [0, 0, 0], 0.01);
  b.box('dark', 0.05, 0.22, 0.06, [-0.1, 0.11, 0], [0, 0, 0], 0.01);
  b.node('pitch', [0, 0.2, 0]);
  for (let i = 0; i < barrels; i++) {
    const x = barrels === 1 ? 0 : i === 0 ? -0.06 : 0.06;
    b.box('paint2', 0.07, 0.1, 0.36, [x, 0, 0.04], [0, 0, 0], 0.015);
    b.box('dark', 0.04, 0.12, 0.08, [x, -0.1, 0.02]);
    // ammo box
    b.box('paint', 0.1, 0.1, 0.14, [x + (barrels === 1 ? 0.1 : i === 0 ? -0.1 : 0.1), -0.04, 0.05], [0, 0, 0], 0.015);
    b.node(`barrel_${i}`, [x, 0.01, -0.14]);
    b.cylZ('dark', 0.02, 0.5, [0, 0, -0.25], 10);
    b.cylZ('dark', 0.032, 0.18, [0, 0, -0.08], 10);
    b.cylZ('metal', 0.026, 0.06, [0, 0, -0.5], 10);
    b.anchor(`muzzle_${i}`, [0, 0, -0.55]);
    b.end();
  }
  // shield
  b.box('paint', 0.34, 0.22, 0.02, [0, 0.02, -0.12], [0.1, 0, 0], 0.01);
  b.end();
  b.end();
};

const w_chaingun: MeshFn = (b) => {
  turretBase(b, 0.16, 0.07);
  b.node('yaw', [0, 0.07, 0]);
  b.box('dark', 0.06, 0.26, 0.1, [0.15, 0.13, 0], [0, 0, 0], 0.02);
  b.box('dark', 0.06, 0.26, 0.1, [-0.15, 0.13, 0], [0, 0, 0], 0.02);
  b.node('pitch', [0, 0.24, 0]);
  b.box('paint2', 0.22, 0.2, 0.34, [0, 0, 0.1], [0, 0, 0], 0.03);
  b.box('paint', 0.14, 0.18, 0.22, [0.2, -0.02, 0.12], [0, 0, 0], 0.02);
  b.pipe('metal', [[0.2, 0.06, 0.02], [0.14, 0.1, -0.06], [0.05, 0.06, -0.1]], 0.025, 8, 6);
  b.node('barrel_0', [0, 0, -0.08]);
  b.node('spin', [0, 0, 0]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    b.cylZ('dark', 0.018, 0.7, [Math.cos(a) * 0.05, Math.sin(a) * 0.05, -0.35], 8);
  }
  b.cylZ('metal', 0.075, 0.05, [0, 0, -0.1], 14);
  b.cylZ('metal', 0.075, 0.04, [0, 0, -0.55], 14);
  b.cylZ('dark', 0.02, 0.72, [0, 0, -0.34], 8);
  b.end();
  b.anchor('muzzle_0', [0, 0, -0.72]);
  b.end();
  b.end();
  b.end();
};

const w_hmg: MeshFn = (b) => {
  turretBase(b, 0.18, 0.08);
  b.node('yaw', [0, 0.08, 0]);
  b.box('paint', 0.5, 0.06, 0.4, [0, 0.03, 0.02], [0, 0, 0], 0.02);
  b.box('dark', 0.06, 0.25, 0.12, [0.18, 0.15, 0], [0, 0, 0], 0.02);
  b.box('dark', 0.06, 0.25, 0.12, [-0.18, 0.15, 0], [0, 0, 0], 0.02);
  b.node('pitch', [0, 0.26, 0]);
  b.box('paint2', 0.26, 0.12, 0.2, [0, 0, 0.12], [0, 0, 0], 0.02);
  for (let i = 0; i < 2; i++) {
    const x = i === 0 ? -0.1 : 0.1;
    b.box('dark', 0.1, 0.14, 0.42, [x, 0.02, 0.05], [0, 0, 0], 0.02);
    b.box('paint', 0.12, 0.13, 0.16, [x * 2.3, -0.02, 0.1], [0, 0, 0], 0.02);
    b.node(`barrel_${i}`, [x, 0.03, -0.18]);
    b.cylZ('dark', 0.025, 0.75, [0, 0, -0.38], 10);
    b.cylZ('dark', 0.04, 0.3, [0, 0, -0.1], 10);
    b.cylZ('metal', 0.035, 0.1, [0, 0, -0.76], 10);
    b.anchor(`muzzle_${i}`, [0, 0, -0.82]);
    b.end();
  }
  b.box('paint', 0.5, 0.26, 0.03, [0, 0.03, -0.14], [0.15, 0, 0], 0.01);
  b.end();
  b.end();
};

const w_shotgun: MeshFn = (b) => {
  turretBase(b, 0.12, 0.05, 'dark');
  b.node('yaw', [0, 0.05, 0]);
  b.box('rust', 0.05, 0.2, 0.08, [0.1, 0.1, 0]);
  b.box('rust', 0.05, 0.2, 0.08, [-0.1, 0.1, 0]);
  b.node('pitch', [0, 0.18, 0]);
  b.box('wood', 0.1, 0.1, 0.3, [0, -0.02, 0.15], [0, 0, 0], 0.02);
  b.node('barrel_0', [0, 0, -0.05]);
  b.cylZ('rust', 0.06, 0.55, [0, 0.02, -0.2], 14);
  b.cylZ('metal', 0.07, 0.05, [0, 0.02, -0.45], 14);
  b.cylZ('dark', 0.035, 0.4, [0, -0.07, -0.15], 10);
  b.anchor('muzzle_0', [0, 0.02, -0.5]);
  b.end();
  b.end();
  b.end();
};

const w_autocannon: MeshFn = (b, def) => {
  const big = !!def.look?.big;
  const s = big ? 1.25 : 1;
  turretBase(b, 0.24 * s, 0.1, 'paint');
  b.node('yaw', [0, 0.1, 0]);
  b.box('paint', 0.5 * s, 0.26 * s, 0.55 * s, [0, 0.13 * s, 0.05], [0, 0, 0], 0.04);
  b.box('paint2', 0.2 * s, 0.1 * s, 0.35 * s, [0.3 * s, 0.1 * s, 0.1], [0, 0, 0], 0.03);
  b.grille('dark', 0.3 * s, 0.15 * s, 4, [0, 0.14 * s, 0.33 * s], 0.01);
  b.node('pitch', [0, 0.2 * s, -0.15 * s]);
  b.box('dark', 0.22 * s, 0.18 * s, 0.24 * s, [0, 0, 0], [0, 0, 0], 0.03);
  b.node('barrel_0', [0, 0, -0.1 * s]);
  b.cylZ('dark', 0.045 * s, 1.1 * s, [0, 0, -0.55 * s], 12);
  b.cylZ('dark', 0.07 * s, 0.25 * s, [0, 0, -0.1 * s], 14);
  // muzzle brake
  b.box('metal', 0.14 * s, 0.09 * s, 0.14 * s, [0, 0, -1.1 * s], [0, 0, 0], 0.015);
  b.box('dark', 0.16 * s, 0.03 * s, 0.03 * s, [0, 0, -1.06 * s]);
  b.anchor('muzzle_0', [0, 0, -1.2 * s]);
  b.end();
  b.end();
  b.end();
};

const w_cannon: MeshFn = (b, def) => {
  const big = !!def.look?.big;
  const s = big ? 1.35 : 1;
  turretBase(b, 0.45 * s, 0.12, 'dark');
  b.node('yaw', [0, 0.12, 0]);
  // turret body
  b.profile('paint', [[-0.6 * s, 0], [-0.65 * s, 0.22 * s], [-0.35 * s, 0.42 * s], [0.55 * s, 0.42 * s], [0.75 * s, 0.25 * s], [0.7 * s, 0]], 0.9 * s, [0, 0, 0], 0.03);
  b.box('paint2', 0.95 * s, 0.05 * s, 0.9 * s, [0, 0.44 * s, 0.1], [0, 0, 0], 0.01);
  b.cyl('dark', 0.13 * s, 0.1 * s, [0.2 * s, 0.5 * s, 0.25 * s], [0, 0, 0], 16);
  b.box('dark', 0.25 * s, 0.25 * s, 0.4 * s, [0, 0.2 * s, 0.75 * s], [0, 0, 0], 0.02);
  b.rivets('metal', [-0.45 * s, 0.38 * s, -0.3 * s], [-0.45 * s, 0.38 * s, 0.5 * s], 6, '-x');
  b.rivets('metal', [0.45 * s, 0.38 * s, -0.3 * s], [0.45 * s, 0.38 * s, 0.5 * s], 6, 'x');
  b.node('pitch', [0, 0.25 * s, -0.55 * s]);
  b.box('paint', 0.36 * s, 0.3 * s, 0.25 * s, [0, 0, 0.02], [0, 0, 0], 0.04);
  b.node('barrel_0', [0, 0, -0.1]);
  b.cylZ('dark', 0.075 * s, 2.2 * s, [0, 0, -1.1 * s], 18, 0.065 * s);
  b.cylZ('paint2', 0.11 * s, 0.45 * s, [0, 0, -0.9 * s], 18);
  // muzzle brake
  b.box('metal', 0.26 * s, 0.14 * s, 0.24 * s, [0, 0, -2.2 * s], [0, 0, 0], 0.02);
  b.box('dark', 0.3 * s, 0.05 * s, 0.05 * s, [0, 0, -2.15 * s]);
  b.anchor('muzzle_0', [0, 0, -2.36 * s]);
  b.end();
  b.end();
  b.end();
};

const w_rockets: MeshFn = (b) => {
  turretBase(b, 0.14, 0.06);
  b.node('yaw', [0, 0.06, 0]);
  b.box('dark', 0.06, 0.25, 0.1, [0.16, 0.12, 0]);
  b.box('dark', 0.06, 0.25, 0.1, [-0.16, 0.12, 0]);
  b.node('pitch', [0, 0.28, 0]);
  b.box('paint2', 0.42, 0.34, 0.7, [0, 0, 0], [0, 0, 0], 0.04);
  b.hazardPanel(0.43, 0.05, 0.05, [0, 0.14, -0.33]);
  for (let i = 0; i < 8; i++) {
    const x = -0.135 + (i % 4) * 0.09;
    const y = i < 4 ? 0.06 : -0.06;
    b.cylZ('dark', 0.036, 0.04, [x, y, -0.35], 10);
    b.cone('paint', 0.028, 0.08, [x, y, -0.36], [-PI / 2, 0, 0], 8);
    b.anchor(`muzzle_${i}`, [x, y, -0.42]);
  }
  b.end();
  b.end();
};

const w_missiles: MeshFn = (b, def) => {
  const swarm = !!def.look?.swarm;
  turretBase(b, 0.16, 0.06);
  b.node('yaw', [0, 0.06, 0]);
  b.box('dark', 0.08, 0.3, 0.12, [0, 0.15, 0.1]);
  b.node('pitch', [0, 0.32, 0]);
  if (swarm) {
    b.box('paint', 0.56, 0.4, 0.5, [0, 0, 0], [0, 0, 0], 0.04);
    for (let i = 0; i < 16; i++) {
      const x = -0.195 + (i % 4) * 0.13;
      const y = -0.13 + Math.floor(i / 4) * 0.087;
      b.cylZ('dark', 0.03, 0.02, [x, y, -0.25], 8);
      b.anchor(`muzzle_${i}`, [x, y, -0.3]);
    }
  } else {
    b.box('paint', 0.5, 0.08, 0.9, [0, -0.18, 0], [0, 0, 0], 0.02);
    for (let i = 0; i < 4; i++) {
      const x = i < 2 ? -0.12 : 0.12;
      const y = i % 2 === 0 ? -0.06 : 0.1;
      b.node(`round_${i}`, [x, y, 0]);
      b.cylZ('white', 0.06, 0.95, [0, 0, 0], 12);
      b.cone('paint2', 0.06, 0.18, [0, 0, -0.56], [-PI / 2, 0, 0], 12);
      for (let f = 0; f < 4; f++) b.box('dark', 0.004, 0.08, 0.14, [0, 0, 0.4], [0, 0, (f / 4) * PI + PI / 4]);
      b.end();
      b.anchor(`muzzle_${i}`, [x, y, -0.68]);
    }
    b.box('dark', 0.06, 0.34, 0.06, [0, -0.02, -0.3]);
    b.box('dark', 0.06, 0.34, 0.06, [0, -0.02, 0.3]);
  }
  b.end();
  b.end();
};

const w_laser: MeshFn = (b, def) => {
  const beam = !!def.look?.beam;
  b.cyl('white', 0.16, 0.08, [0, 0.04, 0], [0, 0, 0], 24);
  b.torus('glow', 0.16, 0.008, [0, 0.08, 0], [PI / 2, 0, 0], 28);
  b.node('yaw', [0, 0.08, 0]);
  b.box('white', 0.06, 0.2, 0.12, [0.12, 0.1, 0], [0, 0, 0], 0.03);
  b.box('white', 0.06, 0.2, 0.12, [-0.12, 0.1, 0], [0, 0, 0], 0.03);
  b.node('pitch', [0, 0.2, 0]);
  b.lathe('white', [[0.0, -0.2], [0.09, -0.18], [0.1, 0.15], [0.07, 0.25], [0.0, 0.26]], [0, 0, 0], [PI / 2, 0, 0], 20);
  b.node('barrel_0', [0, 0, -0.2]);
  b.cylZ('dark', beam ? 0.045 : 0.035, beam ? 0.7 : 0.5, [0, 0, beam ? -0.35 : -0.25], 14);
  for (let i = 0; i < (beam ? 5 : 3); i++) b.torus('glow', beam ? 0.055 : 0.045, 0.008, [0, 0, -0.1 - i * 0.12], [0, 0, 0], 16);
  b.cylZ('glass', beam ? 0.04 : 0.03, 0.03, [0, 0, beam ? -0.71 : -0.51], 14);
  b.anchor('muzzle_0', [0, 0, beam ? -0.74 : -0.54]);
  b.end();
  b.box('dark', 0.05, 0.05, 0.2, [0, -0.1, 0.1]);
  b.end();
  b.end();
};

const w_railgun: MeshFn = (b) => {
  turretBase(b, 0.3, 0.1, 'dark');
  b.node('yaw', [0, 0.1, 0]);
  b.box('paint', 0.6, 0.2, 0.7, [0, 0.1, 0.15], [0, 0, 0], 0.04);
  for (const x of [-0.26, 0.26]) b.box('dark', 0.08, 0.35, 0.2, [x, 0.3, 0]);
  b.node('pitch', [0, 0.42, 0]);
  b.box('dark', 0.34, 0.3, 0.6, [0, 0, 0.1], [0, 0, 0], 0.04);
  for (let i = 0; i < 4; i++) b.cyl('paint2', 0.06, 0.34, [-0.12 + i * 0.08, 0.1, 0.35], [0, 0, 0], 12);
  b.node('barrel_0', [0, 0, -0.2]);
  for (const y of [0.09, -0.09]) b.box('metal', 0.1, 0.05, 2.2, [0, y, -1.0], [0, 0, 0], 0.01);
  for (let i = 0; i < 7; i++) {
    b.box('paint', 0.2, 0.26, 0.05, [0, 0, -0.1 - i * 0.3], [0, 0, 0], 0.01);
    b.box('glow', 0.02, 0.14, 0.03, [0, 0, -0.1 - i * 0.3]);
  }
  b.anchor('muzzle_0', [0, 0, -2.15]);
  b.end();
  b.end();
  b.end();
};

const w_flamer: MeshFn = (b) => {
  turretBase(b, 0.12, 0.05);
  b.node('yaw', [0, 0.05, 0]);
  b.box('dark', 0.05, 0.2, 0.08, [0.1, 0.1, 0]);
  b.box('dark', 0.05, 0.2, 0.08, [-0.1, 0.1, 0]);
  b.node('pitch', [0, 0.18, 0]);
  b.cylZ('paint2', 0.08, 0.3, [0, 0.08, 0.12], 14);
  b.sphere('paint2', 0.08, [0, 0.08, 0.27], [1, 1, 0.5], 12);
  b.cylZ('dark', 0.03, 0.6, [0, -0.02, -0.18], 10);
  b.cylZ('heat', 0.05, 0.08, [0, -0.02, -0.5], 12, 0.04);
  b.pipe('rubber', [[0, 0.02, 0.1], [0.05, -0.04, 0.05], [0.02, -0.02, -0.05]], 0.015, 8, 6);
  b.box('glow', 0.02, 0.02, 0.02, [0, -0.06, -0.52]);
  b.anchor('muzzle_0', [0, -0.02, -0.56]);
  b.end();
  b.end();
};

const w_arc: MeshFn = (b) => {
  b.cyl('white', 0.14, 0.1, [0, 0.05, 0], [0, 0, 0], 20);
  b.node('yaw', [0, 0.1, 0]);
  b.cyl('dark', 0.05, 0.2, [0, 0.1, 0], [0, 0, 0], 12);
  b.node('pitch', [0, 0.24, 0]);
  b.cylZ('white', 0.06, 0.35, [0, 0, 0.05], 16);
  for (let i = 0; i < 4; i++) b.torus('copper', 0.07 - i * 0.008, 0.018, [0, 0, -0.1 - i * 0.07], [0, 0, 0], 16);
  b.sphere('glow', 0.07, [0, 0, -0.42], [1, 1, 1], 16);
  b.anchor('muzzle_0', [0, 0, -0.45]);
  b.end();
  b.end();
};

export const WEAPON_MESHES: Record<string, MeshFn> = {
  w_mg,
  w_chaingun,
  w_hmg,
  w_shotgun,
  w_autocannon,
  w_cannon,
  w_rockets,
  w_missiles,
  w_laser,
  w_beam: w_laser,
  w_railgun,
  w_flamer,
  w_arc,
};
