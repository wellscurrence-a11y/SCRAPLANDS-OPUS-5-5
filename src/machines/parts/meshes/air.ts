/** Mesh builders for aircraft frames and flight components. */
import { bladeGeometry } from '../kit';
import type { MeshFn } from './registry';

const PI = Math.PI;

const frame_quad: MeshFn = (b) => {
  // central pod
  b.box('paint', 0.9, 0.32, 1.42, [0, 0.02, 0.02], [0, 0, 0], 0.12);
  b.box('dark', 0.94, 0.08, 1.2, [0, -0.13, 0.05], [0, 0, 0], 0.03);
  b.box('paint2', 0.6, 0.04, 1.1, [0, 0.19, 0.1], [0, 0, 0], 0.02);
  // arms to rotor pads
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const ex = sx * 1.32;
      const ez = sz * 1.18;
      b.pipe('dark', [[sx * 0.38, 0.02, sz * 0.4], [sx * 0.9, 0.08, sz * 0.82], [ex, 0.1, ez]], 0.045, 10, 8);
      b.pipe('paint2', [[sx * 0.38, -0.08, sz * 0.5], [sx * 0.8, 0.0, sz * 0.9], [ex, 0.06, ez]], 0.025, 10, 6);
      b.cyl('metal', 0.14, 0.08, [ex, 0.11, ez], [0, 0, 0], 16);
      b.box('glow', 0.05, 0.03, 0.05, [ex + sx * 0.16, 0.1, ez]);
    }
  }
  b.grille('dark', 0.5, 0.18, 4, [0, 0.03, 0.74], 0.02);
  b.anchor('light_0', [0, -0.05, -0.74]);
  b.cylZ('lamp', 0.06, 0.02, [0, -0.05, -0.73], 12);
};

const frame_heli: MeshFn = (b) => {
  // cabin body
  b.profile('paint', [[-2.25, -0.2], [-2.1, -0.55], [-1.2, -0.66], [1.4, -0.66], [1.8, -0.2], [1.9, 0.55], [1.2, 0.8], [-0.6, 0.85], [-1.2, 0.6], [-2.0, 0.25]], 1.25, [0, 0, 0], 0.06);
  // side windows (cabin)
  for (const s of [-1, 1]) {
    b.box('glass', 0.02, 0.35, 0.7, [s * 0.645, 0.3, 0.15], [0, 0, 0], 0.01);
    b.box('dark', 0.02, 0.5, 0.02, [s * 0.645, 0.1, 0.62]);
  }
  // engine fairing
  b.box('paint2', 0.8, 0.26, 1.4, [0, 0.9, 0.6], [0, 0, 0], 0.1);
  b.grille('dark', 0.6, 0.16, 4, [0, 0.9, -0.12], 0.02);
  for (const s of [-1, 1]) {
    b.cylZ('heat', 0.08, 0.3, [s * 0.3, 0.85, 1.35], 12);
    b.anchor(s > 0 ? 'exhaust_0' : 'exhaust_1', [s * 0.3, 0.85, 1.52]);
  }
  // tail boom
  b.cylZ('paint', 0.32, 3.9, [0, 0.55, 3.45], 16, 0.14);
  b.rivets('metal', [0, 0.84, 1.8], [0, 0.66, 5.2], 12, 'y', 0.012);
  // vertical fin & stabilisers
  b.profile('paint2', [[4.8, 0.55], [5.6, 0.55], [5.75, 1.45], [5.45, 1.45]], 0.06, [0, 0, 0], 0.01);
  b.box('paint2', 1.3, 0.04, 0.35, [0, 0.55, 4.6], [0, 0, 0], 0.01);
  b.box('glow', 0.04, 0.04, 0.04, [0, 1.45, 5.7]);
  b.cylZ('lamp', 0.07, 0.02, [0, -0.45, -2.1], 12);
  b.anchor('light_0', [0, -0.45, -2.2]);
};

