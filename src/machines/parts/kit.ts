/**
 * Procedural geometry kit used to build detailed machine parts.
 * Parts are authored as a tree of nodes (for animated sub-assemblies) holding
 * geometry per material slot; geometry is merged per node/slot for cheap rendering.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Slot =
  | 'paint'
  | 'paint2'
  | 'metal'
  | 'dark'
  | 'rust'
  | 'rubber'
  | 'glass'
  | 'chrome'
  | 'glow'
  | 'rarity'
  | 'hazard'
  | 'copper'
  | 'lamp'
  | 'wood'
  | 'canvas'
  | 'heat'
  | 'white';

export type V3 = [number, number, number];

export class NodeTemplate {
  pos = new THREE.Vector3();
  quat = new THREE.Quaternion();
  parts = new Map<Slot, THREE.BufferGeometry[]>();
  merged = new Map<Slot, THREE.BufferGeometry>();
  children: NodeTemplate[] = [];
  constructor(public name: string) {}

  finalize() {
    for (const [slot, list] of this.parts) {
      if (list.length === 0) continue;
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!g) continue;
      g.computeBoundingBox();
      g.computeBoundingSphere();
      this.merged.set(slot, g);
    }
    this.parts.clear();
    for (const c of this.children) c.finalize();
  }

  find(name: string): NodeTemplate | null {
    if (this.name === name) return this;
    for (const c of this.children) {
      const f = c.find(name);
      if (f) return f;
    }
    return null;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Normalise attributes so geometries can be merged. */
function normalizeGeo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = g;
  if (!geo.index) {
    const n = geo.attributes.position.count;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) {
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  }
  geo.morphAttributes = {};
  geo.clearGroups();
  return geo;
}

export class PartBuilder {
  root = new NodeTemplate('root');
  private stack: NodeTemplate[] = [this.root];

  get cur() {
    return this.stack[this.stack.length - 1];
  }

