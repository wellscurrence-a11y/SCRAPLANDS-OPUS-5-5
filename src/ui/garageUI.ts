/** Garage interface: build, machines, storage, research, fabrication, workshop upgrades and paint. */
import './garage.css';
import './panels.css';
import { h, clear, fmtCredits } from './dom';
import type { Garage } from '../garage/garage';
import type { Profile, Resource } from '../gameplay/profile';
import { RESOURCES, RESOURCE_LABEL, canAfford, spend, storageCapacity, saveProfile, addResources } from '../gameplay/profile';
import { getPart, PARTS } from '../machines/parts/catalog';
import { CATEGORY_LABEL, RARITY_COLOR, rarityIndex, PaintPattern, PartCategory, PartDef, PartItem } from '../machines/types';
import { partDetailHtml } from './partInfo';
import { formatMass, formatPower, uid } from '../core/math';
import { repairCost, scrapYield, sellPrice } from '../gameplay/economy';
import { TECH, researchStatus, partUnlocked, fabricationCost, needsElectronicsBench, UPGRADES, baysFor } from '../gameplay/research';
import { canMount } from '../machines/layout';

type Tab = 'build' | 'machines' | 'storage' | 'research' | 'fabricate' | 'workshop' | 'paint';

const CAT_GROUPS: Record<string, PartCategory[]> = {
  Structure: ['frame', 'cockpit', 'armor', 'ram', 'cargo'],
  Drive: ['engine', 'transmission', 'suspension', 'wheel', 'track', 'booster', 'rotor', 'jet', 'wing', 'gear', 'airbrake', 'leg', 'actuator', 'foot', 'arm', 'jumpjet', 'hydraulics'],
  Power: ['generator', 'battery', 'fuel', 'cooling'],
  Weapons: ['weapon', 'melee'],
  Utility: ['sensor', 'countermeasure', 'light', 'stabilizer', 'utility'],
};

const PALETTE = ['#b5552b', '#8c3b1f', '#6b6b3a', '#56603f', '#3f4f5f', '#2f5d7a', '#4a88a8', '#9a7a2e', '#d9b25a', '#e0dccb', '#e2e6ea', '#8a8a8a', '#4a5046', '#2d2f2a', '#1c1c1c', '#5e2e2e', '#c43a2a', '#e07a2e', '#ffd23a', '#7a5a2f', '#5a2f4a', '#3a6a5a', '#9fd28a', '#ff4fb8'];
const BASIC = 10;

export class GarageUI {
  root: HTMLElement;
  private tab: Tab = 'build';
  private filterGroup = 'All';
  private search = '';
  private bodyEl: HTMLElement;
  private msgTimer = 0;
  onDeploy: ((machineId: string) => void) | null = null;
  onExit: (() => void) | null = null;
  onNotify: ((t: string, k?: string) => void) | null = null;
  private profile!: Profile;
  private refreshQueued = false;

  constructor(parent: HTMLElement, private garage: Garage) {
    this.root = h('div', { id: 'garage-ui' });
    this.bodyEl = h('div');
    this.root.appendChild(this.bodyEl);
    parent.appendChild(this.root);
    garage.onChange = () => this.queueRefresh();
    garage.onMessage = (t, k) => this.message(t, k);
  }

  show(profile: Profile) {
    this.profile = profile;
    this.root.classList.add('on');
    this.tab = 'build';
    this.refresh();
  }

  hide() {
    this.root.classList.remove('on');
  }

