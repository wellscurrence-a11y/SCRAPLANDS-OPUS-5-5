const app = window.__app;
const P = await import('/src/gameplay/profile.ts');
localStorage.clear();
app.settings.quality = 'low'; app.settings.autoQuality = false; app.applySettings();
app.beginGame(P.newProfile(), false);
game.frame(1 / 60);
const pl = game.player;
const T = pl.currPos.constructor;
const out = [];
for (const role of ['raider', 'truck', 'drone', 'gunship', 'scout', 'walker', 'assault', 'hauler', 'tank']) {
  const m = app.director.spawn({ faction: role === 'walker' || role === 'assault' ? 'authority' : 'scrappers', tier: 2, pos: new T(pl.currPos.x + out.length * 25, 0, pl.currPos.z + 60), role });
  game.simulate(0.2);
  const count = {};
  let hiddenOrig = 0;
  m.root.traverse((o) => { if (o.isMesh && !o.userData.batch && !o.visible) hiddenOrig++; });
  m.root.traverseVisible((o) => {
    if (!o.isMesh || o.layers.mask !== 1) return;
    const key = o.userData.batch ? (o.parent === m.root ? 'ROOT' : o.parent.name) : `UNBATCHED:${o.parent.name}`;
    count[key] = (count[key] ?? 0) + 1;
  });
  const total = Object.values(count).reduce((a, b) => a + b, 0);
  out.push({ role, name: m.name, parts: m.parts.length, total, hiddenOrig, carriers: Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(' ') });
}
return out;
