/** Mesh builders for class-agnostic components (engines, power, armour, sensors…). */
import { PartBuilder, V3 } from '../kit';
import type { MeshFn } from './registry';

const PI = Math.PI;

const engine: MeshFn = (b, def) => {
  const layout = String(def.look?.layout ?? 'v');
  const cyl = Number(def.look?.cyl ?? 4);
  if (layout === 'mower') {
    b.box('dark', 0.3, 0.05, 0.3, [0, 0.025, 0]);
    b.cyl('paint2', 0.12, 0.2, [0, 0.15, 0], [0, 0, 0], 16);
    b.fins('metal', 0.26, 0.012, 0.012, 6, 0.028, [0, 0.14, 0], 'y');
    b.cyl('paint', 0.1, 0.1, [0, 0.3, 0.02], [0, 0, 0], 14);
    b.pipe('heat', [[0.1, 0.18, 0], [0.18, 0.2, 0.08], [0.2, 0.25, 0.2]], 0.02, 8, 6);
    b.anchor('exhaust_0', [0.2, 0.26, 0.22]);
    b.torus('rubber', 0.05, 0.01, [0, 0.36, 0.02], [PI / 2, 0, 0], 10);
    return;
  }
  if (layout === 'turbine' || layout === 'flux') {
    const flux = layout === 'flux';
    b.box('dark', 0.5, 0.06, 0.9, [0, 0.03, 0], [0, 0, 0], 0.02);
    b.lathe(flux ? 'white' : 'metal', [[0.0, -0.42], [0.22, -0.42], [0.25, -0.2], [0.2, 0.3], [0.14, 0.42], [0.0, 0.42]], [0, 0.3, 0], [PI / 2, 0, 0], 24);
    if (flux) {
      for (let i = 0; i < 5; i++) b.torus('glow', 0.23, 0.012, [0, 0.3, -0.25 + i * 0.12], [0, 0, 0], 24);
      b.cylZ('copper', 0.05, 0.3, [0, 0.3, 0.5], 10);
    } else {
      b.cylZ('dark', 0.18, 0.04, [0, 0.3, -0.43], 24);
      b.node('spin', [0, 0.3, -0.44]);
      for (let i = 0; i < 10; i++) b.box('metal', 0.02, 0.15, 0.01, [0, 0.08, 0], [0, 0, (i / 10) * PI * 2]);
      b.end();
      b.cylZ('heat', 0.14, 0.2, [0, 0.3, 0.5], 18, 0.1);
      b.anchor('exhaust_0', [0, 0.3, 0.62]);
      b.pipe('copper', [[0.2, 0.3, -0.2], [0.26, 0.45, 0], [0.2, 0.3, 0.2]], 0.015, 10, 6);
    }
    return;
  }
  const inline = layout === 'inline';
  const banks = inline ? 1 : 2;
  const perBank = inline ? cyl : Math.ceil(cyl / 2);
  const len = 0.12 * perBank + 0.18;
  const diesel = !!def.look?.diesel;
  // Block
  b.box('dark', inline ? 0.32 : 0.48, 0.3, len, [0, 0.19, 0], [0, 0, 0], 0.03);
  b.box('metal', inline ? 0.28 : 0.44, 0.1, len - 0.04, [0, 0.03, 0], [0, 0, 0], 0.02);
  // Cylinder heads & valve covers
  for (let k = 0; k < banks; k++) {
    const side = banks === 1 ? 0 : k === 0 ? -1 : 1;
    const tilt = side * 0.55;
    const hx = side * 0.19;
    b.box(diesel ? 'dark' : 'paint2', 0.2, 0.1, len - 0.06, [hx, 0.4, 0], [0, 0, tilt], 0.03);
    b.box('chrome', 0.16, 0.05, len - 0.14, [hx + side * 0.03, 0.46, 0], [0, 0, tilt], 0.02);
    for (let i = 0; i < perBank; i++) {
      const z = -len / 2 + 0.15 + i * 0.12;
      b.bolts('metal', [[hx + side * 0.05, 0.47, z]], 'y', 0.015);
      // exhaust headers
      const ex = side === 0 ? 0.2 : side * 0.36;
      b.pipe('heat', [[side === 0 ? 0.16 : hx + side * 0.1, 0.35, z], [ex, 0.3, z], [ex + (side || 1) * 0.02, 0.18, z + 0.04]], 0.022, 6, 6);
    }
    const ex = side === 0 ? 0.22 : side * 0.38;
    b.cylZ('heat', 0.035, len * 0.9, [ex, 0.16, 0.05], 10);
    b.cylZ('heat', 0.05, 0.12, [ex, 0.16, len / 2 + 0.06], 12);
    b.anchor(`exhaust_${k}`, [ex, 0.16, len / 2 + 0.12]);
  }
  // Pulley/front
  b.cylZ('metal', 0.09, 0.04, [0, 0.2, -len / 2 - 0.03], 18);
  b.cylZ('metal', 0.05, 0.05, [0.1, 0.34, -len / 2 - 0.03], 14);
  b.torus('rubber', 0.12, 0.01, [0.03, 0.26, -len / 2 - 0.035], [0, 0, 0], 16);
  // Intake / blower
  if (def.look?.blower) {
    b.box('chrome', 0.26, 0.16, len * 0.5, [0, 0.58, 0], [0, 0, 0], 0.04);
    b.box('dark', 0.3, 0.08, 0.3, [0, 0.72, -0.05], [0, 0, 0], 0.03);
    b.node('spin', [0, 0.58, -len * 0.25 - 0.02]);
    b.cylZ('metal', 0.07, 0.04, [0, 0, 0], 14);
    b.box('dark', 0.13, 0.01, 0.03, [0, 0, -0.02]);
    b.end();
  } else if (!inline) {
    b.box('paint', 0.18, 0.08, len * 0.6, [0, 0.48, 0], [0, 0, 0], 0.03);
    b.cyl('chrome', 0.1, 0.06, [0, 0.55, 0], [0, 0, 0], 16);
  } else {
    b.box('paint', 0.14, 0.1, len * 0.7, [-0.18, 0.36, 0], [0, 0, 0.2], 0.03);
  }
  if (def.look?.turbo) {
    for (const s of [-1, 1]) {
      b.lathe('metal', [[0.0, -0.08], [0.1, -0.06], [0.12, 0.0], [0.1, 0.06], [0.0, 0.08]], [s * 0.34, 0.36, len / 2 - 0.05], [0, 0, PI / 2], 16);
      b.pipe('copper', [[s * 0.34, 0.4, len / 2 - 0.1], [s * 0.2, 0.55, 0], [s * 0.05, 0.6, -0.05]], 0.02, 8, 6);
    }
  }
  // wiring & hoses
  b.pipe('rubber', [[0.15, 0.3, -len / 2], [0.25, 0.4, -len / 2 + 0.2], [0.15, 0.45, 0]], 0.018, 10, 6);
};

