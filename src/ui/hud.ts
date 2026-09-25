/** In-world HUD: vehicle telemetry, damage schematic, weapons, crosshair, target intel, compass. */
import './hud.css';
import * as THREE from 'three';
import { h, setText, setWidth, fmtCredits } from './dom';
import type { Game } from '../core/game';
import type { Machine } from '../machines/machine';
import type { PartRuntime } from '../machines/part';
import { RARITY_COLOR, RARITY_LABEL, rarityIndex, CATEGORY_LABEL } from '../machines/types';
import { clamp, wrapAngle } from '../core/math';
import { input } from '../core/input';
import { LOCATIONS } from '../world/layout';

export interface CompassMarker {
  pos: THREE.Vector3;
  label: string;
  kind: 'poi' | 'obj' | 'enemy' | 'loot';
}

export interface HudDeps {
  credits(): number;
  discovered(): string[];
  markers(): CompassMarker[];
  mission(): { title: string; objectives: { text: string; done: boolean }[] } | null;
}

const FACTION_COLOR: Record<string, string> = {
  scrappers: '#ff7a3a',
  authority: '#d8c86a',
  helix: '#5fe6ff',
  independents: '#9fd28a',
  player: '#ffae3b',
  neutral: '#cccccc',
};
const FACTION_NAME: Record<string, string> = {
  scrappers: 'Scrappers',
  authority: 'Iron Authority',
  helix: 'Helix Industries',
  independents: 'Independent',
  player: 'You',
  neutral: 'Neutral',
};

export class Hud {
  root: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  private schem: HTMLCanvasElement;
  private schemCtx: CanvasRenderingContext2D;
  private notes: HTMLElement;
  private targetMachine: Machine | null = null;
  private targetTime = 0;
  private flashParts = new Map<PartRuntime, number>();
  private callouts: HTMLElement[] = [];
  private slow = 0;
  private promptText = '';
  visible = true;
  scanHeld = false;

