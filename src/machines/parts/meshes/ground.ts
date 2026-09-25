/** Mesh builders for ground-vehicle frames, cockpits and running gear. */
import type { PartDef } from '../../types';
import { PartBuilder, V3, tireGeometry, rimGeometry, trackBeltGeometry } from '../kit';
import type { MeshFn } from './registry';

const PI = Math.PI;

function pilot(b: PartBuilder, pos: V3, lean = 0) {
  b.node('_pilot', pos, [lean, 0, 0]);
  b.box('canvas', 0.36, 0.42, 0.24, [0, 0.35, 0], [0, 0, 0], 0.08);
  b.sphere('paint2', 0.13, [0, 0.68, -0.02], [1, 1.08, 1.1], 14);
  b.box('glass', 0.2, 0.07, 0.05, [0, 0.68, -0.13], [0, 0, 0], 0.02);
  b.pipe('canvas', [[0.17, 0.5, 0], [0.24, 0.35, -0.18], [0.16, 0.34, -0.36]], 0.045, 8, 6);
  b.pipe('canvas', [[-0.17, 0.5, 0], [-0.24, 0.35, -0.18], [-0.16, 0.34, -0.36]], 0.045, 8, 6);
  b.end();
}

function headlight(b: PartBuilder, pos: V3, r = 0.08, name?: string) {
  b.cylZ('dark', r * 1.25, 0.1, pos, 14);
  b.cylZ('lamp', r, 0.02, [pos[0], pos[1], pos[2] - 0.05], 14);
  if (name) b.anchor(name, [pos[0], pos[1], pos[2] - 0.08]);
}

const frame_buggy: MeshFn = (b) => {
  // floor pan and main rails
  b.box('dark', 1.05, 0.04, 2.7, [0, -0.1, 0.05], [0, 0, 0], 0.01);
  for (const x of [-0.55, 0.55]) {
    b.pipe('paint', [[x, -0.05, -1.62], [x, -0.04, -0.4], [x, -0.04, 0.6], [x, -0.05, 1.62]], 0.045, 16, 8);
    // nerf bar
    b.pipe('paint', [[x, -0.02, -0.75], [x * 1.2, 0.1, -0.55], [x * 1.2, 0.12, 0.6], [x, -0.02, 0.8]], 0.035, 16, 8);
    // axle towers
    b.pipe('dark', [[x, -0.03, -1.35], [x * 0.9, 0.28, -1.15], [x, -0.03, -0.95]], 0.03, 10, 6);
    b.pipe('dark', [[x, -0.03, 0.95], [x * 0.9, 0.28, 1.15], [x, -0.03, 1.35]], 0.03, 10, 6);
  }
  // front & rear hoops
  b.pipe('paint', [[-0.55, -0.05, -1.62], [-0.45, 0.18, -1.72], [0.45, 0.18, -1.72], [0.55, -0.05, -1.62]], 0.042, 20, 8);
  b.pipe('paint', [[-0.55, -0.05, 1.62], [-0.48, 0.2, 1.72], [0.48, 0.2, 1.72], [0.55, -0.05, 1.62]], 0.042, 20, 8);
  // cross members
  for (const z of [-1.15, -0.5, 0.55, 1.15]) b.cylX('dark', 0.035, 1.12, [0, -0.04, z], 10);
  // decks
  b.box('metal', 0.95, 0.03, 0.66, [0, 0.07, -1.08], [0, 0, 0], 0.01);
  b.box('metal', 1.05, 0.03, 0.76, [0, 0.07, 1.12], [0, 0, 0], 0.01);
  b.rivets('dark', [-0.44, 0.09, -1.38], [0.44, 0.09, -1.38], 6);
  b.rivets('dark', [-0.49, 0.09, 1.46], [0.49, 0.09, 1.46], 6);
  // skid plate
  b.box('metal', 0.9, 0.03, 0.45, [0, -0.02, -1.72], [0.5, 0, 0], 0.01);
  headlight(b, [0.34, 0.18, -1.76], 0.07, 'light_r');
  headlight(b, [-0.34, 0.18, -1.76], 0.07, 'light_l');
  b.box('glow', 0.08, 0.05, 0.02, [0.4, 0.2, 1.76]);
  b.box('glow', 0.08, 0.05, 0.02, [-0.4, 0.2, 1.76]);
  // number plate
  b.box('paint2', 0.3, 0.12, 0.01, [0, 0.05, 1.75]);
};