const generator: MeshFn = (b, def) => {
  const style = String(def.look?.style ?? 'dynamo');
  switch (style) {
    case 'dynamo': {
      b.box('dark', 0.44, 0.05, 0.4, [0, 0.025, 0]);
      b.cyl('paint2', 0.11, 0.18, [-0.1, 0.16, 0], [0, 0, 0], 14);
      b.fins('metal', 0.24, 0.012, 0.012, 5, 0.03, [-0.1, 0.15, 0], 'y');
      b.cylX('copper', 0.09, 0.2, [0.12, 0.15, 0], 16);
      b.cylX('dark', 0.095, 0.04, [0.12, 0.15, 0], 16);
      b.torus('rubber', 0.07, 0.01, [0.0, 0.2, 0.1], [0, PI / 2, 0], 12);
      b.pipe('heat', [[-0.18, 0.2, 0], [-0.24, 0.25, 0.12]], 0.018, 4, 6);
      b.anchor('exhaust_0', [-0.24, 0.27, 0.15]);
      break;
    }
    case 'diesel': {
      b.box('dark', 0.7, 0.06, 0.5, [0, 0.03, 0]);
      b.box('paint2', 0.36, 0.34, 0.4, [-0.14, 0.24, 0], [0, 0, 0], 0.03);
      b.cylX('copper', 0.15, 0.3, [0.2, 0.22, 0], 18);
      b.grille('dark', 0.3, 0.26, 5, [-0.14, 0.24, -0.21], 0.02);
      for (const x of [-0.33, 0.33]) for (const z of [-0.23, 0.23]) b.cyl('metal', 0.015, 0.45, [x, 0.25, z], [0, 0, 0], 6);
      b.box('metal', 0.7, 0.02, 0.5, [0, 0.48, 0]);
      b.cyl('heat', 0.04, 0.3, [-0.2, 0.62, 0.12], [0, 0, 0], 10);
      b.anchor('exhaust_0', [-0.2, 0.78, 0.12]);
      break;
    }
    case 'core': {
      b.cyl('dark', 0.3, 0.06, [0, 0.03, 0], [0, 0, 0], 20);
      b.cyl('paint', 0.26, 0.5, [0, 0.31, 0], [0, 0, 0], 20);
      for (let i = 0; i < 3; i++) b.torus('metal', 0.265, 0.015, [0, 0.12 + i * 0.18, 0], [PI / 2, 0, 0], 24);
      b.box('glow', 0.06, 0.2, 0.02, [0, 0.35, -0.265]);
      b.cyl('dark', 0.15, 0.12, [0, 0.62, 0], [0, 0, 0], 16);
      b.pipe('rubber', [[0.2, 0.5, 0.1], [0.32, 0.4, 0.15], [0.3, 0.1, 0.1]], 0.025, 10, 6);
      b.cyl('heat', 0.035, 0.2, [0.12, 0.75, 0.08], [0, 0, 0], 8);
      b.anchor('exhaust_0', [0.12, 0.86, 0.08]);
      break;
    }
    case 'turbine': {
      b.box('dark', 0.34, 0.06, 0.7, [0, 0.03, 0]);
      b.lathe('metal', [[0.0, -0.32], [0.15, -0.32], [0.17, -0.1], [0.13, 0.3], [0.0, 0.3]], [0, 0.22, 0], [PI / 2, 0, 0], 20);
      b.cylZ('heat', 0.1, 0.12, [0, 0.22, 0.38], 14, 0.07);
      b.anchor('exhaust_0', [0, 0.22, 0.46]);
      b.cylX('copper', 0.08, 0.14, [0.2, 0.12, -0.1], 12);
      break;
    }
    case 'cell': {
      b.box('white', 0.4, 0.4, 0.36, [0, 0.2, 0], [0, 0, 0], 0.04);
      for (let i = 0; i < 6; i++) b.box('dark', 0.36, 0.3, 0.012, [0, 0.2, -0.13 + i * 0.052]);
      b.box('glow', 0.3, 0.02, 0.02, [0, 0.35, -0.19]);
      b.cyl('metal', 0.04, 0.1, [0.12, 0.44, 0.1], [0, 0, 0], 10);
      break;
    }
    case 'milcore': {
      b.box('dark', 0.6, 0.08, 0.5, [0, 0.04, 0], [0, 0, 0], 0.02);
      b.cyl('paint', 0.28, 0.55, [0, 0.35, 0], [0, 0, 0], 8);
      b.cyl('paint2', 0.3, 0.08, [0, 0.62, 0], [0, 0, 0], 8);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * PI * 2 + PI / 8;
        b.box('dark', 0.05, 0.4, 0.05, [Math.cos(a) * 0.3, 0.35, Math.sin(a) * 0.3]);
      }
      b.box('glow', 0.1, 0.1, 0.02, [0, 0.4, -0.28]);
      b.hazardPanel(0.3, 0.06, 0.02, [0, 0.2, -0.28]);
      break;
    }
    case 'fusion': {
      b.cyl('dark', 0.34, 0.08, [0, 0.04, 0], [0, 0, 0], 24);
      b.torus('metal', 0.26, 0.08, [0, 0.35, 0], [PI / 2, 0, 0], 28);
      b.torus('copper', 0.26, 0.09, [0, 0.35, 0], [PI / 2, 0, 0], 12, PI * 0.6);
      b.node('spin', [0, 0.35, 0]);
      b.sphere('glow', 0.13, [0, 0, 0], [1, 1, 1], 16);
      b.end();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * PI * 2;
        b.cyl('metal', 0.03, 0.36, [Math.cos(a) * 0.3, 0.2, Math.sin(a) * 0.3], [0, 0, 0], 8);
      }
      b.box('hazard', 0.5, 0.04, 0.04, [0, 0.1, -0.3]);
      break;
    }
    case 'singularity': {
      b.lathe('white', [[0.0, 0.0], [0.25, 0.0], [0.28, 0.1], [0.2, 0.18], [0.0, 0.18]], [0, 0, 0], [0, 0, 0], 28);
      b.node('spin', [0, 0.42, 0]);
      b.sphere('dark', 0.12, [0, 0, 0], [1, 1, 1], 20);
      b.torus('glow', 0.22, 0.012, [0, 0, 0], [PI / 2, 0, 0], 32);
      b.torus('glow', 0.22, 0.012, [0, 0, 0], [0, 0, 0], 32);
      b.torus('glow', 0.18, 0.01, [0, 0, 0], [PI / 4, PI / 4, 0], 32);
      b.end();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * PI * 2;
        b.box('white', 0.05, 0.5, 0.05, [Math.cos(a) * 0.24, 0.35, Math.sin(a) * 0.24], [0, -a, Math.cos(a) * 0.2]);
      }
      break;
    }
  }
};

