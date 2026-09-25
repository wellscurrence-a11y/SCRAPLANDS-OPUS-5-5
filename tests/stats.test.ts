import { describe, it, expect, beforeAll } from 'vitest';
import { registerAllMeshes } from '../src/machines/parts/meshes';
import { starterAir, starterGround, starterMech } from '../src/machines/designs';
import { computeStats } from '../src/machines/stats';
import { PARTS } from '../src/machines/parts/catalog';
import { getPartTemplate } from '../src/machines/parts/meshes/registry';

describe('starter machines', () => {
  beforeAll(() => registerAllMeshes());

  it('every part has a mesh template with sane bounds', () => {
    for (const p of PARTS) {
      const t = getPartTemplate(p);
      const size = t.bounds.getSize(new (t.bounds.min.constructor as any)());
      expect(size.x, p.id).toBeGreaterThan(0.01);
      expect(size.x, p.id).toBeLessThan(12);
    }
  });

  for (const [name, fn] of [
    ['ground', starterGround],
    ['air', starterAir],
    ['mech', starterMech],
  ] as const) {
    it(`${name} starter is a valid, physically plausible design`, () => {
      const d = fn();
      const s = computeStats(d);
      const errors = s.warnings.filter((w) => w.level === 'error');
      console.log(
        name,
        `mass=${s.mass.toFixed(0)}kg com=(${s.com.x.toFixed(2)},${s.com.y.toFixed(2)},${s.com.z.toFixed(2)})`,
        `pow=${s.powerGen}/${s.powerDrawPeak.toFixed(0)} twr=${s.twr.toFixed(2)} load=${s.loadRatio.toFixed(2)} top=${(s.topSpeed * 3.6).toFixed(0)}km/h`,
        s.warnings.map((w) => `[${w.level}] ${w.text}`).join(' | '),
      );
      expect(errors).toEqual([]);
      expect(Math.abs(s.com.x)).toBeLessThan(0.15);
    });
  }
});