const frame_racer: MeshFn = (b) => {
  b.profile('paint', [[-2.05, -0.1], [-1.2, -0.12], [1.9, -0.12], [2.02, 0.02], [1.95, 0.14], [0.9, 0.18], [0.5, 0.26], [-0.2, 0.26], [-0.9, 0.12], [-1.9, 0.02]], 1.05, [0, 0, 0], 0.03);
  b.box('dark', 1.12, 0.06, 3.9, [0, -0.13, 0], [0, 0, 0], 0.02);
  // side pods
  for (const s of [-1, 1]) {
    b.box('paint2', 0.16, 0.16, 1.4, [s * 0.58, -0.02, 0.2], [0, 0, 0], 0.05);
    b.grille('dark', 0.1, 0.1, 4, [s * 0.66, -0.02, -0.45], 0.02, [0, s * PI / 2, 0]);
    // wheel arches
    b.torus('paint', 0.52, 0.035, [s * 0.6, -0.05, -1.45], [0, PI / 2, 0], 16, PI);
    b.torus('paint', 0.52, 0.035, [s * 0.64, -0.05, 1.35], [0, PI / 2, 0], 16, PI);
  }
  // rear wing
  b.box('paint2', 1.3, 0.03, 0.32, [0, 0.62, 1.85], [-0.1, 0, 0], 0.01);
  b.box('dark', 0.04, 0.46, 0.14, [0.45, 0.4, 1.85]);
  b.box('dark', 0.04, 0.46, 0.14, [-0.45, 0.4, 1.85]);
  b.box('dark', 0.03, 0.2, 0.36, [0.66, 0.62, 1.85]);
  b.box('dark', 0.03, 0.2, 0.36, [-0.66, 0.62, 1.85]);
  headlight(b, [0.36, 0.02, -1.95], 0.055, 'light_r');
  headlight(b, [-0.36, 0.02, -1.95], 0.055, 'light_l');
  b.box('glow', 0.5, 0.03, 0.02, [0, 0.12, 2.0]);
  b.rivets('metal', [-0.4, 0.2, 0.8], [0.4, 0.2, 0.8], 8);
};

const frame_pickup: MeshFn = (b) => {
  // ladder frame
  for (const x of [-0.5, 0.5]) b.box('dark', 0.1, 0.16, 4.6, [x, -0.02, 0], [0, 0, 0], 0.02);
  for (const z of [-1.9, -1.1, 0, 1.0, 2.0]) b.box('dark', 1.0, 0.1, 0.08, [0, -0.02, z]);
  // hood & front fenders
  b.profile('paint', [[-2.38, 0.05], [-2.4, 0.32], [-2.3, 0.4], [-1.1, 0.42], [-1.05, 0.05]], 1.46, [0, 0, 0], 0.03);
  for (const s of [-1, 1]) {
    b.profile('paint', [[-2.35, 0.1], [-2.25, 0.5], [-1.9, 0.62], [-1.2, 0.62], [-0.9, 0.45], [-0.9, 0.1]], 0.24, [s * 0.8, 0, 0], 0.02);
    // rear fenders
    b.profile('paint', [[0.8, 0.12], [0.95, 0.58], [1.95, 0.58], [2.1, 0.12]], 0.2, [s * 0.83, 0, 0], 0.02);
  }
  // grille and bumpers
  b.grille('chrome', 1.0, 0.26, 6, [0, 0.22, -2.4], 0.03);
  b.box('chrome', 1.75, 0.14, 0.14, [0, 0.0, -2.45], [0, 0, 0], 0.04);
  b.box('metal', 1.7, 0.12, 0.12, [0, 0.02, 2.44], [0, 0, 0], 0.03);
  headlight(b, [0.62, 0.3, -2.42], 0.085, 'light_r');
  headlight(b, [-0.62, 0.3, -2.42], 0.085, 'light_l');
  // bed
  b.box('metal', 1.55, 0.04, 1.95, [0, 0.14, 1.38], [0, 0, 0], 0.01);
  for (let i = 0; i < 6; i++) b.box('dark', 0.03, 0.02, 1.9, [-0.62 + i * 0.25, 0.17, 1.38]);
  for (const s of [-1, 1]) b.box('paint', 0.05, 0.42, 1.95, [s * 0.78, 0.37, 1.38], [0, 0, 0], 0.015);
  b.box('paint', 1.6, 0.42, 0.05, [0, 0.37, 2.37], [0, 0, 0], 0.015);
  b.box('paint', 1.6, 0.42, 0.05, [0, 0.37, 0.39], [0, 0, 0], 0.015);
  b.box('glow', 0.12, 0.2, 0.02, [0.7, 0.4, 2.4]);
  b.box('glow', 0.12, 0.2, 0.02, [-0.7, 0.4, 2.4]);
  b.rivets('metal', [-0.7, 0.6, 2.4], [0.7, 0.6, 2.4], 7, 'z');
};

