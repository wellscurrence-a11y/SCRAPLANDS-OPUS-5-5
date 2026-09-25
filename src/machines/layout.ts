/**
 * Design layout: resolves every placed part's rest transform in machine space.
 * Pure math (three.js math types only), shared by the builder, stats and runtime.
 */
import * as THREE from 'three';
import type { MachineDesign, PartDef, PlacedPart, SocketDef } from './types';
import { getPart, PART_MAP } from './parts/catalog';
import { getPartTemplate } from './parts/meshes';

export const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _f = new THREE.Vector3();

export function defaultForward(n: THREE.Vector3, out: THREE.Vector3) {
  if (Math.abs(n.y) > 0.9) return out.set(0, 0, -1);
  if (Math.abs(n.z) > 0.9) return out.set(0, 1, 0);
  return out.set(0, 0, -1);
}

function basis(pos: THREE.Vector3, normal: THREE.Vector3, forward: THREE.Vector3 | null, out: THREE.Matrix4) {
  _y.copy(normal).normalize();
  if (forward) _f.copy(forward);
  else defaultForward(_y, _f);
  _f.addScaledVector(_y, -_f.dot(_y));
  if (_f.lengthSq() < 1e-6) defaultForward(_y.clone().set(0, 1, 0), _f);
  _f.normalize();
  _z.copy(_f).negate();
  _x.crossVectors(_y, _z).normalize();
  out.makeBasis(_x, _y, _z);
  out.setPosition(pos);
  return out;
}

/** Socket frame in its owner part's space. */
export function socketFrame(s: SocketDef, out = new THREE.Matrix4()) {
  if (s.reflect) {
    const pos = new THREE.Vector3(-s.pos[0], s.pos[1], s.pos[2]);
    const n = new THREE.Vector3(-s.normal[0], s.normal[1], s.normal[2]);
    const f = s.forward ? new THREE.Vector3(-s.forward[0], s.forward[1], s.forward[2]) : null;
    basis(pos, n, f, out);
    return out.premultiply(MIRROR_X);
  }
  return basis(
    new THREE.Vector3(...s.pos),
    new THREE.Vector3(...s.normal),
    s.forward ? new THREE.Vector3(...s.forward) : null,
    out,
  );
}

/** Transform from part space to socket space for a placement. */
export function placementLocal(p: Pick<PlacedPart, 'offset' | 'rot' | 'tilt' | 'mirror'>, out = new THREE.Matrix4()) {
  const t = new THREE.Matrix4().makeTranslation(p.offset[0], 0, p.offset[1]);
  const ry = new THREE.Matrix4().makeRotationY((p.rot * Math.PI) / 180);
  const rx = new THREE.Matrix4().makeRotationX((p.tilt * Math.PI) / 180);
  out.copy(t).multiply(ry).multiply(rx);
  if (p.mirror) out.multiply(MIRROR_X);
  return out;
}

export interface PartLayout {
  placed: PlacedPart;
  def: PartDef;
  /** Part space → machine space (rest pose). */
  matrix: THREE.Matrix4;
  /** Machine-space AABB (rest pose). */
  bounds: THREE.Box3;
  localBounds: THREE.Box3;
  socket: SocketDef | null;
  parent: PartLayout | null;
  children: PartLayout[];
  depth: number;
}

export interface LayoutResult {
  root: PartLayout | null;
  parts: PartLayout[];
  byUid: Map<string, PartLayout>;
  errors: string[];
}

export function findSocket(def: PartDef, id: string | null): SocketDef | null {
  if (!id) return null;
  return def.sockets?.find((s) => s.id === id) ?? null;
}

export function layoutDesign(design: MachineDesign): LayoutResult {
  const errors: string[] = [];
  const byUid = new Map<string, PartLayout>();
  const parts: PartLayout[] = [];
  const rootPlaced = design.parts.find((p) => p.parent === null);
  if (!rootPlaced) return { root: null, parts, byUid, errors: ['Design has no frame'] };
  const childrenOf = new Map<string, PlacedPart[]>();
  for (const p of design.parts) {
    if (p.parent === null) continue;
    let list = childrenOf.get(p.parent);
    if (!list) {
      list = [];
      childrenOf.set(p.parent, list);
    }
    list.push(p);
  }
  const visit = (p: PlacedPart, parent: PartLayout | null, depth: number) => {
    if (!PART_MAP.has(p.defId)) {
      errors.push(`Unknown part ${p.defId}`);
      return;
    }
    const def = getPart(p.defId);
    let matrix = new THREE.Matrix4();
    let socket: SocketDef | null = null;
    if (parent) {
      socket = findSocket(parent.def, p.socket);
      if (!socket) {
        errors.push(`${def.name}: socket ${p.socket} missing on ${parent.def.name}`);
        return;
      }
      matrix.copy(parent.matrix).multiply(socketFrame(socket)).multiply(placementLocal(p));
    } else {
      matrix = placementLocal({ offset: [0, 0], rot: 0, tilt: 0 });
    }
    const tpl = getPartTemplate(def);
    const bounds = tpl.bounds.clone().applyMatrix4(matrix);
    const lay: PartLayout = { placed: p, def, matrix, bounds, localBounds: tpl.bounds, socket, parent, children: [], depth };
    byUid.set(p.uid, lay);
    parts.push(lay);
    if (parent) parent.children.push(lay);
    for (const c of childrenOf.get(p.uid) ?? []) visit(c, lay, depth + 1);
  };
  visit(rootPlaced, null, 0);
  // Orphans (parent missing)
  for (const p of design.parts) if (!byUid.has(p.uid) && !errors.length) errors.push(`${p.defId} is detached`);
  return { root: byUid.get(rootPlaced.uid) ?? null, parts, byUid, errors };
}

/** Socket compatibility: can `def` be mounted on a socket of `type`? */
export function canMount(def: PartDef, socket: SocketDef, cls: string): boolean {
  if (!def.mount.includes(socket.type)) return false;
  if (!def.classes.includes(cls as any)) return false;
  return true;
}

/** Shrunken AABB overlap test for placement validity. */
export function overlaps(a: THREE.Box3, b: THREE.Box3, shrink = 0.04) {
  return (
    a.min.x + shrink < b.max.x - shrink &&
    a.max.x - shrink > b.min.x + shrink &&
    a.min.y + shrink < b.max.y - shrink &&
    a.max.y - shrink > b.min.y + shrink &&
    a.min.z + shrink < b.max.z - shrink &&
    a.max.z - shrink > b.min.z + shrink
  );
}

/** Open or moving assemblies that don't block placement of other parts. */
export const NO_OVERLAP_CHECK = new Set(['gear', 'suspension', 'wheel', 'track', 'leg', 'arm', 'actuator', 'foot', 'rotor', 'cockpit']);

/** Occupancy check for a candidate placement against other parts (ignoring parent chain & children). */
export function placementCollides(layout: LayoutResult, candidate: THREE.Box3, parentUid: string | null, ignoreUid?: string): PartLayout | null {
  for (const p of layout.parts) {
    if (p.placed.uid === ignoreUid) continue;
    if (p.placed.uid === parentUid) continue;
    if (p.def.category === 'frame') continue; // frames are hollow-ish; surfaces sit on them
    if (NO_OVERLAP_CHECK.has(p.def.category)) continue;
    if (p.parent && p.parent.placed.uid === ignoreUid) continue;
    // Parts mounted on the same parent via non-surface sockets (wheels, legs) are exempt from each other.
    if (overlaps(p.bounds, candidate, 0.06)) return p;
  }
  return null;
}
