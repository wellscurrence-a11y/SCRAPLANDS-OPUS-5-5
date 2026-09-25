import type * as THREE from 'three';
import type { Physics } from '../physics/physics';
import type { Terrain } from '../world/terrain';
import type { FX } from '../render/particles';
import type { Machine } from '../machines/machine';
import type { EventBus } from './events';
import type { Environment } from '../render/environment';
import type { PartRuntime } from '../machines/part';

export type Faction = 'player' | 'scrappers' | 'authority' | 'helix' | 'independents' | 'neutral';

export interface HitInfo {
  machine: Machine;
  part: PartRuntime;
  damage: number;
  effectiveness: number; // 0..1 armour penetration factor
  destroyed: boolean;
  source: Machine | null;
  point: THREE.Vector3;
  kind: string;
}

export interface GameEvents extends Record<string, unknown> {
  hit: HitInfo;
  partDestroyed: { machine: Machine; part: PartRuntime; source: Machine | null };
  partDetached: { machine: Machine; part: PartRuntime };
  machineKilled: { machine: Machine; source: Machine | null; cause: string };
  notify: { text: string; kind?: 'info' | 'good' | 'bad' | 'loot' | 'mission'; rarity?: string };
  playerDamaged: { amount: number };
  explosion: { pos: THREE.Vector3; size: number };
  shot: { machine: Machine; kind: string; pos: THREE.Vector3; size: number };
  footstep: { machine: Machine; pos: THREE.Vector3; weight: number };
}

export interface AudioAPI {
  play(name: string, pos?: THREE.Vector3 | null, opts?: { volume?: number; pitch?: number; size?: number }): void;
  listener: THREE.Vector3;
}

export interface WorldContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Camera view frustum as of the last rendered frame (for cheap visibility tests). */
  viewFrustum: THREE.Frustum;
  physics: Physics;
  terrain: Terrain;
  fx: FX;
  env: Environment;
  audio: AudioAPI;
  events: EventBus<GameEvents>;
  machines: Machine[];
  time: number;
  player: Machine | null;
  /** Projectile system (set by combat module). */
  projectiles: import('../combat/projectiles').Projectiles;
  debris: import('../world/debris').DebrisSystem;
  hostile(a: Faction, b: Faction): boolean;
}