const frame_hauler: MeshFn = (b) => {
  for (const x of [-0.55, 0.55]) b.box('dark', 0.14, 0.22, 6.3, [x, 0, 0], [0, 0, 0], 0.02);
  for (let z = -2.8; z <= 2.9; z += 0.7) b.box('dark', 1.1, 0.12, 0.1, [0, 0, z]);
  // front bumper + winch
  b.box('paint2', 2.0, 0.3, 0.25, [0, 0.12, -3.1], [0, 0, 0], 0.04);
  b.cylX('dark', 0.1, 0.5, [0, 0.12, -3.26], 12);
  b.hazardPanel(1.9, 0.08, 0.02, [0, 0.29, -3.24]);
  headlight(b, [0.78, 0.18, -3.24], 0.1, 'light_r');
  headlight(b, [-0.78, 0.18, -3.24], 0.1, 'light_l');
  // fenders
  for (const s of [-1, 1]) {
    b.profile('paint', [[-2.8, 0.2], [-2.7, 0.72], [-1.65, 0.72], [-1.55, 0.2]], 0.45, [s * 0.88, 0, 0], 0.02);
    b.profile('paint', [[0.25, 0.25], [0.35, 0.72], [2.95, 0.72], [3.05, 0.25]], 0.45, [s * 0.88, 0, 0], 0.02);
    // side steps & toolboxes (structural)
    b.box('metal', 0.3, 0.05, 1.0, [s * 0.95, -0.05, -1.05]);
    b.box('dark', 0.1, 0.2, 2.3, [s * 1.06, 0.18, 1.6], [0, 0, 0], 0.02);
  }
  // flatbed
  b.box('wood', 1.95, 0.08, 3.5, [0, 0.24, 1.25], [0, 0, 0], 0.01);
  for (let i = 0; i < 8; i++) b.box('dark', 1.95, 0.01, 0.02, [0, 0.285, -0.45 + i * 0.48]);
  b.box('metal', 2.0, 0.1, 0.06, [0, 0.26, 3.02]);
  b.box('metal', 0.06, 0.1, 3.5, [0.99, 0.26, 1.25]);
  b.box('metal', 0.06, 0.1, 3.5, [-0.99, 0.26, 1.25]);
  b.box('paint', 1.8, 0.05, 0.9, [0, 0.26, -0.75], [0, 0, 0], 0.01);
  b.box('glow', 0.15, 0.1, 0.02, [0.85, 0.22, 3.08]);
  b.box('glow', 0.15, 0.1, 0.02, [-0.85, 0.22, 3.08]);
  // exhaust stacks
  b.cyl('heat', 0.06, 1.4, [0.95, 0.9, -1.65], [0, 0, 0], 12);
  b.cyl('chrome', 0.075, 0.3, [0.95, 0.55, -1.65], [0, 0, 0], 12);
};