const battery: MeshFn = (b, def) => {
  const style = String(def.look?.style ?? 'lead');
  if (style === 'lead') {
    b.box('wood', 0.5, 0.04, 0.36, [0, 0.02, 0]);
    for (let i = 0; i < 6; i++) {
      const x = -0.17 + (i % 3) * 0.17;
      const z = i < 3 ? -0.08 : 0.08;
      b.box('dark', 0.15, 0.2, 0.14, [x, 0.14, z], [0, 0, 0], 0.01);
      b.cyl('metal', 0.012, 0.03, [x - 0.04, 0.25, z], [0, 0, 0], 6);
      b.cyl('copper', 0.012, 0.03, [x + 0.04, 0.25, z], [0, 0, 0], 6);
    }
    b.pipe('rubber', [[-0.2, 0.26, -0.08], [0, 0.3, 0], [0.2, 0.26, 0.08]], 0.01, 12, 6);
    b.box('paint2', 0.52, 0.03, 0.03, [0, 0.2, -0.17]);
  } else if (style === 'liion') {
    b.box('white', 0.44, 0.14, 0.34, [0, 0.07, 0], [0, 0, 0], 0.03);
    b.box('dark', 0.4, 0.02, 0.3, [0, 0.145, 0]);
    b.box('glow', 0.2, 0.012, 0.012, [0, 0.12, -0.17]);
    b.fins('metal', 0.3, 0.02, 0.01, 6, 0.04, [0, 0.16, 0], 'z');
  } else if (style === 'cap') {
    b.box('dark', 0.48, 0.05, 0.36, [0, 0.025, 0]);
    for (let i = 0; i < 8; i++) {
      const x = -0.18 + (i % 4) * 0.12;
      const z = i < 4 ? -0.08 : 0.08;
      b.cyl('paint2', 0.05, 0.26, [x, 0.18, z], [0, 0, 0], 14);
      b.cyl('metal', 0.052, 0.02, [x, 0.31, z], [0, 0, 0], 14);
    }
    b.pipe('copper', [[-0.2, 0.33, 0], [0, 0.36, 0], [0.2, 0.33, 0]], 0.012, 8, 6);
    b.box('glow', 0.04, 0.04, 0.04, [0.22, 0.1, -0.16]);
  } else {
    b.box('white', 0.4, 0.08, 0.3, [0, 0.04, 0], [0, 0, 0], 0.03);
    b.box('dark', 0.36, 0.01, 0.26, [0, 0.085, 0]);
    for (let i = 0; i < 5; i++) b.box('glow', 0.3, 0.004, 0.008, [0, 0.09, -0.1 + i * 0.05]);
  }
};

