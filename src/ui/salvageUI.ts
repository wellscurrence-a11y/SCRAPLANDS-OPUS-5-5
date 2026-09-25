/** Salvage selection panel: choose which surviving components to cut off a wreck. */
import './panels.css';
import { h } from './dom';
import type { Machine } from '../machines/machine';
import type { PartRuntime } from '../machines/part';
import type { SalvageSystem } from '../gameplay/salvage';
import { CATEGORY_LABEL, RARITY_COLOR, rarityIndex } from '../machines/types';
import { formatMass } from '../core/math';
import { sellPrice } from '../gameplay/economy';

export class SalvageUI {
  el: HTMLElement | null = null;
  private selected = new Set<PartRuntime>();
  onClose: (() => void) | null = null;

  constructor(private parent: HTMLElement, private salvage: SalvageSystem) {}

  get open() {
    return !!this.el;
  }

  show(wreck: Machine) {
    this.close();
    const cands = this.salvage.candidates(wreck).sort((a, b) => rarityIndex(b.def.rarity) - rarityIndex(a.def.rarity) || b.def.value - a.def.value);
    this.selected.clear();
    // preselect rare+ parts that fit
    let mass = this.salvage.cargoUsed();
    for (const p of cands) {
      if (rarityIndex(p.def.rarity) >= 2 && mass + p.def.mass <= this.salvage.cargoCap()) {
        this.selected.add(p);
        mass += p.def.mass;
      }
    }
    const list = h('div', { class: 'plist', style: { maxHeight: '50vh', minWidth: '560px' } });
    const cargoBar = h('i');
    const cargoText = h('span', { class: 'mono dim' });
    const takeBtn = h('button', { class: 'btn primary' }, 'Cut selected parts');
    const render = () => {
      list.innerHTML = '';
      const used = this.salvage.cargoUsed();
      const sel = [...this.selected].reduce((s, p) => s + p.def.mass, 0);
      const cap = this.salvage.cargoCap();
      cargoBar.style.width = `${Math.min(1, (used + sel) / cap) * 100}%`;
      cargoBar.style.background = used + sel > cap ? 'var(--bad)' : '';
      cargoText.textContent = `${formatMass(used + sel)} / ${formatMass(cap)}`;
      for (const p of cands) {
        const on = this.selected.has(p);
        const fits = on || used + sel + p.def.mass <= cap;
        const row = h(
          'div',
          { class: `prow ${on ? 'sel' : ''} ${fits ? '' : 'dis'}`, onclick: () => { if (on) this.selected.delete(p); else this.selected.add(p); render(); } },
          h('div', { class: 'chk' }),
          h('div', {}, h('div', { class: 'pname', style: { color: RARITY_COLOR[p.def.rarity] } }, p.def.name), h('div', { class: 'pcat' }, `${CATEGORY_LABEL[p.def.category]} · ${p.def.rarity}`)),
          h('div', { class: 'bar hp' }, h('i', { style: { width: `${p.cond * 100}%`, background: p.cond > 0.5 ? 'var(--good)' : 'var(--warn)' } })),
          h('div', { class: 'num' }, formatMass(p.def.mass)),
          h('div', { class: 'num' }, `¢${sellPrice(p.def, p.cond)}`),
        );
        list.appendChild(row);
      }
      if (!cands.length) list.appendChild(h('div', { class: 'dim', style: { padding: '12px' } }, 'Nothing intact survived. Strip it for resources.'));
      (takeBtn as HTMLButtonElement).disabled = this.selected.size === 0;
    };
    takeBtn.onclick = () => {
      this.salvage.start(wreck, [...this.selected], false);
      this.close();
    };
    const stripBtn = h('button', { class: 'btn' }, 'Strip remains for resources');
    stripBtn.onclick = () => {
      this.salvage.start(wreck, [...this.selected], true);
      this.close();
    };
    this.el = h(
      'div',
      { class: 'panel modal fade-in' },
      h('div', { class: 'close', onclick: () => this.close() }, '✕'),
      h('div', { class: 'head' }, h('div', {}, h('div', { class: 'label' }, 'Salvage'), h('div', { class: 'h2' }, wreck.name)), h('div', { class: 'label' }, `${cands.length} intact components`)),
      h('div', { class: 'cargo-line', style: { marginBottom: '10px' } }, h('span', { class: 'label' }, 'Cargo'), h('div', { class: 'bar cargo' }, cargoBar), cargoText),
      list,
      h('div', { class: 'foot' }, h('span', { class: 'dim', style: { marginRight: 'auto', fontSize: '13px' } }, 'Cutting takes time. Stay close — enemies may arrive.'), stripBtn, takeBtn),
    );
    this.parent.appendChild(this.el);
    render();
  }

  close() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.onClose?.();
  }
}