const frame_hull: MeshFn = (b) => {
  b.profile('paint', [[-2.7, -0.1], [-2.72, 0.12], [-2.25, 0.58], [2.55, 0.58], [2.72, 0.35], [2.7, -0.1], [2.3, -0.32], [-2.3, -0.32]], 1.9, [0, 0, 0], 0.04);
  // sponsons / track guards
  for (const s of [-1, 1]) {
    b.box('paint2', 0.72, 0.05, 5.1, [s * 1.3, 0.58, 0], [0, 0, 0], 0.01);
    b.box('dark', 0.1, 0.4, 4.7, [s * 0.96, 0.15, 0], [0, 0, 0], 0.02);
    b.rivets('metal', [s * 0.96, 0.4, -2.2], [s * 0.96, 0.4, 2.2], 12, s > 0 ? 'x' : '-x');
    // stowage bins
    b.box('dark', 0.2, 0.18, 1.2, [s * 1.45, 0.7, 1.4], [0, 0, 0], 0.02);
  }
  // hatches and vents
  b.cyl('dark', 0.35, 0.06, [0.5, 0.61, -0.4], [0, 0, 0], 20);
  b.grille('dark', 1.2, 0.6, 7, [0, 0.61, 2.05], 0.02, [-PI / 2, 0, 0]);
  b.box('metal', 1.6, 0.1, 0.14, [0, 0.2, 2.73]);
  headlight(b, [0.72, 0.45, -2.5], 0.07, 'light_r');
  headlight(b, [-0.72, 0.45, -2.5], 0.07, 'light_l');
  b.box('glow', 0.1, 0.06, 0.02, [0.8, 0.45, 2.73]);
  b.box('glow', 0.1, 0.06, 0.02, [-0.8, 0.45, 2.73]);
  // tow hooks
  b.torus('metal', 0.07, 0.02, [0.5, 0.0, -2.72], [0, 0, 0], 10);
  b.torus('metal', 0.07, 0.02, [-0.5, 0.0, -2.72], [0, 0, 0], 10);
};

// ---------------------------------------------------------------- cockpits
const cockpit_cage: MeshFn = (b) => {
  b.box('dark', 0.95, 0.06, 1.2, [0, 0.03, 0.05], [0, 0, 0], 0.02);
  // bucket seat
  b.box('canvas', 0.48, 0.12, 0.5, [0, 0.14, 0.2], [0, 0, 0], 0.05);
  b.box('canvas', 0.48, 0.6, 0.12, [0, 0.45, 0.46], [-0.18, 0, 0], 0.05);
  b.box('dark', 0.52, 0.08, 0.14, [0, 0.8, 0.52], [-0.18, 0, 0], 0.03);
  // dash + steering
  b.box('dark', 0.8, 0.2, 0.2, [0, 0.5, -0.45], [0.2, 0, 0], 0.03);
  b.box('glow', 0.12, 0.05, 0.01, [0.15, 0.58, -0.36], [0.2, 0, 0]);
  b.node('steer', [0, 0.62, -0.28], [-0.9, 0, 0]);
  b.torus('rubber', 0.16, 0.022, [0, 0, 0], [0, 0, 0], 20);
  b.box('dark', 0.3, 0.02, 0.03, [0, 0, 0]);
  b.cyl('dark', 0.025, 0.25, [0, -0.13, 0], [0, 0, 0], 8);
  b.end();
  pilot(b, [0, 0.1, 0.22], -0.1);
  // roll cage
  const hoop = (z: number, top: number, w: number, lean: number) =>
    b.pipe('paint', [[-0.46, 0.05, z], [-w, top * 0.7, z + lean * 0.5], [-w * 0.8, top, z + lean], [w * 0.8, top, z + lean], [w, top * 0.7, z + lean * 0.5], [0.46, 0.05, z]], 0.04, 24, 8);
  hoop(0.55, 1.25, 0.46, -0.1);
  hoop(-0.55, 1.12, 0.46, 0.25);
  b.pipe('paint', [[-0.37, 1.25, 0.45], [-0.37, 1.13, -0.3]], 0.035, 4, 8);
  b.pipe('paint', [[0.37, 1.25, 0.45], [0.37, 1.13, -0.3]], 0.035, 4, 8);
  b.pipe('paint', [[-0.4, 0.9, 0.52], [0.4, 1.2, 0.47]], 0.03, 4, 8);
  b.box('metal', 0.8, 0.03, 0.72, [0, 1.26, 0.1], [0, 0, 0], 0.01);
};