  /** Begin a child node (animated sub-assembly or socket anchor). */
  node(name: string, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]) {
    const n = new NodeTemplate(name);
    n.pos.set(pos[0], pos[1], pos[2]);
    n.quat.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
    this.cur.children.push(n);
    this.stack.push(n);
    return this;
  }

  end() {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }

  /** Empty anchor node (sockets, muzzles, lights). */
  anchor(name: string, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]) {
    this.node(name, pos, rot);
    this.end();
    return this;
  }

  add(slot: Slot, geo: THREE.BufferGeometry, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]) {
    const g = normalizeGeo(geo);
    _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2]));
    g.applyMatrix4(_m);
    let list = this.cur.parts.get(slot);
    if (!list) {
      list = [];
      this.cur.parts.set(slot, list);
    }
    list.push(g);
    return this;
  }

  // ---------- primitives ----------
  box(slot: Slot, w: number, h: number, d: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], bevel = 0.02) {
    const r = Math.min(bevel, w * 0.49, h * 0.49, d * 0.49);
    const geo = r > 0.001 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
    return this.add(slot, geo, pos, rot);
  }

  cyl(slot: Slot, r: number, h: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], seg = 18, rTop?: number, open = false) {
    return this.add(slot, new THREE.CylinderGeometry(rTop ?? r, r, h, seg, 1, open), pos, rot);
  }

  /** Cylinder along the Z axis (convenience for barrels, pipes). */
  cylZ(slot: Slot, r: number, len: number, pos: V3 = [0, 0, 0], seg = 16, rEnd?: number) {
    return this.add(slot, new THREE.CylinderGeometry(rEnd ?? r, r, len, seg), pos, [Math.PI / 2, 0, 0]);
  }

  /** Cylinder along the X axis. */
  cylX(slot: Slot, r: number, len: number, pos: V3 = [0, 0, 0], seg = 16) {
    return this.add(slot, new THREE.CylinderGeometry(r, r, len, seg), pos, [0, 0, Math.PI / 2]);
  }

  sphere(slot: Slot, r: number, pos: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], seg = 16) {
    return this.add(slot, new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)), pos, [0, 0, 0], scale);
  }

  cone(slot: Slot, r: number, h: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], seg = 16) {
    return this.add(slot, new THREE.ConeGeometry(r, h, seg), pos, rot);
  }

  torus(slot: Slot, r: number, tube: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], seg = 24, arc = Math.PI * 2) {
    return this.add(slot, new THREE.TorusGeometry(r, tube, 8, seg, arc), pos, rot);
  }

  lathe(slot: Slot, profile: [number, number][], pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], seg = 24) {
    const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
    return this.add(slot, new THREE.LatheGeometry(pts, seg), pos, rot);
  }

  /** Extruded 2D shape (XY profile) along Z by depth. */
  extrude(slot: Slot, shape: [number, number][], depth: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], bevel = 0.01) {
    const s = new THREE.Shape(shape.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(s, {
      depth,
      bevelEnabled: bevel > 0,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 1,
      steps: 1,
    });
    geo.translate(0, 0, -depth / 2);
    return this.add(slot, geo, pos, rot);
  }

  /** Side profile (points as [z, y]) extruded across X by width. */
  profile(slot: Slot, pts: [number, number][], width: number, pos: V3 = [0, 0, 0], bevel = 0.015) {
    const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const geo = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
    geo.translate(0, 0, -width / 2);
    geo.rotateY(-Math.PI / 2);
    return this.add(slot, geo, pos);
  }

  /** Top-down outline (points as [x, z]) extruded along Y by height, base at y=0. */
  plan(slot: Slot, pts: [number, number][], height: number, pos: V3 = [0, 0, 0], bevel = 0.015) {
    const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    return this.add(slot, geo, pos);
  }

  /** Front outline (points as [x, y]) extruded along Z by depth, centred. */
  front(slot: Slot, pts: [number, number][], depth: number, pos: V3 = [0, 0, 0], bevel = 0.015) {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
    geo.translate(0, 0, -depth / 2);
    return this.add(slot, geo, pos);
  }

  pipe(slot: Slot, points: V3[], r: number, seg = 24, radial = 8) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    return this.add(slot, new THREE.TubeGeometry(curve, seg, r, radial, false));
  }

  // ---------- details ----------
  /** Hex bolt heads at positions, facing +normal axis ('x','y','z' with sign). */
  bolts(slot: Slot, positions: V3[], axis: 'x' | 'y' | 'z' | '-x' | '-y' | '-z' = 'y', r = 0.018) {
    const rot: V3 =
      axis === 'y' || axis === '-y'
        ? [0, 0, 0]
        : axis === 'x' || axis === '-x'
          ? [0, 0, Math.PI / 2]
          : [Math.PI / 2, 0, 0];
    for (const p of positions) this.add(slot, new THREE.CylinderGeometry(r, r, r * 0.9, 6), p, rot);
    return this;
  }

  /** Row of rivets/bolts between two points. */
  rivets(slot: Slot, a: V3, b: V3, count: number, axis: 'x' | 'y' | 'z' | '-x' | '-y' | '-z' = 'y', r = 0.014) {
    const pts: V3[] = [];
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
    return this.bolts(slot, pts, axis, r);
  }

  /** Grille of slats in the XY plane at pos, facing +Z. */
  grille(slot: Slot, w: number, h: number, count: number, pos: V3, depth = 0.03, rot: V3 = [0, 0, 0]) {
    const g: THREE.BufferGeometry[] = [];
    for (let i = 0; i < count; i++) {
      const y = -h / 2 + ((i + 0.5) / count) * h;
      const bx = new THREE.BoxGeometry(w, (h / count) * 0.45, depth);
      bx.translate(0, y, 0);
      g.push(normalizeGeo(bx));
    }
    const m = mergeGeometries(g);
    if (m) this.add(slot, m, pos, rot);
    return this;
  }

  /** Cooling fins stacked along an axis. */
  fins(slot: Slot, w: number, h: number, t: number, count: number, spacing: number, pos: V3, axis: 'x' | 'y' | 'z' = 'z') {
    const g: THREE.BufferGeometry[] = [];
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * spacing;
      const bx =
        axis === 'z' ? new THREE.BoxGeometry(w, h, t) : axis === 'x' ? new THREE.BoxGeometry(t, h, w) : new THREE.BoxGeometry(w, t, h);
      if (axis === 'z') bx.translate(0, 0, off);
      else if (axis === 'x') bx.translate(off, 0, 0);
      else bx.translate(0, off, 0);
      g.push(normalizeGeo(bx));
    }
    const m = mergeGeometries(g);
    if (m) this.add(slot, m, pos);
    return this;
  }

  /** Hydraulic piston between a and b (cylinder + chrome rod). */
  piston(a: V3, b: V3, r = 0.05, bodySlot: Slot = 'dark') {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    const mid1 = va.clone().addScaledVector(dir, 0.3);
    const mid2 = va.clone().addScaledVector(dir, 0.75);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    const rot: V3 = [e.x, e.y, e.z];
    this.add(bodySlot, new THREE.CylinderGeometry(r, r, len * 0.6, 12), [mid1.x, mid1.y, mid1.z], rot);
    this.add('chrome', new THREE.CylinderGeometry(r * 0.5, r * 0.5, len * 0.5, 10), [mid2.x, mid2.y, mid2.z], rot);
    this.add('metal', new THREE.SphereGeometry(r * 1.1, 8, 6), a);
    this.add('metal', new THREE.SphereGeometry(r * 0.9, 8, 6), b);
    return this;
  }

  /** Hazard-striped panel (uses the 'hazard' slot whose shader draws stripes). */
  hazardPanel(w: number, h: number, d: number, pos: V3, rot: V3 = [0, 0, 0]) {
    return this.box('hazard', w, h, d, pos, rot, 0.01);
  }

  /** Panel with a raised border frame and corner bolts (armor look). */
  platePanel(slot: Slot, w: number, h: number, t: number, pos: V3, rot: V3 = [0, 0, 0], boltSlot: Slot = 'metal') {
    this.node('_plate', pos, rot);
    this.box(slot, w, h, t, [0, 0, 0], [0, 0, 0], Math.min(0.03, t * 0.4));
    const bx = w / 2 - 0.05;
    const by = h / 2 - 0.05;
    this.bolts(boltSlot, [
      [-bx, -by, t / 2],
      [bx, -by, t / 2],
      [-bx, by, t / 2],
      [bx, by, t / 2],
    ], 'z', 0.022);
    this.end();
    return this;
  }

  build(): NodeTemplate {
    // flatten '_plate' helper nodes into their parents (they are static)
    flattenStatic(this.root);
    this.root.finalize();
    return this.root;
  }
}

