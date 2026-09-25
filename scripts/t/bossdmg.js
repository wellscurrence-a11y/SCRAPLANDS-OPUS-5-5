const app = window.__app;
localStorage.clear();
app.beginGame((await import('/src/gameplay/profile.ts')).newProfile(), false);
game.frame(1 / 60);
const { spawnExcavator } = await import('/src/gameplay/boss.ts');
const pl = game.player;
const T = pl.currPos.constructor;
const boss = spawnExcavator(app, new T(pl.currPos.x + 10, 0, pl.currPos.z + 70));
const log = [];
game.events.on('hit', (e) => { if (e.machine === boss || e.target === boss) log.push({ t: +game.ctx.time.toFixed(2), kind: e.kind, src: e.source?.name, part: e.part?.def?.id, dmg: +(e.damage ?? 0).toFixed(1) }); });
const snap = () => boss.parts.filter((p) => p.hp < p.maxHp - 0.5).map((p) => `${p.def.id}:${Math.round(p.hp)}/${p.maxHp}`);
const series = [];
for (let i = 0; i < 12; i++) { game.simulate(0.5); series.push({ t: i * 0.5 + 0.5, heat: +boss.heat.toFixed(0), heatCap: +boss.heatCap.toFixed(0), dmg: snap().join(' ') }); }
return { series, log: log.slice(0, 20), hitKeys: Object.keys(log[0] ?? {}) };
