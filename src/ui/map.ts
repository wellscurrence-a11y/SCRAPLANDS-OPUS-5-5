/**
 * World map: a hill-shaded chart generated from the real heightfield and splat data, with roads,
 * discovered locations, rumoured sites, contract objectives, nearby contacts and a user waypoint.
 */
import './screens.css';
import * as THREE from 'three';
import type { App } from '../app';
import { h } from './dom';
import { input } from '../core/input';
import { GRID } from '../world/heightfield';
import { LOCATIONS, ROADS, HALF_WORLD, WORLD_SIZE, type LocationDef } from '../world/layout';
import { clamp } from '../core/math';
import type { CompassMarker } from './hud';

const RES = 1024; // base image pixels per side (2 m per pixel)
const FACTION_COLOR: Record<string, string> = {
  scrappers: '#ff8a3a',
  authority: '#6fa8ff',
  helix: '#d77dff',
  independents: '#8fdc6a',
};
const KIND_GLYPH: Record<string, string> = {
  home: '⌂',
  settlement: '◉',
  industrial: '▣',
  military: '✚',
  canyon: '⋀',
  desert: '∿',
  wreck: '✕',
  hidden: '◆',
  quarry: '◎',
  landmark: '▲',
};

let baseCanvas: HTMLCanvasElement | null = null;

