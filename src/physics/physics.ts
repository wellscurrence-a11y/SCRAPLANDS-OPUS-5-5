import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GRID } from '../world/heightfield';
import { WORLD_SIZE } from '../world/layout';

export { RAPIER };

export const GROUP = {
  TERRAIN: 1 << 0,
  STATIC: 1 << 1,
  MACHINE: 1 << 2,
  DEBRIS: 1 << 3,
  PICKUP: 1 << 4,
  TRIGGER: 1 << 5,
};

export function groups(membership: number, filter: number) {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export const COLLIDE = {
  terrain: groups(GROUP.TERRAIN, GROUP.MACHINE | GROUP.DEBRIS | GROUP.PICKUP),
  static: groups(GROUP.STATIC, GROUP.MACHINE | GROUP.DEBRIS | GROUP.PICKUP),
  machine: groups(GROUP.MACHINE, GROUP.TERRAIN | GROUP.STATIC | GROUP.MACHINE | GROUP.DEBRIS),
  debris: groups(GROUP.DEBRIS, GROUP.TERRAIN | GROUP.STATIC | GROUP.MACHINE | GROUP.DEBRIS),
  pickup: groups(GROUP.PICKUP, GROUP.TERRAIN | GROUP.STATIC),
  /** Query filters */
  qWorld: groups(0xffff, GROUP.TERRAIN | GROUP.STATIC),
  qWorldAndMachines: groups(0xffff, GROUP.TERRAIN | GROUP.STATIC | GROUP.MACHINE),
  qAll: groups(0xffff, GROUP.TERRAIN | GROUP.STATIC | GROUP.MACHINE | GROUP.DEBRIS),
};

export const FIXED_DT = 1 / 60;
export const GRAVITY = 12;

let initialised = false;
export async function initPhysics() {
  if (initialised) return;
  await RAPIER.init();
  initialised = true;
}

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  collider: RAPIER.Collider;
}

export class Physics {
  world: RAPIER.World;
  eventQueue: RAPIER.EventQueue;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  terrainCollider: RAPIER.Collider | null = null;
  /** Map collider handle → owner object (machine, prop, debris). */
  owners = new Map<number, unknown>();

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = FIXED_DT;
    this.world.integrationParameters.numSolverIterations = 6;
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  addTerrain(heights: Float32Array) {
    // Our array is row-major [iz*GRID+ix]; Rapier wants column-major with rows along z: [ix*GRID+iz].
    const t = new Float32Array(GRID * GRID);
    for (let iz = 0; iz < GRID; iz++) for (let ix = 0; ix < GRID; ix++) t[ix * GRID + iz] = heights[iz * GRID + ix];
    const desc = RAPIER.ColliderDesc.heightfield(GRID - 1, GRID - 1, t, { x: WORLD_SIZE, y: 1, z: WORLD_SIZE })
      .setFriction(0.9)
      .setCollisionGroups(COLLIDE.terrain);
    this.terrainCollider = this.world.createCollider(desc);
    this.owners.set(this.terrainCollider.handle, 'terrain');
  }

  step() {
    this.world.step(this.eventQueue);
  }

  castRay(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    filter = COLLIDE.qWorldAndMachines,
    excludeBody?: RAPIER.RigidBody,
    predicate?: (c: RAPIER.Collider) => boolean,
  ): RayHit | null {
    this.ray.origin.x = origin.x;
    this.ray.origin.y = origin.y;
    this.ray.origin.z = origin.z;
    this.ray.dir.x = dir.x;
    this.ray.dir.y = dir.y;
    this.ray.dir.z = dir.z;
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, filter, undefined, excludeBody, predicate);
    if (!hit) return null;
    const d = hit.timeOfImpact;
    return {
      point: new THREE.Vector3(origin.x + dir.x * d, origin.y + dir.y * d, origin.z + dir.z * d),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      distance: d,
      collider: hit.collider,
    };
  }

  /** Fast variant writing into provided vectors (no allocation). Returns distance or -1. */
  castRayInto(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    outNormal: THREE.Vector3 | null,
    filter = COLLIDE.qWorldAndMachines,
    excludeBody?: RAPIER.RigidBody,
  ): { d: number; collider: RAPIER.Collider | null } {
    this.ray.origin.x = origin.x;
    this.ray.origin.y = origin.y;
    this.ray.origin.z = origin.z;
    this.ray.dir.x = dir.x;
    this.ray.dir.y = dir.y;
    this.ray.dir.z = dir.z;
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, filter, undefined, excludeBody);
    if (!hit) return { d: -1, collider: null };
    if (outNormal) outNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    return { d: hit.timeOfImpact, collider: hit.collider };
  }

  removeBody(body: RAPIER.RigidBody) {
    for (let i = 0; i < body.numColliders(); i++) this.owners.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
  }
}
