const out = { events: [] };
const m = api.spawn('ground');
game.simulate(1);
const p = m.currPos.clone().add(m.forward().multiplyScalar(45));
const e = api.director.spawn({ faction: 'scrappers', tier: 1, pos: p, role: 'raider', seed: 42 });
out.enemy = { name: e.name, parts: e.parts.map(x => x.def.id).join(',') };
let hits = 0, destroyed = [];
game.events.on('hit', h => { hits++; });
game.events.on('partDestroyed', d => destroyed.push(`${d.machine === m ? 'PLAYER' : 'ENEMY'}:${d.part.def.name}`));
game.events.on('machineKilled', d => out.events.push(`KILLED ${d.machine.name} by ${d.source?.name} (${d.cause})`));
// player aims at enemy cockpit and fires
for (let i = 0; i < 20; i++) {
  const ck = e.cockpit;
  m.input.aimPoint = (ck && !ck.detached ? ck.worldCenter : e.worldCom).clone();
  m.input.fire = [true, false, false];
  game.control.apply = () => {};
  game.simulate(0.5);
  if (i === 6) { game.chase.yaw = Math.atan2(-(e.currPos.x - m.currPos.x), -(e.currPos.z - m.currPos.z)) + Math.PI; game.chase.zoom = 0.9; for (let k=0;k<10;k++) game.frameUpdate(1/60,1); await shot('mid'); }
  if (!e.alive) break;
}
out.hits = hits; out.destroyed = destroyed;
out.enemyAlive = e.alive; out.playerHp = m.healthFraction().toFixed(2);
out.playerDamaged = m.parts.filter(p => p.hp < p.maxHp).map(p => `${p.def.name}:${(p.cond*100).toFixed(0)}%`);
game.simulate(1);
for (let k=0;k<10;k++) game.frameUpdate(1/60,1);
await shot('after');
return out;
