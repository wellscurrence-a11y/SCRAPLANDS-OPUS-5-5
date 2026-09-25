/** Loading screen, title menu, pause/settings and modal overlays. */
import './menus.css';
import { h, clear } from './dom';
import type { Quality } from '../render/renderer';

/** Bump when defaults change in a way that should re-apply to saved settings. */
const SETTINGS_VERSION = 2;

export interface Settings {
  version: number;
  quality: Quality;
  /** Quality was picked for this device (not by the player) and may be lowered if the game runs slowly. */
  autoQuality: boolean;
  volume: number;
  music: number;
  sensitivity: number;
  invertY: boolean;
  fov: number;
  /** Small FPS / render-scale readout in the corner. */
  showPerf: boolean;
}

const SETTINGS_KEY = 'scraplands.settings';

/** A starting quality for this device: Chromebooks and small laptops get lighter settings. */
export function detectQuality(): Quality {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory ?? 8;
  const chromeOS = /\bCrOS\b/.test(nav.userAgent);
  if (cores <= 4 || mem <= 4) return 'low';
  if (chromeOS || cores <= 8) return 'medium';
  return 'high';
}

export function loadSettings(): Settings {
  const def: Settings = { version: SETTINGS_VERSION, quality: detectQuality(), autoQuality: true, volume: 0.8, music: 0.5, sensitivity: 1, invertY: false, fov: 68, showPerf: false };
  let s = def;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      s = { ...def, ...saved };
      // settings saved before graphics were tuned per device: re-detect quality once, keep the rest
      if (!saved.version || saved.version < SETTINGS_VERSION) s = { ...s, version: SETTINGS_VERSION, quality: def.quality, autoQuality: true };
    }
  } catch {
    /* ignore */
  }
  // ?quality=low|medium|high|ultra forces a preset for this visit (handy for testing a device)
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced && ['low', 'medium', 'high', 'ultra'].includes(forced)) s = { ...s, quality: forced as Quality, autoQuality: false };
  return s;
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export class LoadingScreen {
  el: HTMLElement;
  private bar: HTMLElement;
  private label: HTMLElement;
  constructor(parent: HTMLElement) {
    this.bar = h('i');
    this.label = h('div', { class: 'load-label' }, 'Starting');
    this.el = h('div', { id: 'loading' }, h('div', { class: 'logo' }, 'SCRAP', h('span', {}, 'LANDS')), h('div', { class: 'logo-sub' }, 'Build · Salvage · Survive'), h('div', { class: 'load-bar' }, this.bar), this.label);
    parent.appendChild(this.el);
  }
  set(p: number, label: string) {
    this.bar.style.width = `${Math.round(p * 100)}%`;
    this.label.textContent = label;
  }
  done() {
    this.el.classList.add('done');
    setTimeout(() => this.el.remove(), 1000);
  }
}

export interface TitleActions {
  hasSave: boolean;
  saveInfo: string;
  onContinue(): void;
  onNew(): void;
  onSettings(): void;
  onExport(): void;
  onImport(file: File): void;
}

export class TitleScreen {
  el: HTMLElement;
  constructor(parent: HTMLElement) {
    this.el = h('div', { id: 'title' });
    parent.appendChild(this.el);
  }
  show(a: TitleActions) {
    clear(this.el);
    const fileInput = h('input', { type: 'file', accept: '.json', style: { display: 'none' } }) as HTMLInputElement;
    fileInput.onchange = () => {
      const f = fileInput.files?.[0];
      if (f) a.onImport(f);
    };
    const items = [
      a.hasSave ? h('div', { class: 'menu-item', onclick: a.onContinue }, 'Continue', h('div', { class: 'save-info' }, a.saveInfo)) : null,
      h('div', { class: 'menu-item', onclick: a.onNew }, a.hasSave ? 'New game' : 'Start'),
      h('div', { class: 'menu-item', onclick: a.onSettings }, 'Settings'),
      a.hasSave ? h('div', { class: 'menu-item', style: { fontSize: '18px' }, onclick: a.onExport }, 'Export save') : null,
      h('div', { class: 'menu-item', style: { fontSize: '18px' }, onclick: () => fileInput.click() }, 'Import save'),
    ];
    this.el.append(
      h('div', { class: 'inner' }, h('div', { class: 'logo' }, 'SCRAP', h('span', {}, 'LANDS')), h('div', { class: 'logo-sub' }, 'The Kessler Basin'), h('div', { class: 'menu-list' }, ...items), fileInput),
      h('div', { class: 'menu-foot' }, 'One save. Every machine you build is yours to keep.'),
    );
    this.el.classList.add('on');
  }
  hide() {
    this.el.classList.remove('on');
  }
}

