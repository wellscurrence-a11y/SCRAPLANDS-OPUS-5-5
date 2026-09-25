/**
 * Top-level game: owns the renderer, world simulation, fixed-step loop and state.
 */
import * as THREE from 'three';
import { Renderer } from '../render/renderer';
import { Environment } from '../render/environment';
import { FX } from '../render/particles';
import { Terrain } from '../world/terrain';
import { initPhysics, Physics, FIXED_DT, RAPIER } from '../physics/physics';
import { EventBus } from './events';
import type { Faction, GameEvents, WorldContext, AudioAPI } from './context';
import { Machine } from '../machines/machine';
import type { MachineDesign } from '../machines/types';
import { Projectiles } from '../combat/projectiles';
import { DebrisSystem } from '../world/debris';
import { ChaseCamera } from './camera';
import { input } from './input';
import { PlayerControl } from '../gameplay/playerControl';
import { registerAllMeshes } from '../machines/parts/meshes';
import { detailSettings } from '../machines/parts/kit';
import { SilentAudio } from '../audio/audio';
import { clamp } from './math';
import type { PartRuntime } from '../machines/part';

export type GameState = 'loading' | 'title' | 'world' | 'garage';

const HOSTILITY: Record<string, Faction[]> = {
  player: ['scrappers', 'authority', 'helix'],
  scrappers: ['player', 'independents', 'authority', 'helix'],
  authority: ['player', 'scrappers', 'helix'],
  helix: ['player', 'scrappers', 'authority'],
  independents: ['scrappers'],
  neutral: [],
};

export interface Hooks {
  fixed: ((dt: number) => void)[];
  frame: ((dt: number) => void)[];
  /** Called after the graphics preset changes. */
  preset: (() => void)[];
}

export class Game {
  renderer!: Renderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(68, 1, 0.25, 6500);
  physics!: Physics;
  terrain = new Terrain();
  env!: Environment;
  fx = new FX();
  events = new EventBus<GameEvents>();
  ctx!: WorldContext;
  chase!: ChaseCamera;
  control = new PlayerControl(input);
  player: Machine | null = null;
  state: GameState = 'loading';
  paused = false;
  timeScale = 1;
  private acc = 0;
  private last = performance.now();
  manual = false;
  hooks: Hooks = { fixed: [], frame: [], preset: [] };
  audio: AudioAPI = new SilentAudio();
  frameCount = 0;
  fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;
  /** Debug camera override (tests/screenshots). */
  debugCam: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  /** Optional external renderer for the garage state. */
  garageRender: ((dt: number) => void) | null = null;

  async init(container: HTMLElement, onProgress: (p: number, label: string) => void) {
    registerAllMeshes();
    this.renderer = new Renderer(container);
    this.renderer.setQuality('high');
    onProgress(0.05, 'Starting physics');
    await initPhysics();
    this.physics = new Physics();
    onProgress(0.1, 'Shaping the basin');
    await tick();
    this.terrain.generate((p) => onProgress(0.1 + p * 0.5, 'Shaping the basin'));
    onProgress(0.62, 'Building terrain');
    await tick();
    this.terrain.buildMeshes();
    this.physics.addTerrain(this.terrain.data.heights);
    this.scene.add(this.terrain.group);
    this.env = new Environment(this.scene);
    this.env.setShadowQuality(this.renderer.preset.shadowSize, this.renderer.preset.shadowRange);
    onProgress(0.72, 'Casting long shadows');
    await tick();
    this.terrain.updateFarShadow(this.env.atm.lightDir);
    this.fx.ground = (x, z) => this.terrain.heightAt(x, z);
    this.scene.add(this.fx.group);
    const game = this;
    this.ctx = {
      scene: this.scene,
      camera: this.camera,
      physics: this.physics,
      terrain: this.terrain,
      fx: this.fx,
      env: this.env,
      get audio() {
        return game.audio;
      },
      events: this.events,
      machines: [],
      time: 0,
      player: null,
      projectiles: null as any,
      debris: null as any,
      hostile: (a: Faction, b: Faction) => (HOSTILITY[a] ?? []).includes(b),
    } as WorldContext;
    this.ctx.projectiles = new Projectiles(this.ctx);
    this.ctx.debris = new DebrisSystem(this.ctx);
    this.chase = new ChaseCamera(this.ctx);
    input.attach(this.renderer.renderer.domElement);
    this.events.on('explosion', ({ pos, size }) => {
      if (!this.player) return;
      const d = pos.distanceTo(this.camera.position);
      this.chase.addTrauma(clamp((size * 30) / Math.max(8, d) - 0.05, 0, 0.8));
    });
    this.events.on('footstep', ({ machine, weight }) => {
      if (machine === this.player) this.chase.addTrauma(clamp(weight / 12000, 0, 0.18));
    });
    this.events.on('hit', (h) => {
      if (h.machine === this.player) this.chase.addTrauma(clamp(h.damage / 120, 0.02, 0.4));
    });
    this.events.on('shot', (s) => {
      if (s.machine === this.player && s.size > 0.7) this.chase.addTrauma(clamp(s.size * 0.12, 0, 0.3));
    });
    onProgress(0.85, 'Warming up shaders');
    await tick();
  }

