import * as THREE from 'three';
import type { PartDef } from '../../types';
import { rarityIndex } from '../../types';
import { NodeTemplate, PartBuilder } from '../kit';

export type MeshFn = (b: PartBuilder, def: PartDef) => void;

const registry: Record<string, MeshFn> = {};

export function registerMeshes(map: Record<string, MeshFn>) {
  Object.assign(registry, map);
}

export interface PartTemplate {
  root: NodeTemplate;
  /** Rest-pose bounds in part space. */
  bounds: THREE.Box3;
}

const cache = new Map<string, PartTemplate>();

function computeBounds(node: NodeTemplate, parent: THREE.Matrix4, out: THREE.Box3) {
  const m = new THREE.Matrix4().compose(node.pos, node.quat, new THREE.Vector3(1, 1, 1));
  const world = parent.clone().multiply(m);
  const tmpBox = new THREE.Box3();
  for (const g of node.merged.values()) {
    if (!g.boundingBox) g.computeBoundingBox();
    tmpBox.copy(g.boundingBox!).applyMatrix4(world);
    out.union(tmpBox);
  }
  for (const c of node.children) computeBounds(c, world, out);
}

/** Small emissive strips advertising a part's rarity (uncommon and above). */
function addRarityAccent(b: PartBuilder, def: PartDef, bounds: THREE.Box3) {
  const ri = rarityIndex(def.rarity);
  if (ri < 1) return;
  // Articulated or spinning parts move away from their rest-pose bounds: no floating strips.
  if (['leg', 'arm', 'wheel', 'track', 'rotor', 'suspension'].includes(def.category)) return;
  if (['frame', 'actuator', 'foot'].includes(def.category) && ri < 3) return;
  const size = bounds.getSize(new THREE.Vector3());
  const c = bounds.getCenter(new THREE.Vector3());
  const len = Math.min(0.35, Math.max(0.08, size.x * 0.4));
  const thick = 0.018 + ri * 0.003;
  b.box('rarity', len, thick, thick, [c.x, bounds.max.y - thick * 0.3, bounds.min.z + Math.min(0.12, size.z * 0.2)], [0, 0, 0], 0.004);
  if (ri >= 3) {
    b.box('rarity', thick, thick, Math.min(0.4, size.z * 0.5), [bounds.max.x - thick * 0.4, c.y, c.z], [0, 0, 0], 0.004);
    b.box('rarity', thick, thick, Math.min(0.4, size.z * 0.5), [bounds.min.x + thick * 0.4, c.y, c.z], [0, 0, 0], 0.004);
  }
}

export function getPartTemplate(def: PartDef): PartTemplate {
  const cached = cache.get(def.id);
  if (cached) return cached;
  const fn = registry[def.mesh];
  const b = new PartBuilder();
  if (fn) {
    fn(b, def);
  } else {
    console.warn(`[parts] no mesh builder "${def.mesh}" for ${def.id}`);
    b.box('paint', def.size[0], def.size[1], def.size[2], [0, def.size[1] / 2, 0]);
  }
  // Preliminary bounds from un-merged parts for accent placement
  const pre = new THREE.Box3();
  const walk = (n: NodeTemplate, parent: THREE.Matrix4) => {
    const m = parent.clone().multiply(new THREE.Matrix4().compose(n.pos, n.quat, new THREE.Vector3(1, 1, 1)));
    for (const list of n.parts.values()) {
      for (const g of list) {
        g.computeBoundingBox();
        pre.union(g.boundingBox!.clone().applyMatrix4(m));
      }
    }
    for (const c of n.children) walk(c, m);
  };
  walk(b.root, new THREE.Matrix4());
  // Accents on the static root only (rest-pose bounds)
  if (!pre.isEmpty()) addRarityAccent(b, def, pre);
  const root = b.build();
  const bounds = new THREE.Box3();
  computeBounds(root, new THREE.Matrix4(), bounds);
  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-0.2, 0, -0.2), new THREE.Vector3(0.2, 0.4, 0.2));
  const t = { root, bounds };
  cache.set(def.id, t);
  return t;
}

export function hasMesh(name: string) {
  return !!registry[name];
}