export function settingsPanel(s: Settings, onChange: (s: Settings) => void): HTMLElement {
  const quality = h('select', {}, ...(['low', 'medium', 'high', 'ultra'] as Quality[]).map((q) => h('option', { value: q, selected: s.quality === q }, q.toUpperCase()))) as HTMLSelectElement;
  quality.onchange = () => {
    s.quality = quality.value as Quality;
    s.autoQuality = false;
    onChange(s);
  };
  const slider = (key: 'volume' | 'music' | 'sensitivity' | 'fov', min: number, max: number, step: number) => {
    const val = h('div', { class: 'mono' }, String(s[key]));
    const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(s[key]) }) as HTMLInputElement;
    inp.oninput = () => {
      (s as any)[key] = parseFloat(inp.value);
      val.textContent = inp.value;
      onChange(s);
    };
    return [inp, val];
  };
  const invert = h('input', { type: 'checkbox', checked: s.invertY }) as HTMLInputElement;
  invert.onchange = () => {
    s.invertY = invert.checked;
    onChange(s);
  };
  const perf = h('input', { type: 'checkbox', checked: s.showPerf }) as HTMLInputElement;
  perf.onchange = () => {
    s.showPerf = perf.checked;
    onChange(s);
  };
  return h(
    'div',
    { class: 'settings-grid' },
    h('div', { class: 'label' }, 'Graphics'),
    quality,
    h('div'),
    h('div', { class: 'label' }, 'Master volume'),
    ...slider('volume', 0, 1, 0.05),
    h('div', { class: 'label' }, 'Music'),
    ...slider('music', 0, 1, 0.05),
    h('div', { class: 'label' }, 'Mouse sensitivity'),
    ...slider('sensitivity', 0.2, 3, 0.1),
    h('div', { class: 'label' }, 'Field of view'),
    ...slider('fov', 55, 90, 1),
    h('div', { class: 'label' }, 'Invert mouse Y'),
    invert,
    h('div'),
    h('div', { class: 'label' }, 'Show FPS'),
    perf,
    h('div'),
  );
}

export function controlsHelp(): HTMLElement {
  const rows: [string, string][] = [
    ['W A S D', 'Drive / fly / walk'],
    ['Mouse', 'Aim (turrets follow your crosshair)'],
    ['LMB / RMB / MMB', 'Fire weapon groups 1 / 2 / 3'],
    ['Hold 1 / 2 / 3', 'Fire weapon groups (touchpads)'],
    ['Space', 'Handbrake · Climb · Jump jets'],
    ['C / Ctrl', 'Descend (aircraft)'],
    ['Shift', 'Boost · Run'],
    ['E', 'Interact · Salvage · Enter garage'],
    ['Tab (hold)', 'Scan target components'],
    ['F', 'Headlights'],
    ['R (hold)', 'Self-right a flipped machine'],
    ['M', 'Map'],
    ['J', 'Contracts'],
    ['Esc', 'Pause'],
  ];
  return h('div', { class: 'controls-grid' }, ...rows.flatMap(([k, v]) => [h('div', { class: 'k' }, k), h('div', {}, v)]));
}