  constructor(private game: Game, private deps: HudDeps, parent: HTMLElement) {
    const E = this.el;
    this.root = h('div', { id: 'hud' });
    // vehicle block
    E.vname = h('div', { class: 'h3' });
    E.vclass = h('div', { class: 'label' });
    E.speed = h('div', { class: 'big mono' }, '0');
    E.unit = h('div', { class: 'unit' }, 'KM/H');
    E.gear = h('div', { class: 'mono' }, 'N');
    E.gearLabel = h('div', { class: 'label' }, 'GEAR');
    E.rpm = h('i');
    const bar = (cls: string, key: string) => {
      const i = h('i');
      E[key] = i;
      return h('div', { class: `bar ${cls}` }, i);
    };
    E.vEnergy = h('div', { class: 'v' });
    E.vHeat = h('div', { class: 'v' });
    E.vFuel = h('div', { class: 'v' });
    E.vBoost = h('div', { class: 'v' });
    E.boostRow = h('div', { style: { display: 'contents' } }, h('div', { class: 'label' }, 'Boost'), bar('', 'bBoost'), E.vBoost);
    const vehicle = h(
      'div',
      { class: 'panel hud-vehicle' },
      h('div', { class: 'name' }, E.vname, E.vclass),
      h('div', { class: 'hud-speed' }, E.speed, E.unit, h('div', { class: 'gear' }, E.gearLabel, E.gear)),
      h('div', { class: 'hud-rpm' }, E.rpm),
      h(
        'div',
        { class: 'hud-rows' },
        h('div', { class: 'label' }, 'Power'),
        bar('energy', 'bEnergy'),
        E.vEnergy,
        h('div', { class: 'label' }, 'Heat'),
        bar('heat', 'bHeat'),
        E.vHeat,
        h('div', { class: 'label' }, 'Fuel'),
        bar('fuel', 'bFuel'),
        E.vFuel,
        E.boostRow,
      ),
    );
    this.schem = h('canvas', { width: 360, height: 360 });
    this.schemCtx = this.schem.getContext('2d')!;
    const schem = h('div', { class: 'panel hud-schem' }, h('div', { class: 'label' }, 'Integrity'), this.schem);
    E.weapons = h('div', { class: 'panel hud-weapons' });
    // crosshair
    E.cross = h('div', {
      class: 'hud-cross',
      html: `<svg viewBox="-24 -24 48 48"><g stroke="rgba(255,255,255,0.9)" stroke-width="1.6" fill="none" stroke-linecap="round">
        <line x1="-14" y1="0" x2="-6" y2="0"/><line x1="6" y1="0" x2="14" y2="0"/><line x1="0" y1="-14" x2="0" y2="-6"/><line x1="0" y1="6" x2="0" y2="14"/>
        </g><circle r="1.4" fill="#fff"/></svg>`,
    });
    E.gun = h('div', { class: 'hud-gun off' });
    E.hit = h('div', { class: 'hud-hitmark', html: `<svg viewBox="-18 -18 36 36"><g stroke="#fff"><line x1="-12" y1="-12" x2="-5" y2="-5"/><line x1="12" y1="-12" x2="5" y2="-5"/><line x1="-12" y1="12" x2="-5" y2="5"/><line x1="12" y1="12" x2="5" y2="5"/></g></svg>` });
    E.partpop = h('div', { class: 'hud-partpop' });
    E.lock = h('div', { class: 'hud-lockbox' });
    // target
    E.tname = h('div', { class: 'tname' });
    E.tfaction = h('div');
    E.tdist = h('div', { class: 'mono' });
    E.taimName = h('div', { class: 'pn' });
    E.taimHp = h('i');
    E.taimInfo = h('div', { class: 'pv' });
    E.taim = h('div', { class: 'aim' }, h('div', { class: 'label' }, 'Aiming at'), E.taimName, h('div', { class: 'bar hp', style: { marginTop: '4px' } }, E.taimHp), E.taimInfo);
    E.tloot = h('div', { class: 'loot' });
    E.target = h(
      'div',
      { class: 'panel hud-target' },
      E.tname,
      h('div', { class: 'sub' }, E.tfaction, E.tdist),
      E.taim,
      h('div', { class: 'label', style: { marginBottom: '4px' } }, 'Notable components'),
      E.tloot,
    );
    // compass
    E.strip = h('div', { class: 'strip' });
    E.compass = h('div', { class: 'hud-compass' }, E.strip, h('div', { class: 'center' }));
    E.heading = h('div', { class: 'hud-heading' });
    // misc
    E.credits = h('div', { class: 'credits' });
    E.clock = h('div', { class: 'clock' });
    E.warnings = h('div', { class: 'hud-warnings' });
    this.notes = h('div', { class: 'hud-notes' });
    E.prompt = h('div', { class: 'panel hud-prompt' });
    E.progressBar = h('i');
    E.progress = h('div', { class: 'hud-progress' }, E.progressBar);
    E.mission = h('div', { class: 'panel hud-mission' });
    E.banner = h('div', { class: 'hud-banner' }, h('div', { class: 't1' }), h('div', { class: 't2' }), h('div', { class: 't3' }));
    E.help = h('div', { class: 'hud-help' });
    this.root.append(
      vehicle,
      schem,
      E.weapons,
      E.cross,
      E.gun,
      E.hit,
      E.partpop,
      E.lock,
      E.target,
      E.compass,
      E.heading,
      h('div', { class: 'hud-top-left' }, E.credits, E.clock),
      E.warnings,
      this.notes,
      E.prompt,
      E.progress,
      E.mission,
      E.banner,
      E.help,
    );
    parent.appendChild(this.root);
    this.buildCompass();
    game.events.on('hit', (hi) => {
      if (hi.source === game.player && hi.machine !== game.player) {
        this.hitMarker(hi.destroyed ? 'kill' : hi.effectiveness < 0.35 ? 'deflect' : 'hit');
        this.targetMachine = hi.machine;
        this.targetTime = game.ctx.time;
        if (hi.destroyed) this.partPop(`${hi.part.def.name} destroyed`, RARITY_COLOR[hi.part.def.rarity]);
      }
      if (hi.machine === game.player) this.flashParts.set(hi.part, 0.35);
    });
    game.events.on('notify', (n) => this.notify(n.text, n.kind));
    game.events.on('machineKilled', (k) => {
      if (k.source === game.player) this.partPop(k.cause === 'pilot' ? 'Pilot eliminated' : k.cause === 'bailed' ? 'Pilot bailed out' : 'Machine destroyed', '#ff6a3a');
    });
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
  }

