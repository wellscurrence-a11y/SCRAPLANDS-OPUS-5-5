/**
 * Settlement traders: buy parts and blueprints, sell salvage (from cargo or the workshop store),
 * and trade raw resources. Stock rotates daily and depends on the trader's specialty; reputation
 * with the Independents lowers prices.
 */
import './screens.css';
import './panels.css';
import type { App } from '../app';
import { h } from './dom';
import { input } from '../core/input';
import { RNG } from '../core/random';
import { uid, clamp, formatMass } from '../core/math';
import { PARTS, getPart } from '../machines/parts/catalog';
import { CATEGORY_LABEL, RARITY_COLOR, rarityIndex, type PartDef, type PartItem, type PartCategory } from '../machines/types';
import { buyPrice, sellPrice } from '../gameplay/economy';
import { RESOURCES, RESOURCE_LABEL, storageCapacity, saveProfile, type Resource } from '../gameplay/profile';
import { partDetailHtml } from './partInfo';

interface TraderDef {
  id: string;
  name: string;
  keeper: string;
  quote: string;
  /** Categories this trader favours (other categories appear rarely). */
  favours: PartCategory[];
  maxRarity: number;
  markup: number;
  blueprints: number;
  /** Resource prices: buy (what you pay) per unit. Sell is 45% of it. */
  resPrice: Record<Resource, number>;
}

const TRADERS: Record<string, TraderDef> = {
  rustwater: {
    id: 'rustwater',
    name: 'Rustwater Market',
    keeper: 'Oskar "Two-Thumbs" Reyes',
    quote: '"If it bolts on, I sell it. If it fell off, I buy it."',
    favours: ['weapon', 'armor', 'engine', 'wheel', 'suspension', 'transmission', 'fuel', 'cooling', 'cockpit', 'booster', 'ram', 'cargo'],
    maxRarity: 2,
    markup: 1.0,
    blueprints: 1,
    resPrice: { scrap: 6, electronics: 30, mechanical: 24, alloys: 70, data: 55, raretech: 260 },
  },
  dusthollow: {
    id: 'dusthollow',
    name: 'Dust Hollow Exchange',
    keeper: 'Ada Kettleburn',
    quote: '"Rotors, legs and batteries. Things that leave the ground — one way or another."',
    favours: ['rotor', 'jet', 'wing', 'stabilizer', 'gear', 'leg', 'actuator', 'foot', 'arm', 'melee', 'jumpjet', 'hydraulics', 'battery', 'generator', 'sensor', 'countermeasure'],
    maxRarity: 2,
    markup: 1.08,
    blueprints: 2,
    resPrice: { scrap: 7, electronics: 26, mechanical: 28, alloys: 64, data: 48, raretech: 240 },
  },
};

type Tab = 'buy' | 'sell' | 'resources';

export class MerchantUI {
  private el: HTMLElement | null = null;
  private trader: TraderDef = TRADERS.rustwater;
  private tab: Tab = 'buy';
  private selected: { kind: 'stock' | 'bp' | 'cargo' | 'store'; id: string } | null = null;
  private body!: HTMLElement;
  private head!: HTMLElement;

  constructor(private app: App) {}

  get open() {
    return !!this.el;
  }

  show(id: string) {
    const app = this.app;
    const p = app.profile;
    if (!p || this.el) return;
    if (app.map.open) app.map.close();
    if (app.journal.open) app.journal.close();
    this.trader = TRADERS[id] ?? TRADERS.rustwater;
    p.flags.visitedMarket = true;
    input.exitPointerLock();
    input.enabled = false;
    app.game.paused = true;
    app.hud.setVisible(false);
    this.tab = 'buy';
    this.selected = null;
    this.head = h('div', { class: 's-head' });
    this.body = h('div', { class: 'shop' });
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
    if (app.profile) saveProfile(app.profile);
    if (app.mode === 'world' && !app.map.open && !app.journal.open && !app.salvageUI.open) input.enabled = true;
  }

  // ------------------------------------------------------------------ pricing
  private get discount() {
    const rep = this.app.profile?.reputation.independents ?? 0;
    return clamp(1 - rep * 0.004, 0.8, 1);
  }
  private priceOf(def: PartDef) {
    return Math.round(buyPrice(def, this.trader.markup) * this.discount);
  }
  private blueprintPrice(def: PartDef) {
    return Math.round(def.value * 0.9 * this.discount);
  }
  private sellValue(def: PartDef, cond: number) {
    return Math.round(sellPrice(def, cond) * (2 - this.discount));
  }