const frame_vtol: MeshFn = (b) => {
  b.plan('paint', [[-0.4, -2.6], [0.4, -2.6], [1.25, -1.2], [1.3, 2.3], [0.8, 2.6], [-0.8, 2.6], [-1.3, 2.3], [-1.25, -1.2]], 0.55, [0, -0.38, 0], 0.08);
  b.plan('paint2', [[-0.35, -1.9], [0.35, -1.9], [0.8, -0.8], [0.8, 1.9], [-0.8, 1.9], [-0.8, -0.8]], 0.2, [0, 0.18, 0], 0.06);
  for (const s of [-1, 1]) {
    // nacelle pads
    b.cyl('dark', 0.34, 0.12, [s * 1.05, 0.36, -1.25], [0, 0, 0], 18);
    b.cyl('dark', 0.34, 0.12, [s * 1.05, 0.36, 1.55], [0, 0, 0], 18);
    // twin tail fins
    b.profile('paint2', [[1.7, 0.35], [2.55, 0.35], [2.7, 1.25], [2.35, 1.25]], 0.06, [s * 0.7, 0, 0], 0.01);
    b.box('glow', 0.04, 0.04, 0.04, [s * 1.3, 0.1, 2.25]);
    b.grille('dark', 0.5, 0.15, 3, [s * 0.9, 0.05, -1.95], 0.02, [0, s * 0.4, 0]);
  }
  b.cylZ('lamp', 0.08, 0.02, [0, -0.2, -2.6], 12);
  b.anchor('light_0', [0, -0.2, -2.7]);
};

const rotor: MeshFn = (b, def) => {
  const style = String(def.look?.style ?? 'scrap');
  const blades = Number(def.look?.blades ?? 2);
  const R = def.stats.radius ?? 1;
  if (style === 'ducted') {
    b.cyl('dark', 0.1, 0.2, [0, 0.1, 0], [0, 0, 0], 12);
    b.lathe('paint', [[R * 1.02, 0.0], [R * 1.1, 0.02], [R * 1.12, 0.35], [R * 1.05, 0.4], [R * 1.02, 0.38]], [0, 0.05, 0], [0, 0, 0], 32);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * PI * 2;
      b.box('dark', R, 0.03, 0.04, [Math.cos(a) * R * 0.5, 0.22, Math.sin(a) * R * 0.5], [0, -a, 0]);
    }
    b.node('spin', [0, 0.25, 0]);
    b.cyl('metal', 0.1, 0.08, [0, 0, 0], [0, 0, 0], 14);
    for (let i = 0; i < blades; i++) b.add('dark', bladeGeometry(R * 0.95, 0.12, 0.5, 0.015), [0, 0, 0], [0, (i / blades) * PI * 2, 0]);
    b.end();
    return;
  }
  if (style === 'prop') {
    b.cyl('dark', 0.12, 0.1, [0, 0.05, 0], [0, 0, 0], 14);
    b.cyl('paint2', 0.1, 0.3, [0, 0.25, 0], [0, 0, 0], 14, 0.07);
    b.node('spin', [0, 0.42, 0]);
    b.cone('paint', 0.1, 0.18, [0, 0.08, 0], [0, 0, 0], 14);
    for (let i = 0; i < blades; i++) b.add('wood', bladeGeometry(R, 0.14, 0.6, 0.025), [0, 0, 0], [0, (i / blades) * PI * 2, 0]);
    b.end();
    return;
  }
  const mastH = style === 'main' || style === 'coax' ? 0.55 : style === 'tilt' ? 0.3 : 0.28;
  if (style === 'tilt') {
    b.box('dark', 0.3, 0.1, 0.5, [0, 0.05, 0], [0, 0, 0], 0.03);
    b.node('tilt', [0, 0.15, 0]);
    b.lathe('paint', [[0.0, -0.4], [0.2, -0.35], [0.24, 0.1], [0.18, 0.4], [0.0, 0.42]], [0, 0.1, 0], [0, 0, 0], 18);
    b.node('spin', [0, 0.6, 0]);
    b.cone('paint2', 0.16, 0.25, [0, 0.1, 0], [0, 0, 0], 16);
    for (let i = 0; i < blades; i++) b.add('dark', bladeGeometry(R, 0.25, 0.5, 0.03), [0, 0, 0], [0, (i / blades) * PI * 2, 0]);
    b.end();
    b.end();
    return;
  }
  b.cyl('dark', 0.14, 0.08, [0, 0.04, 0], [0, 0, 0], 14);
  b.cyl('metal', 0.05, mastH, [0, mastH / 2, 0], [0, 0, 0], 12);
  if (style === 'main' || style === 'coax') {
    // swashplate + pitch links
    b.cyl('chrome', 0.18, 0.04, [0, mastH * 0.45, 0], [0, 0, 0], 18);
    for (let i = 0; i < blades; i++) {
      const a = (i / blades) * PI * 2;
      b.cyl('metal', 0.012, mastH * 0.5, [Math.cos(a) * 0.14, mastH * 0.7, Math.sin(a) * 0.14], [0, 0, 0], 6);
    }
  }
  const bladeSlot = style === 'scrap' ? 'rust' : 'dark';
  const chord = style === 'main' ? 0.3 : style === 'coax' ? 0.28 : 0.16;
  b.node('spin', [0, mastH, 0]);
  b.cyl('paint2', 0.12, 0.1, [0, 0, 0], [0, 0, 0], 14);
  for (let i = 0; i < blades; i++) {
    b.add(bladeSlot, bladeGeometry(R, chord, style === 'scrap' ? 0.15 : 0.3, style === 'main' ? 0.04 : 0.025), [0, 0, 0], [0, (i / blades) * PI * 2, 0]);
    if (style === 'main' || style === 'coax') {
      const a = (i / blades) * PI * 2;
      b.box('hazard', 0.3, 0.045, chord * 0.9, [Math.cos(a) * (R - 0.2), 0.001, -Math.sin(a) * (R - 0.2)], [0, a, 0], 0.005);
    }
  }
  b.end();
  if (style === 'coax') {
    b.node('spin2', [0, mastH + 0.32, 0]);
    b.cyl('metal', 0.04, 0.34, [0, -0.16, 0], [0, 0, 0], 10);
    b.cyl('paint2', 0.12, 0.1, [0, 0, 0], [0, 0, 0], 14);
    for (let i = 0; i < blades; i++) b.add('dark', bladeGeometry(R * 0.96, chord, 0.3, 0.035), [0, 0, 0], [0, (i / blades) * PI * 2 + PI / blades, 0]);
    b.cone('paint', 0.1, 0.16, [0, 0.12, 0], [0, 0, 0], 12);
    b.end();
  }
};

