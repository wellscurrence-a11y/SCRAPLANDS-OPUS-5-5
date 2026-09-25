/**
 * Contracts: a story chain plus a regenerating board of jobs (bounties, salvage runs, deliveries,
 * races, defence, captures, rescues). Every job can be tackled with any machine class.
 */
import * as THREE from 'three';
import type { App } from '../app';
import type { Machine } from '../machines/machine';
import type { CompassMarker } from '../ui/hud';
import type { Profile, Resource } from './profile';
import { addResources, saveProfile } from './profile';
import { getLocation, LOCATIONS, ROADS } from '../world/layout';
import { RNG } from '../core/random';
import { uid, clamp } from '../core/math';
import { getPart } from '../machines/parts/catalog';
import { generateEnemy } from '../ai/designs';
import type { MachineDesign } from '../machines/types';
import { spawnExcavator } from './boss';

export interface Reward {
  credits?: number;
  xp?: number;
  resources?: Partial<Record<Resource, number>>;
  parts?: string[];
  blueprint?: string;
}

export interface Objective {
  text: string;
  done: boolean;
}

export type JobKind = 'bounty' | 'salvage' | 'delivery' | 'race' | 'defend' | 'capture' | 'rescue';

export interface JobSpec {
  id: string;
  kind: JobKind;
  title: string;
  desc: string;
  loc: string;
  dest?: string;
  tier: number;
  reward: Reward;
  seed: number;
}

abstract class Mission {
  objectives: Objective[] = [];
  data: Record<string, any> = {};
  finished = false;
  failed = false;
  owned = new Set<Machine>();
  constructor(public app: App, public id: string, public title: string, public desc: string, public reward: Reward) {}
  get game() {
    return this.app.game;
  }
  get profile() {
    return this.app.profile!;
  }
  get player() {
    return this.app.game.player;
  }
  abstract start(): void;
  update(_dt: number) {}
  onKill(_m: Machine, _source: Machine | null) {}
  onDiscover(_loc: string) {}
  onEnterGarage() {}
  onEnterWorld() {}
  onInstall() {}
  interaction(_m: Machine): { label: string; action: () => void } | null {
    return null;
  }
  markers(): CompassMarker[] {
    return [];
  }
  complete() {
    if (this.finished) return;
    this.finished = true;
    this.cleanup();
    this.app.missions.completeMission(this);
  }
  fail(reason: string) {
    if (this.finished) return;
    this.finished = true;
    this.failed = true;
    this.cleanup();
    this.app.missions.failMission(this, reason);
  }
  cleanup() {
    for (const m of this.owned) this.app.director.protected.delete(m);
  }
  spawnEnemy(opts: { faction: any; tier: number; pos: THREE.Vector3; role?: any; elite?: boolean; name?: string; cls?: any; ai?: any }) {
    const m = this.app.director.spawn({ ...opts, seed: Math.floor(Math.random() * 1e6) });
    m.tag.mission = this.id;
    m.tag.tier = opts.tier;
    this.owned.add(m);
    this.app.director.protected.add(m);
    return m;
  }
  groundPoint(x: number, z: number) {
    return new THREE.Vector3(x, this.game.terrain.heightAt(x, z), z);
  }
  near(p: THREE.Vector3, r: number) {
    const pl = this.player;
    return !!pl && Math.hypot(pl.currPos.x - p.x, pl.currPos.z - p.z) < r;
  }
  serialize() {
    return { stage: this.data.stage ?? 0, data: {} };
  }
}

// ======================================================================== STORY
class RangeTutorial extends Mission {
  targets: Machine[] = [];
  start() {
    this.objectives = [
      { text: 'Drive to the test range east of the workshop', done: false },
      { text: 'Destroy 3 target dummies', done: false },
      { text: 'Salvage a part from a target wreck [E]', done: false },
      { text: 'Return to the workshop door [E]', done: false },
    ];
    this.data.kills = 0;
    this.data.salvagedStart = this.profile.stats.partsSalvaged;
  }
  private spawnTargets() {
    for (const p of this.app.props.rangeTargets.slice(0, 3)) {
      const d = generateEnemy({ faction: 'scrappers', tier: 0, seed: Math.floor(Math.random() * 1e6), role: 'raider' });
      d.name = 'Target Dummy';
      // remove engines so targets sit still
      d.parts = d.parts.filter((x) => getPart(x.defId).category !== 'engine');
      const m = this.game.spawnMachine(d, p.clone().setY(0), Math.PI / 2, 'scrappers');
      m.tag.mission = this.id;
      m.tag.dummy = true;
      for (const w of m.weapons) w.disabled = true;
      this.app.director.protected.add(m);
      this.owned.add(m);
      this.targets.push(m);
    }
  }
  override update() {
    const home = getLocation('home');
    const range = new THREE.Vector3(home.x + 90, 0, home.z);
    if (!this.objectives[0].done) {
      if (!this.targets.length && this.player) this.spawnTargets();
      if (this.near(range, 45)) this.objectives[0].done = true;
    }
    if (this.data.kills >= 3) this.objectives[1].done = true;
    if (this.profile.stats.partsSalvaged > this.data.salvagedStart) this.objectives[2].done = true;
  }
  override onKill(m: Machine) {
    if (this.targets.includes(m)) {
      this.data.kills++;
      if (!this.objectives[0].done) this.objectives[0].done = true;
    }
  }
  override onEnterGarage() {
    if (this.objectives[1].done && this.objectives[2].done) {
      this.objectives[3].done = true;
      this.complete();
    }
  }
  override onEnterWorld() {
    // targets are cleared when entering the garage; respawn if we come back mid-mission
    this.targets = [];
  }
  override markers(): CompassMarker[] {
    const home = getLocation('home');
    if (!this.objectives[1].done || !this.objectives[2].done) return [{ pos: new THREE.Vector3(home.x + 90, 0, home.z), label: 'Test range', kind: 'obj' }];
    return [{ pos: this.app.props.garageDoor, label: 'Workshop', kind: 'obj' }];
  }
}