/** Merge nodes whose names start with '_' into their parent (they only exist for authoring convenience). */
function flattenStatic(node: NodeTemplate) {
  const keep: NodeTemplate[] = [];
  for (const c of node.children) {
    flattenStatic(c);
    if (c.name.startsWith('_')) {
      const m = new THREE.Matrix4().compose(c.pos, c.quat, new THREE.Vector3(1, 1, 1));
      for (const [slot, list] of c.parts) {
        let dst = node.parts.get(slot);
        if (!dst) {
          dst = [];
          node.parts.set(slot, dst);
        }
        for (const g of list) {
          g.applyMatrix4(m);
          dst.push(g);
        }
      }
      for (const gc of c.children) {
        gc.pos.applyMatrix4(m);
        gc.quat.premultiply(c.quat);
        keep.push(gc);
      }
    } else keep.push(c);
  }
  node.children = keep;
}

/** Tyre with blocky tread, built as a lathe then displaced. Axis along X. */
export function tireGeometry(radius: number, width: number, tread: 'knobby' | 'street' | 'bald' | 'monster' | 'spiked' | 'armored') {
  const rimR = radius * (tread === 'monster' ? 0.52 : 0.62);
  const hw = width / 2;
  const prof: THREE.Vector2[] = [];
  const bulge = tread === 'street' ? 0.02 : 0.05;
  const segs = 14;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = -hw + t * width;
    const edge = Math.pow(Math.abs(t * 2 - 1), 6);
    const r = radius - edge * radius * 0.12 + Math.sin(t * Math.PI) * bulge * radius * 0.2;
    prof.push(new THREE.Vector2(r, y));
  }
  // sidewall down to rim
  prof.unshift(new THREE.Vector2(rimR, -hw * 0.92));
  prof.push(new THREE.Vector2(rimR, hw * 0.92));
  const radialSeg = tread === 'bald' || tread === 'street' ? 40 : 64;
  const geo = new THREE.LatheGeometry(prof, radialSeg);
  // Displace tread blocks
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z);
    if (r < radius * 0.8) continue;
    const ang = Math.atan2(v.z, v.x);
    const lug = tread === 'monster' ? 16 : tread === 'knobby' ? 22 : tread === 'spiked' ? 18 : 30;
    const across = v.y / hw; // -1..1
    let d = 0;
    if (tread === 'knobby' || tread === 'monster' || tread === 'spiked') {
      const stagger = Math.floor((across + 1) * 1.5) % 2 === 0 ? 0 : 0.5;
      const s = Math.sin((ang / (Math.PI * 2)) * lug * Math.PI * 2 + stagger * Math.PI);
      d = s > 0.1 ? 1 : 0;
      d *= tread === 'monster' ? radius * 0.06 : radius * 0.045;
      if (tread === 'spiked' && s > 0.85 && Math.abs(across) < 0.4) d += radius * 0.08;
    } else if (tread === 'street') {
      const groove = Math.abs(Math.sin(across * Math.PI * 2)) < 0.15 ? -radius * 0.012 : 0;
      d = groove;
    } else if (tread === 'armored') {
      const s = Math.sin((ang / (Math.PI * 2)) * 14 * Math.PI * 2);
      d = s > 0.3 ? radius * 0.035 : 0;
    }
    const k = (r + d) / r;
    pos.setXYZ(i, v.x * k, v.y, v.z * k);
  }
  geo.computeVertexNormals();
  geo.rotateZ(Math.PI / 2); // axis along X
  return geo;
}

