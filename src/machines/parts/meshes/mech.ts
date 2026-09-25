/** Mesh builders for mech torsos, legs, joints, feet, arms and melee tools. */
import type { MeshFn } from './registry';

const PI = Math.PI;

const torso_scout: MeshFn = (b) => {
  // chamfered chest (front outline extruded along Z)
  b.front('paint', [[-0.55, -0.35], [0.55, -0.35], [0.68, 0.0], [0.6, 0.45], [0.35, 0.62], [-0.35, 0.62], [-0.6, 0.45], [-0.68, 0.0]], 1.05, [0, 0, 0.05], 0.05);
  b.box('paint2', 0.8, 0.08, 0.9, [0, 0.62, 0.1], [0, 0, 0], 0.03);
  // hip block
  b.box('dark', 0.95, 0.28, 0.6, [0, -0.46, 0.05], [0, 0, 0], 0.04);
  for (const s of [-1, 1]) {
    b.cyl('metal', 0.14, 0.12, [s * 0.42, -0.58, 0.05], [0, 0, 0], 16);
    // shoulder housing
    b.cylX('dark', 0.2, 0.18, [s * 0.66, 0.18, -0.05], 18);
    b.cylX('metal', 0.12, 0.2, [s * 0.68, 0.18, -0.05], 14);
    // hydraulic lines
    b.pipe('rubber', [[s * 0.4, 0.3, 0.5], [s * 0.62, 0.0, 0.45], [s * 0.45, -0.4, 0.3]], 0.025, 10, 6);
  }
  // back vents
  b.grille('dark', 0.6, 0.3, 5, [0, 0.25, 0.58], 0.02);
  b.grille('dark', 0.5, 0.2, 4, [0, -0.15, -0.58], 0.02, [0, PI, 0]);
  b.rivets('metal', [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], 8, '-z');
  b.anchor('light_0', [0.35, 0.3, -0.58]);
  b.cylZ('lamp', 0.05, 0.02, [0.35, 0.3, -0.57], 12);
};

const torso_walker: MeshFn = (b) => {
  b.plan('paint', [[-0.8, -1.4], [0.8, -1.4], [1.1, -1.0], [1.1, 1.1], [0.85, 1.4], [-0.85, 1.4], [-1.1, 1.1], [-1.1, -1.0]], 0.75, [0, -0.35, 0], 0.06);
  b.box('paint2', 1.7, 0.08, 1.8, [0, 0.45, 0.4], [0, 0, 0], 0.03);
  b.box('dark', 1.3, 0.2, 2.2, [0, -0.45, 0], [0, 0, 0], 0.04);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.cyl('dark', 0.3, 0.3, [sx * 0.95, -0.35, sz * 1.0], [0, 0, 0], 18);
      b.cyl('metal', 0.2, 0.34, [sx * 0.95, -0.35, sz * 1.0], [0, 0, 0], 14);
    }
    b.cylX('dark', 0.22, 0.2, [sx * 1.12, 0.15, -1.2], 16);
    b.hazardPanel(0.05, 0.12, 1.6, [sx * 1.11, -0.1, 0.1]);
  }
  b.grille('dark', 1.2, 0.4, 6, [0, 0.0, 1.42], 0.02);
  b.anchor('light_0', [0, 0.1, -1.42]);
  b.cylZ('lamp', 0.07, 0.02, [0.4, 0.1, -1.41], 12);
  b.cylZ('lamp', 0.07, 0.02, [-0.4, 0.1, -1.41], 12);
};