class FirstBuild extends Mission {
  start() {
    this.objectives = [
      { text: 'Enter the workshop', done: false },
      { text: 'Install any part on a machine (Build tab)', done: false },
      { text: 'Deploy', done: false },
    ];
  }
  override onEnterGarage() {
    this.objectives[0].done = true;
    this.data.snapshot = JSON.stringify(this.profile.machines.map((m) => m.parts.map((p) => p.uid)));
  }
  override onEnterWorld() {
    if (!this.objectives[0].done) return;
    const now = JSON.stringify(this.profile.machines.map((m) => m.parts.map((p) => p.uid)));
    if (now !== this.data.snapshot) {
      this.objectives[1].done = true;
      this.objectives[2].done = true;
      this.complete();
    }
  }
  override markers(): CompassMarker[] {
    return this.objectives[0].done ? [] : [{ pos: this.app.props.garageDoor, label: 'Workshop', kind: 'obj' }];
  }
}

class ScrapRats extends Mission {
  start() {
    this.objectives = [
      { text: 'Find the Scrapper raiders at the Broken Overpass', done: false },
      { text: 'Destroy the raiding party (0/3)', done: false },
    ];
    this.data.kills = 0;
    this.data.spawned = false;
  }
  override update() {
    const L = getLocation('overpass');
    const c = new THREE.Vector3(L.x, 0, L.z);
    if (!this.data.spawned && this.near(c, 260)) {
      this.data.spawned = true;
      for (let i = 0; i < 3; i++) {
        const m = this.spawnEnemy({ faction: 'scrappers', tier: 0, pos: this.groundPoint(L.x + (i - 1) * 14, L.z - 20 + i * 6), role: i === 2 ? 'truck' : 'raider', elite: i === 2 });
        m.tag.missionTarget = true;
      }
    }
    if (this.data.spawned && this.near(c, 140)) this.objectives[0].done = true;
    this.objectives[1].text = `Destroy the raiding party (${this.data.kills}/3)`;
  }
  override onKill(m: Machine) {
    if (m.tag.mission === this.id) {
      this.data.kills++;
      this.objectives[0].done = true;
      if (this.data.kills >= 3) {
        this.objectives[1].done = true;
        this.complete();
      }
    }
  }
  override onEnterWorld() {
    this.data.spawned = false;
    this.data.kills = 0;
  }
  override markers(): CompassMarker[] {
    const L = getLocation('overpass');
    return [{ pos: new THREE.Vector3(L.x, 0, L.z), label: 'Raiders', kind: 'obj' }];
  }
}

class RoadToRustwater extends Mission {
  start() {
    this.objectives = [
      { text: 'Drive east along Route 9 to Rustwater', done: false },
      { text: 'Visit the Rustwater Salvage Market', done: false },
    ];
  }
  override onDiscover(l: string) {
    if (l === 'rustwater') this.objectives[0].done = true;
  }
  override update() {
    if (this.profile.flags.visitedMarket) {
      this.objectives[0].done = true;
      this.objectives[1].done = true;
      this.complete();
    }
  }
  override markers(): CompassMarker[] {
    const L = getLocation('rustwater');
    return [{ pos: new THREE.Vector3(L.x - 18, 0, L.z - 14), label: 'Rustwater market', kind: 'obj' }];
  }
}

class ConvoyEscort extends Mission {
  convoy: Machine | null = null;
  path: THREE.Vector3[] = [];
  start() {
    this.objectives = [
      { text: 'Meet the water convoy at Rustwater', done: false },
      { text: 'Escort it west along Route 9 to Dust Hollow', done: false },
      { text: 'The convoy must survive', done: false },
    ];
    this.data.ambush = 0;
  }
  override update() {
    const R = getLocation('rustwater');
    const start = new THREE.Vector3(R.x - 70, 0, R.z + 10);
    if (!this.convoy && this.near(start, 90)) {
      const road = ROADS.find((r) => r.id === 'route9')!;
      this.path = road.points
        .filter(([x]) => x < R.x - 40 && x > -720)
        .reverse()
        .map(([x, z]) => new THREE.Vector3(x, 0, z + 3));
      this.path.push(new THREE.Vector3(-700, 0, 95));
      const d = generateEnemy({ faction: 'independents', tier: 1, seed: 777, role: 'trader' });
      d.name = 'Water Hauler';
      const m = this.app.director.spawn({ faction: 'independents', tier: 1, pos: this.groundPoint(start.x, start.z), role: 'trader', name: 'Water Hauler', yaw: Math.PI / 2, ai: { path: this.path, passive: true, aggression: 0 } });
      m.tag.mission = this.id;
      m.tag.convoy = true;
      this.owned.add(m);
      this.app.director.protected.add(m);
      this.convoy = m;
      this.objectives[0].done = true;
      this.app.hud.notify('Convoy rolling out — stay close!', 'mission');
    }
    const c = this.convoy;
    if (!c) return;
    if (!c.alive) {
      this.fail('The water convoy was destroyed.');
      return;
    }
    const pilot = this.app.director.pilots.get(c);
    if (pilot) {
      // wait for the player
      const pl = this.player;
      const far = pl ? pl.currPos.distanceTo(c.currPos) > 90 : true;
      pilot.state = far ? 'patrol' : 'race';
      if (far) pilot.opts.home.copy(c.currPos);
    }
    // ambushes along the way
    const dx = c.currPos.x;
    const ambushXs = [150, -250, -520];
    if (this.data.ambush < ambushXs.length && dx < ambushXs[this.data.ambush]) {
      const n = 2 + this.data.ambush;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const p = this.groundPoint(c.currPos.x - 90 + Math.cos(a) * 30, c.currPos.z + Math.sin(a) * 60);
        const e = this.spawnEnemy({ faction: 'scrappers', tier: 1, pos: p });
        const ep = this.app.director.pilots.get(e);
        if (ep) {
          ep.target = c;
          ep.state = 'engage';
        }
      }
      this.app.hud.notify('Ambush! Scrappers closing on the convoy', 'bad');
      this.data.ambush++;
    }
    if (Math.hypot(c.currPos.x + 700, c.currPos.z - 95) < 45) {
      this.objectives[1].done = true;
      this.objectives[2].done = true;
      this.complete();
    }
  }
  override onEnterWorld() {
    if (this.convoy && !this.game.ctx.machines.includes(this.convoy)) {
      this.convoy = null;
      this.objectives[0].done = false;
      this.data.ambush = 0;
    }
  }
  override markers(): CompassMarker[] {
    if (!this.convoy) {
      const R = getLocation('rustwater');
      return [{ pos: new THREE.Vector3(R.x - 70, 0, R.z + 10), label: 'Convoy', kind: 'obj' }];
    }
    return [{ pos: this.convoy.currPos, label: 'Convoy', kind: 'obj' }];
  }
}

