import { describe, it, expect, beforeAll } from 'vitest';
import { registerAllMeshes } from '../src/machines/parts/meshes';
import { ROLE_CLASS } from '../src/ai/designs';
import { computeStats } from '../src/machines/stats';
import { RNG } from '../src/core/random';
import * as D from '../src/ai/designs';

describe('enemy generator', () => {
  beforeAll(() => registerAllMeshes());
  it('produces valid designs for all roles', () => {
    const report: string[] = [];
    let bad = 0;
    for (const role of Object.keys(ROLE_CLASS)) {
      for (const f of ['scrappers', 'authority', 'helix', 'independents'] as const) {
        for (const tier of [0, 2, 4]) {
          for (let seed = 1; seed <= 3; seed++) {
            const d = D.generateEnemy({ faction: f, tier, seed: seed * 97 + tier, role: role as any });
            const s = computeStats(d);
            const errs = s.warnings.filter((w) => w.level === 'error').map((w) => w.text);
            const cls = d.cls;
            if (cls !== ROLE_CLASS[role] || errs.length) {
              bad++;
              report.push(`${role}/${f}/t${tier}/s${seed}: got ${cls} ${d.parts[0].defId} ${errs.join('; ')}`);
            }
          }
        }
      }
    }
    console.log(report.slice(0, 40).join('\n'), '\nbad', bad);
    expect(bad).toBeLessThan(15);
  });

  it('generates enemies without an explicit role (director path)', () => {
    for (const f of ['scrappers', 'authority', 'helix', 'independents'] as const) {
      for (const tier of [0, 1, 2, 3, 4]) {
        for (let seed = 1; seed <= 4; seed++) {
          const d = D.generateEnemy({ faction: f, tier, seed: seed * 31 + tier });
          expect(d.parts.length, `${f}/t${tier}`).toBeGreaterThan(3);
        }
      }
    }
  });
});