const torso_heavy: MeshFn = (b) => {
  b.front('paint', [[-0.72, -0.75], [0.72, -0.75], [0.95, -0.2], [1.0, 0.55], [0.7, 0.9], [-0.7, 0.9], [-1.0, 0.55], [-0.95, -0.2]], 1.5, [0, 0, 0.02], 0.06);
  b.front('paint2', [[-0.55, -0.4], [0.55, -0.4], [0.65, 0.4], [-0.65, 0.4]], 0.08, [0, 0.1, -0.78], 0.02);
  b.box('dark', 1.2, 0.3, 0.9, [0, -0.85, 0.1], [0, 0, 0], 0.05);
  for (const s of [-1, 1]) {
    b.cyl('metal', 0.2, 0.14, [s * 0.62, -0.9, 0.1], [0, 0, 0], 18);
    b.cylX('dark', 0.3, 0.26, [s * 1.02, 0.35, -0.05], 20);
    b.box('paint2', 0.45, 0.2, 0.9, [s * 1.0, 0.75, -0.02], [0, 0, s * -0.3], 0.05);
    b.rivets('metal', [s * 0.98, 0.1, -0.7], [s * 0.98, 0.1, 0.7], 7, s > 0 ? 'x' : '-x');
  }
  b.grille('dark', 1.0, 0.5, 6, [0, 0.2, 0.8], 0.02);
  b.cylZ('lamp', 0.06, 0.02, [0.45, 0.5, -0.8], 12);
  b.cylZ('lamp', 0.06, 0.02, [-0.45, 0.5, -0.8], 12);
  b.anchor('light_0', [0, 0.5, -0.85]);
};

const cockpit_mech: MeshFn = (b) => {
  b.front('paint', [[-0.38, 0.0], [0.38, 0.0], [0.42, 0.35], [0.3, 0.6], [-0.3, 0.6], [-0.42, 0.35]], 0.75, [0, 0, 0], 0.04);
  b.box('glass', 0.55, 0.1, 0.05, [0, 0.42, -0.37], [0.25, 0, 0], 0.02);
  b.box('dark', 0.62, 0.04, 0.06, [0, 0.5, -0.38], [0.3, 0, 0]);
  b.box('paint2', 0.5, 0.06, 0.4, [0, 0.62, 0.05], [0, 0, 0], 0.02);
  b.cyl('dark', 0.015, 0.4, [0.28, 0.8, 0.2], [0, 0, 0], 6);
  b.sphere('glow', 0.025, [0.28, 1.0, 0.2]);
  b.rivets('metal', [-0.3, 0.1, -0.38], [0.3, 0.1, -0.38], 5, '-z');
};

const cockpit_mech_heavy: MeshFn = (b) => {
  b.front('paint', [[-0.55, 0.0], [0.55, 0.0], [0.6, 0.45], [0.42, 0.8], [-0.42, 0.8], [-0.6, 0.45]], 0.95, [0, 0, 0], 0.05);
  for (const x of [-0.25, 0, 0.25]) b.box('glass', 0.18, 0.07, 0.05, [x, 0.55, -0.47], [0.3, 0, 0], 0.015);
  b.box('paint2', 1.0, 0.12, 0.3, [0, 0.78, -0.35], [0.2, 0, 0], 0.03);
  b.box('dark', 0.2, 0.15, 0.3, [0.45, 0.85, 0.2], [0, 0, 0], 0.02);
  b.box('glow', 0.05, 0.05, 0.02, [0.45, 0.85, 0.04]);
};