class FoundrySabotage extends Mission {
  rig: Machine | null = null;
  start() {
    this.objectives = [
      { text: 'Reach the Foundry Ruins', done: false },
      { text: 'Destroy the Scrapper generator rig', done: false },
    ];
  }
  override update() {
    const L = getLocation('foundry');
    if (!this.rig && this.near(new THREE.Vector3(L.x, 0, L.z), 320)) {
      const d = buildGeneratorRig();
      this.rig = this.game.spawnMachine(d, this.groundPoint(L.x + 20, L.z + 5), 0.3, 'scrappers');
      this.rig.tag.mission = this.id;
      this.app.director.protected.add(this.rig);
      this.owned.add(this.rig);
      for (let i = 0; i < 4; i++) this.spawnEnemy({ faction: 'scrappers', tier: 2, pos: this.groundPoint(L.x + Math.cos(i * 1.6) * 45, L.z + Math.sin(i * 1.6) * 45), elite: i === 0 });
    }
    if (this.near(new THREE.Vector3(L.x, 0, L.z), 150)) this.objectives[0].done = true;
    if (this.rig && !this.rig.alive) {
      this.objectives[1].done = true;
      this.complete();
    }
  }
  override onEnterWorld() {
    if (this.rig && !this.game.ctx.machines.includes(this.rig)) this.rig = null;
  }
  override markers(): CompassMarker[] {
    const L = getLocation('foundry');
    return [{ pos: this.rig ? this.rig.currPos : new THREE.Vector3(L.x, 0, L.z), label: 'Generator', kind: 'obj' }];
  }
}

class HelixSignal extends Mission {
  start() {
    this.objectives = [
      { text: 'Triangulate the strange signal in the southern canyons', done: false },
      { text: 'Deal with the Helix defences', done: false },
      { text: 'Pull the data core from the relay [E]', done: false },
    ];
    this.data.spawned = false;
  }
  override onDiscover(l: string) {
    if (l === 'helix') this.objectives[0].done = true;
  }
  override update() {
    const L = getLocation('helix');
    if (this.objectives[0].done && !this.data.spawned) {
      this.data.spawned = true;
      for (let i = 0; i < 4; i++) this.spawnEnemy({ faction: 'helix', tier: 3, pos: this.groundPoint(L.x + Math.cos(i * 1.57) * 40, L.z + Math.sin(i * 1.57) * 40), role: i < 3 ? 'drone' : 'scout', elite: i === 3 });
    }
    if (this.data.spawned && ![...this.owned].some((m) => m.alive)) this.objectives[1].done = true;
  }
  override interaction(m: Machine) {
    const L = getLocation('helix');
    if (this.objectives[1].done && !this.objectives[2].done && Math.hypot(m.currPos.x - L.x, m.currPos.z - L.z) < 22) {
      return {
        label: 'Extract the Helix data core',
        action: () => {
          this.objectives[2].done = true;
          this.complete();
        },
      };
    }
    return null;
  }
  override onEnterWorld() {
    this.data.spawned = false;
  }
  override markers(): CompassMarker[] {
    const L = getLocation('helix');
    // approximate until discovered
    if (!this.objectives[0].done) return [{ pos: new THREE.Vector3(L.x + 120, 0, L.z - 90), label: 'Signal (approx.)', kind: 'obj' }];
    return [{ pos: new THREE.Vector3(L.x, 0, L.z), label: 'Relay', kind: 'obj' }];
  }
}

class FortRaid extends Mission {
  start() {
    this.objectives = [
      { text: 'Infiltrate Fort Kessler', done: false },
      { text: 'Steal the prototype power core from the east hangar [E]', done: false },
      { text: 'Escape 500 m from the fort', done: false },
    ];
  }
  override update() {
    const L = getLocation('fort');
    if (this.near(new THREE.Vector3(L.x, 0, L.z), 120)) this.objectives[0].done = true;
    if (this.objectives[1].done) {
      if (!this.data.alarm) {
        this.data.alarm = true;
        for (let i = 0; i < 3; i++) this.spawnEnemy({ faction: 'authority', tier: 3, pos: this.groundPoint(L.x + (i - 1) * 30, L.z - 60), role: i === 0 ? 'gunship' : undefined });
        this.app.hud.notify('ALARM — Authority reinforcements inbound!', 'bad');
      }
      const pl = this.player;
      if (pl && Math.hypot(pl.currPos.x - L.x, pl.currPos.z - L.z) > 500) {
        this.objectives[2].done = true;
        this.complete();
      }
    }
  }
  override interaction(m: Machine) {
    const L = getLocation('fort');
    const h = new THREE.Vector3(L.x + 30, 0, L.z - 40);
    if (this.objectives[0].done && !this.objectives[1].done && Math.hypot(m.currPos.x - h.x, m.currPos.z - h.z) < 16) {
      return { label: 'Grab the prototype power core', action: () => { this.objectives[1].done = true; } };
    }
    return null;
  }
  override markers(): CompassMarker[] {
    const L = getLocation('fort');
    if (!this.objectives[1].done) return [{ pos: new THREE.Vector3(L.x + 30, 0, L.z - 40), label: 'Hangar', kind: 'obj' }];
    return [{ pos: getLocationVec('home'), label: 'Escape', kind: 'obj' }];
  }
}

