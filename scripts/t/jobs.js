// Every job-board contract type, driven through its real mission logic (teleporting instead of driving).
const app = window.__app;
const P = await import('/src/gameplay/profile.ts');
const L = await import('/src/world/layout.ts');
localStorage.clear();
app.beginGame(P.newProfile(), false);
game.frame(1 / 60);
const M = app.missions;
const pl = game.player;
const T = pl.currPos.constructor;
const tp = (x, z) => pl.teleport(new T(x, game.terrain.heightAt(x, z) + 1.5, z), 0);
const loc = (id) => L.getLocation(id);
const kill = (m) => {
  const ck = m.parts.find((p) => p.def.category === 'cockpit') ?? m.frame;
  m.damagePartDirect(ck, 1e6, pl, 'test');
};
const spec = (kind, where, extra = {}) => ({ id: `t_${kind}`, kind, title: `Test ${kind}`, desc: '', loc: where, tier: 0, reward: { credits: 100 }, seed: 7, name: 'Tester', ...extra });
const run = async (s, drive) => {
  const c0 = app.profile.credits;
  M.accept(s);
  const j = M.active.find((m) => m.id === s.id);
  if (!j) return { accepted: false };
  let note = null;
  try {
    note = await drive(j);
  } catch (e) {
    note = `error: ${e.message}`;
  }
  const done = !M.active.includes(j) && !j.failed;
  if (!done) M.abandon(j.id);
  return { done, failed: j.failed, paid: app.profile.credits - c0, note };
};
const out = {};

out.bounty = await run(spec('bounty', 'foundry'), async (j) => {
  const l = loc('foundry');
  tp(l.x + 120, l.z + 40);
  game.simulate(0.3);
  if (!j.target) return 'no target';
  kill(j.target);
  game.simulate(0.3);
  return j.target.name;
});

out.delivery = await run(spec('delivery', 'airliner', { dest: 'dusthollow' }), async () => {
  const d = loc('dusthollow');
  tp(d.x + 10, d.z + 10);
  game.simulate(0.3);
});

out.race = await run(spec('race', 'overpass'), async (j) => {
  game.simulate(0.1);
  if (!j.gates.length) return 'no gates';
  for (let i = 0; i < j.gates.length; i++) {
    const g = j.gates[i].position;
    tp(g.x, g.z);
    pl.teleport(new T(g.x, g.y - 2, g.z), 0);
    game.simulate(0.1);
  }
  return `${j.gates.length} gates`;
});

out.salvage = await run(spec('salvage', 'airliner'), async (j) => {
  const l = loc('airliner');
  tp(l.x + 60, l.z);
  game.simulate(0.3);
  const w = j.wreck;
  if (!w) return 'no wreck';
  const wp = w.currPos;
  tp(wp.x - 6, wp.z);
  game.simulate(0.3);
  const c = app.salvage.candidates(w).sort((a, b) => a.def.mass - b.def.mass).slice(0, 2);
  app.salvage.start(w, c, false);
  for (let i = 0; i < 40 && app.salvage.job; i++) game.simulate(0.5);
  game.simulate(0.2);
  return c.map((p) => p.def.id).join(',');
});

out.capture = await run(spec('capture', 'dunes'), async (j) => {
  const l = loc('dunes');
  tp(l.x + 100, l.z);
  game.simulate(0.3);
  const t = j.target;
  if (!t) return 'no target';
  for (const p of t.parts) if (['wheel', 'track', 'leg', 'rotor', 'jet'].includes(p.def.category)) t.damagePartDirect(p, 1e6, pl, 'test');
  game.simulate(0.5);
  const mc = app.profile.machines.length;
  tp(t.currPos.x - 6, t.currPos.z);
  game.simulate(0.2);
  const it = j.interaction(pl);
  if (!it) return `no interaction (immobile=${t.immobile}, alive=${t.alive})`;
  it.action();
  return `machines ${mc} -> ${app.profile.machines.length}`;
});

out.defend = await run(spec('defend', 'dusthollow'), async (j) => {
  const l = loc('dusthollow');
  tp(l.x, l.z);
  for (let w = 0; w < 5 && M.active.includes(j); w++) {
    game.simulate(0.3);
    for (const m of j.owned) if (m.alive) kill(m);
    game.simulate(0.3);
  }
  return `waves ${j.wave}`;
});

out.rescue = await run(spec('rescue', 'radiotower'), async (j) => {
  const l = loc('radiotower');
  tp(l.x + 20, l.z + 10);
  game.simulate(0.3);
  j.timer = 0.05;
  game.simulate(0.3);
  for (const m of j.owned) if (m.alive) kill(m);
  const r = loc('rustwater');
  tp(r.x, r.z);
  game.simulate(0.3);
  return j.objectives.map((o) => o.done).join(',');
});

return out;
