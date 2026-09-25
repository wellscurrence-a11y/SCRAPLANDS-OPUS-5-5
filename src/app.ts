/**
 * Application flow: loading → title → world ⇄ garage, with HUD, salvage, discovery,
 * research progress, autosave, pause menu and machine recovery.
 */
import * as THREE from 'three';
import { Game } from './core/game';
import { input } from './core/input';
import { Hud, defaultMarkers, CompassMarker } from './ui/hud';
import { Director } from './gameplay/director';
import { SalvageSystem } from './gameplay/salvage';
import { SalvageUI } from './ui/salvageUI';
import { Garage } from './garage/garage';
import { GarageUI } from './ui/garageUI';
import { LoadingScreen, TitleScreen, loadSettings, saveSettings, settingsPanel, controlsHelp, Settings } from './ui/menus';
import { h } from './ui/dom';
import { Profile, newProfile, loadProfile, saveProfile, hasSave, exportSave, importSave, addXp, addResources, storageCapacity, RANK_TITLES } from './gameplay/profile';
import { getLocation, LOCATIONS } from './world/layout';
import { getPart } from './machines/parts/catalog';
import { computeStats } from './machines/stats';
import { AMMO_PRICE, FUEL_PRICE, sellPrice } from './gameplay/economy';
import { TECH } from './gameplay/research';
import type { Machine } from './machines/machine';
import { WorldProps } from './world/props';
import { MissionSystem } from './gameplay/missions';
import { MapScreen } from './ui/map';
import { MerchantUI } from './ui/merchant';
import { JournalUI } from './ui/journal';
import { AudioEngine } from './audio/engine';
import { clamp } from './core/math';

export type AppMode = 'loading' | 'title' | 'world' | 'garage';

export class App {
  game = new Game();
  profile: Profile | null = null;
  settings: Settings = loadSettings();
  mode: AppMode = 'loading';
  ui: HTMLElement;
  hud!: Hud;
  director!: Director;
  salvage!: SalvageSystem;
  salvageUI!: SalvageUI;
  garage!: Garage;
  garageUI!: GarageUI;
  props!: WorldProps;
  missions!: MissionSystem;
  map!: MapScreen;
  merchant!: MerchantUI;
  journal!: JournalUI;
  audio!: AudioEngine;
  title!: TitleScreen;
  private overlay: HTMLElement | null = null;
  private autosaveT = 60;
  private interactT = 0;
  private currentInteraction: { label: string; action: () => void } | null = null;
  private lastPlayerPos = new THREE.Vector3();
  private titleT = 0;
  private fade: HTMLElement;
  private dirTick = 0;
  private slowT = 0;

  constructor() {
    this.ui = document.getElementById('ui')!;
    this.fade = h('div', { style: { position: 'absolute', inset: '0', background: '#000', opacity: '0', pointerEvents: 'none', transition: 'opacity 0.35s', zIndex: '40' } });
    this.ui.appendChild(this.fade);
  }

  async start() {
    const loading = new LoadingScreen(this.ui);
    const viewport = document.getElementById('viewport')!;
    await this.game.init(viewport, (p, l) => loading.set(p * 0.85, l));
    const game = this.game;
    this.applySettings();
    loading.set(0.88, 'Raising the settlements');
    await new Promise((r) => setTimeout(r, 0));
    this.props = new WorldProps(game);
    this.props.build();
    this.audio = new AudioEngine(game);
    game.audio = this.audio;
    this.director = new Director(game);
    this.salvage = new SalvageSystem(game, () => this.profile!);
    this.salvageUI = new SalvageUI(this.ui, this.salvage);
    this.salvageUI.onClose = () => this.resumeControl();
    this.hud = new Hud(game, {
      credits: () => this.profile?.credits ?? 0,
      discovered: () => this.profile?.discovered ?? [],
      markers: () => this.markers(),
      mission: () => this.missions?.trackerInfo() ?? null,
    }, this.ui);
    this.hud.setVisible(false);
    this.missions = new MissionSystem(this);
    this.map = new MapScreen(this);
    this.merchant = new MerchantUI(this);
    this.journal = new JournalUI(this);
    loading.set(0.95, 'Opening the workshop');
    this.garage = new Garage(game.renderer);
    this.garageUI = new GarageUI(this.ui, this.garage);
    this.garageUI.onDeploy = (id) => this.deploy(id);
    this.garageUI.onExit = () => this.deploy(this.garage.design?.id ?? this.profile!.activeMachine, true);
    this.garageUI.onNotify = (t, k) => this.hud.notify(t, k);
    game.garageRender = (dt) => this.garage.render(dt);
    // gameplay hooks
    game.hooks.fixed.push((dt) => this.director.fixedUpdate(dt));
    game.hooks.fixed.push((dt) => this.missions.fixedUpdate(dt));
    game.hooks.frame.push((dt) => this.worldFrame(dt));
    game.events.on('machineKilled', (k) => this.onKill(k.machine, k.source));
    this.title = new TitleScreen(this.ui);
    loading.set(1, 'Ready');
    game.state = 'title';
    game.manual = !!(window as any).__manual;
    game.start();
    // warm up shaders by rendering a few frames at the title
    this.showTitle();
    setTimeout(() => loading.done(), 400);
    (window as any).__app = this;
    (window as any).__game = game;
  }