class ExcavatorHunt extends Mission {
  boss: Machine | null = null;
  start() {
    this.objectives = [
      { text: 'Descend into The Pit', done: false },
      { text: 'Destroy THE EXCAVATOR', done: false },
      { text: 'Salvage its components', done: false },
    ];
  }
  override update() {
    const c = new THREE.Vector3(720, 0, -640);
    if (!this.boss && this.near(c, 240)) {
      this.boss = spawnExcavator(this.app, this.groundPoint(740, -655));
      this.boss.tag.mission = this.id;
      this.owned.add(this.boss);
      this.app.director.protected.add(this.boss);
      this.app.hud.banner('Boss', 'The Excavator', 'Target its knees, its bucket wheel and the reactor behind its back plates');
    }
    if (this.near(c, 150)) this.objectives[0].done = true;
    if (this.boss && !this.boss.alive && !this.objectives[1].done) {
      this.objectives[1].done = true;
      this.profile.world.bossDefeated.push('excavator');
      this.app.hud.banner('Boss defeated', 'The Excavator', 'Its unique components are yours — if they survived.');
    }
    if (this.objectives[1].done && this.boss && (this.boss.tag.stripped || this.boss.parts.filter((p) => p.detached && !p.destroyed).length > 0)) {
      this.objectives[2].done = true;
      this.complete();
    }
  }
  override onEnterGarage() {
    if (this.objectives[1].done) {
      this.objectives[2].done = true;
      this.complete();
    }
  }
  override onEnterWorld() {
    if (this.boss && !this.game.ctx.machines.includes(this.boss)) this.boss = null;
  }
  override markers(): CompassMarker[] {
    return [{ pos: this.boss ? this.boss.currPos : new THREE.Vector3(720, 0, -640), label: 'The Excavator', kind: 'obj' }];
  }
}

function getLocationVec(id: string) {
  const l = getLocation(id);
  return new THREE.Vector3(l.x, 0, l.z);
}

/** An immobile generator rig: a machine built from power parts, to be blown up. */
function buildGeneratorRig(): MachineDesign {
  const d = generateEnemy({ faction: 'scrappers', tier: 2, seed: 4040, role: 'hauler' });
  d.name = 'Scrapper Generator Rig';
  d.parts = d.parts.filter((p) => !['engine', 'transmission'].includes(getPart(p.defId).category));
  const deck = d.parts[0].uid;
  d.parts.push({ uid: uid('p'), defId: 'gen_diesel', parent: deck, socket: 'deck', offset: [-0.5, 1.2], rot: 0, tilt: 0, cond: 1 });
  d.parts.push({ uid: uid('p'), defId: 'gen_diesel', parent: deck, socket: 'deck', offset: [0.5, 0.2], rot: 0, tilt: 0, cond: 1 });
  d.parts.push({ uid: uid('p'), defId: 'fuel_drum', parent: deck, socket: 'deck', offset: [-0.6, -0.4], rot: 0, tilt: 0, cond: 1 });
  return d;
}

