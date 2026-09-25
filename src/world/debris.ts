/**
 * Physical debris: detached parts become rigid bodies. Intact detached parts become
 * loot lying in the world (with a rarity beacon) until salvaged.
 */
import * as THREE from 'three';
import { RAPIER, COLLIDE } from '../physics/physics';
import type { WorldContext } from '../core/context';
import type { Machine } from '../machines/machine';
import type { PartRuntime } from '../machines/part';
import { RARITY_COLOR, rarityIndex } from '../machines/types';
import { randRange, rand } from '../core/random';
import { clamp01 } from '../core/math';

export interface LootItem {
  defId: string;
  cond: number;
  /** Nested parts that came off together (e.g. a gun on an armour plate). */
  extra: { defId: string; cond: number }[];
}

export interface Debris {
  id: number;
  body: RAPIER.RigidBody;
  obj: THREE.Object3D;
  scale: THREE.Vector3;
  life: number;
  maxLife: number;
  smoking: number;
  loot: LootItem | null;
  beacon: THREE.Mesh | null;
  sinking: number;
  source: Machine | null;
  collider: RAPIER.Collider;
  part: PartRuntime;
}

let nextId = 1;

export class DebrisSystem {
  items: Debris[] = [];
  private beaconGeo = new THREE.CylinderGeometry(0.12, 0.35, 14, 12, 1, true);
  maxItems = 60;

  constructor(private ctx: WorldContext) {
    this.beaconGeo.translate(0, 7, 0);
  }

  spawnFromPart(machine: Machine, part: PartRuntime, world: THREE.Matrix4, vel: THREE.Vector3, mass: number, intact: boolean) {
    const ctx = this.ctx;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    world.decompose(pos, quat, scale);
    const box = new THREE.Box3();
    part.node.updateMatrixWorld(true);
    // Local bounds of the whole detached subtree in the part's own space
    const inv = new THREE.Matrix4().copy(part.node.matrixWorld).invert();
    part.node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
      box.union(g.boundingBox!.clone().applyMatrix4(m));
    });
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.2, -0.2, -0.2), new THREE.Vector3(0.2, 0.2, 0.2));
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3()).multiply(scale);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setLinvel(vel.x, vel.y, vel.z)
      .setAngvel({ x: randRange(-4, 4), y: randRange(-4, 4), z: randRange(-4, 4) })
      .setLinearDamping(0.1)
      .setAngularDamping(0.4)
      .setCcdEnabled(true);
    const body = ctx.physics.world.createRigidBody(desc);
    const cd = RAPIER.ColliderDesc.cuboid(Math.max(0.05, size.x / 2), Math.max(0.05, size.y / 2), Math.max(0.05, size.z / 2))
      .setTranslation(center.x, center.y, center.z)
      .setMass(Math.max(5, mass))
      .setFriction(0.8)
      .setRestitution(0.15)
      .setCollisionGroups(COLLIDE.debris);
    const collider = ctx.physics.world.createCollider(cd, body);
    const d: Debris = {
      id: nextId++,
      body,
      obj: part.node,
      scale,
      life: 0,
      maxLife: intact ? 900 : randRange(25, 45),
      smoking: part.destroyed ? randRange(3, 8) : 0,
      loot: null,
      beacon: null,
      sinking: 0,
      source: machine,
      collider,
      part,
    };
    ctx.physics.owners.set(collider.handle, { kind: 'debris', debris: d });
    part.node.matrixAutoUpdate = true;
    ctx.scene.add(part.node);
    part.node.position.copy(pos);
    part.node.quaternion.copy(quat);
    part.node.scale.copy(scale);
    if (intact && !machine.isPlayer) {
      const extra: LootItem['extra'] = [];
      const collect = (p: PartRuntime) => {
        for (const c of p.children) {
          if (!c.destroyed) extra.push({ defId: c.def.id, cond: c.cond });
          collect(c);
        }
      };
      collect(part);
      d.loot = { defId: part.def.id, cond: Math.max(0.05, part.cond), extra };
      const col = new THREE.Color(RARITY_COLOR[part.def.rarity]);
      const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12 + rarityIndex(part.def.rarity) * 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      d.beacon = new THREE.Mesh(this.beaconGeo, mat);
      d.beacon.renderOrder = 12;
      ctx.scene.add(d.beacon);
    }
    this.items.push(d);
    // keep the world tidy
    if (this.items.length > this.maxItems) {
      const junk = this.items.find((x) => !x.loot);
      if (junk) this.remove(junk);
    }
    return d;
  }

  /** Push debris away from explosions. */
  blast(point: THREE.Vector3, radius: number, damage: number) {
    for (const d of this.items) {
      const t = d.body.translation();
      const p = new THREE.Vector3(t.x, t.y, t.z);
      const dist = p.distanceTo(point);
      if (dist > radius * 1.8) continue;
      const k = clamp01(1 - dist / (radius * 1.8));
      const imp = p.sub(point).normalize().multiplyScalar(damage * 3 * k);
      imp.y += damage * 2 * k;
      d.body.applyImpulse({ x: imp.x, y: imp.y, z: imp.z }, true);
    }
  }

  lootNear(pos: THREE.Vector3, radius: number) {
    let best: Debris | null = null;
    let bd = radius;
    for (const d of this.items) {
      if (!d.loot) continue;
      const t = d.body.translation();
      const dist = Math.hypot(t.x - pos.x, t.y - pos.y, t.z - pos.z);
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    return best;
  }

  remove(d: Debris) {
    const i = this.items.indexOf(d);
    if (i >= 0) this.items.splice(i, 1);
    this.ctx.physics.owners.delete(d.collider.handle);
    this.ctx.physics.world.removeRigidBody(d.body);
    d.obj.parent?.remove(d.obj);
    if (d.beacon) {
      d.beacon.parent?.remove(d.beacon);
      (d.beacon.material as THREE.Material).dispose();
    }
  }

  update(dt: number) {
    const fx = this.ctx.fx;
    for (const d of [...this.items]) {
      d.life += dt;
      const t = d.body.translation();
      const r = d.body.rotation();
      d.obj.position.set(t.x, t.y - d.sinking, t.z);
      d.obj.quaternion.set(r.x, r.y, r.z, r.w);
      if (d.smoking > 0) {
        d.smoking -= dt;
        if (rand() < 0.4) fx.smoke(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0, 1.2, 0), 0.3, 2, [0.12, 0.11, 0.1], 0.5, 3);
        if (rand() < 0.05) fx.fire(new THREE.Vector3(t.x, t.y, t.z), 0.4);
      }
      if (d.beacon) {
        d.beacon.position.set(t.x, t.y, t.z);
        const mat = d.beacon.material as THREE.MeshBasicMaterial;
        mat.opacity = (0.1 + rarityIndex(d.part.def.rarity) * 0.04) * (0.75 + 0.25 * Math.sin(this.ctx.time * 3 + d.id));
      }
      if (d.life > d.maxLife - 4) {
        d.sinking += dt * 0.3;
        if (d.life > d.maxLife) this.remove(d);
      }
      // Fell out of world
      if (t.y < this.ctx.terrain.heightAt(t.x, t.z) - 20) this.remove(d);
    }
  }

  clear() {
    for (const d of [...this.items]) this.remove(d);
  }
}