  applySettings() {
    const s = this.settings;
    if (this.game.renderer.quality !== s.quality) this.game.renderer.setQuality(s.quality);
    this.game.env.setShadowQuality(this.game.renderer.preset.shadowSize, this.game.renderer.preset.shadowRange);
    this.game.fx.quality = this.game.renderer.preset.particles;
    input.sensitivity = s.sensitivity;
    input.invertY = s.invertY;
    this.game.chase.baseFov = s.fov;
    this.audio?.setVolume(s.volume, s.music);
  }

  // ------------------------------------------------------------------ title
  showTitle() {
    this.mode = 'title';
    this.game.state = 'title';
    this.hud.setVisible(false);
    this.garageUI.hide();
    const saved = hasSave() ? loadProfile() : null;
    const info = saved ? `Day ${saved.world.day} · ${RANK_TITLES[Math.min(RANK_TITLES.length - 1, saved.rank.level - 1)]} · ${saved.machines.length} machines · ¢${saved.credits}` : '';
    this.game.env.time = 0.28;
    this.game.env.timeScale = 6;
    this.title.show({
      hasSave: !!saved,
      saveInfo: info,
      onContinue: () => this.beginGame(loadProfile() ?? newProfile(), false),
      onNew: () => {
        if (saved && !confirm('Start a new game? Your existing save will be overwritten.')) return;
        this.beginGame(newProfile(), true);
      },
      onSettings: () => this.openSettings(true),
      onExport: () => saved && exportSave(saved),
      onImport: (f) => {
        f.text().then((t) => {
          try {
            const p = importSave(t);
            saveProfile(p);
            this.showTitle();
          } catch {
            alert('That file is not a valid SCRAPLANDS save.');
          }
        });
      },
    });
    this.audio.music('title');
  }

  titleCamera(dt: number) {
    this.titleT += dt;
    const home = getLocation('home');
    const a = this.titleT * 0.035;
    const cx = home.x + 40;
    const cz = home.z - 20;
    const r = 70;
    const pos = new THREE.Vector3(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r);
    pos.y = this.game.terrain.heightAt(pos.x, pos.z) + 18;
    this.game.camera.position.copy(pos);
    this.game.camera.lookAt(home.x, this.game.terrain.heightAt(home.x, home.z) + 6, home.z);
  }

  // ------------------------------------------------------------------ game start
  beginGame(p: Profile, isNew: boolean) {
    this.profile = p;
    this.title.hide();
    this.game.env.time = p.world.time;
    this.game.env.day = p.world.day;
    this.game.env.timeScale = 1;
    this.game.env.setWeather((p.world.weather as any) ?? 'clear', true);
    this.director.clearAll();
    this.props.applyProfile(p);
    this.missions.load(p);
    saveProfile(p);
    if (isNew) this.showIntro(() => this.enterWorld(p.activeMachine));
    else this.enterWorld(p.activeMachine);
  }