// ======================================================================== JOBS
class Job extends Mission {
  target: Machine | null = null;
  wreck: Machine | null = null;
  gates: THREE.Mesh[] = [];
  gateIdx = 0;
  timer = 0;
  wave = 0;
  constructor(app: App, public spec: JobSpec) {
    super(app, spec.id, spec.title, spec.desc, spec.reward);
  }
  get loc() {
    return getLocation(this.spec.loc);
  }
  start() {
    const s = this.spec;
    switch (s.kind) {
      case 'bounty':
        this.objectives = [{ text: `Hunt down ${this.data.name ?? 'the target'} near ${this.loc.name}`, done: false }];
        break;
      case 'salvage':
        this.objectives = [{ text: `Salvage 2 parts from the wreck at ${this.loc.name}`, done: false }];
        this.data.need = 2;
        break;
      case 'delivery':
        this.objectives = [{ text: `Deliver the supply crate to ${getLocation(s.dest!).name}`, done: false }];
        break;
      case 'race':
        this.objectives = [{ text: `Clear every gate before the timer runs out`, done: false }];
        break;
      case 'defend':
        this.objectives = [{ text: `Defend ${this.loc.name} from 3 attack waves`, done: false }];
        break;
      case 'capture':
        this.objectives = [
          { text: `Disable the target's wheels/legs/rotors near ${this.loc.name}`, done: false },
          { text: 'Commandeer it [E] — it joins your garage', done: false },
        ];
        break;
      case 'rescue':
        this.objectives = [
          { text: `Reach the stranded scavenger near ${this.loc.name}`, done: false },
          { text: 'Hold the area until the pickup (60 s)', done: false },
          { text: 'Bring them to Rustwater', done: false },
        ];
        break;
    }
  }
  private spawnPoint(r = 60) {
    const a = Math.random() * Math.PI * 2;
    return this.groundPoint(this.loc.x + Math.cos(a) * r, this.loc.z + Math.sin(a) * r);
  }
  override update(dt: number) {
    const s = this.spec;
    const pl = this.player;
    if (!pl) return;
    const center = new THREE.Vector3(this.loc.x, 0, this.loc.z);
    const near = this.near(center, Math.max(260, this.loc.radius + 180));
    if (s.kind === 'bounty') {
      if (!this.target && near) {
        const factions: any = this.loc.faction && this.loc.faction !== 'independents' ? this.loc.faction : 'scrappers';
        this.target = this.spawnEnemy({ faction: factions, tier: s.tier, pos: this.spawnPoint(), elite: true, name: this.data.name });
        for (let i = 0; i < Math.min(3, s.tier); i++) this.spawnEnemy({ faction: factions, tier: Math.max(0, s.tier - 1), pos: this.spawnPoint(40) });
      }
      if (this.target && !this.target.alive) {
        this.objectives[0].done = true;
        this.complete();
      }
    } else if (s.kind === 'salvage') {
      if (!this.wreck && near) {
        const d = generateEnemy({ faction: s.tier >= 3 ? 'authority' : 'scrappers', tier: s.tier + 1, seed: s.seed, cls: Math.random() < 0.5 ? 'air' : undefined });
        d.name = `Crashed ${d.name}`;
        for (const p of d.parts) p.cond = Math.random() < 0.3 ? 0 : 0.3 + Math.random() * 0.6;
        d.parts[0].cond = 0.2;
        const cp = d.parts.find((p) => getPart(p.defId).category === 'cockpit');
        if (cp) cp.cond = 0.1;
        this.wreck = this.game.spawnMachine(d, this.spawnPoint(30), Math.random() * 6, 'neutral', false, 0.1);
        this.wreck.kill(null, 'bailed');
        this.owned.add(this.wreck);
        this.app.director.protected.add(this.wreck);
        this.data.base = this.profile.stats.partsSalvaged;
        if (s.tier >= 1) for (let i = 0; i < s.tier; i++) this.spawnEnemy({ faction: 'scrappers', tier: s.tier, pos: this.spawnPoint(80) });
      }
      if (this.wreck) {
        const taken = this.wreck.parts.filter((p) => p.detached && !p.destroyed).length;
        this.objectives[0].text = `Salvage 2 parts from the wreck (${Math.min(2, taken)}/2)`;
        if (taken >= 2) {
          this.objectives[0].done = true;
          this.complete();
        }
      }
    } else if (s.kind === 'delivery') {
      const dest = getLocation(s.dest!);
      if (Math.hypot(pl.currPos.x - dest.x, pl.currPos.z - dest.z) < 40) {
        this.objectives[0].done = true;
        this.complete();
      }
      if (!this.data.ambushed && Math.hypot(pl.currPos.x - dest.x, pl.currPos.z - dest.z) < 350 && s.tier > 0) {
        this.data.ambushed = true;
        for (let i = 0; i < s.tier + 1; i++) this.spawnEnemy({ faction: 'scrappers', tier: s.tier, pos: this.groundPoint(pl.currPos.x + 80 * Math.cos(i * 2), pl.currPos.z + 80 * Math.sin(i * 2)) });
        this.app.hud.notify('Raiders want your cargo!', 'bad');
      }
    } else if (s.kind === 'race') {
      if (!this.gates.length) this.buildRace();
      if (this.data.started) {
        this.timer -= dt;
        this.objectives[0].text = `Gates ${this.gateIdx}/${this.gates.length} · ${Math.max(0, this.timer).toFixed(1)} s left`;
        const g = this.gates[this.gateIdx];
        if (g && pl.currPos.distanceTo(g.position) < 11) {
          (g.material as THREE.MeshBasicMaterial).color.set(0x55ff77);
          this.gateIdx++;
          this.game.audio.play('ui_good', null, { volume: 0.5 });
          if (this.gateIdx >= this.gates.length) {
            this.objectives[0].done = true;
            const best = this.profile.stats.bestRace;
            const time = this.data.limit - this.timer;
            if (best === null || time < best) this.profile.stats.bestRace = time;
            this.reward = { ...this.reward, credits: Math.round((this.reward.credits ?? 0) * (1 + this.timer / this.data.limit)) };
            this.complete();
          }
        }
        if (this.timer <= 0) this.fail('Out of time.');
      } else if (pl.currPos.distanceTo(this.gates[0].position) < 11) {
        this.data.started = true;
        this.gateIdx = 1;
        this.timer = this.data.limit;
        this.app.hud.notify('GO! Race started', 'mission');
      }
      for (const [i, g] of this.gates.entries()) {
        g.rotation.y += dt * 0.5;
        g.visible = i >= this.gateIdx - 1;
      }
    } else if (s.kind === 'defend') {
      if (!near) return;
      const alive = [...this.owned].filter((m) => m.alive).length;
      if (alive === 0) {
        if (this.wave >= 3) {
          this.objectives[0].done = true;
          this.complete();
          return;
        }
        this.wave++;
        this.objectives[0].text = `Defend ${this.loc.name}: wave ${this.wave}/3`;
        this.app.hud.notify(`Wave ${this.wave} incoming`, 'bad');
        for (let i = 0; i < 1 + this.wave + s.tier; i++) {
          const m = this.spawnEnemy({ faction: 'scrappers', tier: s.tier + (this.wave === 3 ? 1 : 0), pos: this.spawnPoint(200), elite: this.wave === 3 && i === 0 });
          const p = this.app.director.pilots.get(m);
          if (p) {
            p.opts.home.set(this.loc.x, 0, this.loc.z);
            p.target = pl;
            p.state = 'engage';
          }
        }
      }
    } else if (s.kind === 'capture') {
      if (!this.target && near) {
        this.target = this.spawnEnemy({ faction: 'scrappers', tier: s.tier, pos: this.spawnPoint(), role: Math.random() < 0.5 ? 'raider' : 'truck', name: this.data.name });
      }
      if (this.target) {
        if (!this.target.alive && !this.target.tag.captured) {
          this.fail('The target was destroyed — it had to be taken intact.');
          return;
        }
        this.objectives[0].done = this.target.immobile;
      }
    } else if (s.kind === 'rescue') {
      const c = new THREE.Vector3(this.loc.x + 20, 0, this.loc.z + 10);
      if (!this.objectives[0].done && this.near(c, 30)) {
        this.objectives[0].done = true;
        this.timer = 60;
        for (let i = 0; i < 2 + s.tier; i++) this.spawnEnemy({ faction: 'scrappers', tier: s.tier, pos: this.spawnPoint(150) });
        this.app.hud.notify('Hold position! Pickup in 60 seconds', 'mission');
      }
      if (this.objectives[0].done && !this.objectives[1].done) {
        this.timer -= dt;
        this.objectives[1].text = `Hold the area until the pickup (${Math.max(0, Math.ceil(this.timer))} s)`;
        if (this.timer <= 0) {
          this.objectives[1].done = true;
          this.app.hud.notify('Scavenger aboard — head to Rustwater', 'good');
        }
      }
      if (this.objectives[1].done) {
        const R = getLocation('rustwater');
        if (Math.hypot(pl.currPos.x - R.x, pl.currPos.z - R.z) < 60) {
          this.objectives[2].done = true;
          this.complete();
        }
      }
    }
  }
  private buildRace() {
    const pts: THREE.Vector3[] = [];
    const canyon = this.spec.loc === 'canyons';
    if (canyon) {
      const path: [number, number][] = [[-290, 520], [-360, 540], [-420, 500], [-500, 470], [-580, 500], [-640, 560], [-620, 640], [-540, 740], [-440, 770], [-330, 760], [-250, 760]];
      for (const [x, z] of path) pts.push(this.groundPoint(x, z).add(new THREE.Vector3(0, 4, 0)));
    } else {
      const road = ROADS.find((r) => r.id === 'route9')!;
      for (const [x, z] of road.points.slice(2, 11)) pts.push(this.groundPoint(x, z).add(new THREE.Vector3(0, 4, 0)));
    }
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    this.data.limit = Math.round(len / 17 + 20);
    const geo = new THREE.TorusGeometry(8, 0.35, 8, 40);
    for (const [i, p] of pts.entries()) {
      const g = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: i === 0 ? 0xffd23a : 0xff9a2a, transparent: true, opacity: 0.85 }));
      g.position.copy(p);
      if (i < pts.length - 1) g.lookAt(pts[i + 1]);
      this.game.scene.add(g);
      this.gates.push(g);
    }
  }
  override interaction(m: Machine) {
    if (this.spec.kind === 'capture' && this.target && this.target.alive && this.target.immobile && m.currPos.distanceTo(this.target.currPos) < 14) {
      return {
        label: `Commandeer ${this.target.name}`,
        action: () => {
          const t = this.target!;
          t.tag.captured = true;
          t.syncDesignCondition();
          const p = this.profile;
          const design: MachineDesign = JSON.parse(JSON.stringify(t.design));
          design.id = uid('mach');
          design.name = `${t.name} (captured)`;
          for (const part of design.parts) part.uid = uid('p');
          // keep only parts that are still attached
          const attached = new Set(t.parts.filter((x) => !x.detached).map((x) => x.placed.uid));
          const map = new Map<string, string>();
          t.design.parts.forEach((orig, i) => map.set(orig.uid, design.parts[i].uid));
          design.parts = design.parts.filter((_, i) => attached.has(t.design.parts[i].uid));
          for (const part of design.parts) if (part.parent) part.parent = map.get(part.parent) ?? part.parent;
          const bays = Math.max(3, p.workshop.bays);
          if (p.machines.length < bays) {
            p.machines.push(design);
            this.app.hud.notify(`${design.name} has been towed to your garage!`, 'good');
          } else {
            for (const part of design.parts) p.inventory.push({ uid: part.uid, defId: part.defId, cond: part.cond });
            this.app.hud.notify('No free bay — the captured machine was stripped into storage.', 'loot');
          }
          t.kill(null, 'bailed');
          t.tag.stripped = true;
          t.root.visible = false;
          this.objectives[1].done = true;
          this.complete();
        },
      };
    }
    return null;
  }
  override cleanup() {
    super.cleanup();
    for (const g of this.gates) this.game.scene.remove(g);
    this.gates = [];
  }
  override onEnterWorld() {
    this.target = null;
    this.wreck = null;
    this.wave = 0;
    this.data.started = false;
    this.gateIdx = 0;
  }
  override onEnterGarage() {
    for (const g of this.gates) this.game.scene.remove(g);
    this.gates = [];
  }
  override markers(): CompassMarker[] {
    const s = this.spec;
    if (s.kind === 'delivery') {
      const d = getLocation(s.dest!);
      return [{ pos: new THREE.Vector3(d.x, 0, d.z), label: d.name, kind: 'obj' }];
    }
    if (s.kind === 'race' && this.gates.length) {
      const g = this.gates[Math.min(this.gateIdx, this.gates.length - 1)];
      return [{ pos: g.position, label: this.data.started ? `Gate ${this.gateIdx + 1}` : 'Start', kind: 'obj' }];
    }
    if (s.kind === 'rescue' && this.objectives[1].done) {
      const R = getLocation('rustwater');
      return [{ pos: new THREE.Vector3(R.x, 0, R.z), label: 'Rustwater', kind: 'obj' }];
    }
    const t = this.target?.alive ? this.target.currPos : this.wreck ? this.wreck.currPos : new THREE.Vector3(this.loc.x, 0, this.loc.z);
    return [{ pos: t, label: s.title, kind: 'obj' }];
  }
}

