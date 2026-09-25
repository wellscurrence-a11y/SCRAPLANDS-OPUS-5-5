/** Human-readable part statistics. */
import type { PartDef } from '../machines/types';
import { CATEGORY_LABEL, RARITY_COLOR, RARITY_LABEL } from '../machines/types';
import { formatMass, formatPower } from '../core/math';

export function statRows(def: PartDef): [string, string][] {
  const s = def.stats;
  const r: [string, string][] = [];
  const add = (label: string, v: number | undefined, fmt: (n: number) => string) => {
    if (v !== undefined && v !== 0) r.push([label, fmt(v)]);
  };
  r.push(['Mass', formatMass(def.mass)]);
  r.push(['Durability', `${def.hp} HP`]);
  r.push(['Armor', `${def.armor}`]);
  add('Torque', s.torque && def.category === 'engine' ? s.torque : undefined, (n) => `${n} Nm`);
  add('Torque boost', def.category === 'booster' ? s.torque : undefined, (n) => `+${Math.round(n * 100)}%`);
  add('Max RPM', s.maxRpm, (n) => `${n}`);
  add('Power out', s.powerGen, formatPower);
  add('Power draw', s.powerDraw, formatPower);
  add('Battery', s.batteryCap, (n) => `${n} kJ`);
  add('Discharge', s.maxDischarge, formatPower);
  add('Fuel use', s.fuelUse, (n) => `${n} L/min`);
  add('Fuel tank', s.fuelCap, (n) => `${n} L`);
  add('Heat', s.heat, (n) => (def.category === 'weapon' ? `${n}/shot` : `${n}/s`));
  add('Cooling', s.cooling, (n) => `${n}/s`);
  if (s.gears) r.push(['Gears', `${s.gears.length} · final ${s.finalDrive}`]);
  add('Shift time', s.shiftTime, (n) => `${n}s`);
  add('Spring', s.stiffness, (n) => `${(n / 1000).toFixed(0)} kN/m`);
  add('Travel', s.travel, (n) => `${Math.round(n * 100)} cm`);
  add('Radius', s.radius && def.category !== 'rotor' ? s.radius : undefined, (n) => `${n} m`);
  add('Grip', s.grip, (n) => n.toFixed(2));
  if (s.sandGrip) r.push(['Road / Sand / Rock', `${(s.roadGrip ?? 1).toFixed(2)} / ${s.sandGrip.toFixed(2)} / ${(s.rockGrip ?? 1).toFixed(2)}`]);
  add('Thrust', s.thrust, (n) => `${(n / 1000).toFixed(1)} kN`);
  add('Rotor radius', def.category === 'rotor' ? s.radius : undefined, (n) => `${n} m`);
  add('Cyclic control', s.cyclic, (n) => `${Math.round(n * 100)}%`);
  add('Gimbal', s.gimbal, (n) => `${Math.round((n * 180) / Math.PI)}°`);
  add('Wing area', s.wingArea, (n) => `${n} m²`);
  add('Stabilizing torque', s.torqueAuthority, (n) => `${(n / 1000).toFixed(1)} kNm`);
  add('Load rating', s.loadRating, (n) => `${formatMass(n)}`);
  add('Stride', s.stride, (n) => `${n} m`);
  add('Joint strength', s.jointStrength, (n) => `×${n}`);
  add('Joint speed', s.jointSpeed, (n) => `×${n}`);
  add('Hydraulics', s.hydraulicBoost, (n) => `+${Math.round((n - 1) * 100)}% joints`);
  add('Foot grip', s.footGrip, (n) => n.toFixed(2));
  add('Arm turn', def.category === 'arm' ? s.turnRate : undefined, (n) => `${n} rad/s`);
  if (s.weapon || s.melee) {
    const dmg = s.pellets ? `${s.damage}×${s.pellets}` : `${s.damage}`;
    r.push(['Damage', s.weapon === 'beam' || s.melee === 'drill' || s.melee === 'saw' || s.weapon === 'flamer' ? `${s.damage}/s` : dmg]);
    add('Penetration', s.pen && s.pen < 500 ? s.pen : undefined, (n) => `${n}`);
    if (s.pen && s.pen >= 500) r.push(['Penetration', 'Ignores armor']);
    add('Fire rate', s.rof, (n) => `${n}/s`);
    add('Splash', s.splash, (n) => `${n} m · ${s.splashDamage}`);
    add('Range', s.range, (n) => `${n} m`);
    add('Reach', s.reach, (n) => `${n} m`);
    add('Recoil', s.recoil, (n) => `${n} N·s`);
    add('Magazine', s.magazine, (n) => `${n} · ${s.reload}s reload`);
    add('Ammo', s.ammo, (n) => `${n}`);
    add('Energy/shot', s.energyPerShot, (n) => `${n} kJ`);
    add('Lock time', s.lockTime, (n) => `${n}s`);
    add('Traverse', s.yawLimit && s.yawLimit < 180 ? s.yawLimit : undefined, (n) => `±${n}°`);
    add('Turret speed', s.turnRate && def.category === 'weapon' ? s.turnRate : undefined, (n) => `${n} rad/s`);
  }
  add('Cargo', s.cargo, (n) => formatMass(n));
  add('Scan range', s.scanRange, (n) => `${n} m`);
  add('Radar', s.radarRange, (n) => `${n} m`);
  add('Ram damage', s.ramDamage, (n) => `×${n}`);
  add('Jamming', s.jammer, (n) => `${Math.round(n * 100)}%`);
  add('Flares', s.flares, (n) => `${n}`);
  add('Light range', s.lightRange, (n) => `${n} m`);
  return r;
}

export function partTitleHtml(def: PartDef) {
  return `<div style="color:${RARITY_COLOR[def.rarity]};font-size:20px;font-weight:700;letter-spacing:0.04em" class="${def.rarity === 'exotic' ? 'r-exotic' : ''}">${def.name}</div>
    <div class="label" style="margin-top:2px"><span style="color:${RARITY_COLOR[def.rarity]}">${RARITY_LABEL[def.rarity]}</span> · ${CATEGORY_LABEL[def.category]} · ${def.classes.length === 3 ? 'All classes' : def.classes.join(' / ')}</div>`;
}

export function partDetailHtml(def: PartDef, cond?: number) {
  const rows = statRows(def)
    .map(([k, v]) => `<div class="dim">${k}</div><div class="mono" style="text-align:right">${v}</div>`)
    .join('');
  const special = (def.special ?? []).length ? `<div style="margin-top:8px;color:var(--accent);font-size:13px;letter-spacing:0.08em;text-transform:uppercase">★ ${def.special!.join(' · ')}</div>` : '';
  const condHtml =
    cond !== undefined
      ? `<div style="display:flex;align-items:center;gap:8px;margin:8px 0 4px"><span class="label">Condition</span><div class="bar hp" style="flex:1"><i style="width:${cond * 100}%;background:${cond > 0.6 ? 'var(--good)' : cond > 0.25 ? 'var(--warn)' : 'var(--bad)'}"></i></div><span class="mono">${cond <= 0 ? 'WRECKED' : Math.round(cond * 100) + '%'}</span></div>`
      : '';
  return `${partTitleHtml(def)}${condHtml}<div style="font-size:14px;color:var(--text-2);margin:8px 0;line-height:1.35">${def.desc}</div>${special}<div style="display:grid;grid-template-columns:1fr auto;gap:2px 12px;font-size:13px;margin-top:8px">${rows}</div>`;
}
