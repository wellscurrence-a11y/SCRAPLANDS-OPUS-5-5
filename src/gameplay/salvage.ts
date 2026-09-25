/**
 * Salvage: cut surviving components off wrecks (and pick up parts lying in the dirt).
 * Every part is physically removed from the wreck; cargo is limited by your machine's racks.
 */
import * as THREE from 'three';
import type { Game } from '../core/game';
import type { Machine } from '../machines/machine';
import type { PartRuntime } from '../machines/part';
import type { Debris } from '../world/debris';
import type { Profile } from './profile';
import { addResources, RESOURCES, RESOURCE_LABEL } from './profile';
import { getPart } from '../machines/parts/catalog';
import { salvageTime, scrapYield } from './economy';
import { uid } from '../core/math';
import { rarityIndex } from '../machines/types';
import { randRange } from '../core/random';

export interface SalvageCandidate {
  part: PartRuntime;
  mass: number;
  selected: boolean;
}

export interface SalvageJob {
  wreck: Machine;
  queue: PartRuntime[];
  current: PartRuntime | null;
  t: number;
  dur: number;
  strip: boolean;
}

export class SalvageSystem {
  job: SalvageJob | null = null;
  onChange: (() => void) | null = null;

  constructor(private game: Game, private profile: () => Profile) {}

  cargoUsed() {
    return this.profile().cargo.reduce((s, it) => s + getPart(it.defId).mass, 0);
  }

  cargoCap() {
    return this.game.player?.stats.cargo ?? 120;
  }

  candidates(w: Machine): PartRuntime[] {
    return w.parts.filter((p) => !p.detached && !p.destroyed);
  }