const cockpit_cab: MeshFn = (b) => {
  // body shell with window cutouts represented by inset glass
  b.box('paint', 1.52, 0.55, 1.25, [0, 0.3, 0.05], [0, 0, 0], 0.05);
  b.profile('paint', [[-0.58, 0.55], [-0.45, 1.3], [0.62, 1.32], [0.68, 0.55]], 1.5, [0, 0, 0], 0.04);
  b.box('glass', 1.3, 0.55, 0.02, [0, 0.92, -0.53], [-0.17, 0, 0], 0.01);
  for (const s of [-1, 1]) {
    b.box('glass', 0.02, 0.45, 0.9, [s * 0.755, 0.92, 0.05], [0, 0, 0], 0.01);
    b.box('dark', 0.04, 0.04, 0.12, [s * 0.82, 0.9, -0.45]);
    b.box('chrome', 0.03, 0.14, 0.1, [s * 0.86, 0.9, -0.52]);
    b.box('dark', 0.02, 0.5, 0.02, [s * 0.765, 0.3, 0.35]);
  }
  // wire mesh over windscreen
  b.grille('dark', 1.28, 0.52, 7, [0, 0.93, -0.56], 0.015, [-0.17, 0, 0]);
  b.box('metal', 1.4, 0.04, 1.05, [0, 1.34, 0.06], [0, 0, 0], 0.01);
  b.box('glow', 0.1, 0.05, 0.05, [0.5, 1.37, -0.4]);
  b.box('glow', 0.1, 0.05, 0.05, [-0.5, 1.37, -0.4]);
  pilot(b, [0.35, 0.28, 0.1], -0.05);
  b.node('steer', [0.35, 0.75, -0.3], [-1.0, 0, 0]);
  b.torus('rubber', 0.17, 0.02, [0, 0, 0], [0, 0, 0], 20);
  b.end();
};

const cockpit_armored: MeshFn = (b) => {
  b.profile('paint', [[-0.72, 0.0], [-0.72, 0.4], [-0.35, 1.18], [0.65, 1.2], [0.72, 0.0]], 1.55, [0, 0, 0], 0.05);
  for (const x of [-0.45, -0.15, 0.15, 0.45]) b.box('glass', 0.2, 0.08, 0.04, [x, 0.9, -0.52], [-0.95, 0, 0]);
  for (const s of [-1, 1]) {
    b.box('glass', 0.04, 0.08, 0.2, [s * 0.79, 0.85, 0.1]);
    b.rivets('metal', [s * 0.79, 0.25, -0.6], [s * 0.79, 0.25, 0.6], 7, s > 0 ? 'x' : '-x');
  }
  b.cyl('dark', 0.26, 0.08, [0.3, 1.23, 0.25], [0, 0, 0], 18);
  b.box('dark', 0.12, 0.2, 0.12, [-0.4, 1.3, 0.1]);
  b.box('glass', 0.1, 0.05, 0.02, [-0.4, 1.35, 0.03]);
  b.cyl('dark', 0.02, 0.8, [-0.6, 1.5, 0.5], [0, 0, 0], 6);
};

const cockpit_canopy: MeshFn = (b) => {
  b.lathe('paint', [[0.0, 0.0], [0.42, 0.02], [0.5, 0.2], [0.46, 0.35], [0.0, 0.36]], [0, 0, 0], [0, 0, 0], 20);
  b.sphere('glass', 0.46, [0, 0.35, -0.05], [1, 0.8, 1.35], 20);
  b.torus('dark', 0.47, 0.025, [0, 0.35, -0.05], [PI / 2, 0, 0], 24);
  pilot(b, [0, 0.0, 0.05], -0.05);
  b.box('dark', 0.5, 0.12, 0.12, [0, 0.3, -0.45], [0.3, 0, 0], 0.03);
};

const cockpit_gunship: MeshFn = (b) => {
  b.profile('paint', [[-1.1, 0.0], [-1.15, 0.2], [-0.6, 0.35], [0.8, 0.35], [0.9, 0.0]], 0.9, [0, 0, 0], 0.04);
  b.sphere('glass', 0.38, [0, 0.42, -0.6], [1, 0.75, 1.25], 18);
  b.sphere('glass', 0.4, [0, 0.62, 0.25], [1, 0.8, 1.3], 18);
  b.box('dark', 0.8, 0.05, 0.05, [0, 0.58, -0.15]);
  pilot(b, [0, 0.05, -0.55], -0.1);
  pilot(b, [0, 0.25, 0.3], -0.05);
  b.rivets('metal', [-0.44, 0.2, -0.9], [-0.44, 0.2, 0.7], 8, '-x');
  b.rivets('metal', [0.44, 0.2, -0.9], [0.44, 0.2, 0.7], 8, 'x');
};

