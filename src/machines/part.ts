import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PartDef, PlacedPart } from './types';
import type { PartLayout } from './layout';

/** Runtime state of one physical component on a machine. */
export class PartRuntime {
  uid: string;
  def: PartDef;
  placed: PlacedPart;
  layout: PartLayout;
  node: THREE.Object3D;
  meshes: THREE.Mesh[] = [];
  nodes = new Map<string, THREE.Object3D>();
  hp: number;
  maxHp: number;
  destroyed = false;
  detached = false;
  damageLevel = 0;
  parent: PartRuntime | null = null;
  children: PartRuntime[] = [];
  localBox: THREE.Box3;
  /** Part space → world, refreshed every physics step. */
  world = new THREE.Matrix4();
  invWorld = new THREE.Matrix4();
  worldCenter = new THREE.Vector3();
  radius = 0.5;
  collider: RAPIER.Collider | null = null;
  burning = 0;
  leaking = 0;
  fxTimer = Math.random();
  reactiveUsed = false;
  /** Set when this part has been scanned by the player (reveals rarity at range). */
  scanned = false;
  lastHitTime = -10;

  constructor(layout: PartLayout, node: THREE.Object3D, localBox: THREE.Box3) {
    this.layout = layout;
    this.def = layout.def;
    this.placed = layout.placed;
    this.uid = layout.placed.uid;
    this.node = node;
    this.maxHp = layout.def.hp;
    this.hp = Math.max(0, layout.placed.cond) * this.maxHp;
    this.localBox = localBox;
    const size = localBox.getSize(new THREE.Vector3());
    this.radius = Math.max(0.15, size.length() / 2);
    if (this.hp <= 0) {
      this.destroyed = true;
      this.damageLevel = 2;
    } else if (this.hp < this.maxHp * 0.5) this.damageLevel = 1;
  }

  get cond() {
    return this.maxHp > 0 ? Math.max(0, this.hp / this.maxHp) : 0;
  }

  get functional() {
    return !this.destroyed && !this.detached;
  }

  /** Effectiveness multiplier: heavily damaged parts work worse. */
  get efficiency() {
    if (!this.functional) return 0;
    const c = this.cond;
    return c > 0.5 ? 1 : 0.55 + c * 0.9;
  }

  find(name: string) {
    return this.nodes.get(name) ?? null;
  }
}