const fuel: MeshFn = (b, def) => {
  const style = String(def.look?.style ?? 'drum');
  if (style === 'jerry') {
    b.box('dark', 0.56, 0.03, 0.3, [0, 0.015, 0]);
    for (let i = 0; i < 3; i++) {
      const x = -0.18 + i * 0.18;
      b.box('paint2', 0.15, 0.4, 0.28, [x, 0.22, 0], [0, 0, 0], 0.02);
      b.box('dark', 0.02, 0.3, 0.2, [x + 0.075, 0.22, 0]);
      b.box('metal', 0.08, 0.04, 0.12, [x, 0.44, -0.04], [0, 0, 0], 0.01);
      b.cyl('dark', 0.02, 0.05, [x, 0.44, 0.07], [0, 0, 0], 8);
    }
    b.pipe('metal', [[-0.28, 0.1, -0.16], [0.28, 0.1, -0.16]], 0.012, 2, 6);
    b.pipe('metal', [[-0.28, 0.35, -0.16], [0.28, 0.35, -0.16]], 0.012, 2, 6);
  } else if (style === 'drum') {
    b.cyl('paint2', 0.29, 0.86, [0, 0.43, 0], [0, 0, 0], 22);
    for (const y of [0.22, 0.64]) b.torus('paint2', 0.292, 0.015, [0, y, 0], [PI / 2, 0, 0], 22);
    b.cyl('metal', 0.29, 0.02, [0, 0.865, 0], [0, 0, 0], 22);
    b.cyl('dark', 0.035, 0.03, [0.15, 0.88, 0], [0, 0, 0], 8);
    b.torus('metal', 0.3, 0.012, [0, 0.4, 0], [PI / 2, 0, 0], 22);
  } else if (style === 'armored') {
    b.box('paint', 0.6, 0.35, 0.45, [0, 0.18, 0], [0, 0, 0], 0.04);
    b.rivets('metal', [-0.28, 0.36, -0.2], [0.28, 0.36, -0.2], 6);
    b.rivets('metal', [-0.28, 0.36, 0.2], [0.28, 0.36, 0.2], 6);
    b.cyl('dark', 0.05, 0.05, [0.2, 0.37, 0.1], [0, 0, 0], 10);
    b.hazardPanel(0.5, 0.05, 0.01, [0, 0.2, -0.23]);
  } else {
    b.cylZ('paint2', 0.22, 1.1, [0, 0.22, 0], 20);
    b.sphere('paint2', 0.22, [0, 0.22, -0.55], [1, 1, 0.4], 16);
    b.sphere('paint2', 0.22, [0, 0.22, 0.55], [1, 1, 0.4], 16);
    for (const z of [-0.3, 0.3]) b.torus('dark', 0.225, 0.02, [0, 0.22, z], [0, 0, 0], 20);
    b.box('dark', 0.3, 0.03, 0.9, [0, 0.015, 0]);
    b.cyl('metal', 0.04, 0.05, [0, 0.45, 0.2], [0, 0, 0], 10);
  }
};

