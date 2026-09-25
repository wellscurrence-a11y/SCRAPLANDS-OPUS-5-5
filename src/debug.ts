/** Debug sandbox (open with ?debug): a bare world with a starter machine and a scripting API for tests. */
import * as THREE from 'three';
import { Game } from './core/game';
import { starterAir, starterGround, starterMech } from './machines/designs';
import { getLocation } from './world/layout';
import { input } from './core/input';
import { Director } from './gameplay/director';

async function boot() {
  const viewport = document.getElementById('viewport')!;
  const game = new Game();
  const label = document.createElement('div');
  label.style.cssText = 'position:absolute;left:12px;top:10px;color:#ddd;font:12px monospace;z-index:5;white-space:pre';
  document.getElementById('ui')!.appendChild(label);
  await game.init(viewport, (p, l) => (label.textContent = `${l} ${(p * 100).toFixed(0)}%`));
  const home = getLocation('home');
  const spawn = (cls: 'ground' | 'air' | 'mech') => {
    if (game.player) game.removeMachine(game.player);
    const d = cls === 'ground' ? starterGround() : cls === 'air' ? starterAir() : starterMech();
    return game.spawnMachine(d, new THREE.Vector3(home.x, 0, home.z + 40), Math.PI, 'player', true);
  };
  spawn('ground');
  game.state = 'world';
  const director = new Director(game);
  director.enabled = false;
  game.hooks.fixed.push((dt) => director.fixedUpdate(dt));
  let dirT = 0;
  game.hooks.fixed.push((dt) => { dirT += dt; if (dirT > 0.5) { director.tick(dirT); dirT = 0; } });
  const w = window as any;
  w.__game = game;
  w.__api = {
    spawn,
    director,
    input,
    enemy(cls: 'ground' | 'air' | 'mech', dist = 25) {
      const d = cls === 'ground' ? starterGround() : cls === 'air' ? starterAir() : starterMech();
      d.name = 'Target';
      const p = game.player!.currPos.clone().add(game.player!.forward().multiplyScalar(dist));
      return game.spawnMachine(d, p, 0, 'scrappers');
    },
  };
  game.manual = !!w.__manual;
  game.start();
  canvasClickLock(game);
  setInterval(() => {
    const m = game.player;
    if (!m) return;
    const t = m.controller.telemetry();
    label.textContent = `${game.fps.toFixed(0)} fps  ${(t.speed * 3.6).toFixed(0)} km/h  ${t.gear ?? ''} rpm ${t.rpm?.toFixed(0) ?? '-'}  alt ${t.altitude?.toFixed(1) ?? '-'}  pow ${(m.powerRatio * 100).toFixed(0)}%  E ${m.energy.toFixed(0)}/${m.energyCap}  heat ${m.heat.toFixed(0)}/${m.heatCap.toFixed(0)}  fuel ${m.fuel.toFixed(1)}  ${(t.warnings ?? []).join(' ')}`;
  }, 200);
  w.__ready = true;
}

function canvasClickLock(game: Game) {
  game.renderer.renderer.domElement.addEventListener('click', () => input.requestPointerLock());
}

export function bootDebug() {
  return boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;position:fixed;top:40px;left:10px;z-index:99">${e?.stack ?? e}</pre>`);
});
}