  private queueRefresh() {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => {
      this.refreshQueued = false;
      this.refresh();
    });
  }

  private message(t: string, kind = 'info') {
    this.onNotify?.(t, kind);
  }

  refresh() {
    if (!this.profile) return;
    clear(this.bodyEl);
    this.bodyEl.appendChild(this.topBar());
    switch (this.tab) {
      case 'build':
        this.bodyEl.append(...this.buildTab());
        break;
      case 'machines':
        this.bodyEl.append(this.machinesTab());
        break;
      case 'storage':
        this.bodyEl.append(this.storageTab());
        break;
      case 'research':
        this.bodyEl.append(this.researchTab());
        break;
      case 'fabricate':
        this.bodyEl.append(this.fabricateTab());
        break;
      case 'workshop':
        this.bodyEl.append(this.workshopTab());
        break;
      case 'paint':
        this.bodyEl.append(...this.paintTab());
        break;
    }
  }

  private topBar() {
    const p = this.profile;
    const tabs: [Tab, string][] = [
      ['build', 'Build'],
      ['machines', 'Machines'],
      ['storage', 'Storage'],
      ['research', 'Research'],
      ['fabricate', 'Fabricate'],
      ['workshop', 'Workshop'],
      ['paint', 'Paint'],
    ];
    const res = RESOURCES.map((r) => h('div', { class: 'r' }, h('b', {}, String(p.resources[r])), h('span', {}, RESOURCE_LABEL[r].split(' ')[0])));
    return h(
      'div',
      { class: 'g-top' },
      h('div', { class: 'title' }, 'WORKSHOP'),
      h(
        'div',
        { class: 'g-tabs' },
        tabs.map(([t, l]) => h('div', { class: `g-tab ${this.tab === t ? 'on' : ''}`, onclick: () => { this.tab = t; if (t !== 'build') this.garage.cancelPlacing(); this.refresh(); } }, l)),
      ),
      h('div', { class: 'g-res' }, h('div', { class: 'c' }, fmtCredits(p.credits)), ...res),
      h('button', { class: 'btn', onclick: () => this.onExit?.() }, 'Leave'),
    );
  }

  // ------------------------------------------------------------------ BUILD
  private buildTab(): HTMLElement[] {
    const g = this.garage;
    const d = g.design;
    const p = this.profile;
    const out: HTMLElement[] = [];
    // ---- parts list ----
    const groups = ['All', ...Object.keys(CAT_GROUPS)];
    const filter = h(
      'div',
      { class: 'g-filter' },
      groups.map((gr) => h('div', { class: `chip ${this.filterGroup === gr ? 'on' : ''}`, onclick: () => { this.filterGroup = gr; this.refresh(); } }, gr)),
    );
    const search = h('input', { type: 'text', placeholder: 'Search parts…', value: this.search, style: { width: '100%', fontSize: '15px' } }) as HTMLInputElement;
    search.oninput = () => {
      this.search = search.value;
      renderList();
    };
    const list = h('div', { class: 'g-list' });
    const renderList = () => {
      clear(list);
      const byDef = new Map<string, PartItem[]>();
      for (const it of p.inventory) {
        const def = getPart(it.defId);
        if (this.filterGroup !== 'All' && !CAT_GROUPS[this.filterGroup].includes(def.category)) continue;
        if (this.search && !def.name.toLowerCase().includes(this.search.toLowerCase())) continue;
        const arr = byDef.get(def.id) ?? [];
        arr.push(it);
        byDef.set(def.id, arr);
      }
      const entries = [...byDef.entries()].map(([id, items]) => ({ def: getPart(id), items: items.sort((a, b) => b.cond - a.cond) }));
      entries.sort((a, b) => a.def.category.localeCompare(b.def.category) || rarityIndex(b.def.rarity) - rarityIndex(a.def.rarity));
      let lastCat = '';
      for (const e of entries) {
        if (e.def.category !== lastCat) {
          lastCat = e.def.category;
          list.appendChild(h('div', { class: 'g-group' }, CATEGORY_LABEL[e.def.category]));
        }
        const fits = d ? e.def.classes.includes(d.cls) && e.def.category !== 'frame' : false;
        const placing = g.placing?.def.id === e.def.id;
        const best = e.items[0];
        const el = h(
          'div',
          {
            class: `g-item ${placing ? 'on' : ''} ${fits ? '' : 'na'}`,
            style: { borderLeftColor: RARITY_COLOR[e.def.rarity] },
            title: e.def.desc,
            onclick: () => {
              if (!fits) {
                this.message(e.def.category === 'frame' ? 'Frames start new machines (Machines tab).' : `${e.def.name} is not usable on ${d?.cls} machines.`, 'bad');
                return;
              }
              if (g.selected) {
                const sel = g.selectedPart();
                const selDef = sel ? getPart(sel.defId) : null;
                const lay = sel && g.layout?.byUid.get(sel.uid);
                if (selDef && lay?.socket && canMount(e.def, lay.socket, d!.cls) && selDef.category === e.def.category) {
                  g.replacePart(sel!.uid, best);
                  return;
                }
              }
              g.startPlacing(best);
            },
          },
          h('div', { class: 'n', style: { color: RARITY_COLOR[e.def.rarity] } }, e.def.name),
          h('div', { class: 'q' }, `×${e.items.length}`),
          h('div', { class: 's' }, `${CATEGORY_LABEL[e.def.category]} · ${formatMass(e.def.mass)} · best ${Math.round(best.cond * 100)}%`),
        );
        el.addEventListener('mouseenter', () => this.showHoverDetail(e.def, best.cond));
        list.appendChild(el);
      }
      if (!entries.length) list.appendChild(h('div', { class: 'dim', style: { padding: '12px', fontSize: '14px' } }, 'No parts in storage. Salvage wrecks, buy from merchants or fabricate parts.'));
    };
    renderList();
    out.push(
      h(
        'div',
        { class: 'panel g-left' },
        h('div', { class: 'label' }, `Storage ${p.inventory.length}/${storageCapacity(p)}`),
        filter,
        search,
        h('div', { style: { height: '8px' } }),
        list,
      ),
    );
    // ---- stats panel ----
    const right = h('div', { class: 'panel g-right' });
    if (d && g.stats) {
      const s = g.stats;
      const name = h('input', { type: 'text', class: 'name-input', value: d.name, maxlength: 24 }) as HTMLInputElement;
      name.onchange = () => {
        d.name = name.value.trim() || d.name;
        this.message(`Renamed to ${d.name}`);
      };
      right.appendChild(h('div', {}, h('div', { class: 'label' }, `${d.cls} machine · ${d.parts.length} parts`), name));
      const rows: [string, string][] = [
        ['Mass', formatMass(s.mass)],
        ['Centre of mass', `${s.com.x.toFixed(2)}, ${s.com.y.toFixed(2)}, ${s.com.z.toFixed(2)}`],
        ['Power', `${formatPower(s.powerGen)} gen / ${formatPower(s.powerDrawPeak)} peak`],
        ['Battery', `${Math.round(s.batteryCap)} kJ`],
        ['Heat', `${Math.round(s.heatPeak)}/s vs ${Math.round(s.cooling)}/s cooling`],
        ['Fuel', `${Math.round(s.fuelCap)} L · ${s.fuelUsePeak.toFixed(1)} L/min peak`],
        ['Cargo', formatMass(s.cargo)],
        ['Firepower', `${Math.round(s.dps)} dps · ${Math.round(s.alphaDamage)} alpha`],
        ['Armor (avg)', s.armorWeighted.toFixed(1)],
      ];
      if (d.cls === 'ground') rows.splice(2, 0, ['Torque', `${Math.round(s.torque)} Nm`], ['Est. top speed', `${Math.round(s.topSpeed * 3.6)} km/h`]);
      if (d.cls === 'air') rows.splice(2, 0, ['Thrust / weight', s.twr.toFixed(2)], ['Hover throttle', `${Math.round(Math.min(1, s.hoverPowerFraction) * 100)}%`], ['COM ↔ lift', `${s.comLiftOffset.toFixed(2)} m`]);
      if (d.cls === 'mech') rows.splice(2, 0, ['Legs', `${s.legCount} · ${formatMass(s.legCapacity)}`], ['Leg load', `${Math.round(s.loadRatio * 100)}%`], ['Walk speed', `${(s.walkSpeed * 3.6).toFixed(1)} km/h`]);
      right.appendChild(h('div', { class: 'stat-grid' }, rows.flatMap(([k, v]) => [h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)])));
      const warn = h('div', { class: 'warn-list' }, s.warnings.map((w) => h('div', { class: w.level }, w.text)));
      right.appendChild(h('div', {}, h('div', { class: 'label', style: { marginBottom: '4px' } }, s.valid ? 'Engineering report' : 'Cannot deploy'), warn));
      // repair
      const damaged = d.parts.filter((x) => x.cond < 0.999);
      if (damaged.length) {
        const c = g.repairCostFor(damaged);
        const resTxt = Object.entries(c.res).filter(([, v]) => v).map(([k, v]) => `${v} ${RESOURCE_LABEL[k as Resource].split(' ')[0]}`).join(', ');
        right.appendChild(
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('div', { class: 'dim', style: { fontSize: '13px', flex: '1' } }, `${damaged.length} damaged parts`), h('button', { class: 'btn small', onclick: () => g.repairAll(), disabled: !canAfford(p, c.credits, c.res) }, `Repair all ${fmtCredits(c.credits)}${resTxt ? ' + ' + resTxt : ''}`)),
        );
      }
      // selected part
      const sel = g.selectedPart();
      const detail = h('div', { id: 'g-detail', style: { borderTop: '1px solid var(--line)', paddingTop: '10px' } });
      if (sel) {
        const def = getPart(sel.defId);
        detail.innerHTML = partDetailHtml(def, sel.cond);
        const actions = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' } });
        if (sel.parent) actions.appendChild(h('button', { class: 'btn small danger', onclick: () => g.removePart(sel.uid) }, 'Remove'));
        if (sel.cond < 0.999) {
          const c = repairCost(def, sel.cond);
          actions.appendChild(h('button', { class: 'btn small', onclick: () => g.repairOne(sel.uid), disabled: !canAfford(p, c.credits, c.res) }, `Repair ${fmtCredits(c.credits)}`));
        }
        if (def.category === 'weapon' || def.category === 'melee') {
          for (const grp of [1, 2, 3]) actions.appendChild(h('button', { class: `btn small ${sel.group === grp ? 'primary' : ''}`, onclick: () => g.setGroup(sel.uid, grp) }, grp === 1 ? 'LMB' : grp === 2 ? 'RMB' : 'MMB'));
        }
        if (sel.parent) {
          actions.appendChild(h('button', { class: 'btn small', onclick: () => g.adjustSelected({ rot: 45 }) }, 'Rotate'));
          if (def.tiltable) actions.appendChild(h('button', { class: 'btn small', onclick: () => g.adjustSelected({ tilt: 15 }) }, 'Tilt'));
        }
        detail.appendChild(actions);
        const swaps = p.inventory.filter((i) => getPart(i.defId).category === def.category && i.defId !== def.id);
        if (swaps.length && sel.parent) detail.appendChild(h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '6px' } }, `Tip: click a ${CATEGORY_LABEL[def.category].toLowerCase()} in the list to swap it in place.`));
      } else if (g.placing) {
        detail.innerHTML = partDetailHtml(g.placing.def, g.placing.item.cond);
      } else {
        detail.innerHTML = '<div class="dim" style="font-size:14px">Select a part on the machine to inspect it, or pick a part from storage to install.</div>';
      }
      right.appendChild(detail);
    } else {
      right.appendChild(h('div', { class: 'dim' }, 'No machine selected. Create one in the Machines tab.'));
    }
    out.push(right);
    // ---- mode banner & hints ----
    if (g.placing) {
      const hov = g.hover;
      out.push(
        h(
          'div',
          { class: 'panel g-mode', style: { color: hov && !hov.valid ? 'var(--bad)' : 'var(--accent)' } },
          `Installing ${g.placing.def.name}${hov && !hov.valid ? ` — ${hov.reason}` : ''}`,
        ),
      );
    }
    out.push(
      h('div', {
        class: 'g-hints',
        html: g.placing
          ? '<span class="key">LMB</span>place <span class="key">R</span>rotate <span class="key">T</span>tilt <span class="key">X</span>mirror ' + (g.mirrorMode ? 'ON' : 'OFF') + ' <span class="key">ESC</span>cancel · <span class="key">RMB</span>orbit <span class="key">WHEEL</span>zoom'
          : '<span class="key">LMB</span>select <span class="key">DEL</span>remove <span class="key">R/T</span>rotate/tilt <span class="key">ARROWS</span>move <span class="key">CTRL+Z</span>undo · <span class="key">RMB</span>orbit <span class="key">MMB</span>pan',
      }),
    );
    const valid = !!g.stats?.valid;
    out.push(
      h(
        'div',
        { class: 'g-bottom' },
        h('button', { class: 'btn', onclick: () => { saveProfile(this.profile); this.message('Progress saved', 'good'); } }, 'Save'),
        h('button', { class: 'btn primary', disabled: !valid, onclick: () => d && this.onDeploy?.(d.id), title: valid ? '' : 'Fix the engineering errors first' }, `Deploy ${d?.name ?? ''} ▶`),
      ),
    );
    return out;
  }

  private showHoverDetail(def: PartDef, cond: number) {
    if (this.garage.selected || this.garage.placing) return;
    const el = this.root.querySelector('#g-detail') as HTMLElement | null;
    if (el) el.innerHTML = partDetailHtml(def, cond);
  }

  // ------------------------------------------------------------------ MACHINES
  private machinesTab() {
    const g = this.garage;
    const p = this.profile;
    const cards = h('div', { class: 'm-cards' });
    for (const d of p.machines) {
      const parts = d.parts.length;
      const avg = d.parts.reduce((s, x) => s + x.cond, 0) / Math.max(1, parts);
      const mass = d.parts.reduce((s, x) => s + getPart(x.defId).mass, 0);
      const frame = getPart(d.parts[0]?.defId ?? 'frm_buggy');
      const card = h(
        'div',
        { class: `m-card ${g.design?.id === d.id ? 'on' : ''}`, onclick: () => { g.setMachine(d.id); this.tab = 'build'; this.refresh(); } },
        h('div', { class: 'label' }, `${d.cls} · ${frame.name}`),
        h('div', { class: 'mn' }, d.name),
        h('div', { class: 'dim', style: { fontSize: '14px', margin: '6px 0' } }, `${parts} parts · ${formatMass(mass)} · condition ${Math.round(avg * 100)}%`),
        h('div', { class: 'dim', style: { fontSize: '13px' } }, `Kills ${d.kills ?? 0} · ${Math.round((d.distance ?? 0) / 1000)} km travelled`),
        h('div', { style: { display: 'flex', gap: '6px', marginTop: '10px' } },
          h('button', { class: 'btn small', onclick: (e: Event) => { e.stopPropagation(); g.setMachine(d.id); this.tab = 'build'; this.refresh(); } }, 'Edit'),
          h('button', { class: 'btn small danger', onclick: (e: Event) => {
            e.stopPropagation();
            if (p.machines.length <= 1) { this.message('You need at least one machine.', 'bad'); return; }
            if (confirm(`Dismantle ${d.name}? All ${parts} parts go back into storage.`)) { g.dismantleMachine(d.id); this.refresh(); }
          } }, 'Dismantle'),
        ),
      );
      cards.appendChild(card);
    }
    const frames = p.inventory.filter((i) => getPart(i.defId).category === 'frame');
    const bays = baysFor(p);
    const newBox = h('div', { class: 'm-card', style: { cursor: 'default' } }, h('div', { class: 'label' }, `Bays ${p.machines.length}/${bays}`), h('div', { class: 'mn' }, 'New machine'));
    if (p.machines.length >= bays) newBox.appendChild(h('div', { class: 'dim', style: { fontSize: '14px', marginTop: '6px' } }, 'All vehicle bays are full. Upgrade your bays in the Workshop tab or dismantle a machine.'));
    else if (!frames.length) newBox.appendChild(h('div', { class: 'dim', style: { fontSize: '14px', marginTop: '6px' } }, 'You need a spare frame. Salvage one, buy one from a merchant, or fabricate one.'));
    else
      for (const f of frames) {
        const def = getPart(f.defId);
        newBox.appendChild(
          h('button', { class: 'btn small', style: { margin: '6px 6px 0 0' }, onclick: () => {
            const name = prompt('Name your new machine:', def.rootOf === 'air' ? 'Wasp' : def.rootOf === 'mech' ? 'Jackrabbit' : 'Roadrunner');
            if (!name) return;
            g.createMachine(f, name.slice(0, 24));
            this.tab = 'build';
            this.refresh();
          } }, `Build on ${def.name}`),
        );
      }
    cards.appendChild(newBox);
    return h('div', { class: 'panel g-page' }, h('div', { class: 'h2', style: { marginBottom: '14px' } }, 'Your machines'), cards);
  }

  // ------------------------------------------------------------------ STORAGE
  private storageTab() {
    const p = this.profile;
    const cap = storageCapacity(p);
    const list = h('div', { class: 'plist', style: { maxHeight: 'calc(100vh - 220px)' } });
    const bonus = [1, 1, 1.25, 1.5][p.workshop.salvage] ?? 1.5;
    const items = [...p.inventory].sort((a, b) => rarityIndex(getPart(b.defId).rarity) - rarityIndex(getPart(a.defId).rarity) || a.defId.localeCompare(b.defId));
    for (const it of items) {
      const def = getPart(it.defId);
      const y = scrapYield(def, it.cond, bonus);
      const yTxt = Object.entries(y).filter(([, v]) => v).map(([k, v]) => `${v} ${RESOURCE_LABEL[k as Resource].split(' ')[0]}`).join(', ');
      const rc = repairCost(def, it.cond);
      list.appendChild(
        h(
          'div',
          { class: 'prow', style: { gridTemplateColumns: '1fr 100px 90px auto auto auto', cursor: 'default' } },
          h('div', {}, h('div', { class: 'pname', style: { color: RARITY_COLOR[def.rarity] } }, def.name), h('div', { class: 'pcat' }, `${CATEGORY_LABEL[def.category]} · ${def.classes.length === 3 ? 'all' : def.classes.join('/')} · ${formatMass(def.mass)}`)),
          h('div', { class: 'bar hp' }, h('i', { style: { width: `${it.cond * 100}%`, background: it.cond > 0.5 ? 'var(--good)' : it.cond > 0 ? 'var(--warn)' : 'var(--bad)' } })),
          h('div', { class: 'num' }, it.cond <= 0 ? 'WRECKED' : `${Math.round(it.cond * 100)}%`),
          it.cond < 0.999
            ? h('button', { class: 'btn small', disabled: !canAfford(p, rc.credits, rc.res), onclick: () => { spend(p, rc.credits, rc.res); it.cond = 1; this.refresh(); } }, `Repair ${fmtCredits(rc.credits)}`)
            : h('span'),
          h('button', { class: 'btn small', title: `Sell for ${fmtCredits(sellPrice(def, it.cond))}`, onclick: () => { p.credits += sellPrice(def, it.cond); p.inventory = p.inventory.filter((x) => x.uid !== it.uid); this.message(`Sold ${def.name}`, 'good'); this.refresh(); } }, `Sell ${fmtCredits(sellPrice(def, it.cond))}`),
          h('button', { class: 'btn small', title: `Scrap for ${yTxt}`, onclick: () => { p.inventory = p.inventory.filter((x) => x.uid !== it.uid); addResources(p, y); this.message(`Scrapped ${def.name}: ${yTxt}`, 'good'); this.refresh(); } }, 'Scrap'),
        ),
      );
    }
    return h(
      'div',
      { class: 'panel g-page' },
      h('div', { class: 'head', style: { display: 'flex', justifyContent: 'space-between', marginBottom: '12px' } }, h('div', { class: 'h2' }, 'Parts storage'), h('div', { class: 'label' }, `${p.inventory.length} / ${cap} parts · Salvage processor bonus ×${bonus}`)),
      list,
    );
  }

  // ------------------------------------------------------------------ RESEARCH
  private researchTab() {
    const p = this.profile;
    const grid = h('div', { class: 'tech-grid', style: { height: `${8 * 96 + 20}px` } });
    for (const t of TECH) {
      const st = researchStatus(p, t);
      const costTxt = Object.entries(t.cost).map(([k, v]) => (k === 'credits' ? fmtCredits(v!) : `${v} ${RESOURCE_LABEL[k as Resource].split(' ')[0]}`)).join(' · ');
      const node = h(
        'div',
        {
          class: `tech ${st}`,
          style: { left: `${t.x * 260}px`, top: `${t.y * 96}px` },
          onclick: () => {
            if (st !== 'available') {
              this.message(st === 'station' ? `Needs Research Station level ${t.tier}` : st === 'locked' ? `Requires ${t.requires.map((r) => TECH.find((x) => x.id === r)?.name).join(' + ')}` : st === 'done' ? 'Already researched' : 'Research in progress', 'bad');
              return;
            }
            if (p.research.active) {
              this.message('Only one research project at a time.', 'bad');
              return;
            }
            const { credits = 0, ...res } = t.cost;
            if (!spend(p, credits, res)) {
              this.message('Not enough resources', 'bad');
              return;
            }
            p.research.active = t.id;
            p.research.progress = 0;
            this.message(`Research started: ${t.name}`, 'good');
            this.refresh();
          },
        },
        h('div', { class: 'tn', style: { color: st === 'done' ? 'var(--good)' : st === 'active' ? 'var(--accent)' : '' } }, t.name),
        h('div', { class: 'tu' }, t.unlocks),
        st === 'active'
          ? h('div', { class: 'bar', style: { marginTop: '6px' } }, h('i', { style: { width: `${(p.research.progress / t.time) * 100}%` } }))
          : h('div', { class: 'tc' }, st === 'done' ? 'RESEARCHED' : st === 'station' ? `STATION LV ${t.tier}` : costTxt),
      );
      grid.appendChild(node);
    }
    const active = p.research.active ? TECH.find((t) => t.id === p.research.active) : null;
    return h(
      'div',
      { class: 'panel g-page' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px' } },
        h('div', { class: 'h2' }, 'Research'),
        h('div', { class: 'dim', style: { fontSize: '14px' } }, active ? `Researching ${active.name}: ${Math.round((p.research.progress / active.time) * 100)}% — continues while you are out in the world` : `Station level ${p.workshop.research}. Research unlocks whole families of parts for fabrication and merchants.`),
      ),
      grid,
    );
  }

  // ------------------------------------------------------------------ FABRICATE
  private fabricateTab() {
    const p = this.profile;
    const wrap = h('div', { class: 'two-col' });
    const list = h('div', { class: 'g-list', style: { maxHeight: 'calc(100vh - 200px)' } });
    const detail = h('div', { class: 'panel', style: { padding: '14px', overflowY: 'auto' } });
    detail.innerHTML = '<div class="dim">Select a part to fabricate.</div>';
    const craftable = PARTS.filter((d) => !d.unique && d.category !== 'frame' ? true : !d.unique);
    craftable.sort((a, b) => a.category.localeCompare(b.category) || rarityIndex(a.rarity) - rarityIndex(b.rarity));
    let last = '';
    for (const def of craftable) {
      const unlocked = partUnlocked(p, def);
      const bench = needsElectronicsBench(def) && p.workshop.electronics < 1;
      if (def.category !== last) {
        last = def.category;
        list.appendChild(h('div', { class: 'g-group' }, CATEGORY_LABEL[def.category]));
      }
      const cost = fabricationCost(def);
      const affordable = canAfford(p, cost.credits, cost);
      const why = !unlocked ? (def.blueprint || rarityIndex(def.rarity) >= 4 ? 'Needs blueprint' : `Research: ${TECH.find((t) => t.id === def.tech)?.name ?? '?'}`) : bench ? 'Needs Electronics Bench' : '';
      const el = h(
        'div',
        { class: `g-item ${unlocked && !bench ? '' : 'na'}`, style: { borderLeftColor: RARITY_COLOR[def.rarity] } },
        h('div', { class: 'n', style: { color: RARITY_COLOR[def.rarity] } }, def.name),
        h('div', { class: 'q' }, why ? '🔒' : fmtCredits(cost.credits)),
        h('div', { class: 's' }, why || `${def.classes.length === 3 ? 'all classes' : def.classes.join('/')} · ${formatMass(def.mass)}${affordable ? '' : ' · cannot afford'}`),
      );
      el.onclick = () => {
        detail.innerHTML = partDetailHtml(def);
        const costTxt = Object.entries(cost).filter(([, v]) => v).map(([k, v]) => (k === 'credits' ? fmtCredits(v as number) : `${v} ${RESOURCE_LABEL[k as Resource]}`)).join('<br>');
        detail.appendChild(h('div', { html: `<div class="label" style="margin-top:12px">Fabrication cost</div><div class="mono" style="font-size:14px;line-height:1.6">${costTxt}</div>` }));
        const btn = h('button', { class: 'btn primary', style: { marginTop: '12px', width: '100%' }, disabled: !(unlocked && !bench && affordable) }, why || 'Fabricate');
        btn.onclick = () => {
          if (p.inventory.length >= storageCapacity(p)) {
            this.message('Storage full', 'bad');
            return;
          }
          const { credits, ...res } = cost;
          if (!spend(p, credits, res)) return;
          p.inventory.push({ uid: uid('p'), defId: def.id, cond: 1 });
          this.message(`Fabricated ${def.name}`, 'good');
          this.refresh();
        };
        detail.appendChild(btn);
      };
      list.appendChild(el);
    }
    wrap.append(h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: '0' } }, h('div', { class: 'h2', style: { marginBottom: '10px' } }, 'Fabricate'), list), detail);
    return h('div', { class: 'panel g-page' }, wrap);
  }

  // ------------------------------------------------------------------ WORKSHOP
  private workshopTab() {
    const p = this.profile;
    const rows = UPGRADES.map((u) => {
      const lvl = p.workshop[u.id];
      const maxLvl = u.levels.length - 1;
      const next = lvl < maxLvl ? u.levels[lvl + 1] : null;
      const costTxt = next ? Object.entries(next.cost).filter(([, v]) => v).map(([k, v]) => (k === 'credits' ? fmtCredits(v as number) : `${v} ${RESOURCE_LABEL[k as Resource].split(' ')[0]}`)).join(' · ') : 'MAXED';
      const affordable = next ? canAfford(p, next.cost.credits, next.cost) : false;
      const pips = u.id === 'bays' ? [] : Array.from({ length: maxLvl }, (_, i) => h('i', { class: i < lvl ? 'on' : '' }));
      return h(
        'div',
        { class: 'up-row' },
        h('div', { class: 'ic' }, u.icon),
        h('div', {}, h('div', { class: 'h3' }, u.name), h('div', { class: 'dim', style: { fontSize: '14px' } }, u.levels[lvl]?.desc ?? ''), h('div', { class: 'pips' }, pips)),
        h('div', {}, next ? h('div', {}, h('div', { class: 'label' }, 'Next'), h('div', { style: { fontSize: '14px' } }, next.desc), h('div', { class: 'mono', style: { fontSize: '12px', color: 'var(--accent)' } }, costTxt)) : h('div', { class: 'dim' }, 'Fully upgraded')),
        h('button', { class: 'btn', disabled: !next || !affordable, onclick: () => {
          if (!next) return;
          const { credits, ...res } = next.cost;
          if (!spend(p, credits, res)) return;
          p.workshop[u.id] = lvl + 1;
          this.garage.env.applyUpgrades(p);
          this.message(`${u.name} upgraded`, 'good');
          this.refresh();
        } }, next ? 'Upgrade' : '—'),
      );
    });
    return h('div', { class: 'panel g-page' }, h('div', { class: 'h2', style: { marginBottom: '8px' } }, 'Workshop upgrades'), h('div', { class: 'dim', style: { marginBottom: '12px' } }, 'Turn the scrapyard shed into a real engineering facility.'), ...rows);
  }

  // ------------------------------------------------------------------ PAINT
  private paintTab(): HTMLElement[] {
    const g = this.garage;
    const d = g.design;
    const p = this.profile;
    if (!d) return [h('div', { class: 'panel g-page' }, 'No machine')];
    const lvl = p.workshop.paint;
    const apply = () => {
      g.mats?.setPaint(d.paint);
      this.refresh();
    };
    const swatchRow = (key: 'primary' | 'secondary' | 'accent') =>
      h(
        'div',
        { class: 'swatches' },
        PALETTE.map((c, i) => h('div', { class: `swatch ${d.paint[key] === c ? 'on' : ''} ${i >= BASIC && lvl < 2 ? 'locked' : ''}`, style: { background: c }, onclick: () => { d.paint[key] = c; apply(); } })),
      );
    const patterns: [PaintPattern, string, number][] = [
      ['none', 'Solid', 1],
      ['stripes', 'Racing stripes', 2],
      ['twotone', 'Two-tone', 2],
      ['camo', 'Camouflage', 3],
      ['digital', 'Digital', 3],
      ['hazard', 'Hazard', 3],
    ];
    const wear = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(d.paint.wear), style: { width: '100%' } }) as HTMLInputElement;
    wear.oninput = () => {
      d.paint.wear = parseFloat(wear.value);
      g.mats?.setPaint(d.paint);
    };
    const panel = h(
      'div',
      { class: 'panel g-right', style: { width: '380px' } },
      h('div', { class: 'h2' }, 'Paint'),
      h('div', { class: 'dim', style: { fontSize: '13px' } }, lvl < 3 ? 'Upgrade the Painting Station for more colours and patterns.' : 'Full paint shop unlocked.'),
      h('div', { class: 'label' }, 'Primary'),
      swatchRow('primary'),
      h('div', { class: 'label' }, 'Secondary'),
      swatchRow('secondary'),
      h('div', { class: 'label' }, 'Accent / lights'),
      swatchRow('accent'),
      h('div', { class: 'label' }, 'Pattern'),
      h('div', { class: 'g-filter' }, patterns.map(([pt, label, need]) => h('div', { class: `chip ${d.paint.pattern === pt ? 'on' : ''}`, style: { opacity: lvl >= need ? '1' : '0.3', pointerEvents: lvl >= need ? 'auto' : 'none' }, onclick: () => { d.paint.pattern = pt; apply(); } }, label))),
      h('div', { class: 'label' }, 'Weathering: fresh ↔ rusted'),
      wear,
    );
    return [panel, h('div', { class: 'g-hints', html: '<span class="key">RMB</span>orbit <span class="key">WHEEL</span>zoom — paint is free, it is your machine.' })];
  }
}

export { formatPower };