const jet: MeshFn = (b, def) => {
  const style = String(def.look?.style ?? 'turbo');
  // Exhaust points along +Y (away from the mount surface); thrust pushes into the surface.
  if (style === 'pulse') {
    b.box('dark', 0.2, 0.06, 0.3, [0, 0.03, 0]);
    b.cyl('rust', 0.1, 0.35, [0, 0.24, 0], [0, 0, 0], 14, 0.14);
    b.cyl('heat', 0.07, 0.8, [0, 0.8, 0], [0, 0, 0], 12);
    b.cyl('heat', 0.1, 0.12, [0, 1.25, 0], [0, 0, 0], 12, 0.07);
    b.anchor('nozzle', [0, 1.32, 0]);
    return;
  }
  if (style === 'vector') {
    b.cyl('white', 0.24, 0.12, [0, 0.06, 0], [0, 0, 0], 20);
    b.node('gimbal', [0, 0.18, 0]);
    b.sphere('dark', 0.16, [0, 0, 0], [1, 1, 1], 16);
    b.cyl('white', 0.2, 0.45, [0, 0.3, 0], [0, 0, 0], 20, 0.16);
    for (let i = 0; i < 3; i++) b.torus('glow', 0.18 - i * 0.01, 0.01, [0, 0.2 + i * 0.12, 0], [PI / 2, 0, 0], 20);
    b.cyl('heat', 0.16, 0.12, [0, 0.58, 0], [0, 0, 0], 18, 0.13);
    b.anchor('nozzle', [0, 0.66, 0]);
    b.end();
    return;
  }
  const lift = style === 'lift';
  const L = lift ? 0.6 : 1.2;
  const R = lift ? 0.26 : 0.3;
  b.box('dark', R * 1.4, 0.08, R * 1.6, [0, 0.04, 0], [0, 0, 0], 0.03);
  b.lathe('metal', [[R * 0.85, 0.0], [R, 0.08], [R * 1.02, L * 0.5], [R * 0.9, L * 0.85], [R * 0.75, L], [R * 0.7, L]], [0, 0.06, 0], [0, 0, 0], 22);
  b.torus('paint', R * 1.0, 0.03, [0, 0.12, 0], [PI / 2, 0, 0], 20);
  b.cyl('dark', R * 0.8, 0.04, [0, 0.08, 0], [0, 0, 0], 20);
  b.node('spin', [0, 0.1, 0]);
  for (let i = 0; i < 12; i++) b.box('metal', 0.02, 0.01, R * 0.7, [0, 0, R * 0.35], [0, (i / 12) * PI * 2, 0.4]);
  b.end();
  b.cyl('heat', R * 0.7, 0.14, [0, L + 0.1, 0], [0, 0, 0], 20, R * 0.62);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    b.box('dark', 0.03, 0.12, 0.08, [Math.cos(a) * R * 0.66, L + 0.12, Math.sin(a) * R * 0.66], [0, -a, 0]);
  }
  b.anchor('nozzle', [0, L + 0.2, 0]);
};

