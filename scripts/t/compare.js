// Same view at the preset given by ?quality=: a small fight near the scrapyard.
const app = window.__app;
const P = await import('/src/gameplay/profile.ts');
localStorage.removeItem('scraplands.save.v1');
app.beginGame(P.newProfile(), false);
game.frame(1 / 60);
const pl = game.player;
const T = pl.currPos.constructor;
const specs = [['scrappers', 'raider', -14, 34], ['authority', 'walker', 12, 44], ['scrappers', 'drone', 2, 30]];
const ms = specs.map(([faction, role, dx, dz]) => app.director.spawn({ faction, tier: 1, role, pos: new T(pl.currPos.x + dx, 0, pl.currPos.z + dz), ai: { passive: true }, seed: 11 }));
game.simulate(2.5);
const c = pl.currPos;
game.debugCam = { pos: new T(c.x - 10, c.y + 6, c.z - 6), target: new T(c.x + 2, c.y + 1, c.z + 30) };
for (let i = 0; i < 3; i++) game.frame(1 / 60);
await shot(app.settings.quality);
game.debugCam = { pos: new T(c.x + 60, c.y + 30, c.z - 80), target: new T(c.x + 200, c.y, c.z + 200) };
for (let i = 0; i < 3; i++) game.frame(1 / 60);
await shot(app.settings.quality + '_vista');
return { quality: app.settings.quality, calls: game.renderer.renderer.info.render.calls };