const leg: MeshFn = (b, def) => {
  const style = String(def.look?.style ?? 'stilt');
  const T = def.stats.thigh ?? 1.3;
  const S = def.stats.shin ?? 1.4;
  const heavy = style === 'walker' || style === 'titan';
  const w = style === 'titan' ? 0.36 : heavy ? 0.28 : style === 'strider' ? 0.2 : 0.15;
  b.node('hip', [0, 0, 0]);
  b.anchor('hipjoint', [0, 0, 0]);
  // thigh
  if (style === 'crab') {
    b.box('paint', w, T * 0.9, w * 1.1, [0, T / 2, 0], [0, 0, 0], 0.04);
    b.box('dark', w * 0.6, T * 0.8, w * 0.4, [0, T / 2, w * 0.6]);
  } else {
    b.box('paint', w * 1.2, T * 0.85, w * 1.4, [0, T / 2, 0], [0, 0, 0], 0.05);
    b.box('paint2', w * 1.25, T * 0.4, w * 0.2, [0, T * 0.45, -w * 0.75], [0, 0, 0], 0.02);
    b.piston([0, T * 0.12, w * 0.9], [0, T * 0.82, w * 0.75], heavy ? 0.06 : 0.04);
  }
  b.pipe('rubber', [[w * 0.6, T * 0.1, 0], [w * 0.9, T * 0.5, w * 0.2], [w * 0.6, T * 0.9, 0]], 0.02, 10, 6);
  b.node('knee', [0, T, 0]);
  b.anchor('kneejoint', [0, 0, 0]);
  b.sphere('metal', w * 0.7, [0, 0, 0], [1, 1, 1], 12);
  // shin
  if (style === 'raptor') {
    b.box('paint', w * 1.1, S * 0.9, w * 1.3, [0, S / 2, 0], [0, 0, 0], 0.04);
    b.box('paint2', w * 0.5, S * 0.7, w * 0.3, [0, S * 0.45, -w * 0.7], [0, 0, 0], 0.02);
  } else if (style === 'crab') {
    b.cone('paint', w * 0.8, S, [0, S / 2, 0], [PI, 0, 0], 10);
  } else {
    b.box('paint', w * 1.3, S * 0.9, w * 1.5, [0, S / 2, 0], [0, 0, 0], 0.05);
    b.box('paint2', w * 1.35, S * 0.5, w * 0.25, [0, S * 0.35, -w * 0.8], [0, 0, 0], 0.02);
    if (heavy) b.rivets('metal', [0, S * 0.15, -w * 0.95], [0, S * 0.65, -w * 0.95], 5, '-z');
    b.piston([0, S * 0.1, w * 0.95], [0, S * 0.85, w * 0.8], heavy ? 0.055 : 0.035);
  }
  b.node('ankle', [0, S, 0]);
  b.sphere('dark', w * 0.55, [0, 0, 0], [1, 1, 1], 10);
  b.anchor('foot', [0, 0, 0]);
  b.end();
  b.end();
  b.end();
};

const actuator: MeshFn = (b, def) => {
  const style = String(def.look?.style ?? 'scrap');
  // Local +Y is the joint axis (sideways). Built centred on the joint.
  const s = style === 'mega' ? 1.8 : style === 'titan' ? 1.35 : style === 'heavy' ? 1.2 : 1;
  const r = 0.16 * s;
  b.cyl(style === 'servo' ? 'white' : 'dark', r, 0.14 * s, [0, 0.12 * s, 0], [0, 0, 0], 18);
  b.cyl('metal', r * 0.6, 0.18 * s, [0, 0.14 * s, 0], [0, 0, 0], 14);
  b.cyl('dark', r * 0.35, 0.05, [0, 0.24 * s, 0], [0, 0, 0], 10);
  if (style === 'scrap') {
    b.pipe('rubber', [[r, 0.12, 0], [r * 1.6, 0.2, r], [r * 0.8, 0.12, r * 1.4]], 0.02, 8, 6);
    b.box('rust', 0.05, 0.1, 0.12, [r, 0.12, 0]);
  } else if (style === 'servo') {
    b.torus('glow', r * 0.85, 0.008, [0, 0.2 * s, 0], [PI / 2, 0, 0], 20);
  } else if (style === 'heavy' || style === 'mega') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2;
      b.bolts('metal', [[Math.cos(a) * r * 0.8, 0.2 * s, Math.sin(a) * r * 0.8]], 'y', 0.02 * s);
    }
    b.piston([r, 0.12 * s, 0], [r * 2.4, 0.12 * s, r * 1.2], 0.035 * s, 'paint2');
    if (style === 'mega') b.hazardPanel(r * 1.4, 0.03, 0.06, [0, 0.21 * s, -r * 0.3]);
  } else {
    b.torus('rarity', r * 0.9, 0.01, [0, 0.2 * s, 0], [PI / 2, 0, 0], 20);
    b.torus('copper', r * 0.7, 0.03, [0, 0.12 * s, 0], [PI / 2, 0, 0], 20);
  }
};

