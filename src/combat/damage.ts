/** Damage resolution: armour penetration, ricochets, reactive armour, splash. */
import * as THREE from 'three';
import type { WorldContext } from '../core/context';
import type { Machine } from '../machines/machine';
import type { PartRuntime } from '../machines/part';
import { clamp, clamp01 } from '../core/math';
import { rand } from '../core/random';
import type { SurfaceKind } from '../render/particles';

export type DamageKind = 'ballistic' | 'explosive' | 'energy' | 'melee' | 'fire' | 'ram' | 'arc' | 'pierce' | 'flame';

export function penetrationFactor(pen: number, armor: number) {
  if (pen >= armor) return 1;
  return clamp(pen / Math.max(1, armor), 0.1, 1);
}

/** Apply a hit to a specific part. Returns effective damage dealt. */
export function hitPart(
  ctx: WorldContext,
  target: Machine,
  part: PartRuntime,
  damage: number,
  pen: number,
  point: THREE.Vector3,
  normal: THREE.Vector3,
  dir: THREE.Vector3,
  source: Machine | null,
  kind: DamageKind,
  quiet = false,
): number {
  if (part.detached) return 0;
  const armor = part.def.armor;
  let factor = kind === 'arc' ? 1 : penetrationFactor(pen, armor);
  // Sloped plates deflect light rounds entirely
  if (part.def.special?.includes('ricochet') && pen < armor * 1.4 && kind === 'ballistic' && rand() < 0.6) factor = 0;
  // Reactive armour cancels one heavy hit
  if (part.def.stats.reactive && !part.reactiveUsed && damage * factor > 55 && !part.destroyed) {
    part.reactiveUsed = true;
    ctx.fx.explosion(point, 0.6, { debris: true, scorch: false });
    ctx.audio.play('explosion', point, { volume: 0.7, size: 0.6 });
    target.damagePartDirect(part, part.hp + 1, source, 'explosive');
    ctx.events.emit('hit', { machine: target, part, damage: 0, effectiveness: 0, destroyed: true, source, point, kind: 'reactive' });
    return 0;
  }
  // Hard-light shields regenerate: treat as armour that recovers (handled in machine systems)
  const eff = damage * factor;
  const wasDestroyed = part.destroyed;
  if (eff > 0) target.damagePartDirect(part, eff, source, kind);
  const destroyed = !wasDestroyed && part.destroyed;
  // Frame/cockpit hits bleed a little into adjacent internals when armour is thin
  if (!quiet) {
    let fxKind: SurfaceKind = factor < 0.35 ? 'ricochet' : 'metal';
    if (kind === 'energy' || kind === 'arc') fxKind = 'energy';
    const sc = clamp(damage / 30, 0.4, 2.5);
    if (kind !== 'explosive' && kind !== 'fire' && kind !== 'flame') ctx.fx.impact(point, normal.lengthSq() > 0 ? normal : dir.clone().negate(), fxKind, sc);
    if (fxKind === 'ricochet') ctx.audio.play('ricochet', point, { volume: 0.55 });
    else if (kind === 'ballistic') ctx.audio.play(damage > 60 ? 'hitHeavy' : 'hitMetal', point, { volume: clamp(damage / 40, 0.3, 1) });
  }
  // physical push
  if (kind === 'ballistic' || kind === 'explosive' || kind === 'melee' || kind === 'pierce') {
    const imp = dir.clone().multiplyScalar(damage * (kind === 'melee' ? 40 : 6));
    target.body.applyImpulseAtPoint({ x: imp.x, y: imp.y, z: imp.z }, { x: point.x, y: point.y, z: point.z }, true);
  }
  ctx.events.emit('hit', { machine: target, part, damage: eff, effectiveness: factor, destroyed, source, point: point.clone(), kind });
  return eff;
}

/** Radial damage. Parts closer to the blast take more; armour still matters (reduced penetration). */
export function splash(ctx: WorldContext, point: THREE.Vector3, radius: number, damage: number, pen: number, source: Machine | null, direct?: PartRuntime | null) {
  for (const m of ctx.machines) {
    if (m.currPos.distanceTo(point) > radius + m.boundRadius) continue;
    const near = m.partsNear(point, radius);
    near.sort((a, b) => a.dist - b.dist);
    let shielded = 0;
    for (const { part, dist } of near) {
      if (part === direct) continue;
      const f = clamp01(1 - dist / radius);
      // Armour plates close to the blast absorb some of it for what's behind them
      const shield = Math.max(0.35, 1 - shielded * 0.12);
      hitPart(ctx, m, part, damage * f * f * shield, pen * 0.6, point, new THREE.Vector3(), part.worldCenter.clone().sub(point).normalize(), source, 'explosive', true);
      if (part.def.category === 'armor') shielded++;
    }
    const d = m.worldCom.distanceTo(point);
    if (d < radius * 1.5) {
      const imp = m.worldCom.clone().sub(point).normalize().multiplyScalar(damage * 60 * clamp01(1 - d / (radius * 1.5)));
      imp.y += damage * 20 * clamp01(1 - d / (radius * 1.5));
      m.body.applyImpulseAtPoint({ x: imp.x, y: imp.y, z: imp.z }, { x: point.x, y: point.y, z: point.z }, true);
    }
  }
  ctx.debris.blast(point, radius, damage);
}

export function surfaceKindAt(ctx: WorldContext, point: THREE.Vector3, collider: unknown): SurfaceKind {
  const owner = collider ? ctx.physics.owners.get((collider as any).handle) : null;
  if (owner === 'terrain') {
    const s = ctx.terrain.surfaceAt(point.x, point.z);
    if (s === 'sand') return 'sand';
    if (s === 'rock') return 'rock';
    if (s === 'asphalt') return 'asphalt';
    return 'dirt';
  }
  if (owner && typeof owner === 'object' && (owner as any).kind === 'debris') return 'metal';
  if (owner && typeof owner === 'object' && (owner as any).kind === 'static') return (owner as any).surface ?? 'rock';
  return 'rock';
}