  /** Stock rotates daily; bought items are recorded in profile flags so they stay sold until tomorrow. */
  private stock(): { stock: PartDef[]; bps: PartDef[] } {
    const p = this.app.profile!;
    const day = this.app.game.env.day;
    const t = this.trader;
    const rng = new RNG(day * 131 + t.id.length * 977 + 17);
    const rank = p.rank.level;
    const maxR = Math.min(3, t.maxRarity + (rank >= 6 ? 1 : 0));
    const pool = PARTS.filter((d) => !d.unique && !d.blueprint && !d.rootOf && rarityIndex(d.rarity) <= maxR && d.value > 0);
    const fav = pool.filter((d) => t.favours.includes(d.category));
    const other = pool.filter((d) => !t.favours.includes(d.category));
    const picks = new Set<PartDef>();
    let guard = 0;
    while (picks.size < 14 && guard++ < 400) {
      const src = rng.chance(0.8) ? fav : other;
      const d = rng.pick(src);
      // rarer parts are rarer on the shelf
      const ri = rarityIndex(d.rarity);
      if (rng.next() > [1, 0.7, 0.35, 0.12][ri]) continue;
      picks.add(d);
    }
    // a frame now and then
    if (rng.chance(0.5)) {
      const frames = PARTS.filter((d) => d.rootOf && !d.unique && rarityIndex(d.rarity) <= maxR);
      if (frames.length) picks.add(rng.pick(frames));
    }
    const bpPool = PARTS.filter((d) => (d.blueprint || rarityIndex(d.rarity) === 4) && !d.unique && !p.blueprints.includes(d.id));
    const bps: PartDef[] = [];
    for (let i = 0; i < t.blueprints && bpPool.length; i++) {
      const d = rng.pick(bpPool);
      if (!bps.includes(d)) bps.push(d);
    }
    const sold = String(p.flags[`sold_${t.id}_${day}`] ?? '').split(',');
    const stock = [...picks].filter((d) => !sold.includes(d.id)).sort((a, b) => a.category.localeCompare(b.category) || rarityIndex(a.rarity) - rarityIndex(b.rarity));
    return { stock, bps };
  }

  private markSold(id: string) {
    const p = this.app.profile!;
    const key = `sold_${this.trader.id}_${this.app.game.env.day}`;
    // drop stale sold-lists from earlier days
    for (const k of Object.keys(p.flags)) if (k.startsWith(`sold_${this.trader.id}_`) && k !== key) delete p.flags[k];
    p.flags[key] = [String(p.flags[key] ?? ''), id].filter(Boolean).join(',');
  }

  // ------------------------------------------------------------------ actions
  private buy(def: PartDef) {
    const app = this.app;
    const p = app.profile!;
    const price = this.priceOf(def);
    if (p.credits < price) return this.fail('Not enough credits.');
    if (p.inventory.length >= storageCapacity(p)) return this.fail('Workshop storage is full. Sell or scrap something first.');
    p.credits -= price;
    p.inventory.push({ uid: uid('p'), defId: def.id, cond: 1 });
    this.markSold(def.id);
    this.selected = null;
    app.hud.notify(`Bought ${def.name} — delivered to your workshop`, 'good');
    app.game.audio.play('ui_coin', null, { volume: 0.7 });
    this.render();
  }

  private buyBlueprint(def: PartDef) {
    const app = this.app;
    const p = app.profile!;
    const price = this.blueprintPrice(def);
    if (p.credits < price) return this.fail('Not enough credits.');
    p.credits -= price;
    p.blueprints.push(def.id);
    this.selected = null;
    app.hud.banner('Blueprint acquired', def.name, 'Fabricate it at the workshop.');
    app.game.audio.play('ui_good', null, { volume: 0.7 });
    this.render();
  }

  private sell(item: PartItem, from: 'cargo' | 'store') {
    const app = this.app;
    const p = app.profile!;
    const def = getPart(item.defId);
    const v = this.sellValue(def, item.cond);
    const list = from === 'cargo' ? p.cargo : p.inventory;
    const i = list.indexOf(item);
    if (i < 0) return;
    list.splice(i, 1);
    p.credits += v;
    p.reputation.independents = (p.reputation.independents ?? 0) + (rarityIndex(def.rarity) >= 2 ? 1 : 0);
    this.selected = null;
    app.hud.notify(`Sold ${def.name} for ¢${v}`, 'good');
    app.game.audio.play('ui_coin', null, { volume: 0.7 });
    this.render();
  }

  private tradeRes(r: Resource, n: number) {
    const app = this.app;
    const p = app.profile!;
    const unit = this.trader.resPrice[r];
    if (n > 0) {
      const cost = Math.round(unit * n * this.discount);
      if (p.credits < cost) return this.fail('Not enough credits.');
      p.credits -= cost;
      p.resources[r] += n;
    } else {
      const k = Math.min(-n, p.resources[r]);
      if (k <= 0) return this.fail(`No ${RESOURCE_LABEL[r]} to sell.`);
      p.resources[r] -= k;
      p.credits += Math.round(unit * 0.45 * k);
    }
    app.game.audio.play('ui_coin', null, { volume: 0.5 });
    this.render();
  }