const foot: MeshFn = (b, def) => {
  const style = String(def.look?.style ?? 'pad');
  // Foot local: +Y up (away from ground), sole at y = -0.2 below ankle, toes to -Z.
  const size = def.stats.footSize ?? 0.6;
  if (style === 'claw') {
    b.box('dark', 0.25, 0.18, 0.3, [0, -0.12, 0], [0, 0, 0], 0.04);
    for (const [x, rot] of [[0.12, 0.3], [-0.12, -0.3], [0, 0]] as [number, number][]) {
      b.box('paint', 0.1, 0.08, size * 0.8, [x, -0.2, -size * 0.35], [0, rot, 0], 0.03);
      b.cone('metal', 0.05, 0.16, [x + Math.sin(rot) * -size * 0.7, -0.22, -size * 0.75], [-PI / 2 - 0.3, 0, 0], 6);
    }
    b.box('paint', 0.1, 0.08, 0.3, [0, -0.2, 0.25], [0, 0, 0], 0.03);
  } else if (style === 'wide') {
    b.box('dark', 0.25, 0.16, 0.25, [0, -0.1, 0], [0, 0, 0], 0.04);
    b.plan('paint', [[-size * 0.45, -size * 0.6], [size * 0.45, -size * 0.6], [size * 0.55, 0], [size * 0.4, size * 0.45], [-size * 0.4, size * 0.45], [-size * 0.55, 0]], 0.08, [0, -0.24, 0], 0.02);
    b.fins('dark', size * 0.9, 0.03, 0.03, 5, size * 0.18, [0, -0.25, 0], 'z');
  } else if (style === 'mag') {
    b.box('white', 0.3, 0.15, 0.3, [0, -0.1, 0], [0, 0, 0], 0.05);
    b.box('white', size * 0.8, 0.08, size * 1.1, [0, -0.2, -0.05], [0, 0, 0], 0.03);
    b.box('glow', size * 0.7, 0.01, size, [0, -0.245, -0.05]);
  } else {
    b.box('dark', 0.24, 0.16, 0.24, [0, -0.1, 0], [0, 0, 0], 0.04);
    b.box('paint', size * 0.75, 0.1, size * 1.1, [0, -0.22, -0.06], [0, 0, 0], 0.03);
    b.box('rubber', size * 0.75, 0.03, size * 1.1, [0, -0.28, -0.06], [0, 0, 0], 0.01);
    b.box('paint2', size * 0.5, 0.05, 0.12, [0, -0.15, -size * 0.55], [0.4, 0, 0], 0.01);
  }
};

const arm: MeshFn = (b, def) => {
  const style = String(def.look?.style ?? 'light');
  const hand = def.sockets?.[0]?.pos ?? [-0.1, 0.45, -1.2];
  const s = style === 'heavy' ? 1.35 : style === 'industrial' ? 1.15 : 1;
  // Local: +Y outward, -Z forward, +X = machine down (mirrored on left). Shoulder pivots around Y.
  b.node('shoulder', [0, 0, 0]);
  b.cyl('dark', 0.16 * s, 0.22, [0, 0.11, 0], [0, 0, 0], 16);
  b.box('paint', 0.3 * s, 0.24 * s, 0.34 * s, [0.08, hand[1] * 0.75, 0.0], [0, 0, 0], 0.04);
  if (style === 'heavy') b.box('paint2', 0.5, 0.3, 0.5, [-0.12, hand[1] * 0.8, 0.02], [0, 0, 0.2], 0.05);
  b.node('elbow', [0.15, hand[1], -0.05]);
  b.sphere('metal', 0.1 * s, [0, 0, 0], [1, 1, 1], 12);
  b.box('paint', 0.18 * s, 0.2 * s, Math.abs(hand[2]) * 0.95, [-0.1, 0, hand[2] * 0.5], [0, 0, 0], 0.04);
  b.box('paint2', 0.2 * s, 0.05, Math.abs(hand[2]) * 0.6, [-0.1, 0.1 * s, hand[2] * 0.5], [0, 0, 0], 0.01);
  b.piston([0.05, 0, -0.05], [0.0, -0.05, hand[2] * 0.8], 0.03 * s);
  b.anchor('hand', [hand[0] - 0.15, 0, hand[2] + 0.05]);
  b.end();
  b.end();
};