const cooling: MeshFn = (b, def) => {
  const style = String(def.look?.style ?? 'radiator');
  if (style === 'radiator') {
    b.box('dark', 0.6, 0.45, 0.06, [0, 0.26, 0], [0, 0, 0], 0.01);
    b.fins('copper', 0.56, 0.4, 0.005, 14, 0.035, [0, 0.26, 0], 'x');
    b.node('spin', [0, 0.26, 0.08]);
    for (let i = 0; i < 4; i++) b.box('dark', 0.05, 0.18, 0.01, [0, 0.09, 0], [0, 0, (i / 4) * PI * 2]);
    b.end();
    b.torus('dark', 0.19, 0.012, [0, 0.26, 0.08], [0, 0, 0], 18);
    b.box('metal', 0.08, 0.04, 0.2, [0.25, 0.03, 0]);
    b.box('metal', 0.08, 0.04, 0.2, [-0.25, 0.03, 0]);
  } else if (style === 'heatsink') {
    b.box('dark', 0.5, 0.06, 0.4, [0, 0.03, 0]);
    b.fins('copper', 0.48, 0.3, 0.008, 16, 0.024, [0, 0.21, 0], 'z');
    b.pipe('copper', [[-0.22, 0.08, -0.2], [-0.22, 0.34, 0], [-0.22, 0.08, 0.2]], 0.015, 10, 6);
    b.pipe('copper', [[0.22, 0.08, -0.2], [0.22, 0.34, 0], [0.22, 0.08, 0.2]], 0.015, 10, 6);
  } else if (style === 'fans') {
    b.box('paint2', 0.8, 0.2, 0.42, [0, 0.1, 0], [0, 0, 0], 0.03);
    for (const x of [-0.2, 0.2]) {
      b.torus('dark', 0.16, 0.02, [x, 0.21, 0], [PI / 2, 0, 0], 20);
      b.node('spin', [x, 0.22, 0]);
      for (let i = 0; i < 7; i++) b.box('metal', 0.14, 0.008, 0.04, [0.07, 0, 0], [0.3, (i / 7) * PI * 2, 0]);
      b.end();
    }
  } else if (style === 'cryo') {
    b.box('white', 0.5, 0.36, 0.36, [0, 0.18, 0], [0, 0, 0], 0.05);
    b.cyl('glass', 0.08, 0.32, [0.3, 0.2, 0], [0, 0, 0], 14);
    b.cyl('glow', 0.06, 0.28, [0.3, 0.2, 0], [0, 0, 0], 12);
    b.pipe('chrome', [[0.22, 0.32, 0.1], [0.3, 0.42, 0.1], [0.3, 0.36, 0]], 0.02, 8, 6);
    b.fins('metal', 0.46, 0.02, 0.3, 6, 0.05, [0, 0.2, 0], 'y');
  } else {
    b.box('dark', 0.5, 0.04, 0.5, [0, 0.02, 0]);
    for (let i = 0; i < 6; i++) b.cyl('copper', 0.025, 0.5, [-0.2 + i * 0.08, 0.28, 0], [0, 0, 0], 8);
    b.fins('metal', 0.5, 0.004, 0.5, 10, 0.045, [0, 0.3, 0], 'y');
  }
};