/** Rim / hub with spokes; axis along X. */
export function rimGeometry(radius: number, width: number, spokes: number, style: 'steel' | 'spoke' | 'solid') {
  const parts: THREE.BufferGeometry[] = [];
  const barrel = new THREE.CylinderGeometry(radius, radius, width * 0.85, 24, 1, true);
  barrel.rotateZ(Math.PI / 2);
  parts.push(normalizeGeo(barrel));
  const disc = new THREE.CylinderGeometry(radius * 0.96, radius * 0.96, 0.02, 24);
  disc.rotateZ(Math.PI / 2);
  disc.translate(width * 0.18, 0, 0);
  if (style === 'solid') parts.push(normalizeGeo(disc));
  const hub = new THREE.CylinderGeometry(radius * 0.28, radius * 0.32, width * 0.5, 12);
  hub.rotateZ(Math.PI / 2);
  hub.translate(width * 0.12, 0, 0);
  parts.push(normalizeGeo(hub));
  if (style !== 'solid') {
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const sp = new THREE.BoxGeometry(0.03, radius * 0.75, style === 'spoke' ? 0.03 : radius * 0.28);
      sp.translate(0, radius * 0.5, 0);
      sp.rotateX(a);
      sp.translate(width * 0.18, 0, 0);
      parts.push(normalizeGeo(sp));
    }
  }
  // lug nuts
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const nut = new THREE.CylinderGeometry(0.018, 0.018, 0.03, 6);
    nut.rotateZ(Math.PI / 2);
    nut.translate(width * 0.28, Math.cos(a) * radius * 0.18, Math.sin(a) * radius * 0.18);
    parts.push(normalizeGeo(nut));
  }
  return mergeGeometries(parts)!;
}

/** Rotor blade: tapered, twisted flat blade along +X from the hub. */
export function bladeGeometry(length: number, chord: number, twist = 0.25, thickness = 0.03) {
  const segs = 8;
  const geo = new THREE.BoxGeometry(length, thickness, chord, segs, 1, 1);
  geo.translate(length / 2, 0, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = v.x / length;
    const taper = 1 - t * 0.35;
    const ang = twist * (1 - t);
    const z = v.z * taper;
    const y = v.y;
    pos.setXYZ(i, v.x, y * Math.cos(ang) - z * Math.sin(ang), y * Math.sin(ang) + z * Math.cos(ang));
  }
  geo.computeVertexNormals();
  return geo;
}

/** Track loop (belt) between front & rear wheels, axis along X. */
export function trackBeltGeometry(length: number, radius: number, width: number, links: number) {
  const parts: THREE.BufferGeometry[] = [];
  const half = length / 2;
  const perim = 2 * length + 2 * Math.PI * radius;
  for (let i = 0; i < links; i++) {
    const s = (i / links) * perim;
    let y: number, z: number, ang: number;
    if (s < length) {
      z = half - s;
      y = radius;
      ang = 0;
    } else if (s < length + Math.PI * radius) {
      const a = (s - length) / radius;
      z = -half - Math.sin(a) * radius;
      y = Math.cos(a) * radius;
      ang = a;
    } else if (s < 2 * length + Math.PI * radius) {
      z = -half + (s - length - Math.PI * radius);
      y = -radius;
      ang = Math.PI;
    } else {
      const a = (s - 2 * length - Math.PI * radius) / radius;
      z = half + Math.sin(a) * radius;
      y = -Math.cos(a) * radius;
      ang = Math.PI + a;
    }
    const link = new THREE.BoxGeometry(width, 0.05, (perim / links) * 0.8);
    const grouser = new THREE.BoxGeometry(width * 0.95, 0.05, 0.04);
    grouser.translate(0, 0.045, 0);
    const lg = mergeGeometries([normalizeGeo(link), normalizeGeo(grouser)])!;
    lg.rotateX(-ang);
    lg.translate(0, y, z);
    parts.push(lg);
  }
  return mergeGeometries(parts)!;
}
