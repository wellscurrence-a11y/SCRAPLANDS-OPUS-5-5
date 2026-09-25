/**
 * Draw-call batching for world machines. Every rigid mesh (one not under an animated node such as
 * a turret yaw, wheel spin or leg joint) is merged per material into a single mesh in machine space,
 * and all rigid shadow casters become one depth-only proxy drawn only by the sun's shadow camera.
 *
 * The original part meshes are kept (out of the scene graph) and put back whenever the batch is
 * rebuilt, so damage looks, detaching, salvage and debris work exactly as before.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PartRuntime } from './part';

/** Layer seen only by the sun's shadow camera. */
export const SHADOW_LAYER = 1;

const shadowMat = new THREE.MeshBasicMaterial({ colorWrite: false });
/** Moving sub-assemblies smaller than this (m) count as small detail for the distance LOD. */
const SMALL_RADIUS = 0.3;

export class MachineBatch {
  private meshes: THREE.Mesh[] = [];
  /** Merged meshes of small moving sub-assemblies (shocks, links): hidden on distant machines. */
  private small: THREE.Mesh[] = [];
  private smallVisible = true;
  /** Original part meshes taken out of the scene graph while merged (so nothing walks them). */
  private hidden: { mesh: THREE.Mesh; parent: THREE.Object3D }[] = [];
  private dirty = false;
  private age = 0;

  /**
   * @param minShadowRadius moving sub-assemblies smaller than this (m) don't cast shadows
   *   (0 = everything casts, as with individual meshes).
   */
  constructor(
    private root: THREE.Object3D,
    private parts: PartRuntime[],
    private minShadowRadius = 0,
  ) {
    this.rebuild();
  }

  /**
   * The object a mesh moves with: its nearest ancestor that is animated (not a part root or a fixed
   * anchor), or the machine root for rigid meshes. Null if the mesh is no longer under the machine.
   */
  private carrier(mesh: THREE.Mesh): THREE.Object3D | null {
    let n = mesh.parent;
    while (n && n !== this.root && (n.userData.uid || n.userData.anchor)) n = n.parent;
    if (!n) return null;
    if (n === this.root) return n;
    // make sure the carrier itself is still attached to this machine
    let up: THREE.Object3D | null = n;
    while (up && up !== this.root) up = up.parent;
    return up ? n : null;
  }

  /** Rebuild soon (materials changed); throttled so heavy combat doesn't rebuild every hit. */
  invalidate() {
    this.dirty = true;
  }

  update(dt: number) {
    this.age += dt;
    if (this.dirty && this.age > 0.25) this.rebuild();
  }

  rebuild() {
    this.clear();
    this.root.updateMatrixWorld(true);
    const rel = new THREE.Matrix4();
    const inv = new Map<THREE.Object3D, THREE.Matrix4>();
    const groups = new Map<THREE.Object3D, { byMat: Map<THREE.Material, THREE.BufferGeometry[]>; shadow: THREE.BufferGeometry[] }>();
    for (const p of this.parts) {
      if (p.detached) continue;
      for (const m of p.meshes) {
        if (!m.visible || !m.parent) continue;
        const carrier = this.carrier(m);
        if (!carrier) continue;
        let ci = inv.get(carrier);
        if (!ci) inv.set(carrier, (ci = new THREE.Matrix4().copy(carrier.matrixWorld).invert()));
        rel.multiplyMatrices(ci, m.matrixWorld);
        const g = m.geometry.clone().applyMatrix4(rel);
        let grp = groups.get(carrier);
        if (!grp) groups.set(carrier, (grp = { byMat: new Map(), shadow: [] }));
        const mat = m.material as THREE.Material;
        let list = grp.byMat.get(mat);
        if (!list) grp.byMat.set(mat, (list = []));
        list.push(g);
        if (m.castShadow) {
          const sg = new THREE.BufferGeometry();
          sg.setAttribute('position', g.getAttribute('position'));
          if (g.index) sg.setIndex(g.index);
          grp.shadow.push(sg);
        }
        this.hidden.push({ mesh: m, parent: m.parent! });
      }
    }
    for (const h of this.hidden) h.parent.remove(h.mesh);
    for (const [carrier, grp] of groups) {
      const groupSphere = new THREE.Sphere();
      const merged: THREE.Mesh[] = [];
      for (const [mat, list] of grp.byMat) {
        const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
        if (!geo) continue;
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false; // identity: geometry is already in the carrier's space
        mesh.userData.batch = true;
        carrier.add(mesh);
        this.meshes.push(mesh);
        merged.push(mesh);
        if (groupSphere.isEmpty()) groupSphere.copy(geo.boundingSphere!);
        else groupSphere.union(geo.boundingSphere!);
      }
      if (carrier !== this.root && groupSphere.radius < SMALL_RADIUS) {
        for (const mesh of merged) {
          mesh.visible = this.smallVisible;
          this.small.push(mesh);
        }
      }
      if (!grp.shadow.length) continue;
      const geo = grp.shadow.length === 1 ? grp.shadow[0] : mergeGeometries(grp.shadow, false);
      if (!geo) continue;
      geo.computeBoundingSphere();
      if (carrier !== this.root && geo.boundingSphere!.radius < this.minShadowRadius) {
        geo.dispose();
        continue;
      }
      const mesh = new THREE.Mesh(geo, shadowMat);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.layers.set(SHADOW_LAYER);
      mesh.matrixAutoUpdate = false;
      mesh.userData.batch = true;
      carrier.add(mesh);
      this.meshes.push(mesh);
    }
    this.dirty = false;
    this.age = 0;
  }

  /** Remove the merged meshes and show the original part meshes again. */
  clear() {
    for (const h of this.hidden) h.parent.add(h.mesh);
    this.hidden = [];
    for (const m of this.meshes) {
      m.parent?.remove(m);
      m.geometry.dispose();
    }
    this.meshes = [];
    this.small = [];
  }

  /** Show or hide the small moving sub-assemblies (distance LOD). */
  setSmallVisible(on: boolean) {
    if (on === this.smallVisible) return;
    this.smallVisible = on;
    for (const m of this.small) m.visible = on;
  }

  get drawCount() {
    return this.meshes.length;
  }
}