  private fail(msg: string) {
    this.app.hud.notify(msg, 'bad');
    this.app.game.audio.play('ui_bad', null, { volume: 0.6 });
  }

  // ------------------------------------------------------------------ view
  private render() {
    const p = this.app.profile!;
    const t = this.trader;
    const tabs = h(
      'div',
      { class: 'tabs' },
      ...(['buy', 'sell', 'resources'] as Tab[]).map((k) => h('div', { class: `tab ${this.tab === k ? 'on' : ''}`, onclick: () => { this.tab = k; this.selected = null; this.render(); } }, k)),
    );
    this.head.replaceChildren(
      h('div', { class: 'h1' }, t.name),
      tabs,
      h('div', { class: 'grow' }),
      h('div', { class: 'mono', style: { color: 'var(--accent)', fontSize: '20px' } }, `¢${p.credits.toLocaleString()}`),
      h('div', { class: 'dim mono' }, `Storage ${p.inventory.length}/${storageCapacity(p)}`),
      h('div', { class: 's-close', onclick: () => this.close() }, 'ESC  LEAVE'),
    );
    if (this.tab === 'buy') this.renderBuy();
    else if (this.tab === 'sell') this.renderSell();
    else this.renderResources();
  }

  private row(def: PartDef, right1: string, right2: string, sel: boolean, dim: boolean, onclick: () => void) {
    return h(
      'div',
      { class: `row ${sel ? 'sel' : ''} ${dim ? 'dis' : ''}`, onclick },
      h('div', {}, h('div', { class: 'pname', style: { color: RARITY_COLOR[def.rarity] } }, def.name), h('div', { class: 'pcat' }, `${CATEGORY_LABEL[def.category]} · ${def.rarity}`)),
      h('div', { class: 'num' }, right1),
      h('div', { class: 'num', style: { color: dim ? 'var(--bad)' : 'var(--accent)' } }, right2),
    );
  }

  private detail(def: PartDef | null, cond: number | undefined, action: HTMLElement | null) {
    const t = this.trader;
    const box = h('div', { class: 'panel detail' });
    if (!def) {
      box.append(h('div', { class: 'label' }, t.keeper), h('div', { class: 'quote' }, t.quote), h('div', { class: 'dim' }, 'Select an item to inspect it. Bought parts are delivered straight to your workshop storage.'));
      const rep = this.app.profile!.reputation.independents ?? 0;
      box.append(h('div', { class: 'label', style: { marginTop: '14px' } }, 'Standing with the Independents'), h('div', { class: 'mono' }, `${rep}  ·  prices ${Math.round((1 - this.discount) * 100)}% better`));
      return box;
    }
    const d = h('div');
    d.innerHTML = partDetailHtml(def, cond);
    box.append(d);
    if (action) box.append(h('div', { style: { marginTop: '14px' } }, action));
    return box;
  }

  private renderBuy() {
    const p = this.app.profile!;
    const { stock, bps } = this.stock();
    const list = h('div', { class: 'plist scroll' });
    for (const d of stock) {
      const price = this.priceOf(d);
      const sel = this.selected?.kind === 'stock' && this.selected.id === d.id;
      list.append(this.row(d, formatMass(d.mass), `¢${price.toLocaleString()}`, sel, p.credits < price, () => { this.selected = { kind: 'stock', id: d.id }; this.render(); }));
    }
    if (!stock.length) list.append(h('div', { class: 'dim', style: { padding: '10px' } }, 'Sold out. New stock arrives tomorrow.'));
    const bpList = h('div', { class: 'plist scroll' });
    for (const d of bps) {
      const price = this.blueprintPrice(d);
      const sel = this.selected?.kind === 'bp' && this.selected.id === d.id;
      bpList.append(this.row(d, 'blueprint', `¢${price.toLocaleString()}`, sel, p.credits < price, () => { this.selected = { kind: 'bp', id: d.id }; this.render(); }));
    }
    if (!bps.length) bpList.append(h('div', { class: 'dim', style: { padding: '10px' } }, 'No blueprints for sale today.'));
    let def: PartDef | null = null;
    let action: HTMLElement | null = null;
    if (this.selected?.kind === 'stock') {
      def = getPart(this.selected.id);
      const d = def;
      action = h('button', { class: 'btn primary', onclick: () => this.buy(d) }, `Buy for ¢${this.priceOf(d).toLocaleString()}`);
    } else if (this.selected?.kind === 'bp') {
      def = getPart(this.selected.id);
      const d = def;
      action = h('div', {}, h('div', { class: 'dim', style: { marginBottom: '8px' } }, 'A blueprint lets your workshop fabricate this part from resources, as many times as you like.'), h('button', { class: 'btn primary', onclick: () => this.buyBlueprint(d) }, `Buy blueprint ¢${this.blueprintPrice(d).toLocaleString()}`));
    }
    this.body.replaceChildren(
      h('div', { class: 'col' }, h('div', { class: 'label' }, `Parts in stock · Day ${this.app.game.env.day}`), list),
      h('div', { class: 'col' }, h('div', { class: 'label' }, 'Blueprints'), bpList),
      this.detail(def, 1, action),
    );
  }

