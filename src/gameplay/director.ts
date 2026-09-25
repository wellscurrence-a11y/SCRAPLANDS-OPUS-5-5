/**
 * Encounter director: spawns faction patrols around locations and on the roads,
 * drives their AI pilots, and cleans up distant machines and old wrecks.
 */
import * as THREE from 'three';
import type { Game } from '../core/game';
import type { Faction } from '../core/context';
import type { Machine } from '../machines/machine';
import { AIPilot, AIOptions } from '../ai/pilot';
import { generateEnemy, EnemyOptions } from '../ai/designs';
import { LOCATIONS, LocationDef, ROADS } from '../world/layout';
import { RNG } from '../core/random';
import { clamp } from '../core/math';

interface Zone {
  loc: LocationDef;
  faction: Faction;
  tier: number;
  cooldownUntil: number;
  active: Machine[];
}

export interface SpawnRequest extends Partial<EnemyOptions> {
  faction: Faction;
  tier: number;
  pos: THREE.Vector3;
  yaw?: number;
  ai?: Partial<AIOptions>;
  name?: string;
  tag?: Record<string, any>;
}

export class Director {
  pilots = new Map<Machine, AIPilot>();
  zones: Zone[] = [];
  enabled = true;
  maxEnemies = 9;
  private rng = new RNG(Date.now() & 0xffff);
  private roamTimer = 40;
  private cleanTimer = 0;
  private seed = 1000;
  /** Mission-owned machines are never auto-despawned. */
  protected = new Set<Machine>();

  constructor(private game: Game) {
    for (const loc of LOCATIONS) {
      if (!loc.faction || loc.danger <= 0) continue;
      if (loc.kind === 'settlement') continue;
      this.zones.push({ loc, faction: loc.faction, tier: loc.danger, cooldownUntil: 0, active: [] });
    }
    game.events.on('hit', (h) => {
      // Neutral machines that get shot by the player turn hostile
      if (h.source === game.player) {
        const p = this.pilots.get(h.machine);
        if (p && p.opts.passive && !p.provoked) {
          p.provoked = true;
          p.target = game.player;
          p.state = 'engage';
          game.events.emit('notify', { text: `${h.machine.name} is now hostile`, kind: 'bad' });
        }
      }
      // Any AI that gets hit wakes up and engages its attacker
      const pilot = this.pilots.get(h.machine);
      if (pilot && h.source && h.source !== h.machine && pilot.state !== 'flee' && pilot.state !== 'race' && (game.ctx.hostile(h.machine.faction, h.source.faction) || pilot.provoked)) {
        pilot.target = h.source;
        pilot.state = 'engage';
      }
    });
  }

  spawn(req: SpawnRequest): Machine {
    const game = this.game;
    const design = generateEnemy({ faction: req.faction, tier: req.tier, seed: req.seed ?? this.seed++, elite: req.elite, role: req.role, cls: req.cls });
    if (req.name) design.name = req.name;
    const yaw = req.yaw ?? this.rng.range(0, Math.PI * 2);
    const m = game.spawnMachine(design, req.pos, yaw, req.faction, false, this.rng.range(0.4, 0.9));
    if (req.tag) Object.assign(m.tag, req.tag);
    const skill = clamp(0.25 + req.tier * 0.15 + (req.elite ? 0.2 : 0) + (req.faction === 'helix' ? 0.15 : 0), 0.1, 0.95);
    const doctrine = req.faction === 'authority' ? (this.rng.chance(0.5) ? 'weapons' : 'locomotion') : req.faction === 'helix' ? 'cockpit' : 'center';
    const pilot = new AIPilot(m, {
      skill,
      aggression: req.faction === 'scrappers' ? 0.8 : req.faction === 'independents' ? 0.3 : 0.6,
      home: req.pos.clone(),
      patrolRadius: 80,
      doctrine,
      passive: req.faction === 'independents',
      ...req.ai,
    });
    this.pilots.set(m, pilot);
    return m;
  }

  private findSpawnPoint(center: THREE.Vector3, radius: number, minFromPlayer: number): THREE.Vector3 | null {
    const game = this.game;
    const player = game.player;
    for (let i = 0; i < 20; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(radius * 0.2, radius);
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      const n = game.terrain.normalAt(x, z);
      if (n.y < 0.85) continue;
      const p = new THREE.Vector3(x, game.terrain.heightAt(x, z), z);
      if (player && p.distanceTo(player.currPos) < minFromPlayer) continue;
      if (Math.abs(x) > 880 || Math.abs(z) > 880) continue;
      return p;
    }
    return null;
  }