const cockpit_helix: MeshFn = (b) => {
  b.lathe('white', [[0.0, 0.0], [0.45, 0.02], [0.55, 0.25], [0.5, 0.55], [0.3, 0.78], [0.0, 0.82]], [0, 0, 0], [0, 0, 0], 28);
  b.box('glass', 0.62, 0.12, 0.3, [0, 0.52, -0.38], [0.35, 0, 0], 0.05);
  b.torus('glow', 0.53, 0.012, [0, 0.3, 0], [PI / 2, 0, 0], 32);
  b.torus('glow', 0.44, 0.01, [0, 0.62, 0], [PI / 2, 0, 0], 28);
};

// ---------------------------------------------------------------- running gear
const suspension: MeshFn = (b, def) => {
  const style = String(def.look?.style ?? 'coil');
  const hub = def.sockets?.[0]?.pos[1] ?? 0.34;
  // Local frame: +Y outward, +X = machine down on the right side (mirrored left).
  b.box('dark', 0.24, 0.1, 0.22, [0, 0.04, 0], [0, 0, 0], 0.02);
  // knuckle node is moved vertically by the controller
  b.node('knuckle', [0, hub, 0]);
  b.cyl('metal', 0.07, 0.12, [0, -0.02, 0], [0, 0, 0], 12);
  if (style === 'heavy' || style === 'active') b.cyl('dark', 0.1, 0.06, [0, -0.08, 0], [0, 0, 0], 14);
  b.anchor('hub', [0, 0, 0]);
  b.end();
  // arms are aligned by the controller (they aim at the knuckle)
  const armW = style === 'long' ? 0.22 : 0.16;
  b.node('arm_upper', [-0.12, 0.05, 0]);
  if (style === 'leaf') {
    for (let i = 0; i < 4; i++) b.box('dark', 0.02, hub, 0.1 - i * 0.015, [-0.02 - i * 0.022, hub / 2, 0]);
  } else {
    b.pipe('paint2', [[0, 0, -armW], [0, hub * 0.95, 0], [0, 0, armW]], 0.02, 8, 6);
  }
  b.end();
  b.node('arm_lower', [0.12, 0.05, 0]);
  b.pipe('dark', [[0, 0, -armW], [0, hub * 0.95, 0], [0, 0, armW]], 0.025, 8, 6);
  b.end();
  // shock / spring stretches between chassis and lower arm
  b.node('shock', [-0.3, 0.06, 0.06]);
  const coilCol = style === 'active' ? 'glow' : style === 'long' ? 'hazard' : 'paint2';
  if (style !== 'leaf') {
    b.cyl('dark', 0.035, 0.22, [0, 0.11, 0], [0, 0, 0], 10);
    b.cyl('chrome', 0.018, 0.26, [0, 0.3, 0], [0, 0, 0], 8);
    for (let i = 0; i < 6; i++) b.torus(coilCol, 0.05, 0.009, [0, 0.06 + i * 0.045, 0], [PI / 2, 0, 0], 12);
  } else {
    b.cyl('dark', 0.03, 0.26, [0, 0.13, 0], [0, 0, 0], 8);
  }
  b.end();
};

