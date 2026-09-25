/**
 * The workshop interior. Starts as a tin shed and grows with workshop upgrades
 * (crane gantry, research terminals, paint booth, electronics bench, extra racks).
 */
import * as THREE from 'three';
import { PartBuilder } from '../machines/parts/kit';
import { MachineMaterials } from '../machines/materials';
import { extendMaterial } from '../render/globals';
import { getNoiseTexture } from '../render/textures';
import type { Profile } from '../gameplay/profile';
import { getPart } from '../machines/parts/catalog';
import { getPartTemplate } from '../machines/parts/meshes';
import type { NodeTemplate, Slot } from '../machines/parts/kit';

const W = 26; // interior width (x)
const D = 20; // depth (z)
const H = 7.5;

function concreteMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a847a, roughness: 0.85, metalness: 0.0 });
  extendMaterial(mat, 'garage-floor', (shader) => {
    shader.uniforms.uNoise = { value: getNoiseTexture() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGP = (modelMatrix * vec4(transformed,1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGP;\nuniform sampler2D uNoise;\nfloat gRough = 0.85;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec2 p = vGP.xz;
          vec4 a = texture2D(uNoise, p * 0.05);
          vec4 b = texture2D(uNoise, p * 0.31);
          vec4 c = texture2D(uNoise, p * 1.7);
          vec3 col = mix(vec3(0.42, 0.4, 0.37), vec3(0.58, 0.55, 0.5), a.g * 0.7 + b.r * 0.3);
          col *= 0.9 + c.r * 0.2;
          // expansion joints every 4 m
          vec2 g = abs(fract(p / 4.0) - 0.5);
          float joint = smoothstep(0.495, 0.5, max(g.x, g.y));
          col *= 1.0 - joint * 0.5;
          // oil stains
          float oil = smoothstep(0.66, 0.8, a.r * 0.6 + b.g * 0.5);
          col = mix(col, vec3(0.1, 0.09, 0.08), oil * 0.75);
          gRough = mix(0.85, 0.35, oil);
          // painted bay lines
          float line = smoothstep(0.08, 0.05, abs(length(p - vec2(0.0, -1.0)) - 5.2));
          float wear = smoothstep(0.3, 0.6, b.g + c.g * 0.3);
          col = mix(col, vec3(0.85, 0.62, 0.12), line * wear);
          diffuseColor.rgb = col;
        }`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;');
  });
  return mat;
}

function corrugated(width: number, height: number, waves: number) {
  const geo = new THREE.PlaneGeometry(width, height, waves * 4, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, Math.sin((x / width) * waves * Math.PI * 2) * 0.05);
  }
  geo.computeVertexNormals();
  return geo;
}

export class GarageEnvironment {
  group = new THREE.Group();
  dynamic = new THREE.Group();
  mats: MachineMaterials;
  lights: THREE.Light[] = [];
  platform: THREE.Group;
  turntable: THREE.Object3D;
  craneHook: THREE.Object3D | null = null;
  screens: THREE.Mesh[] = [];

  constructor() {
    this.mats = new MachineMaterials({ primary: '#6a5a44', secondary: '#9a3a2a', accent: '#ffae3b', pattern: 'none', wear: 0.55 });
    this.group.add(this.dynamic);
    this.buildShell();
    this.platform = new THREE.Group();
    this.turntable = new THREE.Object3D();
    this.buildPlatform();
    this.buildLights();
    this.buildBenches();
  }

  private addBuilt(b: PartBuilder, pos: THREE.Vector3, rotY = 0, parent: THREE.Object3D = this.group, shadows = true) {
    const root = b.build();
    const o = this.instantiate(root, shadows);
    o.position.copy(pos);
    o.rotation.y = rotY;
    parent.add(o);
    return o;
  }

  private instantiate(t: NodeTemplate, shadows: boolean): THREE.Object3D {
    const o = new THREE.Object3D();
    o.position.copy(t.pos);
    o.quaternion.copy(t.quat);
    o.name = t.name;
    for (const [slot, geo] of t.merged) {
      const m = new THREE.Mesh(geo, this.mats.get(slot as Slot));
      m.castShadow = shadows && slot !== 'glow' && slot !== 'lamp';
      m.receiveShadow = shadows;
      o.add(m);
    }
    for (const c of t.children) o.add(this.instantiate(c, shadows));
    return o;
  }

  private buildShell() {
    const g = this.group;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W + 30, D + 40), concreteMaterial());
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    g.add(floor);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x7c776c, metalness: 0.6, roughness: 0.55, side: THREE.DoubleSide });
    const rustWall = this.mats.get('rust');
    // back wall
    const back = new THREE.Mesh(corrugated(W, H, 60), wallMat);
    back.position.set(0, H / 2, -D / 2);
    back.receiveShadow = true;
    g.add(back);
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(corrugated(D, H, 46), s < 0 ? wallMat : rustWall);
      side.position.set((s * W) / 2, H / 2, 0);
      side.rotation.y = (-s * Math.PI) / 2;
      side.receiveShadow = true;
      g.add(side);
      // front wall segments either side of the big door
      const seg = new THREE.Mesh(corrugated(W / 2 - 6, H, 14), wallMat);
      seg.position.set(s * (W / 4 + 3), H / 2, D / 2);
      seg.rotation.y = Math.PI;
      g.add(seg);
    }
    const lintel = new THREE.Mesh(corrugated(12, H - 5.8, 16), wallMat);
    lintel.position.set(0, 5.8 + (H - 5.8) / 2, D / 2);
    lintel.rotation.y = Math.PI;
    g.add(lintel);
    // roof with skylights
    const roof = new THREE.Mesh(corrugated(W, D, 50), wallMat);
    roof.rotation.x = Math.PI / 2;
    roof.position.set(0, H, 0);
    g.add(roof);
    const b = new PartBuilder();
    // columns and trusses
    for (const x of [-W / 2 + 0.3, -W / 4, 0, W / 4, W / 2 - 0.3]) {
      for (const z of [-D / 2 + 0.3, D / 2 - 0.3]) {
        if (Math.abs(x) < 6.5 && z > 0) continue;
        b.box('paint', 0.3, H, 0.3, [x, H / 2, z], [0, 0, 0], 0.01);
      }
      b.box('paint', 0.2, 0.35, D, [x, H - 0.3, 0], [0, 0, 0], 0.01);
      for (let i = -3; i <= 3; i++) b.box('dark', 0.06, 0.8, 0.06, [x, H - 0.8, i * 2.6], [0.6 * (i % 2 ? 1 : -1), 0, 0]);
    }
    // roll-up door (half open) and door frame
    b.box('paint2', 12.2, 0.4, 0.4, [0, 5.9, D / 2], [0, 0, 0], 0.02);
    b.cylX('dark', 0.35, 12, [0, 6.3, D / 2 - 0.3], 20);
    for (let i = 0; i < 6; i++) b.box('metal', 11.8, 0.1, 0.05, [0, 5.4 + i * 0.1, D / 2 - 0.05]);
    b.hazardPanel(0.3, 5.6, 0.32, [-6.05, 2.8, D / 2]);
    b.hazardPanel(0.3, 5.6, 0.32, [6.05, 2.8, D / 2]);
    this.addBuilt(b, new THREE.Vector3());
    // Outside ground & junk silhouettes beyond the door
    const out = new PartBuilder();
    for (let i = 0; i < 9; i++) {
      const x = -16 + i * 4.2 + Math.sin(i * 3.1) * 1.5;
      const z = D / 2 + 12 + Math.cos(i * 1.7) * 4;
      out.box(i % 3 === 0 ? 'rust' : 'paint', 2 + (i % 3), 1 + (i % 2), 2.5, [x, 0.6, z], [0.1 * i, i, 0.05 * i], 0.05);
      out.cylX('rubber', 0.45, 0.3, [x + 1.4, 0.45, z - 1], 16);
    }
    this.addBuilt(out, new THREE.Vector3());
  }

  private buildPlatform() {
    const b = new PartBuilder();
    b.cyl('dark', 5.2, 0.18, [0, 0.09, 0], [0, 0, 0], 48);
    b.torus('hazard', 5.05, 0.08, [0, 0.2, 0], [Math.PI / 2, 0, 0], 64);
    b.cyl('metal', 4.8, 0.05, [0, 0.21, 0], [0, 0, 0], 48);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      b.box('dark', 0.05, 0.02, 4.7, [Math.cos(a) * 2.35, 0.24, Math.sin(a) * 2.35], [0, -a + Math.PI / 2, 0]);
    }
    const plat = this.addBuilt(b, new THREE.Vector3(0, 0, -1));
    this.platform.add(plat);
    this.platform.add(this.turntable);
    this.turntable.position.set(0, 0.24, -1);
    this.group.add(this.platform);
  }

  private buildLights() {
    const hemi = new THREE.HemisphereLight(0xffe6c8, 0x3a3028, 0.55);
    this.group.add(hemi);
    this.lights.push(hemi);
    // sunlight through the door
    const sun = new THREE.DirectionalLight(0xffd6a0, 2.2);
    sun.position.set(8, 10, 22);
    sun.target.position.set(-2, 0, -2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 16;
    sun.shadow.camera.bottom = -16;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    this.group.add(sun, sun.target);
    this.lights.push(sun);
    // hanging lamps
    const b = new PartBuilder();
    const lampPos: [number, number][] = [
      [-4, -1],
      [4, -1],
      [0, -6],
      [-9, -6],
      [9, -6],
    ];
    for (const [x, z] of lampPos) {
      b.cyl('dark', 0.01, 1.4, [x, H - 0.7, z], [0, 0, 0], 4);
      b.cone('paint2', 0.45, 0.35, [x, H - 1.5, z], [0, 0, 0], 20);
      b.sphere('lamp', 0.12, [x, H - 1.66, z]);
    }
    this.addBuilt(b, new THREE.Vector3(), 0, this.group, false);
    this.mats.setLights(true);
    for (const [i, [x, z]] of lampPos.entries()) {
      const s = new THREE.SpotLight(0xffd9a8, i < 2 ? 70 : 35, 14, 0.85, 0.55, 1.5);
      s.position.set(x, H - 1.7, z);
      s.target.position.set(x, 0, z);
      s.castShadow = i < 2;
      if (s.castShadow) {
        s.shadow.mapSize.set(1024, 1024);
        s.shadow.bias = -0.0008;
      }
      this.group.add(s, s.target);
      this.lights.push(s);
    }
  }

  private buildBenches() {
    // Left wall workbench with tools
    const b = new PartBuilder();
    const bx = -W / 2 + 1.1;
    b.box('wood', 1.2, 0.08, 5.5, [bx, 0.95, -3], [0, 0, 0], 0.01);
    for (const z of [-5.5, -0.5]) for (const dx of [-0.5, 0.5]) b.box('dark', 0.06, 0.95, 0.06, [bx + dx, 0.47, z]);
    b.box('paint2', 0.5, 0.4, 0.8, [bx, 0.2, -4.6], [0, 0, 0], 0.03);
    b.box('paint2', 0.5, 0.4, 0.8, [bx, 0.62, -4.6], [0, 0, 0], 0.03);
    for (let i = 0; i < 3; i++) b.box('metal', 0.02, 0.06, 0.7, [bx + 0.26, 0.2 + i * 0.13, -4.6]);
    // pegboard with tools
    b.box('wood', 0.04, 1.6, 5, [-W / 2 + 0.15, 2.1, -3], [0, 0, 0], 0.005);
    for (let i = 0; i < 16; i++) {
      const z = -5.2 + i * 0.28;
      const len = 0.3 + (i % 4) * 0.08;
      b.box(i % 3 === 0 ? 'chrome' : 'metal', 0.03, len, 0.035, [-W / 2 + 0.22, 2.3 - (i % 2) * 0.45, z], [0, 0, (i % 5) * 0.08 - 0.15]);
    }
    // vise and grinder
    b.box('paint', 0.25, 0.2, 0.35, [bx + 0.3, 1.1, -1.2], [0, 0, 0], 0.03);
    b.cylX('metal', 0.14, 0.05, [bx, 1.15, -2.2], 20);
    b.cylX('dark', 0.08, 0.3, [bx, 1.15, -2.0], 12);
    // welding cart and gas bottles
    b.cyl('paint2', 0.14, 1.2, [-W / 2 + 1.5, 0.6, 2.5], [0, 0, 0], 16);
    b.cyl('paint', 0.14, 1.2, [-W / 2 + 1.9, 0.6, 2.5], [0, 0, 0], 16);
    b.box('dark', 0.6, 0.5, 0.5, [-W / 2 + 1.7, 0.3, 3.3], [0, 0, 0], 0.03);
    // tire stacks & barrels along the right wall
    for (let i = 0; i < 4; i++) b.torus('rubber', 0.38, 0.14, [W / 2 - 1.2, 0.14 + i * 0.28, 5.5], [Math.PI / 2, 0, 0], 20);
    for (let i = 0; i < 3; i++) b.torus('rubber', 0.38, 0.14, [W / 2 - 2.2, 0.14 + i * 0.28, 6.3], [Math.PI / 2, 0, 0], 20);
    for (let i = 0; i < 5; i++) b.cyl(i % 2 ? 'rust' : 'paint2', 0.29, 0.86, [W / 2 - 1 - (i % 3) * 0.7, 0.43, 2 + Math.floor(i / 3) * 0.8], [0, 0, 0], 18);
    this.addBuilt(b, new THREE.Vector3());
    // decorative spare parts on a rack by the back wall
    const rack = new PartBuilder();
    for (const y of [0.1, 1.2, 2.3]) rack.box('dark', 5.5, 0.05, 1.0, [-6, y, -D / 2 + 0.7]);
    for (const x of [-8.7, -3.3]) rack.box('dark', 0.06, 2.4, 1.0, [x, 1.2, -D / 2 + 0.7]);
    this.addBuilt(rack, new THREE.Vector3());
    const deco = ['eng_v4', 'whl_knobby', 'fuel_drum', 'wpn_lmg', 'gen_dynamo', 'cool_radiator'];
    deco.forEach((id, i) => {
      const t = getPartTemplate(getPart(id));
      const o = this.instantiate(t.root, true);
      o.position.set(-8 + (i % 3) * 1.9, 0.15 + Math.floor(i / 3) * 1.1, -D / 2 + 0.7);
      o.rotation.y = i * 0.7;
      this.group.add(o);
    });
  }

  /** Rebuild props that depend on workshop upgrades. */
  applyUpgrades(p: Profile) {
    this.dynamic.clear();
    this.screens = [];
    this.craneHook = null;
    const b = new PartBuilder();
    // research station: desk + terminals, grows with level
    const rl = p.workshop.research;
    b.box('dark', 2.4, 0.08, 0.9, [W / 2 - 1.3, 0.95, -6], [0, 0, 0], 0.01);
    b.box('dark', 0.08, 0.95, 0.9, [W / 2 - 2.4, 0.47, -6]);
    b.box('dark', 0.08, 0.95, 0.9, [W / 2 - 0.2, 0.47, -6]);
    const monitors = rl >= 3 ? 4 : rl >= 2 ? 3 : 1;
    for (let i = 0; i < monitors; i++) b.box('paint2', 0.5, 0.42, 0.45, [W / 2 - 0.7 - i * 0.55, 1.22, -6.1], [0, -Math.PI / 2, 0], 0.03);
    if (rl >= 2) {
      b.box('dark', 0.7, 2.0, 0.8, [W / 2 - 0.5, 1.0, -8], [0, 0, 0], 0.02);
      for (let i = 0; i < 8; i++) b.box('glow', 0.02, 0.03, 0.5, [W / 2 - 0.86, 0.4 + i * 0.2, -8]);
    }
    if (rl >= 3) b.box('white', 1.4, 2.2, 0.6, [W / 2 - 2, 1.1, -D / 2 + 0.5], [0, 0, 0], 0.05);
    // electronics bench
    if (p.workshop.electronics >= 1) {
      b.box('white', 1.8, 0.06, 0.8, [W / 2 - 1.2, 0.95, -2.5], [0, 0, 0], 0.01);
      b.box('dark', 0.4, 0.3, 0.35, [W / 2 - 0.8, 1.13, -2.2], [0, -Math.PI / 2, 0], 0.02);
      b.box('glow', 0.02, 0.18, 0.28, [W / 2 - 1.01, 1.15, -2.2]);
      b.pipe('copper', [[W / 2 - 1.5, 1.0, -2.8], [W / 2 - 1.4, 1.2, -2.6], [W / 2 - 1.2, 1.0, -2.4]], 0.01, 8, 4);
    }
    // paint booth
    if (p.workshop.paint >= 2) {
      for (const [x, z] of [
        [-12, 4],
        [-7, 4],
        [-12, 9],
        [-7, 9],
      ] as [number, number][])
        b.box('metal', 0.08, 3.2, 0.08, [x, 1.6, z]);
      b.box('metal', 5.1, 0.08, 5.1, [-9.5, 3.2, 6.5]);
      b.box('canvas', 5.0, 2.8, 0.02, [-9.5, 1.8, 4]);
      b.box('paint2', 0.3, 0.5, 0.3, [-8, 0.25, 5], [0, 0, 0], 0.05);
    }
    // crane gantry
    if (p.workshop.crane >= 1) {
      b.box('hazard', W - 1, 0.5, 0.5, [0, H - 0.8, -1], [0, 0, 0], 0.02);
      for (const s of [-1, 1]) b.box('paint2', 0.4, 0.4, D - 1, [s * (W / 2 - 0.8), H - 0.5, 0], [0, 0, 0], 0.02);
      b.box('dark', 0.8, 0.6, 0.8, [1.5, H - 1.3, -1], [0, 0, 0], 0.05);
    }
    // extra storage racks
    for (let i = 1; i < p.workshop.storage; i++) {
      const z = -D / 2 + 0.7;
      const x = 6 + (i - 1) * 3.2;
      for (const y of [0.1, 1.2, 2.3]) b.box('dark', 2.8, 0.05, 1.0, [x, y, z]);
      for (const dx of [-1.4, 1.4]) b.box('dark', 0.06, 2.4, 1.0, [x + dx, 1.2, z]);
      for (let k = 0; k < 4; k++) b.box(k % 2 ? 'paint2' : 'paint', 0.6, 0.45, 0.6, [x - 1 + k * 0.65, 0.35 + (k % 3) * 1.1, z], [0, k, 0], 0.03);
    }
    const o = this.addBuilt(b, new THREE.Vector3(), 0, this.dynamic);
    void o;
    if (p.workshop.crane >= 1) {
      const hook = new PartBuilder();
      hook.cyl('dark', 0.015, 2.2, [0, -1.1, 0], [0, 0, 0], 6);
      hook.torus('metal', 0.12, 0.03, [0, -2.25, 0], [0, 0, 0], 12, Math.PI * 1.5);
      this.craneHook = this.addBuilt(hook, new THREE.Vector3(1.5, H - 1.6, -1), 0, this.dynamic);
    }
    // glowing terminal screens (animated in update)
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x7dffb0 });
    for (let i = 0; i < monitors; i++) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.28), screenMat);
      s.position.set(W / 2 - 0.7 - i * 0.55 - 0.001, 1.24, -6.1 + 0.23);
      s.rotation.y = 0;
      s.position.set(W / 2 - 0.7 - i * 0.55, 1.24, -6.1 - 0.23 + 0.46);
      this.dynamic.add(s);
      this.screens.push(s);
    }
  }

  update(t: number) {
    for (const [i, s] of this.screens.entries()) {
      const m = s.material as THREE.MeshBasicMaterial;
      m.color.setHSL(0.38, 0.9, 0.35 + 0.1 * Math.sin(t * 3 + i));
    }
  }
}

export const GARAGE_SIZE = { W, D, H };