  /** Nearest salvageable wreck within reach of the player. */
  nearestWreck(maxDist = 16): Machine | null {
    const p = this.game.player;
    if (!p) return null;
    let best: Machine | null = null;
    let bd = maxDist;
    for (const m of this.game.ctx.machines) {
      if (m === p || !m.wreck || m.tag.stripped) continue;
      const d = m.worldCom.distanceTo(p.worldCom) - m.boundRadius * 0.6;
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  nearestLoot(maxDist = 9): Debris | null {
    const p = this.game.player;
    if (!p) return null;
    return this.game.ctx.debris.lootNear(p.worldCom, maxDist + p.boundRadius * 0.5);
  }

  start(wreck: Machine, parts: PartRuntime[], strip: boolean) {
    const fast = this.game.player?.parts.some((p) => p.functional && p.def.special?.includes('fast salvage')) ?? false;
    const queue = [...parts];
    this.job = { wreck, queue, current: null, t: 0, dur: 0, strip };
    this.next(fast);
  }

  private next(fast: boolean) {
    const job = this.job!;
    job.current = job.queue.shift() ?? null;
    job.t = 0;
    job.dur = job.current ? salvageTime(job.current.def, fast) : job.strip ? 3.5 : 0;
    if (!job.current && !job.strip) this.finish();
  }

  cancel(reason?: string) {
    if (!this.job) return;
    this.job = null;
    if (reason) this.game.events.emit('notify', { text: reason, kind: 'bad' });
    this.onChange?.();
  }

  private finish() {
    this.job = null;
    this.onChange?.();
  }

  /** Called every frame while a salvage job runs. Returns progress 0..1 or null. */
  update(dt: number): number | null {
    const job = this.job;
    const game = this.game;
    const p = game.player;
    if (!job || !p) return null;
    if (!game.ctx.machines.includes(job.wreck)) {
      this.cancel('Wreck lost');
      return null;
    }
    const d = job.wreck.worldCom.distanceTo(p.worldCom) - job.wreck.boundRadius * 0.6;
    if (d > 20) {
      this.cancel('Salvage interrupted — moved too far away');
      return null;
    }
    if (!p.alive) {
      this.cancel();
      return null;
    }
    job.t += dt;
    const target = job.current ? job.current.worldCenter : job.wreck.worldCom;
    // cutting torch sparks
    if (Math.random() < dt * 30) {
      const n = new THREE.Vector3(randRange(-1, 1), 1, randRange(-1, 1)).normalize();
      game.fx.sparks(target, n, 3, 5, 0.9, [1, 0.8, 0.5]);
      if (Math.random() < 0.3) game.fx.glow(target, 0.25, [2, 2.5, 4], 0.05);
    }
    if (Math.random() < dt * 5) game.audio.play('torch', target, { volume: 0.4 });
    if (job.t >= job.dur) {
      const fast = p.parts.some((x) => x.functional && x.def.special?.includes('fast salvage'));
      if (job.current) this.takePart(job.wreck, job.current);
      else if (job.strip) this.stripWreck(job.wreck);
      if (job.queue.length || (job.strip && job.current)) this.next(fast);
      else this.finish();
      this.onChange?.();
    }
    const total = job.dur || 1;
    return Math.min(1, job.t / total);
  }

  canCarry(massToAdd: number) {
    return this.cargoUsed() + massToAdd <= this.cargoCap();
  }

  private takePart(wreck: Machine, part: PartRuntime) {
    const prof = this.profile();
    const game = this.game;
    if (!this.canCarry(part.def.mass)) {
      game.events.emit('notify', { text: `Cargo full — can't fit ${part.def.name} (${Math.round(part.def.mass)} kg)`, kind: 'bad' });
      return;
    }
    prof.cargo.push({ uid: uid('p'), defId: part.def.id, cond: Math.max(0.05, part.cond) });
    prof.stats.partsSalvaged++;
    // physically remove it from the wreck (children fall off as debris)
    for (const c of [...part.children]) {
      if (!c.detached) wreck.detachPart(c, new THREE.Vector3(0, 2, 0), true);
    }
    part.detached = true;
    part.node.parent?.remove(part.node);
    wreck.batch?.rebuild();
    if (part.collider) {
      game.physics.owners.delete(part.collider.handle);
      game.physics.world.removeCollider(part.collider, true);
      part.collider = null;
    }
    wreck.refreshMass();
    const ri = rarityIndex(part.def.rarity);
    game.events.emit('notify', { text: `Salvaged ${part.def.name} (${Math.round(part.cond * 100)}%)`, kind: 'loot', rarity: part.def.rarity });
    if (!prof.scannedTypes.includes(part.def.id)) {
      prof.scannedTypes.push(part.def.id);
      const data = 1 + ri * 2;
      addResources(prof, { data });
      game.events.emit('notify', { text: `New component catalogued: +${data} Research Data`, kind: 'good' });
    }
    game.audio.play('salvage', part.worldCenter, { volume: 0.8 });
    if (wreck.parts.every((x) => x.detached || x.destroyed)) wreck.tag.stripped = true;
  }

  stripWreck(wreck: Machine) {
    const prof = this.profile();
    const bonus = [1, 1, 1.25, 1.5][prof.workshop.salvage] ?? 1.5;
    const total: Record<string, number> = {};
    for (const p of wreck.parts) {
      if (p.detached) continue;
      const y = scrapYield(p.def, p.destroyed ? 0.15 : p.cond * 0.6, bonus * 0.6);
      for (const [k, v] of Object.entries(y)) total[k] = (total[k] ?? 0) + (v ?? 0);
    }
    addResources(prof, total);
    wreck.tag.stripped = true;
    const text = RESOURCES.filter((r) => total[r]).map((r) => `+${total[r]} ${RESOURCE_LABEL[r]}`).join('  ');
    this.game.events.emit('notify', { text: `Stripped wreck: ${text}`, kind: 'good' });
    // sink the wreck
    wreck.root.visible = true;
    this.game.fx.dust(wreck.worldCom, 8, [0.5, 0.45, 0.4]);
  }

  /** Pick up a part lying on the ground. */
  pickupLoot(d: Debris): boolean {
    if (!d.loot) return false;
    const prof = this.profile();
    const items = [{ defId: d.loot.defId, cond: d.loot.cond }, ...d.loot.extra];
    const mass = items.reduce((s, it) => s + getPart(it.defId).mass, 0);
    if (!this.canCarry(mass)) {
      this.game.events.emit('notify', { text: `Cargo full — need ${Math.round(mass)} kg free`, kind: 'bad' });
      return false;
    }
    for (const it of items) {
      prof.cargo.push({ uid: uid('p'), defId: it.defId, cond: it.cond });
      const def = getPart(it.defId);
      this.game.events.emit('notify', { text: `Recovered ${def.name} (${Math.round(it.cond * 100)}%)`, kind: 'loot', rarity: def.rarity });
      if (!prof.scannedTypes.includes(def.id)) {
        prof.scannedTypes.push(def.id);
        addResources(prof, { data: 1 + rarityIndex(def.rarity) * 2 });
      }
    }
    prof.stats.partsSalvaged += items.length;
    this.game.audio.play('salvage', this.game.player!.currPos, { volume: 0.8 });
    this.game.ctx.debris.remove(d);
    return true;
  }
}
