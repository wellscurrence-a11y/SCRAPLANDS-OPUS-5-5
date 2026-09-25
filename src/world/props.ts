/**
 * World dressing: settlements, ruins, the home scrapyard, highway furniture, rocks and plants.
 * Everything big is solid (static Rapier colliders) so machines can crash into it and take cover.
 */
import * as THREE from 'three';
import type { Game } from '../core/game';
import type { App } from '../app';
import type { Profile } from '../gameplay/profile';
import { PartBuilder, V3 } from '../machines/parts/kit';
import type { NodeTemplate, Slot } from '../machines/parts/kit';
import { MachineMaterials } from '../machines/materials';
import { RAPIER, COLLIDE } from '../physics/physics';
import { getLocation, LOCATIONS, ROADS, PIT } from './layout';
import { RNG } from '../core/random';
import { Noise } from '../core/noise';
import { clamp, smoothstep } from '../core/math';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { activeDetail } from '../machines/parts/kit';

type ScatterKind = 'rock' | 'shrub' | 'plant';
/** Base view distance (m) per scatter kind, scaled by the preset. */
const SCATTER_RANGE: Record<ScatterKind, number> = { rock: 380, shrub: 170, plant: 480 };

export interface InteractionPoint {
  pos: THREE.Vector3;
  radius: number;
  label: string;
  action: (app: App) => void;
  id: string;
}

const PI = Math.PI;
const noise = new Noise(55);

type MatSet = MachineMaterials;

/** Builder for a location: geometry in location-local coordinates plus colliders. */
class Site {
  b = new PartBuilder();
  boxes: { c: THREE.Vector3; h: THREE.Vector3; rotY: number; surface: string }[] = [];
  cyls: { c: THREE.Vector3; r: number; hh: number; surface: string }[] = [];
  constructor(public origin: THREE.Vector3, public ground: (x: number, z: number) => number) {}
  /** Ground height at a site-local point, relative to the site origin. */
  gy(x: number, z: number) {
    return this.ground(this.origin.x + x, this.origin.z + z) - this.origin.y;
  }
  solid(x: number, y: number, z: number, w: number, h: number, d: number, rotY = 0, surface = 'rock') {
    this.boxes.push({ c: new THREE.Vector3(x, y, z), h: new THREE.Vector3(w / 2, h / 2, d / 2), rotY, surface });
  }
  solidCyl(x: number, y: number, z: number, r: number, h: number, surface = 'metal') {
    this.cyls.push({ c: new THREE.Vector3(x, y, z), r, hh: h / 2, surface });
  }
}

function rotPt(x: number, z: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}

export class WorldProps {
  group = new THREE.Group();
  interactions: InteractionPoint[] = [];
  garageDoor = new THREE.Vector3();
  garageSpawn = { pos: new THREE.Vector3(), yaw: 0 };
  rangeTargets: THREE.Vector3[] = [];
  private mats: Record<string, MatSet> = {};
  private blinkers: THREE.Mesh[] = [];
  private rng = new RNG(4242);
  private time = 0;
  private dynamicLights: { light: THREE.PointLight; pos: THREE.Vector3 }[] = [];

  constructor(private game: Game) {
    game.scene.add(this.group);
    const mk = (primary: string, secondary: string, wear: number, accent = '#ffb040') => new MachineMaterials({ primary, secondary, accent, pattern: 'none', wear });
    this.mats = {
      scrap: mk('#7b5a3a', '#9a3a2a', 0.85),
      settle: mk('#6d7d86', '#b8743a', 0.6),
      red: mk('#8e2f22', '#c8b89a', 0.7),
      blue: mk('#2d5470', '#c8b89a', 0.7),
      green: mk('#3f5a3a', '#c8b89a', 0.7),
      orange: mk('#b86a28', '#c8b89a', 0.7),
      concrete: mk('#8f8a80', '#6a655c', 0.5),
      military: mk('#5a5f48', '#3a3d30', 0.4, '#ff5a2a'),
      helix: mk('#e6e9ec', '#9aa4ad', 0.03, '#44e8ff'),
      home: mk('#7e6a4c', '#b04a2a', 0.75),
    };
    for (const m of Object.values(this.mats)) {
      m.setLights(false);
      m.uniforms.uDirt.value = 0.55;
    }
  }

  // ------------------------------------------------------------------ building
  build() {
    const t0 = performance.now();
    this.buildHome();
    this.buildRustwater();
    this.buildDustHollow();
    this.buildFoundry();
    this.buildPit();
    this.buildFort();
    this.buildAirliner();
    this.buildGunshipWreck();
    this.buildHelix();
    this.buildRadioHill();
    this.buildOverpass();
    this.buildRoadside();
    this.buildScatter();
    // Nothing in the props ever moves: freeze every local matrix so per-frame updates skip them.
    this.group.traverse((o) => {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
    this.group.updateMatrixWorld(true);
    console.log(`[props] built in ${(performance.now() - t0).toFixed(0)} ms`);
  }

  private site(x: number, z: number) {
    const g = this.game.terrain;
    return new Site(new THREE.Vector3(x, g.heightAt(x, z), z), (xx, zz) => g.heightAt(xx, zz));
  }

  private finish(site: Site, mats: MatSet, name: string, castShadow = true) {
    const root = site.b.build();
    const obj = this.instantiate(root, mats, castShadow);
    obj.position.copy(site.origin);
    obj.name = name;
    obj.updateMatrixWorld(true);
    this.group.add(obj);
    const world = this.game.physics.world;
    for (const bx of site.boxes) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), bx.rotY);
      const desc = RAPIER.ColliderDesc.cuboid(bx.h.x, bx.h.y, bx.h.z)
        .setTranslation(site.origin.x + bx.c.x, site.origin.y + bx.c.y, site.origin.z + bx.c.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setCollisionGroups(COLLIDE.static)
        .setFriction(0.8);
      const c = world.createCollider(desc);
      this.game.physics.owners.set(c.handle, { kind: 'static', surface: bx.surface });
    }
    for (const cy of site.cyls) {
      const desc = RAPIER.ColliderDesc.cylinder(cy.hh, cy.r)
        .setTranslation(site.origin.x + cy.c.x, site.origin.y + cy.c.y, site.origin.z + cy.c.z)
        .setCollisionGroups(COLLIDE.static);
      const c = world.createCollider(desc);
      this.game.physics.owners.set(c.handle, { kind: 'static', surface: cy.surface });
    }
    return obj;
  }

  private instantiate(t: NodeTemplate, mats: MatSet, shadows: boolean): THREE.Object3D {
    const o = new THREE.Object3D();
    o.position.copy(t.pos);
    o.quaternion.copy(t.quat);
    o.name = t.name;
    for (const [slot, geo] of t.merged) {
      const m = new THREE.Mesh(geo, mats.get(slot as Slot));
      m.castShadow = shadows && slot !== 'glow' && slot !== 'lamp' && slot !== 'glass';
      m.receiveShadow = true;
      if (slot === 'glow' && t.name.startsWith('blink')) this.blinkers.push(m);
      o.add(m);
    }
    for (const c of t.children) o.add(this.instantiate(c, mats, shadows));
    return o;
  }

  // ------------------------------------------------------------------ primitives
  private shack(s: Site, x: number, z: number, w: number, d: number, hgt: number, rot: number, slot: Slot = 'rust', roof: Slot = 'metal') {
    const y = s.gy(x, z);
    s.b.node('_shack', [x, y, z], [0, rot, 0]);
    s.b.box(slot, w, hgt, d, [0, hgt / 2, 0], [0, 0, 0], 0.02);
    s.b.box(roof, w + 0.5, 0.08, d + 0.6, [0, hgt + 0.18, 0], [0.12, 0, 0], 0.01);
    s.b.box('dark', 0.9, 1.9, 0.06, [w * 0.2, 0.95, d / 2 + 0.01]);
    s.b.box('glass', 0.8, 0.6, 0.05, [-w * 0.25, hgt * 0.6, d / 2 + 0.02]);
    s.b.box('dark', 0.9, 0.08, 0.1, [-w * 0.25, hgt * 0.6 - 0.35, d / 2 + 0.06]);
    for (let i = 0; i < Math.floor(w / 0.6); i++) s.b.box('dark', 0.03, hgt, 0.03, [-w / 2 + 0.3 + i * 0.6, hgt / 2, d / 2 + 0.01]);
    s.b.end();
    const [cx, cz] = [x, z];
    s.solid(cx, y + hgt / 2, cz, w, hgt, d, rot, 'metal');
  }

  private container(s: Site, x: number, y: number, z: number, rot: number, slot: Slot = 'paint', long = true) {
    const L = long ? 6.1 : 3.0;
    s.b.node('_cont', [x, y, z], [0, rot, 0]);
    s.b.box(slot, L, 2.6, 2.44, [0, 1.3, 0], [0, 0, 0], 0.03);
    for (let i = 0; i < Math.floor(L / 0.35); i++) {
      const xx = -L / 2 + 0.2 + i * 0.35;
      s.b.box(slot, 0.12, 2.45, 0.06, [xx, 1.3, 1.23]);
      s.b.box(slot, 0.12, 2.45, 0.06, [xx, 1.3, -1.23]);
    }
    s.b.box('dark', 0.08, 2.6, 2.44, [L / 2, 1.3, 0]);
    s.b.box('rust', L, 0.12, 2.5, [0, 0.06, 0]);
    for (const zz of [-0.4, 0.4]) s.b.box('metal', 0.05, 2.3, 0.04, [L / 2 + 0.05, 1.3, zz]);
    s.b.end();
    s.solid(x, y + 1.3, z, L, 2.6, 2.44, rot, 'metal');
  }