const wheel: MeshFn = (b, def) => {
  const r = def.stats.radius ?? 0.42;
  const w = def.stats.width ?? 0.3;
  const tread = String(def.look?.tread ?? 'knobby');
  const rim = String(def.look?.rim ?? 'steel');
  b.node('spin', [0, w / 2, 0]);
  const tireType = tread === 'omni' ? 'street' : (tread as any);
  const tire = tireGeometry(r, w, tireType);
  tire.rotateZ(PI / 2);
  b.add('rubber', tire);
  const rimR = r * (tread === 'monster' ? 0.52 : 0.62);
  const rimStyle = rim === 'spoke' ? 'spoke' : rim === 'solid' || rim === 'mag' || rim === 'omni' ? 'solid' : 'steel';
  const rg = rimGeometry(rimR * 0.98, w, rim === 'spoke' ? 10 : 6, rimStyle);
  rg.rotateZ(PI / 2);
  b.add(rim === 'mag' ? 'white' : rim === 'spoke' ? 'chrome' : 'metal', rg);
  if (rim === 'mag') b.torus('glow', rimR * 0.7, 0.012, [0, w * 0.35, 0], [0, 0, 0], 24);
  if (tread === 'omni') {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * PI * 2;
      b.cylX('dark', 0.04, 0.2, [Math.cos(a) * r * 0.92, 0, Math.sin(a) * r * 0.92], 8);
    }
    b.torus('glow', rimR * 0.5, 0.012, [0, w * 0.4, 0], [0, 0, 0], 24);
  }
  if (tread === 'spiked') {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * PI * 2;
      b.cone('metal', 0.035, 0.12, [Math.cos(a) * r * 0.6, w * 0.45, Math.sin(a) * r * 0.6], [0, 0, 0], 6);
    }
  }
  b.end();
};

const track: MeshFn = (b, def) => {
  const L = def.stats.trackLength ?? 3.8;
  const r = def.stats.radius ?? 0.38;
  const w = def.stats.width ?? 0.5;
  const mil = def.look?.style === 'mil';
  // Local: +Y outward from hull side; machine down = +X (right side).
  // Track assembly is built in a sub-node so we can orient it: belt axis along machine Z.
  b.node('assembly', [0, w / 2 + 0.05, 0], [0, 0, PI / 2]);
  // inside 'assembly': +X outward (was Y), +Y = machine up
  b.node('belt', [0, 0, 0]);
  const belt = trackBeltGeometry(L, r, w, mil ? 64 : 52);
  b.add('dark', belt, [0, 0, 0], [0, 0, 0]);
  b.end();
  b.node('wheels', [0, 0, 0]);
  const n = mil ? 6 : 5;
  for (let i = 0; i < n; i++) {
    const z = -L / 2 + (i / (n - 1)) * L;
    const rr = i === 0 || i === n - 1 ? r * 0.92 : r * 0.72;
    const y = i === 0 || i === n - 1 ? 0 : -r + rr + 0.02;
    b.cylX('metal', rr, w * 0.7, [0, y, z], 18);
    b.cylX('dark', rr * 0.35, w * 0.74, [0, y, z], 10);
  }
  b.end();
  // side skirt / fender
  b.box('paint', 0.05, 0.3, L * 0.9, [w * 0.5 + 0.05, r * 0.35, 0], [0, 0, 0], 0.02);
  b.rivets('metal', [w * 0.53 + 0.05, r * 0.5, -L * 0.4], [w * 0.53 + 0.05, r * 0.5, L * 0.4], 10, 'x');
  b.box('paint2', w + 0.1, 0.04, L + 0.5, [0, r + 0.12, 0], [0, 0, 0], 0.01);
  b.end();
};

const booster: MeshFn = (b, def) => {
  if (def.look?.style === 'nitro') {
    b.box('dark', 0.3, 0.06, 0.5, [0, 0.03, 0]);
    for (const x of [-0.08, 0.08]) {
      b.cylZ('paint2', 0.07, 0.42, [x, 0.13, 0], 16);
      b.sphere('paint2', 0.07, [x, 0.13, -0.21], [1, 1, 0.6], 12);
      b.cylZ('chrome', 0.03, 0.08, [x, 0.13, 0.25], 10);
    }
    b.pipe('copper', [[-0.08, 0.13, 0.28], [0, 0.2, 0.32], [0.08, 0.13, 0.28]], 0.012, 8, 6);
    b.box('hazard', 0.3, 0.03, 0.08, [0, 0.2, 0]);
  } else {
    // rocket: exhaust points along +Y (away from surface)
    b.cyl('dark', 0.18, 0.1, [0, 0.05, 0], [0, 0, 0], 16);
    b.cyl('paint', 0.15, 0.55, [0, 0.35, 0], [0, 0, 0], 18);
    b.cyl('hazard', 0.155, 0.08, [0, 0.45, 0], [0, 0, 0], 18);
    b.cyl('heat', 0.1, 0.22, [0, 0.72, 0], [0, 0, 0], 16, 0.16);
    b.anchor('nozzle', [0, 0.85, 0]);
  }
};