  /** Push the renderer's quality preset to every system that scales with it. */
  applyPreset() {
    const p = this.renderer.preset;
    this.env.setShadowQuality(p.shadowSize, p.shadowRange);
    this.fx.quality = p.particles;
    this.terrain.setQuality(p.lodScale, p.terrainShadows, p.detail < 1);
    this.env.sky.setLight(p.detail < 1);
    detailSettings.world = p.detail;
    detailSettings.smallPartDistance = p.smallPartDistance;
    for (const h of this.hooks.preset) h();
  }

  spawnMachine(design: MachineDesign, pos: THREE.Vector3, yaw: number, faction: Faction, isPlayer = false, fuelFraction = 1) {
    const y = Math.max(pos.y, this.terrain.heightAt(pos.x, pos.z) + this.spawnHeight(design));
    const m = new Machine(this.ctx, design, { position: new THREE.Vector3(pos.x, y, pos.z), yaw, faction, isPlayer, fuelFraction });
    this.ctx.machines.push(m);
    if (isPlayer) {
      this.player = m;
      this.ctx.player = m;
      this.chase.snapTo(m);
    }
    return m;
  }

  private spawnHeight(d: MachineDesign) {
    return d.cls === 'mech' ? 3.2 : d.cls === 'air' ? 1.8 : 1.4;
  }

  removeMachine(m: Machine) {
    const i = this.ctx.machines.indexOf(m);
    if (i >= 0) this.ctx.machines.splice(i, 1);
    m.dispose();
    if (m === this.player) {
      this.player = null;
      this.ctx.player = null;
    }
  }

  /** One fixed simulation step. */
  step(dt: number) {
    const ctx = this.ctx;
    if (this.player && this.state === 'world') this.control.apply(this.player, this.chase, dt);
    for (const h of this.hooks.fixed) h(dt);
    for (const m of ctx.machines) m.prePhysics(dt);
    this.physics.step();
    this.handleContacts();
    for (const m of ctx.machines) m.postPhysics();
    ctx.projectiles.fixedUpdate(dt);
    ctx.time += dt;
  }