  private waterTower(s: Site, x: number, z: number, hgt = 12, slot: Slot = 'paint') {
    const y = s.gy(x, z);
    s.b.node('_wt', [x, y, z]);
    for (const [dx, dz] of [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]] as [number, number][]) s.b.box('dark', 0.25, hgt, 0.25, [dx, hgt / 2, dz], [dz * 0.03, 0, -dx * 0.03]);
    for (let k = 1; k < 4; k++) s.b.box('dark', 3.4, 0.12, 0.12, [0, (hgt / 4) * k, -1.5]);
    s.b.cyl(slot, 2.6, 3.4, [0, hgt + 1.7, 0], [0, 0, 0], 24);
    s.b.cone('rust', 2.8, 1.2, [0, hgt + 4, 0], [0, 0, 0], 24);
    s.b.torus('dark', 2.62, 0.06, [0, hgt + 0.8, 0], [PI / 2, 0, 0], 24);
    s.b.end();
    s.solid(x, y + hgt / 2, z, 3.5, hgt, 3.5, 0, 'metal');
  }

  private ruinWall(s: Site, x: number, z: number, len: number, hgt: number, rot: number, slot: Slot = 'paint', windows = true) {
    const y = s.gy(x, z);
    s.b.node('_rw', [x, y, z], [0, rot, 0]);
    const seg = 3;
    const n = Math.max(1, Math.round(len / seg));
    for (let i = 0; i < n; i++) {
      const xx = -len / 2 + (i + 0.5) * (len / n);
      const broken = noise.noise2(x * 0.1 + i, z * 0.1) > 0.35;
      const hh = broken ? hgt * (0.35 + 0.3 * (noise.noise2(i, x) * 0.5 + 0.5)) : hgt;
      if (windows && !broken && hh > 4) {
        s.b.box(slot, len / n, 1.2, 0.5, [xx, 0.6, 0], [0, 0, 0], 0.02);
        s.b.box(slot, len / n, hh - 3.2, 0.5, [xx, 3.2 + (hh - 3.2) / 2, 0], [0, 0, 0], 0.02);
        s.b.box(slot, 0.5, 2.0, 0.5, [xx - len / n / 2 + 0.25, 2.2, 0]);
      } else {
        s.b.box(slot, len / n, hh, 0.5, [xx, hh / 2, 0], [0, 0, 0], 0.02);
      }
      if (noise.noise2(i * 3, z) > 0.2) s.b.box('rust', 0.1, hh * 0.6, 0.1, [xx + 0.6, hh * 0.7, 0.3], [0.3, 0, 0.2]);
    }
    s.b.end();
    s.solid(x, y + hgt * 0.35, z, len, hgt * 0.7, 0.6, rot, 'rock');
  }

  private smokestack(s: Site, x: number, z: number, hgt: number, r: number) {
    const y = s.gy(x, z);
    s.b.node('_ss', [x, y, z]);
    s.b.cyl('paint', r, hgt, [0, hgt / 2, 0], [0, 0, 0], 20, r * 0.75);
    for (let k = 0; k < 5; k++) s.b.torus('dark', r * (1 - (k / 5) * 0.25) + 0.05, 0.1, [0, (hgt / 5) * k + 1, 0], [PI / 2, 0, 0], 20);
    s.b.torus('rust', r * 0.78, 0.2, [0, hgt, 0], [PI / 2, 0, 0], 20);
    // ladder
    for (let k = 0; k < hgt / 0.6; k++) s.b.box('dark', 0.5, 0.04, 0.04, [0, k * 0.6, r + 0.25]);
    s.b.anchor('stack_top', [0, hgt + 0.5, 0]);
    s.b.end();
    s.solidCyl(x, y + hgt / 2, z, r, hgt, 'rock');
  }

  private tank(s: Site, x: number, z: number, r: number, hgt: number, slot: Slot = 'paint2') {
    const y = s.gy(x, z);
    s.b.node('_tk', [x, y, z]);
    s.b.cyl(slot, r, hgt, [0, hgt / 2, 0], [0, 0, 0], 28);
    s.b.cyl('rust', r * 1.02, 0.15, [0, hgt, 0], [0, 0, 0], 28);
    s.b.sphere(slot, r, [0, hgt, 0], [1, 0.25, 1], 20);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * PI * 2;
      s.b.box('dark', 0.08, hgt, 0.08, [Math.cos(a) * r * 1.01, hgt / 2, Math.sin(a) * r * 1.01]);
    }
    s.b.end();
    s.solidCyl(x, y + hgt / 2, z, r, hgt, 'metal');
  }

  private carWreck(s: Site, x: number, z: number, rot: number, slot: Slot = 'rust', flipped = false) {
    const y = s.gy(x, z);
    s.b.node('_car', [x, y + (flipped ? 1.2 : 0.35), z], [flipped ? PI : 0, rot, noise.noise2(x, z) * 0.15]);
    s.b.box(slot, 1.8, 0.6, 4.2, [0, 0.35, 0], [0, 0, 0], 0.15);
    s.b.box(slot, 1.6, 0.55, 2.2, [0, 0.9, 0.2], [0, 0, 0], 0.12);
    s.b.box('glass', 1.5, 0.45, 0.05, [0, 0.95, -0.9], [0.5, 0, 0]);
    s.b.box('dark', 1.62, 0.4, 1.8, [0, 0.95, 0.25], [0, 0, 0], 0.05);
    for (const [dx, dz] of [[-0.85, -1.3], [0.85, -1.3], [-0.85, 1.3], [0.85, 1.3]] as [number, number][]) if (noise.noise2(dx * 7 + x, dz * 5 + z) > -0.3) s.b.cylX('rubber', 0.33, 0.22, [dx, 0.05, dz], 14);
    s.b.end();
    s.solid(x, y + 0.7, z, 1.9, 1.4, 4.3, rot, 'metal');
  }

  private rubble(s: Site, x: number, z: number, n: number, spread: number, slot: Slot = 'paint') {
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, PI * 2);
      const r = this.rng.range(0, spread);
      const xx = x + Math.cos(a) * r;
      const zz = z + Math.sin(a) * r;
      const sz = this.rng.range(0.4, 1.4);
      s.b.box(slot, sz * 1.6, sz * 0.5, sz, [xx, s.gy(xx, zz) + sz * 0.15, zz], [this.rng.range(-0.3, 0.3), this.rng.range(0, 3), this.rng.range(-0.3, 0.3)], 0.05);
    }
  }

  private barrels(s: Site, x: number, z: number, n: number) {
    for (let i = 0; i < n; i++) {
      const xx = x + (i % 3) * 0.65 + this.rng.range(-0.1, 0.1);
      const zz = z + Math.floor(i / 3) * 0.65;
      const tipped = this.rng.chance(0.2);
      if (tipped) s.b.cylX(i % 2 ? 'paint2' : 'rust', 0.29, 0.86, [xx, s.gy(xx, zz) + 0.29, zz], 16);
      else s.b.cyl(i % 2 ? 'paint2' : 'rust', 0.29, 0.86, [xx, s.gy(xx, zz) + 0.43, zz], [0, 0, 0], 16);
    }
  }

  private tires(s: Site, x: number, z: number, stacks: number) {
    for (let k = 0; k < stacks; k++) {
      const xx = x + k * 0.9;
      const hN = 2 + (k % 3);
      for (let i = 0; i < hN; i++) s.b.torus('rubber', 0.36, 0.14, [xx, s.gy(xx, z) + 0.14 + i * 0.27, z], [PI / 2, 0, 0], 16);
    }
  }

  private scrapPile(s: Site, x: number, z: number, size: number) {
    const y = s.gy(x, z);
    s.b.node('_pile', [x, y, z]);
    s.b.sphere('rust', size, [0, 0, 0], [1.3, 0.55, 1], 10);
    for (let i = 0; i < 14; i++) {
      const a = this.rng.range(0, PI * 2);
      const r = this.rng.range(0, size * 0.9);
      const hh = size * 0.5 * (1 - r / size) + 0.2;
      const slot: Slot = this.rng.pick(['rust', 'paint', 'paint2', 'dark', 'metal']);
      s.b.box(slot, this.rng.range(0.4, 1.6), this.rng.range(0.1, 0.6), this.rng.range(0.4, 1.8), [Math.cos(a) * r, hh, Math.sin(a) * r], [this.rng.range(-0.6, 0.6), this.rng.range(0, 3), this.rng.range(-0.6, 0.6)], 0.03);
    }
    for (let i = 0; i < 3; i++) s.b.cylX('rubber', 0.4, 0.3, [this.rng.range(-size, size) * 0.6, size * 0.3, this.rng.range(-size, size) * 0.5], 14);
    s.b.end();
    s.solid(x, y + size * 0.25, z, size * 2, size * 0.6, size * 1.6, 0, 'metal');
  }

  private lamppost(s: Site, x: number, z: number, blink = false) {
    const y = s.gy(x, z);
    s.b.cyl('dark', 0.08, 5, [x, y + 2.5, z], [0, 0, 0], 8);
    s.b.box('dark', 0.9, 0.12, 0.2, [x + 0.4, y + 5, z]);
    s.b.box('lamp', 0.4, 0.06, 0.18, [x + 0.7, y + 4.93, z]);
    if (blink) {
      s.b.node('blink', [x, y + 5.1, z]);
      s.b.sphere('glow', 0.08);
      s.b.end();
    }
  }

  private sandbags(s: Site, x: number, z: number, len: number, rot: number) {
    const y = s.gy(x, z);
    s.b.node('_sb', [x, y, z], [0, rot, 0]);
    const n = Math.round(len / 0.55);
    for (let row = 0; row < 3; row++) for (let i = 0; i < n - row; i++) s.b.box('canvas', 0.55, 0.22, 0.4, [-len / 2 + 0.3 + i * 0.55 + row * 0.27, 0.11 + row * 0.21, 0], [0, 0, 0], 0.08);
    s.b.end();
    s.solid(x, y + 0.35, z, len, 0.7, 0.5, rot, 'dirt');
  }

  private tankTrap(s: Site, x: number, z: number) {
    const y = s.gy(x, z);
    s.b.node('_tt', [x, y + 0.6, z], [0, this.rng.range(0, 3), 0]);
    s.b.box('rust', 1.6, 0.18, 0.18, [0, 0, 0], [0.5, 0, 0.6]);
    s.b.box('rust', 1.6, 0.18, 0.18, [0, 0, 0], [-0.5, 1.2, 0.6]);
    s.b.box('rust', 1.6, 0.18, 0.18, [0, 0, 0], [0, 2.2, -0.9]);
    s.b.end();
    s.solid(x, y + 0.6, z, 1.2, 1.2, 1.2, 0, 'metal');
  }

  private fence(s: Site, pts: [number, number][], hgt = 2.4, slot: Slot = 'rust') {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / 3));
      const rot = Math.atan2(-(bz - az), bx - ax);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const y = s.gy(x, z);
        const variant = (k + i) % 4;
        s.b.node('_fp', [x, y, z], [0, rot, noise.noise2(x, z) * 0.06]);
        if (variant === 0) s.b.box('paint', len / n, hgt * 0.9, 0.08, [0, hgt * 0.45, 0], [0, 0, 0], 0.01);
        else if (variant === 1) s.b.box(slot, len / n, hgt, 0.06, [0, hgt / 2, 0], [0, 0, 0], 0.01);
        else if (variant === 2) {
          s.b.box('dark', 0.1, hgt, 0.1, [-len / n / 2, hgt / 2, 0]);
          s.b.grille('metal', len / n, hgt * 0.9, 8, [0, hgt * 0.47, 0], 0.03, [0, 0, 0]);
        } else s.b.box('wood', len / n, hgt * 0.8, 0.1, [0, hgt * 0.4, 0], [0, 0, 0.02], 0.01);
        s.b.end();
        s.solid(x, y + hgt / 2, z, len / n, hgt, 0.3, rot, 'metal');
      }
    }
  }

  // ------------------------------------------------------------------ HOME
  private buildHome() {
    const home = getLocation('home');
    const s = this.site(home.x, home.z);
    const mats = this.mats.home;
    // Garage shed: 26 x 20, door facing north (-Z)
    const W = 26;
    const D = 20;
    const H = 7.5;
    const gz = 0;
    s.b.box('paint', W, H, 0.3, [0, H / 2, gz + D / 2], [0, 0, 0], 0.02);
    for (const sx of [-1, 1]) s.b.box(sx < 0 ? 'rust' : 'paint', 0.3, H, D, [(sx * W) / 2, H / 2, gz], [0, 0, 0], 0.02);
    s.b.box('paint', W / 2 - 6, H, 0.3, [-(W / 4 + 3), H / 2, gz - D / 2], [0, 0, 0], 0.02);
    s.b.box('paint', W / 2 - 6, H, 0.3, [W / 4 + 3, H / 2, gz - D / 2], [0, 0, 0], 0.02);
    s.b.box('paint', 12, H - 5.8, 0.3, [0, 5.8 + (H - 5.8) / 2, gz - D / 2]);
    // pitched roof
    s.b.box('metal', W + 1, 0.12, D / 2 + 1.2, [0, H + 1.1, gz - D / 4], [0.2, 0, 0], 0.01);
    s.b.box('metal', W + 1, 0.12, D / 2 + 1.2, [0, H + 1.1, gz + D / 4], [-0.2, 0, 0], 0.01);
    s.b.box('paint2', W + 1.2, 0.35, 0.35, [0, H + 2.15, gz]);
    // corrugation ribs on the walls
    for (let i = 0; i < 40; i++) {
      s.b.box('dark', 0.05, H, 0.05, [-W / 2 + 0.3 + i * 0.65, H / 2, gz + D / 2 + 0.17]);
      if (Math.abs(-W / 2 + 0.3 + i * 0.65) > 6.2) s.b.box('dark', 0.05, H, 0.05, [-W / 2 + 0.3 + i * 0.65, H / 2, gz - D / 2 - 0.17]);
    }
    // door frame + roll-up door (half open) + hazard stripes
    s.b.box('paint2', 12.3, 0.45, 0.5, [0, 5.85, gz - D / 2 - 0.1]);
    s.b.cylX('dark', 0.38, 12, [0, 6.35, gz - D / 2 - 0.35], 16);
    s.b.hazardPanel(0.35, 5.6, 0.4, [-6.1, 2.8, gz - D / 2 - 0.1]);
    s.b.hazardPanel(0.35, 5.6, 0.4, [6.1, 2.8, gz - D / 2 - 0.1]);
    // interior darkness plane behind the door
    s.b.box('dark', 11.8, 5.6, 0.1, [0, 2.8, gz - D / 2 + 2]);
    // sign
    s.b.box('dark', 7, 1.4, 0.2, [0, H + 0.2, gz - D / 2 - 0.6]);
    s.b.box('glow', 6.4, 0.12, 0.05, [0, H + 0.2, gz - D / 2 - 0.72]);
    s.b.box('lamp', 0.5, 0.2, 0.3, [-4.5, 6.6, gz - D / 2 - 0.5]);
    s.b.box('lamp', 0.5, 0.2, 0.3, [4.5, 6.6, gz - D / 2 - 0.5]);
    s.solid(0, H / 2, gz + D / 2, W, H, 0.6);
    s.solid(-W / 2, H / 2, gz, 0.6, H, D);
    s.solid(W / 2, H / 2, gz, 0.6, H, D);
    s.solid(-(W / 4 + 3), H / 2, gz - D / 2, W / 2 - 6, H, 0.6);
    s.solid(W / 4 + 3, H / 2, gz - D / 2, W / 2 - 6, H, 0.6);
    s.solid(0, 1.0, gz, 11.5, 2, D - 3); // interior blocker so nobody drives inside
    // Yard: scrap piles, containers, crane, bus, tyres, fence
    this.scrapPile(s, -26, -8, 4);
    this.scrapPile(s, -30, 10, 5);
    this.scrapPile(s, 24, 14, 3.5);
    this.scrapPile(s, -18, 22, 3);
    this.container(s, -22, s.gy(-22, -22), -22, 0.3, 'paint2');
    this.container(s, -20, s.gy(-20, -22) + 2.6, -22.5, 0.35, 'rust');
    this.container(s, 26, s.gy(26, -4), -4, PI / 2 + 0.1, 'paint2');
    this.tires(s, 16, -16, 4);
    this.barrels(s, 18, 4, 7);
    this.carWreck(s, -12, -30, 0.8, 'paint2');
    this.carWreck(s, 34, -24, 2.2, 'rust', true);
    this.carWreck(s, -36, -18, 1.4, 'paint');
    // old bus
    const bx = -32;
    const bz = -36;
    s.b.node('_bus', [bx, s.gy(bx, bz) + 0.4, bz], [0, 0.4, 0.04]);
    s.b.box('paint2', 2.5, 2.6, 10, [0, 1.6, 0], [0, 0, 0], 0.2);
    for (let i = 0; i < 7; i++) s.b.box('glass', 2.55, 0.8, 1.0, [0, 2.2, -4 + i * 1.3], [0, 0, 0], 0.02);
    s.b.cylX('rubber', 0.5, 2.4, [0, 0.2, -3], 16);
    s.b.cylX('rubber', 0.5, 2.4, [0, 0.2, 3.2], 16);
    s.b.end();
    s.solid(bx, s.gy(bx, bz) + 1.6, bz, 2.6, 3.2, 10.2, 0.4, 'metal');
    // yard crane
    const cx = 30;
    const cz = 22;
    const cy = s.gy(cx, cz);
    s.b.node('_crane', [cx, cy, cz], [0, -0.6, 0]);
    s.b.box('hazard', 3, 1, 3, [0, 0.5, 0], [0, 0, 0], 0.05);
    s.b.box('paint', 0.7, 12, 0.7, [0, 7, 0]);
    for (let k = 0; k < 12; k++) s.b.box('dark', 0.9, 0.06, 0.06, [0, 1.5 + k, 0.36], [0, 0, k % 2 ? 0.6 : -0.6]);
    s.b.box('paint', 14, 0.6, 0.6, [4, 13, 0]);
    s.b.box('dark', 1.6, 1.2, 1.4, [-2.2, 13.2, 0]);
    s.b.cyl('dark', 0.02, 7, [9.5, 9.5, 0], [0, 0, 0], 4);
    s.b.box('rust', 2.2, 1.0, 1.2, [9.5, 5.6, 0], [0, 0.4, 0], 0.05);
    s.b.end();
    s.solid(cx, cy + 6, cz, 1.2, 12, 1.2);
    // fence around the yard with a gap north
    const fr = 46;
    const pts: [number, number][] = [];
    for (let i = 0; i <= 24; i++) {
      const a = -PI / 2 + 0.35 + (i / 24) * (PI * 2 - 0.7);
      pts.push([Math.cos(a) * fr, Math.sin(a) * fr * 0.95]);
    }
    this.fence(s, pts);
    // Test range (east): berm, targets stands, sign
    const rx = 70;
    for (let i = 0; i < 4; i++) {
      const tz = -26 + i * 14;
      const tx = rx + 22 + (i % 2) * 6;
      this.rangeTargets.push(new THREE.Vector3(home.x + tx, 0, home.z + tz));
    }
    s.b.node('_berm', [rx + 38, s.gy(rx + 38, 0), 0]);
    s.b.box('canvas', 4, 4, 70, [0, 1.5, 0], [0, 0, 0.3], 0.5);
    s.b.end();
    s.solid(rx + 38, s.gy(rx + 38, 0) + 1.5, 0, 5, 4, 70);
    s.b.node('_rsign', [rx - 4, s.gy(rx - 4, -36), -36]);
    s.b.box('dark', 0.2, 3, 0.2, [0, 1.5, 0]);
    s.b.hazardPanel(3.2, 1.2, 0.1, [0, 3.2, 0]);
    s.b.end();
    // lamps
    this.lamppost(s, -9, -14);
    this.lamppost(s, 9, -14);
    this.lamppost(s, 40, 0);
    this.finish(s, mats, 'home');
    this.garageDoor.set(home.x, this.game.terrain.heightAt(home.x, home.z - D / 2 - 3), home.z - D / 2 - 3);
    this.garageSpawn.pos.set(home.x, 0, home.z - D / 2 - 20);
    this.garageSpawn.yaw = 0;
  }

  // ------------------------------------------------------------------ RUSTWATER
  private buildRustwater() {
    const L = getLocation('rustwater');
    const s = this.site(L.x, L.z);
    // container wall ring with gates on the highway (east/west)
    const colors: Slot[] = ['paint', 'paint2', 'rust'];
    const R = 70;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * PI * 2;
      if (Math.abs(Math.sin(a)) < 0.18) continue; // gates E/W along the highway
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R * 0.8;
      this.container(s, x, s.gy(x, z), z, -a + PI / 2, colors[i % 3]);
      if (i % 3 === 0) this.container(s, x, s.gy(x, z) + 2.6, z, -a + PI / 2 + 0.05, colors[(i + 1) % 3]);
    }
    // central pump derrick
    s.b.node('_pump', [0, s.gy(0, -20), -20]);
    for (const [dx, dz] of [[-3, -3], [3, -3], [3, 3], [-3, 3]] as [number, number][]) s.b.box('dark', 0.4, 18, 0.4, [dx * 0.6, 9, dz * 0.6], [dz * 0.05, 0, -dx * 0.05]);
    for (let k = 1; k < 6; k++) s.b.box('dark', 4 - k * 0.3, 0.15, 0.15, [0, k * 3, -1.8 + k * 0.15]);
    s.b.box('paint', 2, 2, 6, [0, 17, 0], [0, 0, 0.1], 0.05);
    s.b.cyl('rust', 1.5, 2, [0, 1, 0], [0, 0, 0], 20);
    s.b.node('blink', [0, 19, 0]);
    s.b.sphere('glow', 0.18);
    s.b.end();
    s.b.end();
    s.solid(0, s.gy(0, -20) + 9, -20, 4, 18, 4);
    this.waterTower(s, 24, -30, 14, 'paint2');
    // market: stalls with awnings along the highway
    for (let i = 0; i < 8; i++) {
      const x = -40 + i * 11;
      const z = i % 2 ? 16 : -14;
      const y = s.gy(x, z);
      s.b.node('_stall', [x, y, z], [0, i % 2 ? PI : 0, 0]);
      s.b.box('wood', 4, 1, 1.5, [0, 0.5, 0], [0, 0, 0], 0.02);
      for (const dx of [-1.9, 1.9]) s.b.box('dark', 0.1, 3, 0.1, [dx, 1.5, -0.7]);
      s.b.box(i % 3 === 0 ? 'paint2' : i % 3 === 1 ? 'canvas' : 'paint', 4.4, 0.05, 2.4, [0, 3, 0.1], [0.25, 0, 0]);
      for (let k = 0; k < 4; k++) s.b.box(this.rng.pick(['metal', 'rust', 'paint2', 'dark'] as Slot[]), 0.5, 0.3, 0.4, [-1.4 + k * 0.9, 1.15, 0], [0, k, 0], 0.03);
      s.b.end();
      s.solid(x, y + 1, z, 4, 2, 1.6, 0, 'wood');
    }
    // shacks
    const shacks: [number, number, number][] = [
      [-30, 36, 0.2],
      [-14, 40, -0.1],
      [8, 38, 0.1],
      [30, 34, -0.2],
      [-38, -34, 0.3],
      [-20, -40, 0],
      [36, -40, -0.3],
    ];
    for (const [x, z, r] of shacks) this.shack(s, x, z, this.rng.range(5, 8), this.rng.range(4, 6), this.rng.range(2.8, 3.6), r, this.rng.pick(['rust', 'paint', 'paint2'] as Slot[]));
    this.barrels(s, 12, -4, 6);
    this.tires(s, -6, 26, 3);
    for (const [x, z] of [[-24, 0], [0, 6], [24, 0], [0, -46], [0, 46]] as [number, number][]) this.lamppost(s, x, z, true);
    // big sign
    s.b.node('_sign', [-60, s.gy(-60, 0), 6]);
    s.b.box('dark', 0.3, 7, 0.3, [-3, 3.5, 0]);
    s.b.box('dark', 0.3, 7, 0.3, [3, 3.5, 0]);
    s.b.box('paint2', 7.5, 2.2, 0.2, [0, 6.8, 0], [0, 0, 0.03], 0.02);
    s.b.box('glow', 6.8, 0.15, 0.1, [0, 6, -0.12]);
    s.b.end();
    this.finish(s, this.mats.settle, 'rustwater');
    this.addInteraction('rustwater_market', L.x - 18, L.z - 14, 10, 'Trade at the Rustwater Salvage Market', (app) => app.merchant.show('rustwater'));
    this.addInteraction('rustwater_board', L.x + 6, L.z - 16, 10, 'Contract board', (app) => app.journal.show('board'));
  }

  private addInteraction(id: string, x: number, z: number, radius: number, label: string, action: (app: App) => void) {
    this.interactions.push({ id, pos: new THREE.Vector3(x, this.game.terrain.heightAt(x, z), z), radius, label, action });
  }

  interactionAt(pos: THREE.Vector3): InteractionPoint | null {
    for (const i of this.interactions) if (Math.hypot(i.pos.x - pos.x, i.pos.z - pos.z) < i.radius) return i;
    return null;
  }

  // ------------------------------------------------------------------ DUST HOLLOW
  private buildDustHollow() {
    const L = getLocation('dusthollow');
    const s = this.site(L.x, L.z);
    // fuel station canopy
    s.b.node('_fuel', [8, s.gy(8, -10), -10]);
    for (const [dx, dz] of [[-5, -3], [5, -3], [-5, 3], [5, 3]] as [number, number][]) s.b.box('paint2', 0.4, 5, 0.4, [dx, 2.5, dz]);
    s.b.box('paint', 12, 0.6, 8, [0, 5.2, 0], [0, 0, 0], 0.05);
    s.b.box('glow', 11.6, 0.1, 0.1, [0, 4.85, -3.95]);
    for (const dx of [-2.5, 2.5]) {
      s.b.box('paint2', 0.8, 1.8, 0.6, [dx, 0.9, 0], [0, 0, 0], 0.08);
      s.b.box('glass', 0.5, 0.35, 0.05, [dx, 1.4, 0.31]);
    }
    s.b.end();
    s.solid(8 - 5, s.gy(8, -10) + 2.5, -13, 0.5, 5, 0.5);
    s.solid(8 + 5, s.gy(8, -10) + 2.5, -13, 0.5, 5, 0.5);
    // tents
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2 + 0.4;
      const x = Math.cos(a) * 28;
      const z = Math.sin(a) * 22 + 10;
      const y = s.gy(x, z);
      s.b.node('_tent', [x, y, z], [0, -a, 0]);
      s.b.extrude('canvas', [[-2.5, 0], [2.5, 0], [0, 2.6]], 5, [0, 0, 0], [0, 0, 0], 0.02);
      s.b.box('dark', 0.08, 2.8, 0.08, [0, 1.4, 2.5]);
      s.b.end();
      s.solid(x, y + 1.2, z, 5, 2.4, 5, -a, 'wood');
    }
    this.shack(s, -18, -16, 7, 5, 3.2, 0.3, 'rust');
    this.shack(s, -8, 26, 6, 5, 3, -0.2, 'paint');
    this.scrapPile(s, 30, 24, 3.5);
    this.barrels(s, 18, 2, 5);
    this.carWreck(s, -30, 4, 1.1, 'rust');
    this.waterTower(s, -26, -24, 10, 'rust');
    for (const [x, z] of [[0, -20], [20, 10], [-20, 10]] as [number, number][]) this.lamppost(s, x, z, true);
    this.finish(s, this.mats.scrap, 'dusthollow');
    this.addInteraction('dusthollow_trader', L.x + 8, L.z - 10, 11, 'Trade with the Dust Hollow scavengers', (app) => app.merchant.show('dusthollow'));
  }

  // ------------------------------------------------------------------ FOUNDRY
  private buildFoundry() {
    const L = getLocation('foundry');
    const s = this.site(L.x, L.z);
    // three ruined halls
    const halls: [number, number, number, number, number][] = [
      [-50, -30, 60, 30, 0.1],
      [30, -50, 44, 26, -0.15],
      [10, 40, 56, 24, 0.05],
    ];
    for (const [x, z, w, d, r] of halls) {
      const [c, sn] = [Math.cos(r), Math.sin(r)];
      const corner = (lx: number, lz: number): [number, number] => [x + lx * c + lz * sn, z - lx * sn + lz * c];
      const hH = 12;
      const [ax, az] = corner(0, -d / 2);
      this.ruinWall(s, ax, az, w, hH, r);
      const [bx, bz] = corner(0, d / 2);
      this.ruinWall(s, bx, bz, w, hH, r);
      const [cx2, cz2] = corner(-w / 2, 0);
      this.ruinWall(s, cx2, cz2, d, hH, r + PI / 2, 'paint', false);
      const [dx2, dz2] = corner(w / 2, 0);
      this.ruinWall(s, dx2, dz2, d * 0.5, hH * 0.6, r + PI / 2, 'paint', false);
      // roof trusses, partly collapsed
      for (let i = 0; i < w / 6; i++) {
        const [tx, tz] = corner(-w / 2 + 3 + i * 6, 0);
        const y = s.gy(tx, tz);
        const fallen = noise.noise2(tx * 0.3, tz * 0.3) > 0.2;
        s.b.node('_truss', [tx, y + (fallen ? 1.5 : hH), tz], [fallen ? 0.6 : 0, r + PI / 2, fallen ? 0.4 : 0]);
        s.b.box('rust', d, 0.4, 0.3, [0, 0, 0]);
        s.b.box('rust', d * 0.52, 0.3, 0.3, [-d / 4, 1.2, 0], [0, 0, 0.18]);
        s.b.box('rust', d * 0.52, 0.3, 0.3, [d / 4, 1.2, 0], [0, 0, -0.18]);
        s.b.end();
      }
      this.rubble(s, x, z, 18, Math.min(w, d) * 0.4, 'paint');
    }
    this.smokestack(s, -10, -70, 42, 2.4);
    this.smokestack(s, 4, -74, 36, 2.0);
    this.smokestack(s, 60, 10, 30, 1.8);
    this.tank(s, 60, -20, 6, 9);
    this.tank(s, 74, -2, 5, 8, 'rust');
    this.tank(s, -80, 20, 7, 11);
    // conveyor gantry
    for (let i = 0; i < 8; i++) {
      const x = -70 + i * 9;
      const z = 60 + i * 2;
      const y = s.gy(x, z);
      s.b.box('dark', 0.5, 8 + i * 0.6, 0.5, [x, y + (8 + i * 0.6) / 2, z]);
      s.solid(x, y + 4, z, 0.6, 8, 0.6);
    }
    s.b.box('rust', 66, 1.2, 2, [-38, s.gy(-38, 67) + 11, 67], [0, -0.22, 0.09], 0.05);
    // pipes
    s.b.pipe('rust', [[-60, s.gy(-60, -60) + 3, -60], [-20, s.gy(-20, -62) + 5, -62], [20, s.gy(20, -60) + 3, -58], [60, s.gy(60, -40) + 4, -40]], 0.8, 40, 12);
    // scrapper camp barricades
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * PI * 2;
      const x = Math.cos(a) * 100;
      const z = Math.sin(a) * 90;
      if (i % 3 === 0) this.tankTrap(s, x, z);
      else this.carWreck(s, x, z, a + PI / 2, i % 2 ? 'rust' : 'paint2', i % 4 === 1);
    }
    this.scrapPile(s, 30, 0, 5);
    this.scrapPile(s, -20, 10, 4);
    this.finish(s, this.mats.concrete, 'foundry');
  }

  // ------------------------------------------------------------------ PIT
  private buildPit() {
    const s = this.site(PIT.x, PIT.z);
    // rusted mining machinery around the rim
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2 + 0.5;
      const x = Math.cos(a) * (PIT.radius + 12);
      const z = Math.sin(a) * (PIT.radius + 12);
      if (i % 2) this.tank(s, x, z, 3, 6, 'rust');
      else this.shack(s, x, z, 8, 6, 4, a, 'rust');
    }
    // conveyor down into the pit
    for (let i = 0; i < 7; i++) {
      const x = -PIT.radius + 10 + i * 12;
      const z = 40;
      const y = s.gy(x, z);
      s.b.box('dark', 0.5, 6, 0.5, [x, y + 3, z]);
    }
    s.b.box('rust', 80, 1, 2.2, [-PIT.radius + 46, s.gy(-60, 40) + 4, 40], [0, 0, -0.25], 0.05);
    // floodlight towers
    for (const [x, z] of [[40, 40], [-40, -40], [50, -30]] as [number, number][]) {
      const y = s.gy(x, z);
      s.b.box('dark', 0.4, 14, 0.4, [x, y + 7, z]);
      s.b.box('dark', 3, 1, 0.5, [x, y + 14, z]);
      s.b.box('lamp', 2.6, 0.6, 0.1, [x, y + 14, z - 0.3]);
      s.solid(x, y + 7, z, 0.5, 14, 0.5);
    }
    // a derelict bucket-wheel excavator parked on the lowest bench: the Excavator's dead sibling
    this.bucketWheelWreck(s, 58, -34, -2.3);
    // an abandoned haul truck on a bench
    this.haulTruck(s, -52, -78, 0.9);
    this.finish(s, this.mats.scrap, 'pit');
  }

  private bucketWheelWreck(s: Site, x: number, z: number, rot: number) {
    const y = s.gy(x, z);
    const b = s.b;
    b.node('_bwe', [x, y, z], [0, rot, 0]);
    // crawlers
    for (const cx of [-4.5, 4.5]) {
      b.box('dark', 3.2, 2.6, 15, [cx, 1.3, 0], [0, 0, 0], 0.2);
      for (let k = 0; k < 6; k++) b.cylX('rubber', 1.0, 3.3, [cx, 1.1, -6 + k * 2.4], 14);
    }
    // turntable and superstructure
    b.cyl('rust', 6, 1.2, [0, 3.2, 0], [0, 0, 0], 28);
    b.box('paint', 11, 6, 13, [0, 6.8, 1], [0, 0, 0], 0.2);
    b.box('rust', 9, 4, 7, [0, 11.8, 3], [0, 0, 0], 0.15);
    b.grille('dark', 7, 2, 10, [0, 11.8, 6.55], 0.1);
    for (let k = 0; k < 4; k++) b.box('dark', 0.9, 0.6, 1.2, [-3 + k * 2, 14, 3], [0, 0, 0], 0.05);
    b.hazardPanel(11.1, 0.8, 0.2, [0, 4.4, -5.5]);
    // mast and stay cables
    b.box('dark', 1.2, 14, 1.2, [0, 17, 0], [0.12, 0, 0], 0.05);
    b.box('dark', 0.2, 0.2, 30, [0, 17, -12], [-0.42, 0, 0]);
    b.box('dark', 0.2, 0.2, 18, [0, 16, 9], [0.62, 0, 0]);
    // main boom reaching out toward the bench face, bucket wheel at its tip
    b.node('_boom', [0, 9, -5], [0.28, 0, 0]);
    b.box('paint', 2.4, 2.4, 34, [0, 0, -17], [0, 0, 0], 0.1);
    for (let k = 0; k < 8; k++) b.box('dark', 2.6, 0.2, 0.2, [0, 1.3, -3 - k * 4], [0, 0, 0]);
    b.node('_wheel', [0, 0, -35], [0, 0, 0]);
    b.torus('rust', 6, 0.5, [0, 0, 0], [0, PI / 2, 0], 32);
    b.torus('rust', 6, 0.5, [0, 0, 0], [0, PI / 2, 0], 32);
    b.cylX('dark', 1.2, 2.6, [0, 0, 0], 16);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * PI * 2;
      b.box('rust', 2.2, 1.6, 1.8, [0, Math.cos(a) * 6.4, Math.sin(a) * 6.4], [a, 0, 0], 0.1);
      b.box('dark', 0.15, 5.6, 0.3, [0, Math.cos(a) * 3, Math.sin(a) * 3], [a, 0, 0]);
    }
    b.end();
    b.end();
    // counterweight boom
    b.node('_cw', [0, 10, 6], [-0.1, 0, 0]);
    b.box('paint', 2, 2, 16, [0, 0, 8], [0, 0, 0], 0.1);
    b.box('dark', 5, 4, 4, [0, -1, 16], [0, 0, 0], 0.15);
    b.end();
    b.end();
    s.solid(x, y + 5, z, 12, 10, 15, rot, 'metal');
  }

  private haulTruck(s: Site, x: number, z: number, rot: number) {
    const y = s.gy(x, z);
    const b = s.b;
    b.node('_haul', [x, y, z], [0, rot, 0.06]);
    b.box('dark', 4.6, 1.2, 10, [0, 2.2, 0], [0, 0, 0], 0.1);
    b.box('paint', 5.6, 3.2, 6.5, [0, 4.6, 1.6], [-0.18, 0, 0], 0.15);
    b.box('rust', 5.2, 0.3, 6, [0, 6.3, 1.4], [-0.18, 0, 0]);
    b.box('paint', 2.4, 2.4, 2.6, [-1.4, 4.2, -3.4], [0, 0, 0], 0.1);
    b.box('glass', 2.0, 0.9, 0.1, [-1.4, 4.7, -4.72], [0, 0, 0]);
    b.box('dark', 5.4, 0.8, 0.9, [0, 2.8, -4.6], [0, 0, 0], 0.05);
    for (const [dx, dz] of [[-2.6, -3.2], [2.6, -3.2], [-2.6, 3.3], [2.6, 3.3]] as [number, number][]) {
      b.cylX('rubber', 1.45, 1.1, [dx, 1.45, dz], 20);
      b.cylX('metal', 0.7, 1.15, [dx, 1.45, dz], 12);
    }
    b.hazardPanel(4.7, 0.3, 0.1, [0, 2.3, -5.05]);
    b.end();
    s.solid(x, y + 3, z, 5.6, 6, 10, rot, 'metal');
  }

  // ------------------------------------------------------------------ FORT
  private buildFort() {
    const L = getLocation('fort');
    const s = this.site(L.x, L.z);
    const R = 110;
    // perimeter concrete walls with a gate on the south (road)
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * PI * 2;
      if (Math.abs(a - PI / 2) < 0.14) continue;
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R;
      const y = s.gy(x, z);
      s.b.node('_fw', [x, y, z], [0, -a + PI / 2, 0]);
      s.b.box('paint', 25, 5, 1.2, [0, 2.5, 0], [0, 0, 0], 0.05);
      s.b.box('dark', 25, 0.3, 1.4, [0, 5.1, 0]);
      for (let k = 0; k < 8; k++) s.b.box('dark', 0.05, 0.05, 1.3, [-12 + k * 3.4, 5.4, 0]);
      s.b.end();
      s.solid(x, y + 2.5, z, 25, 5, 1.4, -a + PI / 2);
      if (i % 4 === 0) {
        // watchtower
        const tx = Math.cos(a) * (R - 4);
        const tz = Math.sin(a) * (R - 4);
        const ty = s.gy(tx, tz);
        s.b.node('_tower', [tx, ty, tz]);
        for (const [dx, dz] of [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]] as [number, number][]) s.b.box('dark', 0.3, 10, 0.3, [dx, 5, dz]);
        s.b.box('paint2', 4.4, 2.4, 4.4, [0, 11, 0], [0, 0, 0], 0.05);
        s.b.box('glass', 4.5, 0.6, 4.5, [0, 11.6, 0]);
        s.b.box('dark', 5, 0.3, 5, [0, 12.4, 0]);
        s.b.box('lamp', 0.6, 0.4, 0.4, [0, 12.2, -2.3]);
        s.b.node('blink', [0, 12.8, 0]);
        s.b.sphere('glow', 0.12);
        s.b.end();
        s.b.end();
        s.solid(tx, ty + 6, tz, 4.4, 12, 4.4);
      }
    }
    // hangars (half cylinders)
    for (const [x, z, r] of [[-40, -30, 0.2], [30, -40, -0.1]] as [number, number, number][]) {
      const y = s.gy(x, z);
      s.b.node('_hangar', [x, y, z], [0, r, 0]);
      s.b.add('paint', new THREE.CylinderGeometry(10, 10, 30, 24, 1, true, 0, PI).rotateZ(PI / 2).rotateY(PI / 2), [0, 0, 0]);
      s.b.box('dark', 20, 9.8, 0.3, [0, 4.9, -15], [0, 0, 0], 0.02);
      s.b.box('paint2', 12, 7, 0.4, [0, 3.5, -15.2]);
      for (let k = 0; k < 10; k++) s.b.torus('dark', 10.05, 0.1, [0, 0, -14 + k * 3.1], [0, 0, 0], 24, PI);
      s.b.end();
      s.solid(x, y + 4, z, 20, 8, 30, r);
    }
    // bunkers
    for (const [x, z] of [[30, 30], [-30, 40], [0, -70], [60, 0]] as [number, number][]) {
      const y = s.gy(x, z);
      s.b.node('_bunker', [x, y, z], [0, this.rng.range(0, 3), 0]);
      s.b.box('paint', 10, 3.2, 8, [0, 1.3, 0], [0, 0, 0], 0.4);
      s.b.box('dark', 6, 0.5, 0.3, [0, 2.2, 4.05]);
      s.b.end();
      s.solid(x, y + 1.3, z, 10, 3.2, 8);
    }
    // radar dish tower
    s.b.node('_radar', [0, s.gy(0, 10), 10]);
    s.b.box('dark', 1.4, 14, 1.4, [0, 7, 0]);
    s.b.node('radarDish', [0, 15, 0], [0.4, 0, 0]);
    s.b.lathe('white', [[0, 0], [2, 0.4], [4.5, 1.6], [5, 2.0], [4.9, 2.1], [0, 0.3]], [0, 0, 0], [0, 0, 0], 28);
    s.b.cyl('dark', 0.1, 4, [0, 2, 0], [0, 0, 0], 6);
    s.b.end();
    s.b.end();
    s.solid(0, s.gy(0, 10) + 7, 10, 1.6, 14, 1.6);
    // sandbags, tank traps, parked wrecks
    for (let i = 0; i < 10; i++) this.sandbags(s, this.rng.range(-70, 70), this.rng.range(-70, 70), this.rng.range(3, 6), this.rng.range(0, 3));
    for (let i = 0; i < 14; i++) {
      const a = this.rng.range(0, PI * 2);
      this.tankTrap(s, Math.cos(a) * (R + 14), Math.sin(a) * (R + 14));
    }
    for (const [x, z] of [[-60, 40], [50, 50]] as [number, number][]) this.lamppost(s, x, z, true);
    this.finish(s, this.mats.military, 'fort');
  }

  // ------------------------------------------------------------------ AIRLINER
  private buildAirliner() {
    const L = getLocation('airliner');
    const s = this.site(L.x, L.z);
    const segs: [number, number, number, number, number, number][] = [
      [0, 0, 18, 0.3, -0.08, 0.05],
      [22, -8, 16, 0.5, 0.1, -0.1],
      [-18, 10, 12, -0.2, -0.2, 0.15],
    ];
    for (const [x, z, len, rot, pitch, roll] of segs) {
      const y = s.gy(x, z) + 1.2;
      s.b.node('_fus', [x, y, z], [pitch, rot, roll]);
      s.b.add('white', new THREE.CylinderGeometry(3, 3, len, 28, 1, true).rotateX(PI / 2));
      for (let i = 0; i < len / 1.2; i++) s.b.box('glass', 0.05, 0.4, 0.3, [2.97, 1, -len / 2 + 0.6 + i * 1.2]);
      for (let k = 0; k < len / 3; k++) s.b.torus('metal', 3.02, 0.06, [0, 0, -len / 2 + k * 3], [0, 0, 0], 28);
      s.b.box('paint2', 0.1, 0.5, len, [2.95, 0.3, 0]);
      s.b.end();
      s.solidCyl(x, y, z, 2.8, len, 'metal');
      s.solid(x, y, z, 5.6, 5.6, len, rot, 'metal');
    }
    // wing and tail
    s.b.node('_wing', [10, s.gy(10, 12) + 0.4, 12], [0.05, 0.4, -0.12]);
    s.b.box('white', 26, 0.5, 6, [0, 0, 0], [0, 0, 0], 0.1);
    s.b.cyl('metal', 1.4, 4, [-6, -1.2, -1], [PI / 2, 0, 0], 20);
    s.b.end();
    s.solid(10, s.gy(10, 12) + 0.4, 12, 26, 1, 6, 0.4, 'metal');
    s.b.node('_tail', [-28, s.gy(-28, 16) + 3, 16], [0, -0.2, 0.3]);
    s.b.extrude('paint2', [[0, 0], [8, 0], [7, 8], [4, 8]], 0.4, [0, 0, 0], [0, 0, 0], 0.05);
    s.b.end();
    this.rubble(s, 0, 0, 30, 30, 'white');
    this.finish(s, this.mats.settle, 'airliner');
  }

  private buildGunshipWreck() {
    const L = getLocation('gunship');
    const s = this.site(L.x, L.z);
    s.b.node('_heli', [0, s.gy(0, 0) + 1.2, 0], [0.3, 0.8, 0.5]);
    s.b.profile('paint', [[-2.2, -0.3], [-1.2, -0.7], [1.6, -0.7], [1.9, 0.6], [-0.6, 0.9], [-2, 0.3]], 1.3, [0, 0, 0], 0.05);
    s.b.cylZ('paint', 0.3, 4, [0, 0.5, 3.6], 12, 0.14);
    s.b.box('dark', 0.2, 0.1, 7, [0.5, 1.3, 0], [0, 0.4, 0.2]);
    s.b.box('dark', 0.2, 0.1, 5, [-1.5, 0.2, -1], [0.3, -0.8, 0.8]);
    s.b.end();
    s.solid(0, s.gy(0, 0) + 1.2, 0, 3, 2.5, 7, 0.8, 'metal');
    this.rubble(s, 0, 0, 12, 8, 'paint');
    this.finish(s, this.mats.military, 'gunship');
  }

  private buildHelix() {
    const L = getLocation('helix');
    const s = this.site(L.x, L.z);
    const y = s.gy(0, 0);
    s.b.box('white', 22, 6, 14, [0, y + 3, 0], [0, 0, 0], 1.0);
    s.b.box('glass', 20, 1.2, 0.2, [0, y + 4, 7.05]);
    s.b.box('glow', 22.2, 0.12, 14.2, [0, y + 0.6, 0]);
    s.b.box('white', 8, 3, 8, [14, y + 1.5, -6], [0, 0.3, 0], 0.6);
    s.b.cyl('white', 0.4, 18, [-8, y + 9, -4], [0, 0, 0], 12);
    s.b.node('radarDish', [-8, y + 18, -4], [0.6, 0, 0]);
    s.b.lathe('white', [[0, 0], [1.5, 0.3], [3, 1.1], [3.2, 1.3], [0, 0.2]], [0, 0, 0], [0, 0, 0], 24);
    s.b.end();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * PI * 2;
      const px = Math.cos(a) * 30;
      const pz = Math.sin(a) * 26;
      const py = s.gy(px, pz);
      s.b.cyl('white', 0.25, 4, [px, py + 2, pz], [0, 0, 0], 10);
      s.b.box('glow', 0.1, 3.4, 0.1, [px, py + 2, pz]);
      s.solidCyl(px, py + 2, pz, 0.3, 4);
    }
    s.solid(0, y + 3, 0, 22, 6, 14);
    s.solid(14, y + 1.5, -6, 8, 3, 8, 0.3);
    this.finish(s, this.mats.helix, 'helix');
  }

  private buildRadioHill() {
    const L = getLocation('radiotower');
    const s = this.site(L.x, L.z);
    const y = s.gy(0, 0);
    const H = 48;
    for (let k = 0; k < 16; k++) {
      const yy = (k / 16) * H;
      const w = 3.2 * (1 - k / 18);
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][]) s.b.box('paint2', 0.14, H / 16 + 0.1, 0.14, [dx * w / 2, y + yy + H / 32, dz * w / 2]);
      s.b.box('dark', w, 0.08, 0.08, [0, y + yy, -w / 2], [0, 0, (k % 2 ? 1 : -1) * 0.3]);
      s.b.box('dark', w, 0.08, 0.08, [0, y + yy, w / 2], [0, 0, (k % 2 ? -1 : 1) * 0.3]);
    }
    s.b.node('blink', [0, y + H + 0.4, 0]);
    s.b.sphere('glow', 0.35);
    s.b.end();
    s.solid(0, y + H / 2, 0, 3.4, H, 3.4);
    this.shack(s, 7, 4, 5, 4, 2.8, 0.4, 'paint');
    this.finish(s, this.mats.red, 'radio');
    this.mats.red.glowMat.emissive.set('#ff2a1a');
  }

  private buildOverpass() {
    const L = getLocation('overpass');
    const s = this.site(L.x, L.z);
    const deckY = 9;
    // bridge crossing the highway north-south
    for (let i = -4; i <= 4; i++) {
      const z = i * 12;
      if (i === 0 || i === 1) continue; // collapsed middle span
      const y = s.gy(0, z);
      s.b.box('paint', 12, 1.2, 12.2, [0, y + deckY, z], [0, 0, 0], 0.05);
      s.b.box('dark', 12.4, 0.8, 0.3, [0, y + deckY + 0.9, z - 6]);
      s.b.box('paint', 0.4, 1, 12, [-6, y + deckY + 1.1, z]);
      s.b.box('paint', 0.4, 1, 12, [6, y + deckY + 1.1, z]);
      s.b.box('paint', 1.6, deckY, 1.6, [-3.5, y + deckY / 2, z]);
      s.b.box('paint', 1.6, deckY, 1.6, [3.5, y + deckY / 2, z]);
      s.solid(0, y + deckY, z, 12, 1.2, 12.2);
      s.solid(-3.5, y + deckY / 2, z, 1.6, deckY, 1.6);
      s.solid(3.5, y + deckY / 2, z, 1.6, deckY, 1.6);
    }
    // collapsed slab as a ramp
    const cy = s.gy(0, 6);
    s.b.node('_slab', [0, cy + 4.2, 6], [0.6, 0.1, 0.08]);
    s.b.box('paint', 12, 1.2, 14, [0, 0, 0], [0, 0, 0], 0.05);
    s.b.end();
    s.solid(0, cy + 4.2, 6, 12, 1.2, 14, 0.1, 'asphalt');
    this.rubble(s, 0, 6, 26, 10, 'paint');
    this.carWreck(s, 8, 20, 0.3, 'rust');
    this.carWreck(s, -9, -16, 2.6, 'paint2', true);
    this.finish(s, this.mats.concrete, 'overpass');
  }

  // ------------------------------------------------------------------ ROADSIDE
  private buildRoadside() {
    const hw = ROADS.find((r) => r.id === 'route9')!;
    const s = this.site(0, 0);
    const pts = hw.points;
    // power line along the highway
    let prev: THREE.Vector3 | null = null;
    let dist = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      for (let d = 0; d < len; d += 5) {
        dist += 5;
        if (dist % 45 !== 0) continue;
        const t = d / len;
        const x = ax + (bx - ax) * t + nx * 14;
        const z = az + (bz - az) * t + nz * 14;
        if (Math.abs(x) > 900) continue;
        const y = s.gy(x, z);
        const lean = noise.noise2(x * 0.1, z * 0.1) * 0.12;
        s.b.node('_pole', [x, y, z], [lean, Math.atan2(nx, nz), 0]);
        s.b.cyl('wood', 0.16, 10, [0, 5, 0], [0, 0, 0], 8);
        s.b.box('wood', 3.2, 0.16, 0.16, [0, 9.2, 0]);
        for (const dx of [-1.4, 0, 1.4]) s.b.cyl('glass', 0.06, 0.25, [dx, 9.4, 0], [0, 0, 0], 6);
        s.b.end();
        s.solidCyl(x, y + 5, z, 0.2, 10, 'wood');
        const top = new THREE.Vector3(x, y + 9.4, z);
        if (prev && prev.distanceTo(top) < 70) {
          const mid = prev.clone().lerp(top, 0.5);
          mid.y -= 1.5;
          s.b.pipe('dark', [[prev.x, prev.y, prev.z], [mid.x, mid.y, mid.z], [top.x, top.y, top.z]], 0.025, 8, 3);
        }
        prev = top;
      }
    }
    // abandoned cars & billboards
    const rng = new RNG(99);
    for (let i = 0; i < 26; i++) {
      const seg = rng.int(0, pts.length - 2);
      const [ax, az] = pts[seg];
      const [bx, bz] = pts[seg + 1];
      const t = rng.next();
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      const off = rng.range(-9, 9);
      const x = ax + (bx - ax) * t + nx * off;
      const z = az + (bz - az) * t + nz * off;
      if (Math.abs(x) > 880) continue;
      if (LOCATIONS.some((l) => Math.hypot(l.x - x, l.z - z) < l.radius * 0.8)) continue;
      this.carWreck(s, x, z, Math.atan2(bx - ax, bz - az) + rng.range(-0.6, 0.6), rng.pick(['rust', 'paint', 'paint2'] as Slot[]), rng.chance(0.15));
    }
    for (let i = 0; i < 5; i++) {
      const seg = 1 + i * 2;
      const [ax, az] = pts[seg];
      const x = ax + 22;
      const z = az - 18;
      const y = s.gy(x, z);
      s.b.node('_bb', [x, y, z], [0, 0.2 * i, 0]);
      s.b.box('dark', 0.4, 9, 0.4, [-3, 4.5, 0]);
      s.b.box('dark', 0.4, 9, 0.4, [3, 4.5, 0]);
      s.b.box('paint2', 10, 4.5, 0.25, [0, 9.5, 0], [0, 0, noise.noise2(i, 1) * 0.1], 0.02);
      s.b.box(i % 2 ? 'rust' : 'white', 9.2, 3.6, 0.1, [0, 9.5, 0.15]);
      s.b.end();
      s.solid(x, y + 4.5, z, 7, 9, 0.6, 0.2 * i);
    }
    this.finish(s, this.mats.scrap, 'roadside');
  }

  // ------------------------------------------------------------------ SCATTER
  private buildScatter() {
    const terrain = this.game.terrain;
    const rng = new RNG(1234);
    // Rock variants
    const rockGeos: THREE.BufferGeometry[] = [];
    const light = activeDetail < 1;
    const density = this.game.renderer.preset.scatterDensity;
    for (let v = 0; v < 6; v++) {
      const g = new THREE.IcosahedronGeometry(1, light ? 1 : 2);
      const pos = g.attributes.position as THREE.BufferAttribute;
      const p = new THREE.Vector3();
      const n = new Noise(300 + v);
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i);
        const d = 1 + n.fbm3(p.x * 1.3, p.y * 1.3, p.z * 1.3, 3) * 0.45;
        p.multiplyScalar(d);
        p.y *= v % 2 ? 0.6 : 0.8;
        if (p.y < -0.3) p.y = -0.3 + (p.y + 0.3) * 0.3;
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      g.computeVertexNormals();
      rockGeos.push(g);
    }
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a6a52, roughness: 0.95 });
    const redRockMat = new THREE.MeshStandardMaterial({ color: 0xa0583a, roughness: 0.92 });
    const perVariant: THREE.Matrix4[][] = rockGeos.map(() => []);
    const perVariantRed: THREE.Matrix4[][] = rockGeos.map(() => []);
    const world = this.game.physics.world;
    const nearLoc = (x: number, z: number, pad = 0.9) => LOCATIONS.some((l) => l.flatten && Math.hypot(l.x - x, l.z - z) < l.flatten * pad) || Math.hypot(x - PIT.x, z - PIT.z) < PIT.radius + 45;
    const nearRoad = (x: number, z: number) => {
      const s = terrain.surfaceAt(x, z);
      return s === 'asphalt' || s === 'gravel';
    };
    for (let i = 0; i < 2600; i++) {
      // same random sequence at every density, so the world looks alike across presets
      const keep = rng.next() < density;
      const x = rng.range(-880, 880);
      const z = rng.range(-880, 880);
      if (nearLoc(x, z) || nearRoad(x, z)) continue;
      const nrm = terrain.normalAt(x, z);
      const sand = terrain.sandAmount(x, z);
      if (sand > 0.6 && rng.chance(0.85)) continue;
      const cluster = noise.noise2(x / 60, z / 60);
      if (cluster < -0.1 && rng.chance(0.7)) continue;
      const big = rng.chance(0.08);
      const scale = big ? rng.range(2.5, 5.5) : rng.range(0.35, 1.6);
      const y = terrain.heightAt(x, z) - scale * 0.15;
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, 6)));
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(scale * rng.range(0.8, 1.3), scale, scale * rng.range(0.8, 1.3)));
      const v = rng.int(0, 5);
      const red = Math.hypot(x + 560, z - 620) < 480;
      if (!keep && !big) continue; // thinned out: no mesh, no collider
      (red ? perVariantRed : perVariant)[v].push(m);
      if (scale > 1.2) {
        const c = world.createCollider(RAPIER.ColliderDesc.ball(scale * 0.8).setTranslation(x, y + scale * 0.2, z).setCollisionGroups(COLLIDE.static).setFriction(0.9));
        this.game.physics.owners.set(c.handle, { kind: 'static', surface: 'rock' });
      }
    }
    const addInst = (lists: THREE.Matrix4[][], mat: THREE.Material) => {
      lists.forEach((list, v) => this.addScatter(rockGeos[v], mat, list, 'rock', true));
    };
    addInst(perVariant, rockMat);
    addInst(perVariantRed, redRockMat);
    // Vegetation: dry shrubs, dead trees, cacti
    const shrubGeo = (() => {
      const parts: THREE.BufferGeometry[] = [];
      for (let k = 0; k < (light ? 4 : 7); k++) {
        const c = new THREE.ConeGeometry(0.05, 0.9, light ? 3 : 4);
        c.translate(0, 0.45, 0);
        c.rotateZ((k % 2 ? 1 : -1) * (0.3 + (k / 7) * 0.6));
        c.rotateY((k / 7) * PI * 2);
        parts.push(c.toNonIndexed());
      }
      const blob = new THREE.IcosahedronGeometry(0.55, light ? 0 : 1);
      blob.scale(1, 0.55, 1);
      blob.translate(0, 0.35, 0);
      parts.push(blob.toNonIndexed());
      return mergeGeometries(parts)!;
    })();
    const cactusGeo = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const trunk = new THREE.CylinderGeometry(0.28, 0.32, 4.2, 10);
      trunk.translate(0, 2.1, 0);
      parts.push(trunk.toNonIndexed());
      for (const [side, h0, h1] of [[1, 1.6, 1.2], [-1, 2.2, 1.0]] as [number, number, number][]) {
        const arm = new THREE.CylinderGeometry(0.2, 0.22, 0.9, 8);
        arm.rotateZ(PI / 2);
        arm.translate(side * 0.6, h0, 0);
        parts.push(arm.toNonIndexed());
        const up = new THREE.CylinderGeometry(0.2, 0.22, h1, 8);
        up.translate(side * 1.0, h0 + h1 / 2, 0);
        parts.push(up.toNonIndexed());
      }
      return mergeGeometries(parts)!;
    })();
    const treeGeo = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const trunk = new THREE.CylinderGeometry(0.12, 0.25, 3, 7);
      trunk.translate(0, 1.5, 0);
      parts.push(trunk.toNonIndexed());
      for (let k = 0; k < 6; k++) {
        const b = new THREE.CylinderGeometry(0.03, 0.08, 1.8, 5);
        b.translate(0, 0.9, 0);
        b.rotateZ(0.6 + (k % 3) * 0.2);
        b.rotateY((k / 6) * PI * 2);
        b.translate(0, 2 + (k % 2) * 0.6, 0);
        parts.push(b.toNonIndexed());
      }
      return mergeGeometries(parts)!;
    })();
    const shrubMat = new THREE.MeshStandardMaterial({ color: 0x6d6440, roughness: 1 });
    const cactusMat = new THREE.MeshStandardMaterial({ color: 0x4f6a3a, roughness: 0.8 });
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.9 });
    const plant = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number, filter: (x: number, z: number) => boolean, scale: [number, number], collide: number, kind: ScatterKind) => {
      const ms: THREE.Matrix4[] = [];
      const shown: THREE.Matrix4[] = [];
      for (let i = 0; i < count * 3 && ms.length < count; i++) {
        const x = rng.range(-870, 870);
        const z = rng.range(-870, 870);
        if (nearLoc(x, z, 0.7) || nearRoad(x, z)) continue;
        if (!filter(x, z)) continue;
        const s = rng.range(scale[0], scale[1]);
        const y = terrain.heightAt(x, z) - 0.05;
        const mtx = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.08, 0.08), rng.range(0, 6), rng.range(-0.08, 0.08))), new THREE.Vector3(s, s, s));
        ms.push(mtx);
        // colliders stay for every plant that blocks; only the drawn set thins out with density
        if (collide > 0 || ((ms.length * 7919) % 1000) / 1000 < density) shown.push(mtx);
        if (collide > 0) {
          const c = world.createCollider(RAPIER.ColliderDesc.cylinder(1.5 * s, collide * s).setTranslation(x, y + 1.5 * s, z).setCollisionGroups(COLLIDE.static));
          this.game.physics.owners.set(c.handle, { kind: 'static', surface: 'wood' });
        }
      }
      this.addScatter(geo, mat, shown, kind, kind !== 'shrub' || !light);
    };
    plant(shrubGeo, shrubMat, 2200, (x, z) => terrain.sandAmount(x, z) < 0.5 && terrain.normalAt(x, z).y > 0.85, [0.6, 1.5], 0, 'shrub');
    plant(cactusGeo, cactusMat, 260, (x, z) => terrain.normalAt(x, z).y > 0.9 && z > -200, [0.8, 1.4], 0.35, 'plant');
    plant(treeGeo, treeMat, 180, (x, z) => terrain.normalAt(x, z).y > 0.88 && terrain.sandAmount(x, z) < 0.3, [0.8, 1.6], 0.2, 'plant');
    // cull scatter tiles by distance every frame (title screen included)
    this.game.hooks.frame.push(() => this.cullScatter());
    this.game.hooks.preset.push(() => (this.scatterDist = this.game.renderer.preset.scatterDistance));
    this.scatterDist = this.game.renderer.preset.scatterDistance;
  }

  // ------------------------------------------------------------------ scatter tiles
  private scatter: { mesh: THREE.InstancedMesh; center: THREE.Vector3; radius: number; kind: ScatterKind }[] = [];
  private scatterDist = 1;

  /** Instanced scatter split into map tiles so off-screen and distant tiles cost nothing. */
  private addScatter(geo: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[], kind: ScatterKind, castShadow: boolean) {
    const TILE = 240;
    const buckets = new Map<string, THREE.Matrix4[]>();
    const p = new THREE.Vector3();
    for (const m of matrices) {
      p.setFromMatrixPosition(m);
      const key = `${Math.floor(p.x / TILE)},${Math.floor(p.z / TILE)}`;
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push(m);
    }
    for (const list of buckets.values()) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = castShadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
      this.scatter.push({ mesh: im, center: im.boundingSphere!.center.clone(), radius: im.boundingSphere!.radius, kind });
    }
  }

  private cullScatter() {
    const cam = this.game.camera.position;
    const k = this.scatterDist;
    for (const t of this.scatter) {
      const range = SCATTER_RANGE[t.kind] * k;
      t.mesh.visible = t.center.distanceTo(cam) - t.radius < range;
    }
  }

  // ------------------------------------------------------------------ runtime
  applyProfile(p: Profile) {
    void p;
  }

  update(dt: number) {
    this.time += dt;
    const on = Math.sin(this.time * 3) > 0.2;
    for (const b of this.blinkers) b.visible = on;
    void clamp;
    void smoothstep;
  }
}

export type { V3 };