// ======================================================================== SYSTEM
const STORY: { id: string; title: string; desc: string; requires: string[]; reward: Reward; make: (app: App) => Mission }[] = [
  { id: 'm_range', title: 'Rust Off the Guns', desc: 'Test your guns on the range and learn to salvage.', requires: [], reward: { credits: 300, xp: 120, resources: { scrap: 20 } }, make: (a) => new RangeTutorial(a, 'm_range', 'Rust Off the Guns', '', {}) },
  { id: 'm_build', title: 'New Parts, New Tricks', desc: 'Install a part in the workshop and roll out again.', requires: ['m_range'], reward: { credits: 200, xp: 100, resources: { data: 5 } }, make: (a) => new FirstBuild(a, 'm_build', 'New Parts, New Tricks', '', {}) },
  { id: 'm_rats', title: 'Scrap Rats', desc: 'A Scrapper raiding party is ambushing travellers at the Broken Overpass.', requires: ['m_build'], reward: { credits: 700, xp: 250, parts: ['wpn_twinlmg'] }, make: (a) => new ScrapRats(a, 'm_rats', 'Scrap Rats', '', {}) },
  { id: 'm_rustwater', title: 'Road to Rustwater', desc: 'Find the trading post at the last working water pump.', requires: ['m_rats'], reward: { credits: 250, xp: 150 }, make: (a) => new RoadToRustwater(a, 'm_rustwater', 'Road to Rustwater', '', {}) },
  { id: 'm_convoy', title: 'Water Run', desc: 'Escort a water hauler from Rustwater to Dust Hollow. Scrappers will want it.', requires: ['m_rustwater'], reward: { credits: 1400, xp: 400, parts: ['fuel_armored', 'sus_heavy', 'sus_heavy'] }, make: (a) => new ConvoyEscort(a, 'm_convoy', 'Water Run', '', {}) },
  { id: 'm_foundry', title: 'Cut the Power', desc: 'The Scrappers run their Foundry camp off a generator rig. Destroy it.', requires: ['m_convoy'], reward: { credits: 1800, xp: 600, resources: { mechanical: 30, electronics: 15 }, parts: ['frm_pickup'] }, make: (a) => new FoundrySabotage(a, 'm_foundry', 'Cut the Power', '', {}) },
  { id: 'm_signal', title: 'Signal in the Canyons', desc: 'A clean, repeating signal is coming from somewhere in the Red Canyons.', requires: ['m_foundry'], reward: { credits: 1500, xp: 800, resources: { data: 30, raretech: 3 }, blueprint: 'ckp_helix' }, make: (a) => new HelixSignal(a, 'm_signal', 'Signal in the Canyons', '', {}) },
  { id: 'm_fort', title: 'Authority Presence', desc: 'The Iron Authority is hiding a prototype reactor at Fort Kessler. Take it.', requires: ['m_signal'], reward: { credits: 2500, xp: 1000, parts: ['gen_core_mil'], blueprint: 'wpn_railgun' }, make: (a) => new FortRaid(a, 'm_fort', 'Authority Presence', '', {}) },
  { id: 'm_excavator', title: 'The Excavator', desc: 'Something enormous still works at the bottom of The Pit. Kill it and take its parts.', requires: ['m_foundry'], reward: { credits: 5000, xp: 2000, resources: { alloys: 30, raretech: 6 }, blueprint: 'act_titan' }, make: (a) => new ExcavatorHunt(a, 'm_excavator', 'The Excavator', '', {}) },
];

