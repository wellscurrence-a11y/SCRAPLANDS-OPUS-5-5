import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';

describe('rapier heightfield layout', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });
  it('maps heights so that index = ix * (n+1) + iz (column-major, rows along z)', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const nsub = 4; // 4x4 cells, 5x5 vertices
    const size = 8; // 2m cells, spans -4..4
    const heights = new Float32Array((nsub + 1) * (nsub + 1));
    // Put a spike of 10 at vertex ix=4 (x=+4), iz=0 (z=-4) under hypothesis A.
    const ix = 4, iz = 0;
    heights[ix * (nsub + 1) + iz] = 10;
    world.createCollider(RAPIER.ColliderDesc.heightfield(nsub, nsub, heights, { x: size, y: 1, z: size }));
    world.step();
    const cast = (x: number, z: number) => {
      const hit = world.castRay(new RAPIER.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 100, true);
      return hit ? 50 - hit.timeOfImpact : null;
    };
    const atA = cast(3.99, -3.99);
    const atB = cast(-3.99, 3.99);
    console.log('A (x=+4,z=-4):', atA, ' B (x=-4,z=+4):', atB);
    expect(atA).toBeGreaterThan(9);
  });
});
