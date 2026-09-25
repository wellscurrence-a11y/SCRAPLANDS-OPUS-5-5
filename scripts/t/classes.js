// Air and mech in the real app: HUD and chase camera while flying and walking.
const app = window.__app;
const P = await import('/src/gameplay/profile.ts');
localStorage.clear();
const p = P.newProfile();
app.beginGame(p, false);
game.frame(1 / 60);
const inp = window.__app.game.control ? null : null;
const I = (await import('/src/core/input.ts')).input;
const out = {};
for (const cls of ['air', 'mech']) {
  const d = p.machines.find((m) => m.cls === cls);
  app.enterWorld(d.id);
  game.frame(1 / 60);
  game.simulate(1);
  if (cls === 'air') I.scripted.set('up', 1);
  I.scripted.set('forward', 1);
  game.simulate(cls === 'air' ? 3 : 4);
  if (cls === 'air') I.scripted.delete('up');
  game.simulate(1.5);
  const m = game.player;
  const t = m.controller.telemetry();
  out[cls] = { speed: +(t.speed * 3.6).toFixed(0), alt: t.altitude != null ? +t.altitude.toFixed(1) : null, up: +m.up().y.toFixed(2), warnings: t.warnings };
  for (let i = 0; i < 3; i++) game.frame(1 / 60);
  await shot(cls);
  I.scripted.delete('forward');
}
return out;