  private showIntro(done: () => void) {
    const box = h(
      'div',
      { class: 'overlay fade-in', style: { zIndex: '30' } },
      h(
        'div',
        { class: 'panel', style: { padding: '34px 40px' } },
        h('div', { class: 'label' }, 'Kessler Basin · Year 31 after the Collapse'),
        h(
          'div',
          { class: 'story', style: { marginTop: '14px' } },
          h('p', {}, 'Old Mags left you her scrapyard, three half-finished machines and a note taped to the welder:'),
          h('p', { style: { fontStyle: 'italic', color: 'var(--text-2)' } }, '"Everything out there is made of parts. Parts can be taken. Take the good ones, bring them home, and build something that scares the Authority. — M."'),
          h('p', {}, 'The Rustbucket buggy is fuelled. The Skeeter quad and the Stilt walker are in the bays. Whatever you build next is up to you.'),
          h('p', { class: 'sig' }, 'Start by testing your guns on the range east of the garage.'),
        ),
        h('div', { style: { textAlign: 'right', marginTop: '10px' } }, h('button', { class: 'btn primary', onclick: () => { box.remove(); done(); } }, 'Roll out ▶')),
      ),
    );
    this.ui.appendChild(box);
  }

  // ------------------------------------------------------------------ world
  garageDoor() {
    return this.props.garageDoor;
  }

  enterWorld(machineId: string) {
    const p = this.profile!;
    const game = this.game;
    let d = p.machines.find((m) => m.id === machineId) ?? p.machines[0];
    if (!d || !computeStats(d).valid) {
      const valid = p.machines.find((m) => computeStats(m).valid);
      if (!valid) {
        this.enterGarage(false);
        this.hud.notify('No machine is ready to deploy — fix one in the workshop.', 'bad');
        return;
      }
      d = valid;
    }
    p.activeMachine = d.id;
    if (game.player) game.removeMachine(game.player);
    const spawn = this.props.garageSpawn;
    const m = game.spawnMachine(d, spawn.pos, spawn.yaw, 'player', true, 1);
    m.fuel = m.fuelCap;
    this.game.chase.yaw = spawn.yaw + Math.PI;
    this.game.chase.pitch = -0.2;
    this.game.chase.snapTo(m);
    this.lastPlayerPos.copy(m.currPos);
    this.mode = 'world';
    game.state = 'world';
    game.paused = false;
    this.garage.exit();
    this.garageUI.hide();
    this.hud.setVisible(true);
    input.enabled = true;
    this.director.enabled = true;
    this.audio.music('world');
    this.audio.attachPlayer(m);
    this.hud.banner('Deployed', d.name, `${d.cls === 'ground' ? 'Ground' : d.cls === 'air' ? 'Air' : 'Mech'} · ${Math.round(computeStats(d).mass)} kg`);
    this.missions.onEnterWorld();
    saveProfile(p);
  }

  /** Return the active machine to the workshop (unload cargo, bill consumables). */
  enterGarage(fromWorld = true) {
    const p = this.profile!;
    const game = this.game;
    this.salvage.cancel();
    this.salvageUI.close();
    const m = game.player;
    if (m && fromWorld) {
      m.syncDesignCondition();
      const d = p.machines.find((x) => x === m.design) ?? p.machines.find((x) => x.id === m.design.id);
      if (d) {
        for (const part of m.parts) {
          const pp = d.parts.find((x) => x.uid === part.uid);
          if (pp) pp.cond = Math.max(0, part.cond);
        }
      }
      // consumables
      let ammoCost = 0;
      for (const w of m.weapons) ammoCost += w.ammoUsed * (AMMO_PRICE[w.kind] ?? 0.3);
      const fuelCost = Math.max(0, m.fuelCap - m.fuel) * FUEL_PRICE;
      const total = Math.round(ammoCost + fuelCost);
      if (total > 0) {
        p.credits = Math.max(0, p.credits - total);
        this.hud.notify(`Refuelled and rearmed: −¢${total}`, 'info');
      }
      game.removeMachine(m);
    }
    // unload cargo
    if (p.cargo.length) {
      const cap = storageCapacity(p);
      let sold = 0;
      for (const it of p.cargo) {
        if (p.inventory.length < cap) p.inventory.push(it);
        else sold += sellPrice(getPart(it.defId), it.cond);
      }
      this.hud.notify(`Unloaded ${p.cargo.length} salvaged parts into storage${sold ? ` (storage full: sold overflow for ¢${sold})` : ''}`, 'good');
      p.credits += sold;
      p.cargo = [];
    }
    this.director.enabled = false;
    this.director.clearAll();
    game.ctx.debris.clear();
    game.ctx.projectiles.clear();
    this.mode = 'garage';
    game.state = 'garage';
    this.hud.setVisible(false);
    input.exitPointerLock();
    input.enabled = false;
    this.garage.enter(p, p.activeMachine);
    this.garageUI.show(p);
    this.audio.music('garage');
    this.audio.attachPlayer(null);
    this.missions.onEnterGarage();
    this.saveNow();
  }