const BOUNTY_NAMES = ['"Rattlesnake" Voss', 'Old Iron Kate', 'The Gutter King', 'Mad Dog Mercer', 'Scab', 'Two-Wheel Tully', 'Lady Carbide', 'Boomstick Brody', 'The Welder', 'Crankjaw'];

export class MissionSystem {
  active: Mission[] = [];
  board: JobSpec[] = [];
  private profile: Profile | null = null;
  constructor(private app: App) {
    app.game.events.on('machineKilled', (k) => {
      for (const m of this.active) m.onKill(k.machine, k.source);
    });
  }

  load(p: Profile) {
    this.profile = p;
    for (const m of this.active) m.cleanup();
    this.active = [];
    // restore active story missions (restart them) and accepted jobs
    for (const st of p.missions.active) {
      const def = STORY.find((s) => s.id === st.id);
      if (def) {
        const m = def.make(this.app);
        m.reward = def.reward;
        m.title = def.title;
        m.desc = def.desc;
        m.start();
        this.active.push(m);
      } else if (st.data?.spec) {
        const j = new Job(this.app, st.data.spec);
        j.data.name = st.data.spec.name;
        j.start();
        this.active.push(j);
      }
    }
    this.checkStory();
    this.refreshBoard();
  }

  private persist() {
    const p = this.profile;
    if (!p) return;
    p.missions.active = this.active.map((m) => ({ id: m.id, stage: 0, data: m instanceof Job ? { spec: { ...m.spec, name: m.data.name } } : {} }));
  }

  checkStory() {
    const p = this.profile;
    if (!p) return;
    for (const s of STORY) {
      if (p.missions.done.includes(s.id)) continue;
      if (this.active.some((m) => m.id === s.id)) continue;
      if (!s.requires.every((r) => p.missions.done.includes(r))) continue;
      const m = s.make(this.app);
      m.reward = s.reward;
      m.title = s.title;
      m.desc = s.desc;
      m.start();
      this.active.push(m);
      if (this.app.mode === 'world') {
        this.app.hud.notify(`New contract: ${s.title}`, 'mission');
        this.app.game.audio.play('ui_good', null, { volume: 0.6 });
      }
      if (!p.missions.tracked) p.missions.tracked = s.id;
    }
    this.persist();
  }