const wing: MeshFn = (b, def) => {
  const span = Number(def.look?.span ?? 2);
  const chord = Number(def.look?.chord ?? 1);
  const style = String(def.look?.style ?? 'scrap');
  // Wing extends outward along +Y; chord along Z; thickness along X.
  const sweep = style === 'swept' ? 0.6 : 0;
  const shape: [number, number][] = [
    [-chord / 2, 0],
    [chord / 2, 0],
    [chord / 2 + sweep - chord * 0.2, span],
    [-chord / 2 + sweep + chord * 0.15, span],
  ];
  // Build as extrusion across X: profile gives (z, y)
  b.profile(style === 'scrap' ? 'rust' : 'paint', shape, 0.08, [0, 0, 0], 0.02);
  if (style === 'scrap') {
    b.rivets('dark', [0.05, 0.1, -chord * 0.4], [0.05, span * 0.9, -chord * 0.4 + sweep], 10, 'x');
    b.box('paint', 0.02, span * 0.5, chord * 0.5, [0.05, span * 0.4, 0.1], [0, 0, 0], 0.005);
  } else {
    b.box('paint2', 0.1, span * 0.9, 0.04, [0, span * 0.48, chord / 2 - 0.05 + sweep * 0.45], [0, 0, 0], 0.01);
  }
  b.box('glow', 0.05, 0.06, 0.06, [0, span - 0.02, sweep + chord * 0.1]);
  if (style === 'stub') {
    for (const y of [0.45, 0.95]) b.box('dark', 0.16, 0.08, 0.4, [0.1, y, 0], [0, 0, 0], 0.02);
  }
};

const fin: MeshFn = (b) => {
  b.profile('paint2', [[-0.4, 0], [0.35, 0], [0.45, 0.7], [0.15, 0.7]], 0.05, [0, 0, 0], 0.01);
  b.box('glow', 0.04, 0.04, 0.04, [0, 0.7, 0.3]);
};

const gear: MeshFn = (b, def) => {
  if (def.look?.style === 'wheels') {
    for (const [x, z] of [[0.35, -0.3], [-0.35, -0.3], [0, 0.4]] as [number, number][]) {
      b.cyl('dark', 0.04, 0.5, [x, 0.25, z], [0, 0, 0], 8);
      b.piston([x, 0.05, z], [x, 0.45, z + 0.05], 0.03);
      b.cylX('rubber', 0.12, 0.08, [x, 0.52, z], 16);
      b.cylX('metal', 0.07, 0.09, [x, 0.52, z], 12);
    }
    return;
  }
  // skids: along Z; struts down (+Y is away from mount surface = down for belly)
  for (const s of [-1, 1]) {
    b.pipe('metal', [[s * 0.55, 0.62, -1.1], [s * 0.55, 0.62, 0.9], [s * 0.55, 0.55, 1.15]], 0.04, 12, 8);
    b.pipe('metal', [[s * 0.55, 0.62, -1.1], [s * 0.55, 0.52, -1.35]], 0.04, 4, 8);
    b.pipe('dark', [[s * 0.2, 0.0, -0.6], [s * 0.45, 0.4, -0.6], [s * 0.55, 0.62, -0.6]], 0.035, 8, 8);
    b.pipe('dark', [[s * 0.2, 0.0, 0.5], [s * 0.45, 0.4, 0.5], [s * 0.55, 0.62, 0.5]], 0.035, 8, 8);
  }
};

const airbrake: MeshFn = (b) => {
  b.box('dark', 0.5, 0.04, 0.2, [0, 0.02, 0.2]);
  b.node('flap', [0, 0.04, 0.3]);
  b.box('paint', 0.5, 0.03, 0.55, [0, 0.015, -0.27], [0, 0, 0], 0.01);
  b.hazardPanel(0.48, 0.005, 0.1, [0, 0.03, -0.45]);
  b.end();
  b.piston([0, 0.04, 0.1], [0, 0.14, -0.2], 0.02);
};

export const AIR_MESHES: Record<string, MeshFn> = { frame_quad, frame_heli, frame_vtol, rotor, jet, wing, fin, gear, airbrake };
