// Build -> fight -> salvage loop through the real app, plus save/load and trading.
const app = window.__app;
const P = await import('/src/gameplay/profile.ts');
const out = {};
localStorage.clear();
app.beginGame(P.newProfile(), false);
game.frame(1 / 60);
game.simulate(0.5);
const tut = app.missions.active.find((m) => m.id === 'm_range');
out.targets = tut.targets.length;
const pl = game.player;
for (const t of tut.targets) {
  const ck = t.parts.find((p) => p.def.category === 'cockpit');
  t.damagePartDirect(ck, 1e5, pl, 'test');
}
game.simulate(0.5);
out.dummiesDead = tut.targets.map((t) => t.alive);
out.obj1 = tut.objectives.map((o) => o.done);
out.credits0 = app.profile.credits;
// drive up to the first wreck and cut a part off it
const w = tut.targets[0];
const T = pl.currPos.constructor;
const spot = new T(w.currPos.x - 8, game.terrain.heightAt(w.currPos.x - 8, w.currPos.z) + 1.5, w.currPos.z);
pl.teleport(spot, Math.PI / 2);
game.simulate(1);
const cands = app.salvage.candidates(w).sort((a, b) => a.def.mass - b.def.mass);
out.candidates = cands.length;
const take = cands[0];
out.taking = take?.def.id;
app.salvage.start(w, [take], false);
for (let i = 0; i < 30 && app.salvage.job; i++) game.simulate(0.5);
out.cargo = app.profile.cargo.map((c) => c.defId);
out.salvaged = app.profile.stats.partsSalvaged;
out.obj2 = tut.objectives.map((o) => o.done);
// back to the workshop
const inv0 = app.profile.inventory.length;
app.enterGarage(true);
game.frame(1 / 60);
out.garage = { mode: app.mode, inv: app.profile.inventory.length - inv0, cargo: app.profile.cargo.length, done: [...app.profile.missions.done], active: app.missions.active.map((m) => m.id) };
// second story contract: install a part through the builder's own hover/place path, then deploy
const g = app.garage;
const V3 = game.camera.position.constructor;
const item = app.profile.inventory.find((i) => i.defId === 'arm_scrap_s') ?? app.profile.inventory[0];
g.startPlacing(item);
g.frameMachine(true);
g.camera.updateMatrixWorld();
g.camera.updateProjectionMatrix();
const parts0 = g.design.parts.length;
let tried = 0;
for (const mk of g.markers.children) {
  mk.updateMatrixWorld();
  const p = new V3().setFromMatrixPosition(mk.matrixWorld).project(g.camera);
  if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1) continue;
  tried++;
  g.mouse.set(p.x, p.y);
  g.updateHover();
  if (g.hover && g.hover.valid) { g.place(); break; }
}
out.install = { tried, added: g.design.parts.length - parts0, m_build: app.missions.active.find((m) => m.id === 'm_build')?.objectives.map((o) => o.done) };
g.cancelPlacing();
app.enterWorld(app.profile.activeMachine);
game.frame(1 / 60);
out.install.doneAfterDeploy = app.profile.missions.done.includes('m_build');
out.install.next = app.missions.active.map((m) => m.id);
app.enterGarage(true);
game.frame(1 / 60);
// research
const R = await import('/src/gameplay/research.ts');
const avail = R.TECH.filter((t) => R.researchStatus(app.profile, t) === 'available');
out.researchAvailable = avail.map((t) => t.id);
// save / load round trip
app.saveNow();
const loaded = P.loadProfile();
out.saveRoundTrip = loaded && loaded.credits === app.profile.credits && loaded.inventory.length === app.profile.inventory.length && loaded.missions.done.join() === app.profile.missions.done.join() && loaded.machines.length === 3;
// trading
app.enterWorld(app.profile.activeMachine);
game.frame(1 / 60);
app.merchant.show('rustwater');
const stock = app.merchant.stock().stock.sort((a, b) => a.value - b.value);
const c0 = app.profile.credits;
const n0 = app.profile.inventory.length;
app.merchant.buy(stock[0]);
out.buy = { item: stock[0].id, paid: c0 - app.profile.credits, inv: app.profile.inventory.length - n0, stillInStock: app.merchant.stock().stock.some((d) => d.id === stock[0].id) };
app.merchant.close();
return out;