const cargo: MeshFn = (b, def) => {
  const style = String(def.look?.style ?? 'rack');
  if (style === 'rack') {
    b.box('dark', 0.9, 0.03, 0.7, [0, 0.015, 0]);
    const pts: V3[] = [
      [-0.45, 0, -0.35],
      [0.45, 0, -0.35],
      [0.45, 0, 0.35],
      [-0.45, 0, 0.35],
    ];
    for (const p of pts) b.cyl('paint2', 0.02, 0.3, [p[0], 0.15, p[2]], [0, 0, 0], 6);
    b.pipe('paint2', [[-0.45, 0.3, -0.35], [0.45, 0.3, -0.35], [0.45, 0.3, 0.35], [-0.45, 0.3, 0.35], [-0.45, 0.3, -0.35]], 0.018, 16, 6);
    for (let i = 1; i < 5; i++) b.cylX('paint2', 0.01, 0.9, [0, 0.16, -0.35 + i * 0.14], 6);
  } else if (style === 'crate') {
    b.box('paint2', 0.9, 0.5, 0.65, [0, 0.25, 0], [0, 0, 0], 0.03);
    b.box('dark', 0.92, 0.05, 0.67, [0, 0.48, 0], [0, 0, 0], 0.02);
    for (const x of [-0.3, 0.3]) b.box('metal', 0.1, 0.52, 0.68, [x, 0.25, 0], [0, 0, 0], 0.01);
    b.box('metal', 0.1, 0.1, 0.02, [0, 0.35, -0.33]);
  } else if (style === 'bay') {
    b.box('paint', 1.3, 0.08, 1.2, [0, 0.04, 0], [0, 0, 0], 0.02);
    for (const s of [-1, 1]) b.box('paint', 0.06, 0.5, 1.2, [s * 0.62, 0.3, 0], [0, 0, 0], 0.02);
    b.box('paint', 1.3, 0.5, 0.06, [0, 0.3, 0.58]);
    b.cyl('dark', 0.05, 1.0, [0, 0.8, -0.4], [0, 0, 0], 10);
    b.box('dark', 0.06, 0.06, 0.9, [0, 1.28, 0.02]);
    b.cylX('metal', 0.08, 0.2, [0, 1.28, 0.45], 12);
    b.pipe('dark', [[0, 1.28, 0.5], [0, 1.0, 0.52]], 0.008, 2, 4);
    b.torus('metal', 0.05, 0.012, [0, 0.95, 0.52], [0, 0, 0], 10);
    b.hazardPanel(1.2, 0.06, 0.02, [0, 0.55, 0.62]);
  } else {
    b.lathe('paint2', [[0.0, -0.6], [0.14, -0.5], [0.22, -0.2], [0.22, 0.3], [0.15, 0.55], [0.0, 0.62]], [0, 0.26, 0], [PI / 2, 0, 0], 18);
    b.box('dark', 0.08, 0.06, 0.5, [0, 0.03, 0]);
  }
};