  private renderSell() {
    const p = this.app.profile!;
    const cargo = h('div', { class: 'plist scroll' });
    const store = h('div', { class: 'plist scroll' });
    const add = (list: HTMLElement, items: PartItem[], kind: 'cargo' | 'store') => {
      const sorted = [...items].sort((a, b) => rarityIndex(getPart(b.defId).rarity) - rarityIndex(getPart(a.defId).rarity));
      for (const it of sorted) {
        const d = getPart(it.defId);
        const sel = this.selected?.kind === kind && this.selected.id === it.uid;
        list.append(this.row(d, `${Math.round(it.cond * 100)}%`, `¢${this.sellValue(d, it.cond).toLocaleString()}`, sel, false, () => { this.selected = { kind, id: it.uid }; this.render(); }));
      }
      if (!items.length) list.append(h('div', { class: 'dim', style: { padding: '10px' } }, kind === 'cargo' ? 'No salvage on board.' : 'Workshop storage is empty.'));
    };
    add(cargo, p.cargo, 'cargo');
    add(store, p.inventory, 'store');
    let def: PartDef | null = null;
    let cond: number | undefined;
    let action: HTMLElement | null = null;
    if (this.selected && (this.selected.kind === 'cargo' || this.selected.kind === 'store')) {
      const from = this.selected.kind;
      const it = (from === 'cargo' ? p.cargo : p.inventory).find((x) => x.uid === this.selected!.id);
      if (it) {
        def = getPart(it.defId);
        cond = it.cond;
        action = h('button', { class: 'btn primary', onclick: () => this.sell(it, from) }, `Sell for ¢${this.sellValue(def, it.cond).toLocaleString()}`);
      }
    }
    const sellAllCargo = h('button', { class: 'btn small', style: { marginTop: '8px' }, disabled: !p.cargo.length, onclick: () => {
      let total = 0;
      for (const it of [...p.cargo]) {
        const d = getPart(it.defId);
        if (rarityIndex(d.rarity) >= 2) continue; // keep rares
        total += this.sellValue(d, it.cond);
        p.cargo.splice(p.cargo.indexOf(it), 1);
      }
      p.credits += total;
      if (total) {
        this.app.hud.notify(`Sold common salvage for ¢${total}`, 'good');
        this.app.game.audio.play('ui_coin', null, { volume: 0.7 });
      }
      this.render();
    } }, 'Sell common & uncommon cargo');
    this.body.replaceChildren(
      h('div', { class: 'col' }, h('div', { class: 'label' }, `Cargo on board · ${p.cargo.length}`), cargo, sellAllCargo),
      h('div', { class: 'col' }, h('div', { class: 'label' }, `Workshop storage (sent by runner) · ${p.inventory.length}`), store),
      this.detail(def, cond, action),
    );
  }

  private renderResources() {
    const p = this.app.profile!;
    const t = this.trader;
    const rows = RESOURCES.map((r) => {
      const unit = Math.round(t.resPrice[r] * this.discount);
      const sellU = Math.round(t.resPrice[r] * 0.45);
      const bulk = r === 'scrap' ? 20 : r === 'raretech' ? 1 : 5;
      return h(
        'div',
        { class: 'res-row' },
        h('div', {}, h('div', { class: 'pname' }, RESOURCE_LABEL[r]), h('div', { class: 'pcat dim', style: { fontSize: '12px' } }, `Buy ¢${unit} · Sell ¢${sellU}`)),
        h('div', { class: 'mono', style: { color: 'var(--accent)', textAlign: 'right' } }, String(p.resources[r])),
        h('button', { class: 'btn small', onclick: () => this.tradeRes(r, bulk) }, `+${bulk}`),
        h('button', { class: 'btn small', onclick: () => this.tradeRes(r, -bulk) }, `−${bulk}`),
      );
    });
    this.body.replaceChildren(
      h('div', { class: 'col', style: { gridColumn: 'span 2' } }, h('div', { class: 'label' }, 'Raw materials'), h('div', { class: 'panel', style: { padding: '12px 16px' } }, ...rows)),
      this.detail(null, undefined, null),
    );
  }
}
