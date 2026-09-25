/** Placeholder replaced by the procedural audio engine (see audio/engine.ts). */
import * as THREE from 'three';
import type { AudioAPI } from '../core/context';

export class SilentAudio implements AudioAPI {
  listener = new THREE.Vector3();
  play() {}
}