/** Render the terrain once into an offscreen canvas. */
function buildBase(app: App): HTMLCanvasElement {
  if (baseCanvas) return baseCanvas;
  const { heights, splat } = app.game.terrain.data;
  const c = document.createElement('canvas');
  c.width = c.height = RES;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(RES, RES);
  const step = (GRID - 1) / RES;
  const hAt = (ix: number, iz: number) => heights[clamp(iz, 0, GRID - 1) * GRID + clamp(ix, 0, GRID - 1)];
  const L = new THREE.Vector3(-0.6, 0.9, -0.5).normalize();
  const nrm = new THREE.Vector3();
  const sand = [201, 170, 120];
  const dirt = [166, 134, 96];
  const packed = [150, 128, 100];
  const rock = [118, 98, 80];
  const high = [150, 138, 124];
  const asphalt = [58, 54, 50];
  const gravel = [138, 126, 110];
  for (let py = 0; py < RES; py++) {
    for (let px = 0; px < RES; px++) {
      const ix = Math.round(px * step);
      const iz = Math.round(py * step);
      const hC = hAt(ix, iz);
      const dx = hAt(ix + 1, iz) - hAt(ix - 1, iz);
      const dz = hAt(ix, iz + 1) - hAt(ix, iz - 1);
      nrm.set(-dx, 4, -dz).normalize();
      const shade = clamp(0.35 + nrm.dot(L) * 0.85, 0.25, 1.25);
      const si = (iz * GRID + ix) * 4;
      const sa = splat[si] / 255;
      const sg = splat[si + 1] / 255;
      const ss = splat[si + 2] / 255;
      const sp = splat[si + 3] / 255;
      const slope = 1 - nrm.y;
      let r = dirt[0];
      let g = dirt[1];
      let b = dirt[2];
      const mix = (col: number[], t: number) => {
        r += (col[0] - r) * t;
        g += (col[1] - g) * t;
        b += (col[2] - b) * t;
      };
      mix(sand, ss);
      mix(packed, sp * 0.8);
      mix(high, clamp((hC - 60) / 90, 0, 1));
      mix(rock, clamp((slope - 0.08) * 4, 0, 1));
      mix(gravel, sg);
      mix(asphalt, sa);
      // contour lines every 10 m
      const cl = Math.abs(((hC / 10) % 1) - 0.5);
      const contour = cl > 0.46 && slope < 0.5 ? 0.86 : 1;
      const o = (py * RES + px) * 4;
      img.data[o] = clamp(r * shade * contour, 0, 255);
      img.data[o + 1] = clamp(g * shade * contour, 0, 255);
      img.data[o + 2] = clamp(b * shade * contour, 0, 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // roads drawn as vectors on top of the splat
  const toPx = (v: number) => ((v + HALF_WORLD) / WORLD_SIZE) * RES;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const road of ROADS) {
    const path = () => {
      ctx.beginPath();
      road.points.forEach(([x, z], i) => (i ? ctx.lineTo(toPx(x), toPx(z)) : ctx.moveTo(toPx(x), toPx(z))));
    };
    if (road.kind === 'highway') {
      path();
      ctx.strokeStyle = 'rgba(20,18,16,0.85)';
      ctx.lineWidth = (road.width / 2) * 1.25;
      ctx.stroke();
      path();
      ctx.strokeStyle = '#4a4540';
      ctx.lineWidth = road.width / 2;
      ctx.stroke();
      path();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = 'rgba(230,190,90,0.7)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      path();
      ctx.strokeStyle = 'rgba(92,72,50,0.8)';
      ctx.lineWidth = road.width / 2;
      ctx.stroke();
    }
  }
  // soft vignette toward the mountain ring
  const grad = ctx.createRadialGradient(RES / 2, RES / 2, RES * 0.38, RES / 2, RES / 2, RES * 0.72);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, RES, RES);
  baseCanvas = c;
  return c;
}

export class MapScreen {
  private el: HTMLElement | null = null;
  private canvas!: HTMLCanvasElement;
  private side!: HTMLElement;
  private raf = 0;
  /** View: world point at canvas centre, pixels per metre. */
  private cx = 0;
  private cz = 0;
  private scale = 0.5;
  private drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  private hover: { x: number; z: number } | null = null;
  /** Player-placed waypoint (shown on the compass). */
  waypoint: THREE.Vector3 | null = null;

  constructor(private app: App) {}

  get open() {
    return !!this.el;
  }

  show() {
    const app = this.app;
    if (this.el || app.mode !== 'world') return;
    if (app.merchant.open) app.merchant.close();
    if (app.journal.open) app.journal.close();
    input.exitPointerLock();
    input.enabled = false;
    app.game.paused = true;
    app.hud.setVisible(false);
    const base = buildBase(app);
    this.canvas = h('canvas') as HTMLCanvasElement;
    const view = h('div', { class: 'map-view' }, this.canvas, h('div', { class: 'map-hint' }, 'Drag to pan · Wheel to zoom · Click to place a waypoint · Click it again to clear'));
    this.side = h('div', { class: 'map-side' });
    this.el = h(
      'div',
      { class: 'screen fade-in' },
      h('div', { class: 's-head' }, h('div', { class: 'h1' }, 'Kessler Basin'), h('div', { class: 'dim' }, `Day ${app.game.env.day} · ${app.game.env.timeString} · ${app.game.env.weather}`), h('div', { class: 'grow' }), h('div', { class: 's-close', onclick: () => this.close() }, 'M / ESC  CLOSE')),
      h('div', { class: 'map-wrap' }, view, this.side),
    );
    app.ui.appendChild(this.el);
    const pl = app.game.player;
    this.cx = pl ? pl.currPos.x : 0;
    this.cz = pl ? pl.currPos.z : 0;
    const rect = view.getBoundingClientRect();
    this.scale = Math.min(rect.width, rect.height) / 1300;
    // interaction
    view.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = view.getBoundingClientRect();
      const before = this.toWorld(e.clientX - r.left, e.clientY - r.top, r);
      this.scale = clamp(this.scale * (e.deltaY < 0 ? 1.18 : 1 / 1.18), Math.min(r.width, r.height) / 2100, 6);
      const after = this.toWorld(e.clientX - r.left, e.clientY - r.top, r);
      this.cx += before.x - after.x;
      this.cz += before.z - after.z;
    });
    view.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz, moved: false };
      view.classList.add('drag');
      view.setPointerCapture(e.pointerId);
    });
    view.addEventListener('pointermove', (e) => {
      const r = view.getBoundingClientRect();
      this.hover = this.toWorld(e.clientX - r.left, e.clientY - r.top, r);
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
      this.cx = this.drag.cx - dx / this.scale;
      this.cz = this.drag.cz - dy / this.scale;
    });
    view.addEventListener('pointerup', (e) => {
      view.classList.remove('drag');
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved) return;
      const r = view.getBoundingClientRect();
      const w = this.toWorld(e.clientX - r.left, e.clientY - r.top, r);
      if (this.waypoint && Math.hypot(this.waypoint.x - w.x, this.waypoint.z - w.z) * this.scale < 14) this.waypoint = null;
      else this.waypoint = new THREE.Vector3(w.x, app.game.terrain.heightAt(w.x, w.z), w.z);
      app.game.audio.play('ui_click', null, { volume: 0.5 });
    });
    this.renderSide();
    const loop = () => {
      if (!this.el) return;
      this.draw(base);
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  close() {
    if (!this.el) return;
    cancelAnimationFrame(this.raf);
    this.el.remove();
    this.el = null;
    const app = this.app;
    app.game.paused = false;
    if (app.mode === 'world') app.hud.setVisible(true);
    if (app.mode === 'world' && !app.merchant.open && !app.journal.open && !app.salvageUI.open) input.enabled = true;
  }

  private toWorld(px: number, py: number, r: { width: number; height: number }) {
    return { x: this.cx + (px - r.width / 2) / this.scale, z: this.cz + (py - r.height / 2) / this.scale };
  }

  private renderSide() {
    const app = this.app;
    const p = app.profile!;
    const tracked = app.missions.trackerInfo();
    const locs = LOCATIONS.filter((l) => p.discovered.includes(l.id));
    const rumoured = LOCATIONS.filter((l) => !l.hidden && !p.discovered.includes(l.id));
    const locRow = (l: LocationDef, known: boolean) =>
      h(
        'div',
        { class: 'loc', style: { borderLeftColor: l.faction ? FACTION_COLOR[l.faction] : 'var(--line-2)' }, onclick: () => { this.cx = l.x; this.cz = l.z; } },
        h('div', { class: 'n' }, known ? `${KIND_GLYPH[l.kind] ?? '•'}  ${l.name}` : '?  Unexplored site'),
        h('div', { class: 'd' }, known ? `${'◆'.repeat(Math.max(0, Math.round(l.danger)))}${'◇'.repeat(Math.max(0, 5 - Math.round(l.danger)))}  ${l.faction ? l.faction[0].toUpperCase() + l.faction.slice(1) : 'Unclaimed'}` : 'Rumoured on the traders\' charts'),
      );
    this.side.replaceChildren(
      h('div', { class: 'panel', style: { padding: '12px 14px' } },
        h('div', { class: 'label' }, 'Tracked contract'),
        tracked
          ? h('div', {}, h('div', { class: 'h3', style: { margin: '4px 0 6px' } }, tracked.title), ...tracked.objectives.map((o) => h('div', { class: `obj ${o.done ? 'done' : ''}`, style: { fontSize: '14px' } }, h('div', { class: 'box' }), o.text)))
          : h('div', { class: 'dim' }, 'None — press J for the contract board.'),
      ),
      h('div', { class: 'label' }, `Known locations  ${locs.length}/${LOCATIONS.filter((l) => !l.hidden).length}`),
      ...locs.map((l) => locRow(l, true)),
      ...rumoured.map((l) => locRow(l, false)),
      h('div', { class: 'label', style: { marginTop: '8px' } }, 'Legend'),
      h('div', { class: 'legend' },
        h('i', { style: { background: 'var(--accent)' } }), 'You',
        h('i', { style: { background: '#ffd84a' } }), 'Contract objective',
        h('i', { style: { background: '#56c2ff' } }), 'Waypoint',
        h('i', { style: { background: '#ff4a3a' } }), 'Hostile contact (radar)',
        h('i', { style: { background: FACTION_COLOR.scrappers } }), 'Scrappers',
        h('i', { style: { background: FACTION_COLOR.authority } }), 'Iron Authority',
        h('i', { style: { background: FACTION_COLOR.helix } }), 'Helix Industries',
        h('i', { style: { background: FACTION_COLOR.independents } }), 'Independents',
      ),
    );
  }

  private draw(base: HTMLCanvasElement) {
    const c = this.canvas;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0a08';
    ctx.fillRect(0, 0, r.width, r.height);
    const s = this.scale;
    const sx = (x: number) => r.width / 2 + (x - this.cx) * s;
    const sy = (z: number) => r.height / 2 + (z - this.cz) * s;
    ctx.imageSmoothingEnabled = s < 1.2;
    ctx.drawImage(base, sx(-HALF_WORLD), sy(-HALF_WORLD), WORLD_SIZE * s, WORLD_SIZE * s);
    // grid (250 m)
    ctx.strokeStyle = 'rgba(255,220,160,0.07)';
    ctx.lineWidth = 1;
    for (let g = -1000; g <= 1000; g += 250) {
      ctx.beginPath();
      ctx.moveTo(sx(g), sy(-HALF_WORLD));
      ctx.lineTo(sx(g), sy(HALF_WORLD));
      ctx.moveTo(sx(-HALF_WORLD), sy(g));
      ctx.lineTo(sx(HALF_WORLD), sy(g));
      ctx.stroke();
    }
    const app = this.app;
    const p = app.profile!;
    const game = app.game;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // locations
    for (const l of LOCATIONS) {
      const known = p.discovered.includes(l.id);
      if (!known && l.hidden) continue;
      const x = sx(l.x);
      const y = sy(l.z);
      const col = known ? (l.faction ? FACTION_COLOR[l.faction] : '#e8dcc6') : 'rgba(232,220,198,0.45)';
      if (known) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(6, l.radius * s), 0, Math.PI * 2);
        ctx.strokeStyle = col + '55';
        ctx.setLineDash([3, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = 'rgba(10,8,6,0.75)';
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.font = '600 13px "Barlow Condensed", sans-serif';
      ctx.fillText(known ? KIND_GLYPH[l.kind] ?? '•' : '?', x, y + 0.5);
      ctx.font = '600 14px "Barlow Condensed", sans-serif';
      ctx.fillStyle = known ? '#f1e7d4' : 'rgba(241,231,212,0.5)';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.fillText(known ? l.name.toUpperCase() : 'UNEXPLORED', x, y + 21);
      ctx.shadowBlur = 0;
    }
    // radar contacts near the player
    const pl = game.player;
    if (pl) {
      for (const m of game.ctx.machines) {
        if (m === pl || !m.alive) continue;
        if (m.currPos.distanceTo(pl.currPos) > 160) continue;
        ctx.fillStyle = m.faction === 'independents' ? '#8fdc6a' : '#ff4a3a';
        ctx.beginPath();
        ctx.arc(sx(m.currPos.x), sy(m.currPos.z), m.tag.boss ? 7 : 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // contract markers (all active contracts; tracked one highlighted)
    const tracked = app.missions.tracked();
    for (const mis of app.missions.active) {
      const on = mis === tracked;
      for (const mk of mis.markers()) this.drawMarker(ctx, sx(mk.pos.x), sy(mk.pos.z), mk, on);
    }
    // waypoint
    if (this.waypoint) {
      const x = sx(this.waypoint.x);
      const y = sy(this.waypoint.z);
      ctx.fillStyle = '#56c2ff';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 7, y - 14);
      ctx.arc(x, y - 16, 7, Math.PI * 0.8, Math.PI * 0.2);
      ctx.closePath();
      ctx.fill();
      if (pl) {
        ctx.strokeStyle = 'rgba(86,194,255,0.5)';
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(sx(pl.currPos.x), sy(pl.currPos.z));
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#bfe6ff';
        ctx.font = '13px "Share Tech Mono", monospace';
        ctx.fillText(`${Math.round(Math.hypot(pl.currPos.x - this.waypoint.x, pl.currPos.z - this.waypoint.z))} m`, x, y - 32);
      }
    }
    // player arrow
    if (pl) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(pl.currQuat);
      const a = Math.atan2(fwd.x, -fwd.z);
      const x = sx(pl.currPos.x);
      const y = sy(pl.currPos.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = '#ffae3b';
      ctx.strokeStyle = '#140f0a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(8, 9);
      ctx.lineTo(0, 4);
      ctx.lineTo(-8, 9);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }
    // cursor readout
    if (this.hover) {
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(r.width - 196, 6, 190, 22);
      ctx.fillStyle = '#d9cfbd';
      ctx.font = '13px "Share Tech Mono", monospace';
      const hgt = game.terrain.heightAt(this.hover.x, this.hover.z);
      ctx.fillText(`${Math.round(this.hover.x)}, ${Math.round(this.hover.z)}  ▲${Math.round(hgt)} m`, r.width - 12, 17);
      ctx.textAlign = 'center';
    }
    // scale bar
    const meters = s > 1.5 ? 50 : s > 0.6 ? 100 : 250;
    ctx.fillStyle = '#d9cfbd';
    ctx.fillRect(14, r.height - 40, meters * s, 3);
    ctx.font = '12px "Share Tech Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${meters} m`, 14, r.height - 50);
    ctx.textAlign = 'center';
    // north
    ctx.fillStyle = '#d9cfbd';
    ctx.font = '700 16px "Barlow Condensed", sans-serif';
    ctx.fillText('N', r.width - 24, 48);
    ctx.beginPath();
    ctx.moveTo(r.width - 24, 58);
    ctx.lineTo(r.width - 29, 70);
    ctx.lineTo(r.width - 19, 70);
    ctx.fill();
  }

  private drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, mk: CompassMarker, tracked: boolean) {
    const col = tracked ? '#ffd84a' : 'rgba(255,216,74,0.55)';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = 'rgba(10,8,6,0.8)';
    ctx.fillRect(-7, -7, 14, 14);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.strokeRect(-7, -7, 14, 14);
    ctx.restore();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (tracked) {
      ctx.font = '600 13px "Barlow Condensed", sans-serif';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.fillText(mk.label, x, y - 18);
      ctx.shadowBlur = 0;
    }
  }
}