const ram: MeshFn = (b, def) => {
  const style = String(def.look?.style ?? 'bullbar');
  // Local +Y points outward (away from the front face).
  if (style === 'bullbar') {
    b.pipe('chrome', [[-0.6, 0.02, -0.12], [-0.62, 0.2, -0.08], [0.62, 0.2, -0.08], [0.6, 0.02, -0.12]], 0.04, 16, 8);
    b.pipe('chrome', [[-0.55, 0.02, 0.12], [-0.58, 0.22, 0.1], [0.58, 0.22, 0.1], [0.55, 0.02, 0.12]], 0.04, 16, 8);
    for (const x of [-0.3, 0.3]) b.pipe('chrome', [[x, 0.02, -0.12], [x, 0.22, 0], [x, 0.02, 0.12]], 0.035, 8, 8);
  } else if (style === 'spike') {
    b.box('rust', 1.2, 0.08, 0.35, [0, 0.04, 0], [0, 0, 0], 0.02);
    for (let i = 0; i < 6; i++) {
      const x = -0.5 + i * 0.2;
      b.cone('metal', 0.05, 0.4 + (i % 2) * 0.12, [x, 0.25 + (i % 2) * 0.06, (i % 3) * 0.05 - 0.05], [0, 0, 0], 6);
    }
  } else if (style === 'plow') {
    b.front('paint2', [[-0.95, -0.2], [0.95, -0.2], [0.95, 0.25], [-0.95, 0.25]], 0.06, [0, 0.35, 0]);
    b.box('hazard', 1.9, 0.08, 0.06, [0, 0.35, -0.22]);
    b.box('metal', 1.9, 0.1, 0.1, [0, 0.47, 0.22], [0, 0, 0], 0.02);
    b.piston([0.5, 0.02, 0.0], [0.5, 0.3, 0.1], 0.05);
    b.piston([-0.5, 0.02, 0.0], [-0.5, 0.3, 0.1], 0.05);
  } else {
    // saw
    b.box('dark', 0.3, 0.2, 0.4, [0, 0.1, 0], [0, 0, 0], 0.03);
    b.cyl('dark', 0.08, 0.3, [0, 0.35, 0], [0, 0, 0], 10);
    b.node('spin', [0, 0.55, 0], [PI / 2, 0, 0]);
    b.cyl('metal', 0.5, 0.02, [0, 0, 0], [PI / 2, 0, 0], 32);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * PI * 2;
      b.cone('chrome', 0.04, 0.1, [Math.cos(a) * 0.53, Math.sin(a) * 0.53, 0], [0, 0, a - PI / 2], 4);
    }
    b.end();
  }
};

const gearbox: MeshFn = (b, def) => {
  const s = Number(def.look?.size ?? 1);
  b.box('dark', 0.36 * s, 0.24 * s, 0.5 * s, [0, 0.12 * s, 0], [0, 0, 0], 0.04);
  b.cylZ('metal', 0.14 * s, 0.2 * s, [0, 0.14 * s, -0.32 * s], 16);
  b.cylZ('metal', 0.05 * s, 0.25 * s, [0, 0.1 * s, 0.35 * s], 10);
  b.fins('dark', 0.34 * s, 0.03 * s, 0.02, 5, 0.08 * s, [0, 0.25 * s, 0], 'z');
  b.bolts('metal', [[0.16 * s, 0.2 * s, -0.2 * s], [-0.16 * s, 0.2 * s, -0.2 * s], [0.16 * s, 0.2 * s, 0.2 * s], [-0.16 * s, 0.2 * s, 0.2 * s]]);
  if (def.look?.race) b.box('glow', 0.05, 0.02, 0.15, [0.12 * s, 0.26 * s, 0.1]);
};

export const GROUND_MESHES: Record<string, MeshFn> = {
  frame_buggy,
  frame_racer,
  frame_pickup,
  frame_hauler,
  frame_hull,
  cockpit_cage,
  cockpit_cab,
  cockpit_armored,
  cockpit_canopy,
  cockpit_gunship,
  cockpit_helix,
  suspension,
  wheel,
  track,
  booster,
  ram,
  gearbox,
};

export type { PartDef };