  deploy(machineId: string, leaving = false) {
    const d = this.profile!.machines.find((m) => m.id === machineId);
    if (!d) return;
    if (!computeStats(d).valid) {
      this.hud.notify(`${d.name} has engineering errors and can't be deployed.`, 'bad');
      if (leaving) return;
      return;
    }
    this.fadeTo(() => this.enterWorld(machineId));
  }

  fadeTo(fn: () => void) {
    this.fade.style.opacity = '1';
    setTimeout(() => {
      fn();
      setTimeout(() => (this.fade.style.opacity = '0'), 60);
    }, 360);
  }

  saveNow() {
    const p = this.profile;
    if (!p) return;
    p.world.time = this.game.env.time;
    p.world.day = this.game.env.day;
    p.world.weather = this.game.env.weather;
    saveProfile(p);
  }

  private markers(): CompassMarker[] {
    const p = this.profile;
    if (!p) return [];
    const out = defaultMarkers(this.game, p.discovered);
    out.push(...this.missions.markers());
    const wp = this.map?.waypoint;
    if (wp) out.push({ pos: wp, label: 'Waypoint', kind: 'loot' });
    return out;
  }

  private onKill(m: Machine, source: Machine | null) {
    const p = this.profile;
    if (!p) return;
    if (m === this.game.player) {
      p.stats.deaths++;
      this.showDisabled();
      return;
    }
    if (source === this.game.player) {
      p.stats.kills++;
      const d = p.machines.find((x) => x.id === source!.design.id);
      if (d) d.kills = (d.kills ?? 0) + 1;
      const tier = m.tag.tier ?? 1;
      const xp = Math.round(40 + m.stats.mass / 40 + tier * 20);
      const bounty = Math.round(30 + m.stats.mass / 30);
      p.credits += bounty;
      this.gainXp(xp);
      this.hud.notify(`${m.name} destroyed  +¢${bounty}  +${xp} XP`, 'good');
      if (m.faction !== 'independents') p.reputation.independents = (p.reputation.independents ?? 0) + 1;
    }
  }

  gainXp(xp: number) {
    const p = this.profile!;
    const ups = addXp(p, xp);
    if (ups > 0) {
      const title = RANK_TITLES[Math.min(RANK_TITLES.length - 1, p.rank.level - 1)];
      this.hud.banner('Rank up', title, `Engineer rank ${p.rank.level} · +¢${250 * p.rank.level} bonus`);
      p.credits += 250 * p.rank.level;
      addResources(p, { data: 3 * p.rank.level });
      this.audio.play('rankup', null, { volume: 0.8 });
    }
  }

  // ------------------------------------------------------------------ overlays
  private closeOverlay() {
    this.overlay?.remove();
    this.overlay = null;
  }

  openPause() {
    if (this.overlay || this.mode !== 'world') return;
    this.game.paused = true;
    input.exitPointerLock();
    input.enabled = false;
    const resume = () => {
      this.closeOverlay();
      this.game.paused = false;
      input.enabled = true;
    };
    const box = h(
      'div',
      { class: 'panel box fade-in' },
      h('div', { class: 'h1' }, 'Paused'),
      h('div', { class: 'dim', style: { marginBottom: '10px' } }, `Day ${this.game.env.day} · ${this.game.env.timeString} · Rank ${this.profile?.rank.level}`),
      settingsPanel(this.settings, (s) => {
        saveSettings(s);
        this.applySettings();
      }),
      h('div', { class: 'label', style: { marginTop: '16px' } }, 'Controls'),
      controlsHelp(),
      h(
        'div',
        { style: { display: 'flex', gap: '8px', marginTop: '20px', justifyContent: 'flex-end' } },
        h('button', { class: 'btn', onclick: () => { this.saveNow(); this.hud.notify('Game saved', 'good'); } }, 'Save'),
        h('button', { class: 'btn', onclick: () => { this.saveNow(); this.closeOverlay(); this.game.paused = false; if (this.game.player) this.game.removeMachine(this.game.player); this.director.clearAll(); this.showTitle(); } }, 'Save & quit'),
        h('button', { class: 'btn primary', onclick: resume }, 'Resume'),
      ),
    );
    this.overlay = h('div', { class: 'overlay', id: 'pause' }, box);
    this.ui.appendChild(this.overlay);
  }