  fixedUpdate(dt: number) {
    for (const [m, p] of this.pilots) {
      if (!this.game.ctx.machines.includes(m)) {
        this.pilots.delete(m);
        continue;
      }
      p.update(dt);
    }
  }

  /** Called a few times per second. */
  tick(dt: number) {
    const game = this.game;
    const player = game.player;
    this.cleanTimer -= dt;
    if (this.cleanTimer <= 0) {
      this.cleanTimer = 2;
      this.cleanup();
    }
    if (!this.enabled || !player || game.state !== 'world') return;
    const alive = game.ctx.machines.filter((m) => m.alive && m !== player && m.faction !== 'independents').length;
    const time = game.ctx.time;
    // Zone garrisons
    for (const z of this.zones) {
      z.active = z.active.filter((m) => game.ctx.machines.includes(m) && m.alive);
      const d = player.currPos.distanceTo(new THREE.Vector3(z.loc.x, player.currPos.y, z.loc.z));
      if (d < z.loc.radius + 320 && z.active.length === 0 && time > z.cooldownUntil && alive < this.maxEnemies) {
        const count = clamp(Math.round(1 + z.tier * 0.7 + this.rng.range(-0.4, 1.2)), 1, 5);
        for (let i = 0; i < count; i++) {
          const p = this.findSpawnPoint(new THREE.Vector3(z.loc.x, 0, z.loc.z), z.loc.radius, 90);
          if (!p) continue;
          const elite = this.rng.chance(0.08 + z.tier * 0.04);
          const m = this.spawn({ faction: z.faction, tier: z.tier + (this.rng.chance(0.2) ? 1 : 0), pos: p, elite, ai: { home: new THREE.Vector3(z.loc.x, 0, z.loc.z), patrolRadius: z.loc.radius } });
          m.tag.zone = z.loc.id;
          z.active.push(m);
        }
        z.cooldownUntil = time + 240;
      }
    }
    // Roaming raiders on the highway and dirt roads
    this.roamTimer -= dt;
    if (this.roamTimer <= 0 && alive < this.maxEnemies - 2) {
      this.roamTimer = this.rng.range(60, 120);
      const road = this.rng.pick(ROADS);
      const pt = this.rng.pick(road.points);
      const center = new THREE.Vector3(pt[0], 0, pt[1]);
      const d = center.distanceTo(new THREE.Vector3(player.currPos.x, 0, player.currPos.z));
      const home = LOCATIONS.find((l) => l.id === 'home')!;
      const nearHome = center.distanceTo(new THREE.Vector3(home.x, 0, home.z)) < 200;
      if (d > 150 && d < 450 && !nearHome) {
        const faction: Faction = this.rng.chance(0.25) ? 'independents' : 'scrappers';
        const tier = clamp(Math.floor(Math.hypot(pt[0], pt[1]) / 350), 0, 2);
        const n = faction === 'independents' ? 1 : this.rng.int(1, 3);
        let leader: Machine | null = null;
        for (let i = 0; i < n; i++) {
          const p = this.findSpawnPoint(center, 40, 120);
          if (!p) continue;
          const m = this.spawn({ faction, tier, pos: p, role: faction === 'independents' ? (this.rng.chance(0.5) ? 'trader' : 'truck') : undefined, ai: { home: center, patrolRadius: 250, leader } });
          if (!leader) leader = m;
          m.tag.roamer = true;
        }
      }
    }
  }

  private cleanup() {
    const game = this.game;
    const player = game.player;
    if (!player) return;
    for (const m of [...game.ctx.machines]) {
      if (m === player || this.protected.has(m)) continue;
      const d = m.currPos.distanceTo(player.currPos);
      const wreckOld = m.wreck && game.ctx.time - m.deathTime > 900;
      const fullyStripped = m.wreck && m.tag.stripped;
      if (d > 750 || wreckOld || (fullyStripped && d > 60)) {
        this.pilots.delete(m);
        game.removeMachine(m);
      }
    }
    // cap wrecks
    const wrecks = game.ctx.machines.filter((m) => m.wreck && !this.protected.has(m));
    if (wrecks.length > 8) {
      wrecks.sort((a, b) => a.deathTime - b.deathTime);
      for (const w of wrecks.slice(0, wrecks.length - 8)) {
        if (w.currPos.distanceTo(player.currPos) < 50) continue;
        this.pilots.delete(w);
        game.removeMachine(w);
      }
    }
  }

  clearAll() {
    for (const m of [...this.game.ctx.machines]) {
      if (m === this.game.player) continue;
      this.pilots.delete(m);
      this.game.removeMachine(m);
    }
    for (const z of this.zones) {
      z.active = [];
      z.cooldownUntil = 0;
    }
    this.protected.clear();
  }
}
