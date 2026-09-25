// Story contracts after the tutorial, each driven through its real logic (teleporting instead of travelling).
const app = window.__app;
const P = await import('/src/gameplay/profile.ts');
const L = await import('/src/world/layout.ts');
localStorage.clear();
app.beginGame(P.newProfile(), false);
game.frame(1 / 60);
const M = app.missions;
const p = app.profile;
const pl = game.player;
const T = pl.currPos.constructor;
const put = (m, x, z, yaw = 0) => m.teleport(new T(x, game.terrain.heightAt(x, z) + 2, z), yaw);
const tp = (x, z) => put(pl, x, z);
const loc = (id) => L.getLocation(id);
const kill = (m) => m.damagePartDirect(m.parts.find((q) => q.def.category === 'cockpit') ?? m.frame, 1e6, pl, 'test');
const chain = { m_rats: ['m_range', 'm_build'], m_rustwater: ['m_range', 'm_build', 'm_rats'], m_convoy: ['m_range', 'm_build', 'm_rats', 'm_rustwater'], m_foundry: ['m_range', 'm_build', 'm_rats', 'm_rustwater', 'm_convoy'] };
chain.m_signal = [...chain.m_foundry, 'm_foundry'];
chain.m_fort = [...chain.m_signal, 'm_signal'];
chain.m_excavator = [...chain.m_foundry, 'm_foundry'];
const begin = (id) => {
  for (const m of M.active) m.cleanup();
  app.director.clearAll();
  M.active = [];
  p.missions.done = [...chain[id]];
  p.discovered = ['home'];
  p.flags = {};
  M.checkStory();
  return M.active.find((m) => m.id === id);
};
const finished = (id) => p.missions.done.includes(id);
const out = {};

// Scrap Rats
{
  const m = begin('m_rats');
  const o = loc('overpass');
  tp(o.x + 60, o.z + 60);
  game.simulate(0.3);
  const n = m.owned.size;
  for (const e of m.owned) kill(e);
  game.simulate(0.3);
  out.m_rats = { spawned: n, done: finished('m_rats') };
}
// Road to Rustwater
{
  begin('m_rustwater');
  const r = loc('rustwater');
  tp(r.x, r.z);
  game.simulate(0.5);
  app.merchant.show('rustwater');
  app.merchant.close();
  game.simulate(0.2);
  out.m_rustwater = { discovered: p.discovered.includes('rustwater'), done: finished('m_rustwater') };
}
// Water Run
{
  const m = begin('m_convoy');
  const r = loc('rustwater');
  tp(r.x - 70, r.z + 10);
  game.simulate(0.5);
  const c = m.convoy;
  let moved = 0;
  if (c) {
    const c0 = c.currPos.clone();
    game.simulate(4);
    moved = c.currPos.distanceTo(c0);
    put(c, 120, 118, Math.PI / 2);
    tp(140, 118);
    game.simulate(0.3);
    const ambush1 = m.data.ambush;
    put(c, -690, 95, Math.PI / 2);
    tp(-670, 95);
    game.simulate(0.5);
    out.m_convoy = { convoy: true, convoyMoved: +moved.toFixed(1), ambushes: ambush1, done: finished('m_convoy') };
  } else out.m_convoy = { convoy: false };
}
// Cut the Power
{
  const m = begin('m_foundry');
  const f = loc('foundry');
  tp(f.x - 80, f.z - 60);
  game.simulate(0.3);
  const rig = m.rig;
  if (rig) {
    for (const q of rig.parts) if (q.def.category === 'generator') rig.damagePartDirect(q, 1e6, pl, 'test');
    rig.damagePartDirect(rig.frame, 1e6, pl, 'test');
  }
  game.simulate(0.3);
  out.m_foundry = { rig: !!rig, rigAlive: rig?.alive, done: finished('m_foundry') };
}
// Signal in the Canyons (relay already discovered before the contract, the case that used to stall)
{
  const m = begin('m_signal');
  p.discovered.push('helix');
  const hx = loc('helix');
  tp(hx.x + 60, hx.z);
  game.simulate(0.3);
  const n = m.owned.size;
  for (const e of m.owned) kill(e);
  game.simulate(0.3);
  tp(hx.x + 5, hx.z);
  game.simulate(0.2);
  const it = m.interaction(pl);
  if (it) it.action();
  out.m_signal = { defenders: n, interaction: !!it, done: finished('m_signal') };
}
// Authority Presence
{
  const m = begin('m_fort');
  const f = loc('fort');
  tp(f.x, f.z);
  game.simulate(0.3);
  tp(f.x + 30, f.z - 40);
  game.simulate(0.2);
  const it = m.interaction(pl);
  if (it) it.action();
  game.simulate(0.3);
  const reinf = m.owned.size;
  tp(f.x + 200, f.z + 560);
  game.simulate(0.3);
  out.m_fort = { grabbed: !!it, reinforcements: reinf, done: finished('m_fort') };
}
// The Excavator
{
  const m = begin('m_excavator');
  const pit = L.PIT;
  tp(pit.x - 60, pit.z + 40);
  game.simulate(0.5);
  const boss = m.boss;
  if (boss) {
    boss.damagePartDirect(boss.parts.find((q) => q.def.id === 'gen_excavator'), 1e6, pl, 'test');
    boss.damagePartDirect(boss.frame, 1e6, pl, 'test');
  }
  game.simulate(0.5);
  const bossDead = boss && !boss.alive;
  app.enterGarage(true);
  out.m_excavator = { boss: !!boss, bossDead, defeated: [...p.world.bossDefeated], done: finished('m_excavator'), blueprint: p.blueprints.includes('act_titan') };
}
return out;
