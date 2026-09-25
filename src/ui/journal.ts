/**
 * Contracts journal: active contracts (track / abandon), the settlement job board and the story log.
 * Board jobs can be read anywhere but only accepted at a job board or at the home workshop radio.
 */
import './screens.css';
import type { App } from '../app';
import { h } from './dom';
import { input } from '../core/input';
import { getLocation } from '../world/layout';
import { getPart } from '../machines/parts/catalog';
import { RARITY_COLOR } from '../machines/types';
import { RESOURCE_LABEL, type Resource } from '../gameplay/profile';
import type { Mission, Reward, JobSpec } from '../gameplay/missions';

type Tab = 'active' | 'board' | 'story';

const KIND_LABEL: Record<string, string> = {
  bounty: 'Bounty',
  salvage: 'Salvage run',
  delivery: 'Delivery',
  race: 'Race',
  defend: 'Defence',
  capture: 'Capture',
  rescue: 'Rescue',
};

export class JournalUI {
  private el: HTMLElement | null = null;
  private tab: Tab = 'active';
  private sel: string | null = null;
  private atBoard = false;
  private head!: HTMLElement;
  private body!: HTMLElement;

  constructor(private app: App) {}

  get open() {
    return !!this.el;
  }

  show(tab?: Tab) {
    const app = this.app;
    if (!app.profile || app.mode !== 'world') return;
    if (this.el) this.close();
    if (app.map.open) app.map.close();
    if (app.merchant.open) app.merchant.close();
    this.atBoard = tab === 'board';
    this.tab = tab ?? 'active';
    this.sel = null;
    input.exitPointerLock();
    input.enabled = false;
    app.game.paused = true;
    app.hud.setVisible(false);
    this.head = h('div', { class: 's-head' });
    this.body = h('div', { class: 'journal' });
    this.el = h('div', { class: 'screen fade-in' }, this.head, this.body);
    app.ui.appendChild(this.el);
    this.render();
  }