  openSettings(fromTitle: boolean) {
    const box = h(
      'div',
      { class: 'panel box fade-in', style: { width: '560px', padding: '28px 32px' } },
      h('div', { class: 'h1' }, 'Settings'),
      settingsPanel(this.settings, (s) => {
        saveSettings(s);
        this.applySettings();
      }),
      h('div', { class: 'label', style: { marginTop: '16px' } }, 'Controls'),
      controlsHelp(),
      h('div', { style: { textAlign: 'right', marginTop: '18px' } }, h('button', { class: 'btn primary', onclick: () => this.closeOverlay() }, 'Done')),
    );
    this.overlay = h('div', { class: 'overlay' }, box);
    this.ui.appendChild(this.overlay);
    void fromTitle;
  }

  private showDisabled() {
    const p = this.profile!;
    const m = this.game.player;
    if (!m) return;
    const home = getLocation('home');
    const dist = Math.hypot(m.currPos.x - home.x, m.currPos.z - home.z);
    const fee = Math.round(120 + dist * 0.25);
    setTimeout(() => {
      if (this.mode !== 'world' || this.overlay) return;
      input.exitPointerLock();
      input.enabled = false;
      const box = h(
        'div',
        { class: 'panel box fade-in', id: 'disabled-ov' },
        h('div', { class: 'label', style: { color: 'var(--bad)' } }, 'Machine disabled'),
        h('div', { class: 'h1' }, m.design.name),
        h('div', { class: 'dim', style: { margin: '10px 0 18px', maxWidth: '440px' } }, 'The pilot is safe. A salvage crew can tow what is left back to the workshop, where every part can be rebuilt. Destroyed parts need rebuilding; your salvaged cargo is kept.'),
        h('button', { class: 'btn primary', onclick: () => {
          p.credits = Math.max(0, p.credits - fee);
          this.closeOverlay();
          this.fadeTo(() => this.enterGarage(true));
        } }, `Tow to workshop (¢${fee})`),
      );
      this.overlay = h('div', { class: 'overlay', id: 'disabled-ov' }, box);
      this.ui.appendChild(this.overlay);
    }, 2500);
  }

  private resumeControl() {
    if (this.mode === 'world' && !this.overlay && !this.map.open && !this.merchant.open && !this.journal.open) {
      input.enabled = true;
    }
  }

  // ------------------------------------------------------------------ per-frame
  private worldFrame(dt: number) {
    const game = this.game;
    if (this.mode === 'title') {
      this.titleCamera(dt);
      return;
    }
    if (this.mode !== 'world' || !this.profile) return;
    const p = this.profile;
    p.playTime += dt;
    this.props.update(dt);
    // research progresses in real time
    if (p.research.active) {
      const t = TECH.find((x) => x.id === p.research.active);
      if (t) {
        p.research.progress += dt;
        if (p.research.progress >= t.time) {
          p.research.done.push(t.id);
          p.research.active = null;
          p.research.progress = 0;
          this.hud.banner('Research complete', t.name, t.unlocks);
          this.gainXp(120 * t.tier);
        }
      }
    }
    this.dirTick += dt;
    if (this.dirTick > 0.5) {
      this.director.tick(this.dirTick);
      this.dirTick = 0;
    }
    this.hud.update(dt);
    const m = game.player;
    // hotkeys
    if (input.pressed('pause')) {
      if (this.map.open) this.map.close();
      else if (this.merchant.open) this.merchant.close();
      else if (this.journal.open) this.journal.close();
      else if (this.salvageUI.open) this.salvageUI.close();
      else if (this.overlay && game.paused) {
        this.closeOverlay();
        game.paused = false;
        input.enabled = true;
      } else this.openPause();
    }
    if (input.pressed('map') && !this.overlay) {
      if (this.map.open) this.map.close();
      else this.map.show();
    }
    if (input.pressed('journal') && !this.overlay) {
      if (this.journal.open) this.journal.close();
      else this.journal.show();
    }
    if (!m) return;
    // distance travelled
    const moved = m.currPos.distanceTo(this.lastPlayerPos);
    if (moved < 50) {
      p.stats.distance += moved;
      const d = p.machines.find((x) => x.id === m.design.id);
      if (d) d.distance = (d.distance ?? 0) + moved;
    }
    this.lastPlayerPos.copy(m.currPos);
    // discovery
    for (const l of LOCATIONS) {
      if (p.discovered.includes(l.id)) continue;
      const d = Math.hypot(m.currPos.x - l.x, m.currPos.z - l.z);
      if (d < Math.max(40, l.radius * 0.7)) {
        p.discovered.push(l.id);
        this.hud.banner(l.hidden ? 'Hidden location discovered' : 'Discovered', l.name, l.desc);
        const xp = l.hidden ? 250 : 100;
        this.gainXp(xp);
        addResources(p, { data: l.hidden ? 6 : 2 });
        this.missions.onDiscover(l.id);
      }
    }
    // salvage job progress
    const prog = this.salvage.update(dt);
    this.hud.progress(prog);
    // interactions
    this.interactT -= dt;
    if (this.interactT <= 0) {
      this.interactT = 0.15;
      this.currentInteraction = this.findInteraction(m);
      this.hud.prompt(this.currentInteraction && !this.salvage.job ? `<span class="key">E</span>${this.currentInteraction.label}` : this.salvage.job ? 'Cutting parts free… stay close' : null);
    }
    if (input.pressed('interact') && this.currentInteraction && !this.overlay && !this.salvageUI.open) this.currentInteraction.action();
    // autosave
    this.autosaveT -= dt;
    if (this.autosaveT <= 0) {
      this.autosaveT = 120;
      this.saveNow();
    }
    // pointer lock on click happens via canvas listener
    this.audio.update(dt);
    game.chase.baseFov = this.settings.fov;
    this.adaptQuality(dt);
    void clamp;
  }

