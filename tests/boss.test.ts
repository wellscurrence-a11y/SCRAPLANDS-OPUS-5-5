import { describe, it, expect, beforeAll } from 'vitest';
import { registerAllMeshes } from '../src/machines/parts/meshes';
import { computeStats } from '../src/machines/stats';
import { excavatorDesign, registerBossParts } from '../src/gameplay/boss';
import { getPart } from '../src/machines/parts/catalog';
import { getPartTemplate } from '../src/machines/parts/meshes/registry';

describe('the Excavator', () => {
  beforeAll(() => {
    registerAllMeshes();
    registerBossParts();
  });

  it('is a valid four-legged mech built from salvageable parts', () => {
    const d = excavatorDesign();
    const s = computeStats(d);
    console.log(
      `mass=${s.mass.toFixed(0)}kg pow=${s.powerGen}/${s.powerDrawPeak.toFixed(0)} load=${s.loadRatio.toFixed(2)}`,
      s.warnings.map((w) => `[${w.level}] ${w.text}`).join(' | '),
    );
    expect(s.warnings.filter((w) => w.level === 'error')).toEqual([]);
    expect(d.parts.filter((p) => getPart(p.defId).category === 'leg')).toHaveLength(4);
    expect(d.parts.some((p) => p.defId === 'mel_bucket')).toBe(true);
    expect(d.parts.filter((p) => p.defId === 'act_excavator')).toHaveLength(8);
    expect(s.mass).toBeGreaterThan(9000);
    expect(Math.abs(s.com.x)).toBeLessThan(0.2);
  });

  it('boss parts have meshes', () => {
    for (const id of ['frm_excavator', 'gen_excavator']) {
      const t = getPartTemplate(getPart(id));
      expect(t.bounds.isEmpty(), id).toBe(false);
    }
  });
});