  refreshBoard(force = false) {
    const p = this.profile;
    if (!p) return;
    const day = this.app.game.env.day;
    if (!force && p.missions.boardDay === day && p.missions.board.length) {
      this.board = p.missions.board;
      return;
    }
    const rng = new RNG(day * 7919 + p.created % 1000);
    const kinds: JobKind[] = ['bounty', 'salvage', 'delivery', 'race', 'defend', 'capture', 'rescue'];
    const locs = LOCATIONS.filter((l) => l.kind !== 'home' && l.id !== 'rustwater' && (!l.hidden || p.discovered.includes(l.id)));
    const rank = p.rank.level;
    this.board = [];
    for (let i = 0; i < 5; i++) {
      const kind = rng.pick(kinds);
      const loc = kind === 'defend' ? rng.pick(['rustwater', 'dusthollow']) : kind === 'race' ? rng.pick(['canyons', 'overpass']) : rng.pick(locs).id;
      const L = getLocation(loc);
      const tier = clamp(Math.round(L.danger * 0.6 + rank * 0.25 + rng.range(-0.5, 0.8)), 0, 4);
      const base = 350 + tier * 400;
      const name = rng.pick(BOUNTY_NAMES);
      const dest = kind === 'delivery' ? rng.pick(['dusthollow', 'fort', 'foundry', 'radiotower'].filter((x) => x !== loc)) : undefined;
      const titles: Record<JobKind, string> = {
        bounty: `Bounty: ${name}`,
        salvage: `Salvage run: ${L.name}`,
        delivery: `Delivery to ${dest ? getLocation(dest).name : ''}`,
        race: `Race: ${L.id === 'canyons' ? 'Canyon Run' : 'Route 9 Sprint'}`,
        defend: `Defend ${L.name}`,
        capture: `Capture: ${name}'s ride`,
        rescue: `Rescue near ${L.name}`,
      };
      const descs: Record<JobKind, string> = {
        bounty: `${name} has a price on their head and a nasty machine. Last seen near ${L.name}. Elite machines carry rare parts.`,
        salvage: `A machine went down near ${L.name}. Cut two usable parts out of it before the Scrappers do.`,
        delivery: `Take a crate of spares from Rustwater to ${dest ? getLocation(dest).name : ''}. Arrive in one piece.`,
        race: 'Gates, a timer and bragging rights. Any machine allowed — wheels, rotors or legs.',
        defend: `${L.name} expects an attack. Hold off three waves.`,
        capture: `Disable the machine's locomotion without killing the pilot, then commandeer it. You keep the machine.`,
        rescue: `A scavenger is pinned down near ${L.name}. Hold the area, then bring them home.`,
      };
      const reward: Reward = { credits: Math.round(base * (kind === 'capture' ? 0.6 : 1)), xp: 120 + tier * 90, resources: { scrap: 10 + tier * 10, data: tier } };
      if (rng.chance(0.25 + tier * 0.08)) reward.parts = [rng.pick(['wpn_hmg', 'wpn_autocannon', 'rot_ducted', 'act_servo', 'eng_i6', 'arm_steel_l', 'bat_liion', 'whl_street', 'cool_heatsink', 'jj_scrap', 'wpn_rockets', 'leg_strider'])];
      this.board.push({ id: `job_${day}_${i}_${Math.floor(rng.next() * 1e5)}`, kind, title: titles[kind], desc: descs[kind], loc, dest, tier, reward, seed: Math.floor(rng.next() * 1e6), name } as JobSpec & { name: string });
    }
    p.missions.board = this.board;
    p.missions.boardDay = day;
  }

  accept(spec: JobSpec) {
    if (this.active.filter((m) => m instanceof Job).length >= 3) {
      this.app.hud.notify('You can hold at most 3 board contracts.', 'bad');
      return false;
    }
    const j = new Job(this.app, spec);
    j.data.name = (spec as any).name;
    j.start();
    this.active.push(j);
    this.board = this.board.filter((b) => b.id !== spec.id);
    this.profile!.missions.board = this.board;
    this.profile!.missions.tracked = j.id;
    this.persist();
    this.app.hud.notify(`Accepted: ${spec.title}`, 'mission');
    return true;
  }

  abandon(id: string) {
    const m = this.active.find((x) => x.id === id);
    if (!m) return;
    if (!(m instanceof Job)) {
      this.app.hud.notify('Story contracts cannot be abandoned.', 'bad');
      return;
    }
    m.cleanup();
    this.active = this.active.filter((x) => x !== m);
    this.persist();
  }

  completeMission(m: Mission) {
    const p = this.profile!;
    this.active = this.active.filter((x) => x !== m);
    if (!(m instanceof Job)) p.missions.done.push(m.id);
    const r = m.reward;
    const parts: string[] = [];
    if (r.credits) p.credits += r.credits;
    if (r.resources) addResources(p, r.resources);
    for (const id of r.parts ?? []) {
      p.inventory.push({ uid: uid('p'), defId: id, cond: 1 });
      parts.push(getPart(id).name);
    }
    if (r.blueprint && !p.blueprints.includes(r.blueprint)) p.blueprints.push(r.blueprint);
    if (r.xp) this.app.gainXp(r.xp);
    const bits = [r.credits ? `¢${r.credits}` : '', ...parts, r.blueprint ? `Blueprint: ${getPart(r.blueprint).name}` : ''].filter(Boolean).join(' · ');
    this.app.hud.banner('Contract complete', m.title, bits);
    this.app.game.audio.play('ui_good', null, { volume: 0.8 });
    if (p.missions.tracked === m.id) p.missions.tracked = this.active[0]?.id ?? null;
    this.checkStory();
    this.persist();
    saveProfile(p);
  }

  failMission(m: Mission, reason: string) {
    const p = this.profile!;
    this.app.hud.banner('Contract failed', m.title, reason);
    if (m instanceof Job) this.active = this.active.filter((x) => x !== m);
    else {
      // story missions restart
      this.active = this.active.filter((x) => x !== m);
      this.checkStory();
    }
    if (p.missions.tracked === m.id) p.missions.tracked = this.active[0]?.id ?? null;
    this.persist();
  }

  fixedUpdate(dt: number) {
    if (this.app.mode !== 'world') return;
    for (const m of [...this.active]) if (!m.finished) m.update(dt);
    if (this.profile && this.profile.missions.boardDay !== this.app.game.env.day) this.refreshBoard();
  }

  onDiscover(l: string) {
    for (const m of this.active) m.onDiscover(l);
  }
  onEnterGarage() {
    for (const m of [...this.active]) m.onEnterGarage();
    for (const m of this.active) m.cleanup();
  }
  onEnterWorld() {
    for (const m of this.active) m.onEnterWorld();
  }

  interaction(pm: Machine) {
    for (const m of this.active) {
      const i = m.interaction(pm);
      if (i) return i;
    }
    return null;
  }

  tracked(): Mission | null {
    const id = this.profile?.missions.tracked;
    return this.active.find((m) => m.id === id) ?? this.active[0] ?? null;
  }

  trackerInfo() {
    const m = this.tracked();
    if (!m) return null;
    return { title: m.title, objectives: m.objectives };
  }

  markers(): CompassMarker[] {
    const m = this.tracked();
    return m ? m.markers() : [];
  }

  storyList() {
    return STORY;
  }
}

export { Mission };