  private buildCompass() {
    const strip = this.el.strip;
    const pxPerDeg = 4;
    for (let d = -360; d <= 720; d += 5) {
      const x = (d + 360) * pxPerDeg;
      const deg = ((d % 360) + 360) % 360;
      const major = deg % 45 === 0;
      strip.appendChild(h('div', { class: `tick ${major ? 'major' : ''}`, style: { left: `${x}px` } }));
      if (deg % 90 === 0) strip.appendChild(h('div', { class: 'card', style: { left: `${x}px` } }, ['N', 'E', 'S', 'W'][deg / 90]));
    }
  }

  notify(text: string, kind: string = 'info') {
    const n = h('div', { class: `hud-note ${kind}` }, text);
    this.notes.appendChild(n);
    while (this.notes.children.length > 6) this.notes.removeChild(this.notes.firstChild!);
    setTimeout(() => n.classList.add('out'), kind === 'mission' ? 6500 : 4500);
    setTimeout(() => n.remove(), kind === 'mission' ? 7200 : 5200);
  }

  banner(t1: string, t2: string, t3 = '') {
    const b = this.el.banner;
    (b.children[0] as HTMLElement).textContent = t1;
    (b.children[1] as HTMLElement).textContent = t2;
    (b.children[2] as HTMLElement).textContent = t3;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  prompt(text: string | null) {
    const t = text ?? '';
    if (t !== this.promptText) {
      this.promptText = t;
      this.el.prompt.innerHTML = t;
    }
    this.el.prompt.classList.toggle('on', !!text);
  }

  progress(frac: number | null) {
    this.el.progress.classList.toggle('on', frac !== null);
    if (frac !== null) setWidth(this.el.progressBar, frac);
  }

  private hitMarker(kind: 'hit' | 'kill' | 'deflect') {
    const el = this.el.hit;
    const col = kind === 'kill' ? '#ff4a3a' : kind === 'deflect' ? '#8a8a8a' : '#ffffff';
    el.querySelectorAll('line').forEach((l) => l.setAttribute('stroke', col));
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  private partPop(text: string, color: string) {
    const el = this.el.partpop;
    el.textContent = text;
    el.style.color = color;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  update(dt: number) {
    if (!this.visible) return;
    const game = this.game;
    const m = game.player;
    this.slow -= dt;
    const slowTick = this.slow <= 0;
    if (slowTick) this.slow = 0.1;
    for (const [p, t] of this.flashParts) {
      if (t - dt <= 0) this.flashParts.delete(p);
      else this.flashParts.set(p, t - dt);
    }
    if (!m) return;
    this.updateCrosshair(m);
    this.updateCompass(m);
    this.updateCallouts(m);
    if (!slowTick) return;
    const E = this.el;
    const t = m.controller.telemetry();
    setText(E.vname, m.design.name);
    setText(E.vclass, m.cls === 'ground' ? 'Ground' : m.cls === 'air' ? 'Air' : 'Mech');
    if (m.cls === 'air') {
      setText(E.speed, Math.round(t.speed * 3.6).toString());
      setText(E.gearLabel, 'ALT');
      setText(E.gear, `${Math.round(t.altitude ?? 0)}m`);
      setWidth(E.rpm, t.throttle ?? 0);
    } else if (m.cls === 'mech') {
      setText(E.speed, Math.round(t.speed * 3.6).toString());
      setText(E.gearLabel, 'GAIT');
      setText(E.gear, t.grounded ? (t.speed > 0.3 ? 'WALK' : 'STAND') : 'AIR');
      setWidth(E.rpm, t.throttle ?? 0);
    } else {
      setText(E.speed, Math.round(t.speed * 3.6).toString());
      setText(E.gearLabel, 'GEAR');
      setText(E.gear, t.gear ?? 'N');
      setWidth(E.rpm, (t.rpm ?? 0) / (t.maxRpm ?? 6000));
    }
    setWidth(E.bEnergy, m.energy / m.energyCap);
    setText(E.vEnergy, `${Math.round(m.powerRatio * 100)}%`);
    setWidth(E.bHeat, m.heat / m.heatCap);
    setText(E.vHeat, m.overheated ? 'HOT' : `${Math.round((m.heat / m.heatCap) * 100)}%`);
    E.vHeat.style.color = m.overheated ? 'var(--bad)' : '';
    setWidth(E.bFuel, m.fuelCap > 0 ? m.fuel / m.fuelCap : 0);
    setText(E.vFuel, m.fuelCap > 0 ? `${Math.round(m.fuel)}L` : '—');
    E.boostRow.style.display = t.boost !== undefined ? 'contents' : 'none';
    if (t.boost !== undefined) {
      setWidth(E.bBoost, t.boost);
      setText(E.vBoost, `${Math.round(t.boost * 100)}%`);
    }
    this.updateWeapons(m);
    this.drawSchematic(m);
    this.updateTarget(m);
    // warnings
    const warns = [...(t.warnings ?? [])];
    if (m.overheated) warns.unshift('OVERHEATING');
    if (!m.alive) warns.unshift('MACHINE DISABLED');
    const wHtml = warns.slice(0, 3).map((w) => `<div>${w}</div>`).join('');
    if (E.warnings.innerHTML !== wHtml) E.warnings.innerHTML = wHtml;
    setText(E.credits, fmtCredits(this.deps.credits()));
    const env = game.env;
    const weatherName = env.current.rain > 0.5 ? 'Storm' : env.current.dust > 0.5 ? 'Dust storm' : env.current.overcast > 0.5 ? 'Overcast' : env.current.dust > 0.15 ? 'Hazy' : 'Clear';
    setText(E.clock, `DAY ${env.day} · ${env.timeString} · ${weatherName.toUpperCase()}`);
    // mission tracker
    const mi = this.deps.mission();
    E.mission.style.display = mi ? '' : 'none';
    if (mi) {
      const html = `<div class="label">Contract</div><div class="mt">${mi.title}</div>` + mi.objectives.map((o) => `<div class="mo ${o.done ? 'done' : ''}"><span class="check"></span>${o.text}</div>`).join('');
      if (E.mission.innerHTML !== html) E.mission.innerHTML = html;
    }
    const targetOn = E.target.classList.contains('on');
    E.mission.style.top = targetOn ? `${80 + E.target.offsetHeight}px` : '70px';
    const help = m.cls === 'ground'
      ? '<span class="key">W/S</span>drive <span class="key">A/D</span>steer <span class="key">SPACE</span>handbrake <span class="key">SHIFT</span>boost'
      : m.cls === 'air'
        ? '<span class="key">W/S</span>fwd <span class="key">A/D</span>strafe <span class="key">SPACE/C</span>climb/descend'
        : '<span class="key">WASD</span>walk <span class="key">SPACE</span>jump jets <span class="key">SHIFT</span>run';
    const helpHtml = `${help}<br><span class="key">LMB/RMB</span>fire groups <span class="key">TAB</span>scan <span class="key">F</span>lights <span class="key">M</span>map <span class="key">J</span>contracts`;
    if (E.help.innerHTML !== helpHtml) E.help.innerHTML = helpHtml;
  }

  private updateWeapons(m: Machine) {
    const rows = m.weapons
      .slice()
      .sort((a, b) => a.group - b.group)
      .map((w) => {
        const off = !w.part.functional || w.disabled;
        let st = '';
        let cls = '';
        let frac = 1;
        if (off) st = 'DESTROYED';
        else if (w.reloadT > 0) {
          st = 'RELOAD';
          frac = 1 - w.reloadT / (w.s.reload ?? 3);
        } else if (m.overheated) {
          st = 'HEAT';
          cls = 'hot';
        } else if (w.kind === 'missiles') {
          st = w.locked ? 'LOCKED' : w.lockT > 0 ? `LOCK ${Math.round((w.lockT / (w.s.lockTime ?? 1.4)) * 100)}%` : `${w.mag}`;
          cls = w.locked ? 'lock' : '';
        } else if (w.s.energyPerShot) {
          st = `${Math.round((m.energy / m.energyCap) * 100)}% E`;
          frac = m.energy / m.energyCap;
        } else if (w.kind === 'melee') st = 'MELEE';
        else if (w.s.ammo) {
          st = `${w.ammo}`;
          frac = w.ammo / w.s.ammo;
        }
        if (w.kind === 'railgun' && w.charge > 0) {
          st = `CHARGE ${Math.round(w.charge * 100)}%`;
          frac = w.charge;
        }
        const color = RARITY_COLOR[w.part.def.rarity];
        return `<div class="hud-weapon ${off ? 'off' : ''}"><div class="grp">${w.group === 1 ? 'L' : w.group === 2 ? 'R' : 'M'}</div><div class="nm" style="color:${rarityIndex(w.part.def.rarity) > 0 ? color : ''}">${w.part.def.name}</div><div class="st ${cls}">${st}</div><div class="mini"><i style="width:${clamp(frac, 0, 1) * 100}%"></i></div></div>`;
      })
      .join('');
    const html = `<div class="label" style="margin-bottom:4px">Weapons</div>${rows || '<div class="dim">Unarmed</div>'}`;
    if (this.el.weapons.innerHTML !== html) this.el.weapons.innerHTML = html;
  }

  private drawSchematic(m: Machine) {
    const c = this.schemCtx;
    const W = this.schem.width;
    const H = this.schem.height;
    c.clearRect(0, 0, W, H);
    const b = m.stats.bounds;
    const sx = b.max.x - b.min.x;
    const sz = b.max.z - b.min.z;
    const scale = Math.min((W - 40) / sx, (H - 50) / sz);
    const ox = W / 2 - ((b.min.x + b.max.x) / 2) * scale;
    const oz = H / 2 + 8 - ((b.min.z + b.max.z) / 2) * scale;
    const parts = [...m.parts].sort((a, b2) => a.layout.bounds.max.y - b2.layout.bounds.max.y);
    for (const p of parts) {
      const pb = p.layout.bounds;
      const x = ox + pb.min.x * scale;
      const y = oz + pb.min.z * scale;
      const w = Math.max(3, (pb.max.x - pb.min.x) * scale);
      const hh = Math.max(3, (pb.max.z - pb.min.z) * scale);
      const cond = p.cond;
      if (p.detached) {
        c.setLineDash([3, 3]);
        c.strokeStyle = 'rgba(255,255,255,0.18)';
        c.strokeRect(x, y, w, hh);
        c.setLineDash([]);
        continue;
      }
      let col: string;
      if (p.destroyed) col = 'rgba(120,20,15,0.85)';
      else if (cond > 0.7) col = 'rgba(125,220,106,0.45)';
      else if (cond > 0.35) col = 'rgba(255,204,58,0.6)';
      else col = 'rgba(255,90,50,0.75)';
      if (p.def.category === 'frame') col = p.destroyed ? col : cond > 0.5 ? 'rgba(125,220,106,0.14)' : 'rgba(255,90,50,0.3)';
      c.fillStyle = col;
      c.fillRect(x, y, w, hh);
      c.strokeStyle = p.destroyed ? 'rgba(255,60,40,0.9)' : 'rgba(255,255,255,0.22)';
      c.lineWidth = 1;
      c.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1);
      const f = this.flashParts.get(p);
      if (f) {
        c.fillStyle = `rgba(255,255,255,${f * 2})`;
        c.fillRect(x, y, w, hh);
      }
      if (p.burning > 0) {
        c.fillStyle = `rgba(255,140,40,${0.4 + 0.3 * Math.sin(performance.now() / 80)})`;
        c.fillRect(x, y, w, hh);
      }
    }
    // forward indicator
    c.fillStyle = 'rgba(255,174,59,0.9)';
    c.beginPath();
    c.moveTo(W / 2, 6);
    c.lineTo(W / 2 - 7, 18);
    c.lineTo(W / 2 + 7, 18);
    c.fill();
  }

  private project(p: THREE.Vector3) {
    const v = p.clone().project(this.game.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  private updateCrosshair(m: Machine) {
    const E = this.el;
    // Gun reticle: where the primary weapon's barrel actually points
    const w = m.weapons.find((x) => x.part.functional && !x.disabled && x.kind !== 'melee' && x.group === 1) ?? m.weapons.find((x) => x.part.functional && x.kind !== 'melee');
    if (w && m.alive) {
      const d = this.game.chase.aimDistance;
      const p = w.muzzleWorld.clone().addScaledVector(w.muzzleDir, d);
      const s = this.project(p);
      if (s) {
        E.gun.style.left = `${s.x}px`;
        E.gun.style.top = `${s.y}px`;
        E.gun.classList.remove('off');
        E.gun.classList.toggle('misaligned', w.aimError > 0.05);
      } else E.gun.classList.add('off');
    } else E.gun.classList.add('off');
    // Missile lock box
    const mw = m.weapons.find((x) => x.kind === 'missiles' && x.part.functional && x.lockTarget);
    if (mw && mw.lockTarget && mw.lockT > 0) {
      const s = this.project(mw.lockTarget.part.worldCenter);
      if (s) {
        E.lock.style.left = `${s.x}px`;
        E.lock.style.top = `${s.y}px`;
        E.lock.classList.add('on');
        E.lock.classList.toggle('locked', mw.locked);
      }
    } else E.lock.classList.remove('on');
  }

  private updateTarget(m: Machine) {
    const E = this.el;
    const chase = this.game.chase;
    const now = this.game.ctx.time;
    if (chase.aimMachine) {
      this.targetMachine = chase.aimMachine;
      this.targetTime = now;
    }
    const t = this.targetMachine;
    const on = !!t && now - this.targetTime < 4 && this.game.ctx.machines.includes(t) && t.currPos.distanceTo(m.currPos) < 600;
    E.target.classList.toggle('on', on);
    if (!on || !t) return;
    setText(E.tname, t.wreck ? `${t.name} (wreck)` : t.name);
    E.tname.style.color = FACTION_COLOR[t.faction] ?? '#fff';
    setText(E.tfaction, `${FACTION_NAME[t.faction] ?? t.faction} · ${t.cls}`);
    setText(E.tdist, `${Math.round(t.currPos.distanceTo(m.currPos))} m`);
    const part = chase.aimMachine === t ? chase.aimPart : null;
    E.taim.style.display = part ? '' : 'none';
    if (part) {
      const col = RARITY_COLOR[part.def.rarity];
      E.taim.style.borderLeftColor = col;
      E.taimName.innerHTML = `<span style="color:${col}">${part.def.name}</span> <span class="dim" style="font-size:12px">${CATEGORY_LABEL[part.def.category]}</span>`;
      setWidth(E.taimHp, part.cond);
      (E.taimHp as HTMLElement).style.background = part.destroyed ? 'var(--bad)' : part.cond > 0.5 ? 'var(--good)' : 'var(--warn)';
      const w = m.weapons.find((x) => x.part.functional && x.kind !== 'melee' && x.group === 1);
      const pen = w?.s.pen ?? 0;
      const eff = pen >= part.def.armor ? 100 : Math.round(Math.max(10, (pen / Math.max(1, part.def.armor)) * 100));
      E.taimInfo.innerHTML = `<span>${part.destroyed ? 'DESTROYED' : `${Math.round(part.hp)}/${part.maxHp} HP`}</span><span style="color:${eff >= 100 ? 'var(--good)' : eff > 40 ? 'var(--warn)' : 'var(--bad)'}">ARMOR ${part.def.armor} · ${eff >= 100 ? 'PENETRATING' : `${eff}% EFFECT`}</span>`;
    }
    const scanRange = Math.max(160, m.stats.scanRange);
    const dist = t.currPos.distanceTo(m.currPos);
    const notable = t.parts
      .filter((p) => rarityIndex(p.def.rarity) >= (dist < scanRange ? 1 : 2) && p.def.category !== 'frame')
      .sort((a, b) => rarityIndex(b.def.rarity) - rarityIndex(a.def.rarity))
      .slice(0, 5);
    const html = notable.length
      ? notable
          .map(
            (p) =>
              `<div class="row ${p.destroyed || p.detached ? 'dead' : ''}"><span style="color:${RARITY_COLOR[p.def.rarity]}">${p.def.name}</span><div class="bar hp"><i style="width:${p.cond * 100}%;background:${RARITY_COLOR[p.def.rarity]}"></i></div></div>`,
          )
          .join('')
      : '<div class="dim" style="font-size:13px">Only common parts detected</div>';
    if (E.tloot.innerHTML !== html) E.tloot.innerHTML = html;
  }

  private updateCallouts(m: Machine) {
    const t = this.targetMachine;
    this.scanHeld = input.held('scan');
    const show = this.scanHeld && t && this.game.ctx.machines.includes(t);
    const parts = show
      ? t!.parts.filter((p) => !p.detached && (rarityIndex(p.def.rarity) >= 1 || ['cockpit', 'engine', 'fuel', 'generator'].includes(p.def.category)) && p.def.category !== 'frame').slice(0, 8)
      : [];
    while (this.callouts.length < parts.length) {
      const c = h('div', { class: 'hud-callout' });
      this.root.appendChild(c);
      this.callouts.push(c);
    }
    for (let i = 0; i < this.callouts.length; i++) {
      const c = this.callouts[i];
      const p = parts[i];
      if (!p) {
        c.style.display = 'none';
        continue;
      }
      const s = this.project(p.worldCenter);
      if (!s) {
        c.style.display = 'none';
        continue;
      }
      c.style.display = '';
      c.style.left = `${s.x}px`;
      c.style.top = `${s.y - 14 - (i % 3) * 18}px`;
      c.style.color = p.destroyed ? '#777' : RARITY_COLOR[p.def.rarity];
      const txt = `${p.def.name}${p.destroyed ? ' ✕' : ` ${Math.round(p.cond * 100)}%`}`;
      setText(c, txt);
    }
    void m;
  }

  private updateCompass(m: Machine) {
    const cam = this.game.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const heading = Math.atan2(fwd.x, -fwd.z); // 0 = north (-Z), +90° = east
    const deg = ((heading * 180) / Math.PI + 360) % 360;
    const pxPerDeg = 4;
    const W = 620;
    this.el.strip.style.transform = `translateX(${W / 2 - (deg + 360) * pxPerDeg}px)`;
    setText(this.el.heading, `${Math.round(deg).toString().padStart(3, '0')}°`);
    // markers
    const markers = this.deps.markers();
    const container = this.el.compass;
    container.querySelectorAll('.poi').forEach((e) => e.remove());
    for (const mk of markers) {
      const dx = mk.pos.x - m.currPos.x;
      const dz = mk.pos.z - m.currPos.z;
      const ang = Math.atan2(dx, -dz);
      const rel = (wrapAngle(ang - heading) * 180) / Math.PI;
      if (Math.abs(rel) > 75) continue;
      const dist = Math.hypot(dx, dz);
      const x = W / 2 + rel * pxPerDeg;
      const label = mk.kind === 'enemy' ? '' : `${mk.label}${mk.kind === 'obj' || dist < 2000 ? ` ${dist > 999 ? (dist / 1000).toFixed(1) + 'km' : Math.round(dist) + 'm'}` : ''}`;
      container.appendChild(h('div', { class: `poi ${mk.kind}`, style: { left: `${x}px` } }, h('b'), label));
    }
  }
}

export const defaultMarkers = (game: Game, discovered: string[]): CompassMarker[] => {
  const out: CompassMarker[] = [];
  for (const l of LOCATIONS) if (discovered.includes(l.id)) out.push({ pos: new THREE.Vector3(l.x, 0, l.z), label: l.name, kind: 'poi' });
  const p = game.player;
  if (p) {
    for (const o of game.ctx.machines) {
      if (o === p || !o.alive) continue;
      if (!game.ctx.hostile(p.faction, o.faction)) continue;
      const d = o.currPos.distanceTo(p.currPos);
      if (d < Math.max(220, p.stats.radarRange)) out.push({ pos: o.currPos, label: '', kind: 'enemy' });
    }
    for (const d of game.ctx.debris.items) {
      if (!d.loot) continue;
      const t = d.body.translation();
      if (Math.hypot(t.x - p.currPos.x, t.z - p.currPos.z) < 300) out.push({ pos: new THREE.Vector3(t.x, t.y, t.z), label: 'Loot', kind: 'loot' });
    }
  }
  return out;
};

export { RARITY_LABEL };