const armor: MeshFn = (b, def) => {
  const style = String(def.look?.style ?? 'scrap');
  const w = Number(def.look?.w ?? 0.8);
  const h = Number(def.look?.h ?? 0.6);
  const t = Number(def.look?.t ?? 0.05);
  // Plate lies on the mount surface: extends along local X (w) and Z (h), thickness along Y.
  switch (style) {
    case 'scrap': {
      b.box('rust', w, t, h, [0, t / 2, 0], [0, 0, 0], 0.01);
      b.box('paint', w * 0.55, t * 0.6, h * 0.5, [-w * 0.18, t * 1.1, -h * 0.15], [0, 0.08, 0], 0.01);
      b.box('metal', w * 0.35, t * 0.5, h * 0.35, [w * 0.25, t * 1.05, h * 0.2], [0, -0.12, 0], 0.01);
      b.rivets('dark', [-w / 2 + 0.05, t, -h / 2 + 0.05], [w / 2 - 0.05, t, -h / 2 + 0.05], Math.max(3, Math.round(w * 7)));
      b.rivets('dark', [-w / 2 + 0.05, t, h / 2 - 0.05], [w / 2 - 0.05, t, h / 2 - 0.05], Math.max(3, Math.round(w * 7)));
      // weld bead
      b.box('dark', w * 0.5, 0.012, 0.02, [-w * 0.1, t * 1.45, 0.08], [0, 0.3, 0]);
      break;
    }
    case 'steel': {
      b.box('paint', w, t, h, [0, t / 2, 0], [0, 0, 0], 0.012);
      b.box('paint2', w * 0.9, t * 0.3, h * 0.9, [0, t + 0.004, 0], [0, 0, 0], 0.008);
      b.rivets('metal', [-w / 2 + 0.04, t, -h / 2 + 0.04], [w / 2 - 0.04, t, -h / 2 + 0.04], Math.max(4, Math.round(w * 9)), 'y', 0.016);
      b.rivets('metal', [-w / 2 + 0.04, t, h / 2 - 0.04], [w / 2 - 0.04, t, h / 2 - 0.04], Math.max(4, Math.round(w * 9)), 'y', 0.016);
      b.rivets('metal', [-w / 2 + 0.04, t, -h / 2 + 0.1], [-w / 2 + 0.04, t, h / 2 - 0.1], Math.max(2, Math.round(h * 7)), 'y', 0.016);
      b.rivets('metal', [w / 2 - 0.04, t, -h / 2 + 0.1], [w / 2 - 0.04, t, h / 2 - 0.1], Math.max(2, Math.round(h * 7)), 'y', 0.016);
      break;
    }
    case 'sloped': {
      b.profile('paint', [[-h / 2, 0], [h / 2, 0], [h / 2, t], [-h / 2 + 0.12, t * 2.8]], w, [0, 0, 0], 0.02);
      b.rivets('metal', [-w / 2 + 0.06, t * 1.8, -h / 2 + 0.12], [w / 2 - 0.06, t * 1.8, -h / 2 + 0.12], Math.round(w * 6));
      break;
    }
    case 'composite': {
      b.box('dark', w, t * 0.4, h, [0, t * 0.2, 0], [0, 0, 0], 0.01);
      b.box('paint', w * 0.96, t * 0.7, h * 0.96, [0, t * 0.6, 0], [0, 0, 0], 0.02);
      const cols = Math.max(2, Math.round(w / 0.3));
      for (let i = 0; i < cols; i++) b.box('paint2', (w / cols) * 0.8, 0.01, h * 0.85, [-w / 2 + (i + 0.5) * (w / cols), t * 0.97, 0], [0, 0, 0], 0.004);
      break;
    }
    case 'reactive': {
      b.box('dark', w, 0.03, h, [0, 0.015, 0]);
      const cols = 3;
      const rows = 2;
      for (let i = 0; i < cols; i++)
        for (let j = 0; j < rows; j++)
          b.box('paint', (w / cols) * 0.9, t, (h / rows) * 0.9, [-w / 2 + (i + 0.5) * (w / cols), 0.03 + t / 2, -h / 2 + (j + 0.5) * (h / rows)], [0, 0, 0], 0.012);
      b.hazardPanel(w * 0.9, 0.012, 0.05, [0, 0.03 + t + 0.006, 0]);
      break;
    }
    case 'ceramic': {
      b.box('dark', w, 0.02, h, [0, 0.01, 0]);
      const n = 4;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < 3; j++) b.box('white', (w / n) * 0.94, t, (h / 3) * 0.94, [-w / 2 + (i + 0.5) * (w / n), 0.02 + t / 2, -h / 2 + (j + 0.5) * (h / 3)], [0, 0, 0], 0.008);
      break;
    }
    case 'aegis': {
      b.box('white', 0.3, 0.1, 0.18, [0, 0.05, 0], [0, 0, 0], 0.03);
      b.cyl('glow', 0.04, 0.08, [0, 0.12, 0], [0, 0, 0], 12);
      b.node('shield', [0, 0.25, 0]);
      b.box('glow', w, 0.012, h, [0, 0, 0], [0, 0, 0], 0.005);
      b.end();
      break;
    }
  }
};

const sensor: MeshFn = (b, def) => {
  const style = String(def.look?.style ?? 'dish');
  if (style === 'dish') {
    b.cyl('dark', 0.06, 0.25, [0, 0.125, 0], [0, 0, 0], 10);
    b.node('spin', [0, 0.28, 0]);
    b.lathe('white', [[0.0, 0.0], [0.08, 0.005], [0.2, 0.04], [0.24, 0.08], [0.23, 0.085], [0.0, 0.01]], [0, 0, -0.02], [-PI / 2 + 0.3, 0, 0], 20);
    b.cyl('dark', 0.012, 0.18, [0, 0.02, -0.12], [PI / 2 - 0.3, 0, 0], 6);
    b.end();
  } else if (style === 'radar') {
    b.cyl('dark', 0.05, 0.7, [0, 0.35, 0], [0, 0, 0], 8);
    b.box('metal', 0.16, 0.12, 0.16, [0, 0.06, 0], [0, 0, 0], 0.02);
    b.node('spin', [0, 0.72, 0]);
    b.box('paint2', 0.9, 0.12, 0.05, [0, 0.06, 0], [0.2, 0, 0], 0.02);
    b.grille('dark', 0.85, 0.1, 4, [0, 0.06, -0.03], 0.01, [0.2, 0, 0]);
    b.end();
    b.box('glow', 0.03, 0.03, 0.03, [0, 0.82, 0]);
  } else if (style === 'jammer') {
    b.box('dark', 0.36, 0.2, 0.3, [0, 0.1, 0], [0, 0, 0], 0.02);
    for (let i = 0; i < 4; i++) b.cyl('metal', 0.012, 0.5 + i * 0.1, [-0.12 + i * 0.08, 0.45 + i * 0.05, 0.08], [0, 0, 0], 6);
    b.box('glow', 0.25, 0.03, 0.02, [0, 0.16, -0.16]);
    b.sphere('paint2', 0.05, [0.12, 0.25, -0.05]);
  }
};