  /** If the device can't keep up, step graphics down once per slow spell (only while quality is automatic). */
  private adaptQuality(dt: number) {
    const s = this.settings;
    if (!s.autoQuality || s.quality === 'low' || this.game.manual || dt <= 0) return;
    const fps = this.game.fps;
    this.slowT = fps < 26 ? this.slowT + dt : Math.max(0, this.slowT - dt * 2);
    if (this.slowT < 6) return;
    this.slowT = 0;
    const order = ['low', 'medium', 'high', 'ultra'] as const;
    s.quality = order[Math.max(0, order.indexOf(s.quality) - 1)];
    saveSettings(s);
    this.applySettings();
    this.hud.notify(`Graphics lowered to ${s.quality.toUpperCase()} for smoother play — change it any time in Settings (Esc)`, 'info');
  }

  private findInteraction(m: Machine): { label: string; action: () => void } | null {
    if (!m.alive) return null;
    // garage door
    const door = this.props.garageDoor;
    if (m.currPos.distanceTo(door) < 14) {
      return { label: 'Enter workshop', action: () => this.fadeTo(() => this.enterGarage(true)) };
    }
    // missions & merchants & static points
    const pt = this.props.interactionAt(m.currPos);
    if (pt) return { label: pt.label, action: () => pt.action(this) };
    const mi = this.missions.interaction(m);
    if (mi) return mi;
    // loot on the ground
    const loot = this.salvage.nearestLoot();
    if (loot && loot.loot) {
      const def = getPart(loot.loot.defId);
      return { label: `Pick up <span style="color:var(--r-${def.rarity})">${def.name}</span> (${Math.round(loot.loot.cond * 100)}%)`, action: () => this.salvage.pickupLoot(loot) };
    }
    const wreck = this.salvage.nearestWreck();
    if (wreck) {
      return {
        label: `Salvage ${wreck.name}`,
        action: () => {
          input.exitPointerLock();
          input.enabled = false;
          this.salvageUI.show(wreck);
        },
      };
    }
    return null;
  }
}

export function bootApp() {
  const app = new App();
  const canvasLock = () => {
    const c = document.getElementById('game-canvas');
    c?.addEventListener('click', () => {
      if (app.mode === 'world' && !app['overlay'] && input.enabled) input.requestPointerLock();
    });
  };
  app
    .start()
    .then(() => {
      canvasLock();
      (window as any).__ready = true;
    })
    .catch((e) => {
      console.error(e);
      document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;position:fixed;top:40px;left:10px;z-index:99;white-space:pre-wrap">${e?.stack ?? e}</pre>`);
    });
  return app;
}