const melee: MeshFn = (b, def) => {
  const style = String(def.look?.style ?? 'claw');
  // Hand mount: local +Y = machine up, -Z forward.
  if (style === 'claw') {
    b.box('dark', 0.25, 0.25, 0.3, [0, 0.0, -0.1], [0, 0, 0], 0.04);
    b.node('jaw_a', [0.08, 0.0, -0.25]);
    b.box('paint', 0.06, 0.08, 0.55, [0, 0, -0.27], [0, 0.25, 0], 0.02);
    b.cone('metal', 0.05, 0.14, [0.07, 0, -0.56], [-PI / 2, 0, 0], 6);
    b.end();
    b.node('jaw_b', [-0.08, 0.0, -0.25]);
    b.box('paint', 0.06, 0.08, 0.55, [0, 0, -0.27], [0, -0.25, 0], 0.02);
    b.cone('metal', 0.05, 0.14, [-0.07, 0, -0.56], [-PI / 2, 0, 0], 6);
    b.end();
    b.piston([0, 0.1, 0.0], [0, 0.08, -0.3], 0.03);
  } else if (style === 'drill' || style === 'bucket') {
    const big = style === 'bucket';
    b.box('dark', big ? 0.5 : 0.3, big ? 0.5 : 0.3, 0.35, [0, 0, -0.1], [0, 0, 0], 0.04);
    b.node('spin', [0, 0, -0.3]);
    if (big) {
      b.cylZ('metal', 0.08, 0.5, [0, 0, 0], 12);
      b.node('_wheel', [0, 0, -0.25], [0, 0, 0]);
      b.torus('paint', 0.55, 0.05, [0, 0, 0], [0, 0, 0], 24);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * PI * 2;
        b.box('rust', 0.25, 0.22, 0.3, [Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0], [0, 0, a], 0.03);
        b.cone('metal', 0.04, 0.12, [Math.cos(a) * 0.75, Math.sin(a) * 0.75, 0], [0, 0, a - PI / 2], 5);
      }
      b.end();
    } else {
      b.cone('metal', 0.14, 0.8, [0, 0, -0.35], [-PI / 2, 0, 0], 12);
      for (let i = 0; i < 12; i++) b.torus('dark', 0.13 - i * 0.01, 0.012, [0, 0, -0.05 - i * 0.055], [0, 0, i * 0.5], 8, PI);
    }
    b.end();
  } else if (style === 'fist') {
    b.box('dark', 0.34, 0.34, 0.3, [0, 0, -0.1], [0, 0, 0], 0.05);
    b.node('piston', [0, 0, -0.25]);
    b.cylZ('chrome', 0.08, 0.3, [0, 0, -0.1], 12);
    b.box('paint', 0.4, 0.4, 0.28, [0, 0, -0.35], [0, 0, 0], 0.06);
    b.hazardPanel(0.41, 0.06, 0.2, [0, 0.12, -0.35]);
    b.end();
  } else {
    // chain blade
    b.box('dark', 0.2, 0.25, 0.3, [0, 0, -0.1], [0, 0, 0], 0.03);
    b.box('metal', 0.04, 0.22, 1.4, [0, 0, -0.95], [0, 0, 0], 0.01);
    b.box('paint2', 0.06, 0.26, 0.3, [0, 0, -0.35], [0, 0, 0], 0.02);
    for (let i = 0; i < 16; i++) b.box('dark', 0.05, 0.04, 0.06, [0, 0.12, -0.35 - i * 0.08]);
  }
};

const jumpjet: MeshFn = (b, def) => {
  const mil = def.look?.style === 'mil';
  const n = mil ? 2 : 1;
  b.box('dark', 0.4 * n, 0.08, 0.3, [0, 0.04, 0], [0, 0, 0], 0.02);
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : i === 0 ? -0.18 : 0.18;
    b.cyl(mil ? 'paint' : 'rust', 0.12, 0.35, [x, 0.25, 0], [0, 0, 0], 14);
    b.cyl('heat', 0.09, 0.14, [x, 0.48, 0], [0, 0, 0], 14, 0.13);
    b.anchor(`nozzle_${i}`, [x, 0.56, 0]);
  }
  b.anchor('nozzle', [0, 0.56, 0]);
};

export const MECH_MESHES: Record<string, MeshFn> = {
  torso_scout,
  torso_walker,
  torso_heavy,
  cockpit_mech,
  cockpit_mech_heavy,
  leg,
  actuator,
  foot,
  arm,
  melee,
  jumpjet,
};