  close() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    const app = this.app;
    app.game.paused = false;
    if (app.mode === 'world') app.hud.setVisible(true);
    if (app.mode === 'world' && !app.map.open && !app.merchant.open && !app.salvageUI.open) input.enabled = true;
  }

  private canAccept() {
    if (this.atBoard) return true;
    const pl = this.app.game.player;
    if (!pl) return false;
    const home = getLocation('home');
    return Math.hypot(pl.currPos.x - home.x, pl.currPos.z - home.z) < 90;
  }

  private rewardChips(r: Reward) {
    const chips: HTMLElement[] = [];
    if (r.credits) chips.push(h('span', { style: { color: 'var(--accent)' } }, `¢${r.credits.toLocaleString()}`));
    if (r.xp) chips.push(h('span', {}, `${r.xp} XP`));
    for (const [k, v] of Object.entries(r.resources ?? {})) if (v) chips.push(h('span', {}, `${v} ${RESOURCE_LABEL[k as Resource]}`));
    for (const id of r.parts ?? []) {
      const d = getPart(id);
      chips.push(h('span', { style: { color: RARITY_COLOR[d.rarity] } }, d.name));
    }
    if (r.blueprint) {
      const d = getPart(r.blueprint);
      chips.push(h('span', { style: { color: RARITY_COLOR[d.rarity] } }, `Blueprint: ${d.name}`));
    }
    return h('div', { class: 'reward' }, ...chips);
  }

  private render() {
    const app = this.app;
    const tabs = h(
      'div',
      { class: 'tabs' },
      ...(['active', 'board', 'story'] as Tab[]).map((k) =>
        h('div', { class: `tab ${this.tab === k ? 'on' : ''}`, onclick: () => { this.tab = k; this.sel = null; this.render(); } }, k === 'active' ? `Active (${app.missions.active.length})` : k === 'board' ? `Job board (${app.missions.board.length})` : 'Story'),
      ),
    );
    this.head.replaceChildren(h('div', { class: 'h1' }, 'Contracts'), tabs, h('div', { class: 'grow' }), h('div', { class: 's-close', onclick: () => this.close() }, 'J / ESC  CLOSE'));
    if (this.tab === 'active') this.renderActive();
    else if (this.tab === 'board') this.renderBoard();
    else this.renderStory();
  }

  private renderActive() {
    const app = this.app;
    const p = app.profile!;
    const list = h('div', { class: 'jlist' });
    const active = app.missions.active;
    if (!this.sel && active.length) this.sel = app.missions.tracked()?.id ?? active[0].id;
    const isStory = (m: Mission) => !('spec' in m);
    for (const m of active) {
      const done = m.objectives.filter((o) => o.done).length;
      const tracked = p.missions.tracked === m.id;
      list.append(
        h(
          'div',
          { class: `jitem ${isStory(m) ? 'story' : ''} ${this.sel === m.id ? 'sel' : ''}`, onclick: () => { this.sel = m.id; this.render(); } },
          h('div', { class: 't' }, `${tracked ? '◈ ' : ''}${m.title}`),
          h('div', { class: 's' }, `${isStory(m) ? 'Story' : KIND_LABEL[(m as any).spec.kind] ?? 'Job'} · ${done}/${m.objectives.length} objectives`),
        ),
      );
    }
    if (!active.length) list.append(h('div', { class: 'dim', style: { padding: '10px' } }, 'No active contracts. Check the job board at Rustwater.'));
    const m = active.find((x) => x.id === this.sel);
    const detail = h('div', { class: 'panel jdetail' });
    if (m) {
      const spec: JobSpec | undefined = (m as any).spec;
      detail.append(
        h('div', { class: 'label' }, spec ? `${KIND_LABEL[spec.kind]} · ${getLocation(spec.loc).name}` : 'Story contract'),
        h('div', { class: 'h2', style: { margin: '4px 0 8px' } }, m.title),
        spec ? h('div', { class: 'tier' }, `THREAT ${'■'.repeat(spec.tier + 1)}${'□'.repeat(4 - spec.tier)}`) : '',
        h('p', { class: 'dim', style: { maxWidth: '640px', lineHeight: '1.4' } }, m.desc || spec?.desc || ''),
        h('div', { class: 'label', style: { marginTop: '10px' } }, 'Objectives'),
        ...m.objectives.map((o) => h('div', { class: `obj ${o.done ? 'done' : ''}` }, h('div', { class: 'box' }), o.text)),
        h('div', { class: 'label', style: { marginTop: '14px' } }, 'Reward'),
        this.rewardChips(m.reward),
        h(
          'div',
          { style: { display: 'flex', gap: '8px' } },
          h('button', { class: 'btn primary', disabled: p.missions.tracked === m.id, onclick: () => { p.missions.tracked = m.id; app.game.audio.play('ui_click', null, { volume: 0.5 }); this.render(); } }, p.missions.tracked === m.id ? 'Tracking' : 'Track'),
          spec ? h('button', { class: 'btn danger', onclick: () => { if (confirm(`Abandon "${m.title}"?`)) { app.missions.abandon(m.id); this.sel = null; this.render(); } } }, 'Abandon') : null,
        ),
      );
    } else detail.append(h('div', { class: 'dim' }, 'Select a contract.'));
    this.body.replaceChildren(list, detail);
  }

  private renderBoard() {
    const app = this.app;
    const board = app.missions.board;
    const list = h('div', { class: 'jlist' });
    if (!this.sel && board.length) this.sel = board[0].id;
    for (const j of board) {
      list.append(
        h(
          'div',
          { class: `jitem ${this.sel === j.id ? 'sel' : ''}`, onclick: () => { this.sel = j.id; this.render(); } },
          h('div', { class: 't' }, j.title),
          h('div', { class: 's' }, `${KIND_LABEL[j.kind]} · ${getLocation(j.loc).name} · threat ${j.tier + 1} · ¢${(j.reward.credits ?? 0).toLocaleString()}`),
        ),
      );
    }
    if (!board.length) list.append(h('div', { class: 'dim', style: { padding: '10px' } }, 'The board is empty. New jobs are posted every morning.'));
    const j = board.find((x) => x.id === this.sel);
    const detail = h('div', { class: 'panel jdetail' });
    if (j) {
      const ok = this.canAccept();
      detail.append(
        h('div', { class: 'label' }, `${KIND_LABEL[j.kind]} · ${getLocation(j.loc).name}${j.dest ? ` → ${getLocation(j.dest).name}` : ''}`),
        h('div', { class: 'h2', style: { margin: '4px 0 8px' } }, j.title),
        h('div', { class: 'tier' }, `THREAT ${'■'.repeat(j.tier + 1)}${'□'.repeat(4 - j.tier)}`),
        h('p', { class: 'dim', style: { maxWidth: '640px', lineHeight: '1.4' } }, j.desc),
        h('div', { class: 'label', style: { marginTop: '10px' } }, 'Reward'),
        this.rewardChips(j.reward),
        h('button', { class: 'btn primary', disabled: !ok, onclick: () => { if (app.missions.accept(j)) { this.tab = 'active'; this.sel = j.id; this.render(); } } }, 'Accept contract'),
        ok ? '' : h('div', { class: 'dim', style: { marginTop: '8px' } }, 'Accept jobs at the Rustwater job board or over the radio at your workshop.'),
      );
    } else detail.append(h('div', { class: 'dim' }, 'Select a job.'));
    this.body.replaceChildren(list, detail);
  }

  private renderStory() {
    const app = this.app;
    const p = app.profile!;
    const list = h('div', { class: 'jlist' });
    const story = app.missions.storyList();
    for (const s of story) {
      const done = p.missions.done.includes(s.id);
      const active = app.missions.active.some((m) => m.id === s.id);
      const locked = !done && !active;
      list.append(
        h(
          'div',
          { class: `jitem story ${done ? 'done' : ''} ${this.sel === s.id ? 'sel' : ''}`, onclick: () => { this.sel = s.id; this.render(); } },
          h('div', { class: 't' }, locked ? '— Unknown —' : s.title),
          h('div', { class: 's' }, done ? 'Completed' : active ? 'In progress' : 'Locked'),
        ),
      );
    }
    const s = story.find((x) => x.id === this.sel);
    const detail = h('div', { class: 'panel jdetail' });
    if (s) {
      const done = p.missions.done.includes(s.id);
      const active = app.missions.active.some((m) => m.id === s.id);
      if (!done && !active) detail.append(h('div', { class: 'dim' }, 'Keep working. Old Mags\' notes will point the way.'));
      else detail.append(h('div', { class: 'label' }, done ? 'Completed' : 'In progress'), h('div', { class: 'h2', style: { margin: '4px 0 8px' } }, s.title), h('p', { class: 'dim', style: { maxWidth: '640px', lineHeight: '1.4' } }, s.desc), h('div', { class: 'label' }, 'Reward'), this.rewardChips(s.reward));
    } else
      detail.append(
        h('div', { class: 'label' }, 'Progress'),
        h('div', { class: 'h2', style: { margin: '6px 0' } }, `${story.filter((x) => p.missions.done.includes(x.id)).length} / ${story.length} story contracts`),
        h('div', { class: 'dim' }, `Kills ${p.stats.kills} · Parts salvaged ${p.stats.partsSalvaged} · ${(p.stats.distance / 1000).toFixed(1)} km travelled · ${p.world.bossDefeated.length ? 'The Excavator is dead.' : 'Something still digs in The Pit.'}`),
      );
    this.body.replaceChildren(list, detail);
  }
}
