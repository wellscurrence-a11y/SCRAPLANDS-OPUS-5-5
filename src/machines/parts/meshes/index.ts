import { registerMeshes } from './registry';
import { GROUND_MESHES } from './ground';
import { COMMON_MESHES } from './common';
import { WEAPON_MESHES } from './weapons';
import { AIR_MESHES } from './air';
import { MECH_MESHES } from './mech';

let done = false;
export function registerAllMeshes() {
  if (done) return;
  done = true;
  registerMeshes(GROUND_MESHES);
  registerMeshes(COMMON_MESHES);
  registerMeshes(WEAPON_MESHES);
  registerMeshes(AIR_MESHES);
  registerMeshes(MECH_MESHES);
}

export { getPartTemplate } from './registry';
export type { PartTemplate } from './registry';