const flares: MeshFn = (b) => {
  b.box('dark', 0.3, 0.2, 0.25, [0, 0.1, 0], [0, 0, 0], 0.02);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) b.cyl('metal', 0.03, 0.05, [-0.08 + i * 0.08, 0.21, -0.05 + j * 0.1], [0, 0, 0], 8);
  b.hazardPanel(0.3, 0.04, 0.01, [0, 0.12, -0.13]);
};

const lights: MeshFn = (b, def) => {
  if (def.look?.style === 'spot') {
    b.cyl('dark', 0.05, 0.08, [0, 0.04, 0], [0, 0, 0], 10);
    b.node('yaw', [0, 0.1, 0]);
    b.box('dark', 0.03, 0.18, 0.05, [0.12, 0.08, 0]);
    b.box('dark', 0.03, 0.18, 0.05, [-0.12, 0.08, 0]);
    b.node('pitch', [0, 0.16, 0]);
    b.cylZ('paint2', 0.1, 0.22, [0, 0, 0.02], 16);
    b.cylZ('lamp', 0.085, 0.01, [0, 0, -0.1], 16);
    b.anchor('light_0', [0, 0, -0.12]);
    b.end();
    b.end();
  } else {
    b.pipe('dark', [[-0.4, 0.02, 0], [-0.38, 0.14, 0], [0.38, 0.14, 0], [0.4, 0.02, 0]], 0.018, 10, 6);
    for (let i = 0; i < 4; i++) {
      const x = -0.27 + i * 0.18;
      b.box('dark', 0.13, 0.1, 0.08, [x, 0.2, 0], [0, 0, 0], 0.02);
      b.box('lamp', 0.1, 0.07, 0.01, [x, 0.2, -0.04]);
    }
    b.anchor('light_0', [0, 0.2, -0.1]);
  }
};

const gyro: MeshFn = (b, def) => {
  const s = Number(def.look?.size ?? 1);
  b.box('dark', 0.34 * s, 0.05, 0.34 * s, [0, 0.025, 0], [0, 0, 0], 0.02);
  b.torus('metal', 0.14 * s, 0.015, [0, 0.2 * s, 0], [0, 0, 0], 20);
  b.torus('metal', 0.14 * s, 0.015, [0, 0.2 * s, 0], [0, PI / 2, 0], 20);
  b.node('spin', [0, 0.2 * s, 0]);
  b.cyl('paint2', 0.1 * s, 0.05 * s, [0, 0, 0], [PI / 2, 0, 0], 20);
  b.box('glow', 0.02, 0.02, 0.1 * s, [0.08 * s, 0, 0]);
  b.end();
  for (const x of [-0.14, 0.14]) b.cyl('dark', 0.015, 0.18 * s, [x * s, 0.1 * s, 0], [0, 0, 0], 6);
};

const hydraulics: MeshFn = (b, def) => {
  const mil = def.look?.style === 'mil';
  b.box('dark', 0.5, 0.05, 0.36, [0, 0.025, 0]);
  b.cylX(mil ? 'paint' : 'paint2', 0.12, 0.34, [-0.05, 0.16, 0], 16);
  b.cyl('metal', 0.08, 0.2, [0.18, 0.15, 0.05], [0, 0, 0], 14);
  b.pipe('rubber', [[0.18, 0.25, 0.05], [0.2, 0.35, -0.1], [-0.1, 0.3, -0.15]], 0.02, 10, 6);
  b.pipe('rubber', [[-0.22, 0.2, 0], [-0.3, 0.3, 0.1], [-0.2, 0.05, 0.15]], 0.02, 10, 6);
  b.cyl('chrome', 0.03, 0.05, [0.18, 0.28, 0.05], [0, 0, 0], 8);
};

export const COMMON_MESHES: Record<string, MeshFn> = {
  engine,
  generator,
  battery,
  fuel,
  cooling,
  cargo,
  armor,
  sensor,
  flares,
  lights,
  gyro,
  hydraulics,
};

export type { PartBuilder };
