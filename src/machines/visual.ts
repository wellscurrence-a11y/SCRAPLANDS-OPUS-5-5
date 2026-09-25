/** Builds the Object3D hierarchy for a machine design (shared by world machines and the garage). */
import * as THREE from 'three';
import type { MachineDesign, Rarity } from './types';
import type { NodeTemplate, Slot } from './parts/kit';
import { getPartTemplate } from './parts/meshes';
import { LayoutResult, layoutDesign, PartLayout, placementLocal, socketFrame } from './layout';
import type { MachineMaterials } from './materials';

export interface PartVisual {
  layout: PartLayout;
  node: THREE.Object3D;
  meshes: THREE.Mesh[];
  nodes: Map<string, THREE.Object3D>;
}

export interface AssembledMachine {
  root: THREE.Group;
  parts: Map<string, PartVisual>;
  layout: LayoutResult;
}

function instantiate(
  t: NodeTemplate,
  mats: MachineMaterials,
  rarity: Rarity,
  damage: number,
  meshes: THREE.Mesh[],
  nodes: Map<string, THREE.Object3D>,
  shadows: boolean,
): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = t.name;
  o.position.copy(t.pos);
  o.quaternion.copy(t.quat);
  for (const [slot, geo] of t.merged) {
    const mesh = new THREE.Mesh(geo, mats.get(slot as Slot, damage, rarity));
    mesh.userData.slot = slot;
    mesh.castShadow = shadows && slot !== 'glow' && slot !== 'rarity' && slot !== 'lamp';
    mesh.receiveShadow = shadows;
    o.add(mesh);
    meshes.push(mesh);
  }
  if (t.anchor) o.userData.anchor = true;
  if (t.name !== 'root') nodes.set(t.name, o);
  for (const c of t.children) o.add(instantiate(c, mats, rarity, damage, meshes, nodes, shadows));
  return o;
}

/** Rest transform of `node` relative to `root` (walks up the parent chain). */
function relativeMatrix(node: THREE.Object3D, root: THREE.Object3D) {
  const m = new THREE.Matrix4();
  let n: THREE.Object3D | null = node;
  const chain: THREE.Object3D[] = [];
  while (n && n !== root) {
    chain.push(n);
    n = n.parent;
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    chain[i].updateMatrix();
    m.multiply(chain[i].matrix);
  }
  return m;
}

export function damageLevelFor(cond: number) {
  return cond <= 0 ? 2 : cond < 0.5 ? 1 : 0;
}

export function assembleDesign(design: MachineDesign, mats: MachineMaterials, opts: { shadows?: boolean; layout?: LayoutResult; detail?: number } = {}): AssembledMachine {
  const layout = opts.layout ?? layoutDesign(design);
  const root = new THREE.Group();
  root.name = design.name;
  const parts = new Map<string, PartVisual>();
  const shadows = opts.shadows ?? true;
  for (const lay of layout.parts) {
    const tpl = getPartTemplate(lay.def, opts.detail ?? 1);
    const meshes: THREE.Mesh[] = [];
    const nodes = new Map<string, THREE.Object3D>();
    const node = instantiate(tpl.root, mats, lay.def.rarity, damageLevelFor(lay.placed.cond), meshes, nodes, shadows);
    node.name = `${lay.def.id}:${lay.placed.uid}`;
    node.userData.uid = lay.placed.uid;
    let parentObj: THREE.Object3D = root;
    let local: THREE.Matrix4;
    if (lay.parent && lay.socket) {
      const pv = parts.get(lay.parent.placed.uid)!;
      const socketM = socketFrame(lay.socket).multiply(placementLocal(lay.placed));
      const anchor = pv.nodes.get(lay.socket.id);
      if (anchor) {
        parentObj = anchor;
        const rest = relativeMatrix(anchor, pv.node);
        local = rest.invert().multiply(socketM);
      } else {
        parentObj = pv.node;
        local = socketM;
      }
    } else {
      local = new THREE.Matrix4();
    }
    local.decompose(node.position, node.quaternion, node.scale);
    parentObj.add(node);
    parts.set(lay.placed.uid, { layout: lay, node, meshes, nodes });
  }
  return { root, parts, layout };
}

/** Swap every mesh of a part to the material variant for a damage level. */
export function setPartDamageLook(pv: { meshes: THREE.Mesh[] }, mats: MachineMaterials, level: number, rarity: Rarity) {
  for (const m of pv.meshes) {
    const slot = m.userData.slot as Slot;
    m.material = mats.get(slot, level, rarity);
  }
}
