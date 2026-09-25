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
out.garage = { mode: app.mode, inv: app.profile.inventory.length - inv0, cargo: app.profile.cargo.length, done: app.profile.missions.done, active: app.missions.active.map((m) => m.id) };
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