  private handleContacts() {
    const owners = this.physics.owners;
    this.physics.eventQueue.drainContactForceEvents((ev) => {
      const f = ev.totalForceMagnitude();
      const a = owners.get(ev.collider1()) as any;
      const b = owners.get(ev.collider2()) as any;
      const apply = (self: any, other: any) => {
        if (!self || !self.machine) return;
        const m = self.machine as Machine;
        const part = self.part as PartRuntime;
        const thresh = 8000 + m.stats.mass * 6;
        let dmg = Math.max(0, f - thresh) * 0.00007;
        if (dmg < 1) return;
        if (part.def.category === 'ram') dmg *= part.def.stats.ramArmor ?? 0.5;
        if (other && other.machine && other.part) {
          const op = other.part as PartRuntime;
          if (op.def.category === 'ram') dmg *= op.def.stats.ramDamage ?? 1.5;
          if (op.def.category === 'wheel') dmg *= op.def.stats.ramDamage ?? 1;
        }
        dmg = Math.min(dmg, 400);
        m.damagePartDirect(part, dmg, other?.machine ?? null, 'ram');
        const p = part.worldCenter;
        if (dmg > 5) {
          this.fx.sparks(p, new THREE.Vector3(0, 1, 0), Math.min(30, dmg), 8, 1);
          this.audio.play('crash', p, { volume: clamp(dmg / 60, 0.2, 1) });
          if (m === this.player) this.chase.addTrauma(clamp(dmg / 80, 0.05, 0.6));
        }
      };
      apply(a, b);
      apply(b, a);
    });
    // Clear collision events we do not use
    this.physics.eventQueue.clear();
  }

  /** Visual update with interpolation. */
  frameUpdate(dt: number, alpha: number) {
    const ctx = this.ctx;
    for (const m of ctx.machines) m.update(dt, alpha);
    ctx.debris.update(dt);
    ctx.projectiles.update(dt);
    const md = input.consumeMouse();
    const wheel = input.consumeWheel();
    this.chase.update(dt, this.player, input.pointerLocked || this.manual ? md.dx : 0, input.pointerLocked || this.manual ? md.dy : 0, wheel);
    if (this.debugCam) {
      this.camera.position.copy(this.debugCam.pos);
      this.camera.lookAt(this.debugCam.target);
    }
    for (const h of this.hooks.frame) h(dt);
    const focus = this.player ? this.player.currPos : this.chase.focus;
    this.env.update(dt, focus, this.camera, this.renderer.renderer);
    this.renderer.renderer.toneMappingExposure = this.env.atm.exposure;
    this.fx.update(dt, this.camera.position, this.env.hemi.color.clone().multiplyScalar(this.env.hemi.intensity), this.env.sun.color.clone().multiplyScalar(this.env.sun.intensity * 0.35));
    this.audio.listener.copy(this.camera.position);
  }

  start() {
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.fpsAcc += dt;
      this.fpsFrames++;
      if (this.fpsAcc > 0.5) {
        this.fps = this.fpsFrames / this.fpsAcc;
        this.fpsAcc = 0;
        this.fpsFrames = 0;
      }
      if (!this.manual) {
        this.frame(dt);
        if (this.state !== 'loading') this.renderer.adapt(dt);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  frame(dt: number) {
    this.frameCount++;
    if (this.state === 'world') {
      if (!this.paused) {
        this.acc += dt * this.timeScale;
        let steps = 0;
        // At most 3 catch-up steps: on a slow device the game slows down slightly
        // instead of spiralling into ever longer frames.
        while (this.acc >= FIXED_DT && steps < 3) {
          this.step(FIXED_DT);
          this.acc -= FIXED_DT;
          steps++;
        }
        if (steps >= 3) this.acc = Math.min(this.acc, FIXED_DT);
      }
      this.frameUpdate(this.paused ? 0 : dt, this.acc / FIXED_DT);
      this.renderer.render(this.scene, this.camera, dt);
    } else if (this.state === 'garage' && this.garageRender) {
      this.garageRender(dt);
    } else if (this.state === 'title') {
      this.frameUpdate(dt, 1);
      this.renderer.render(this.scene, this.camera, dt);
    }
    input.endFrame();
  }

  /** Advance the simulation deterministically (for tests). */
  simulate(seconds: number, render = false) {
    const steps = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < steps; i++) {
      this.step(FIXED_DT);
      if (i % 4 === 0 || i === steps - 1) this.frameUpdate(FIXED_DT * 4, 1);
    }
    if (render) this.renderer.render(this.scene, this.camera, FIXED_DT);
  }
}

function tick() {
  return new Promise((r) => setTimeout(r, 0));
}

export { RAPIER };
