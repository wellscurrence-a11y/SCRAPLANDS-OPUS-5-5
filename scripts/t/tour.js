// Scenic tour: vantage shots of key locations at different times and weather.
const app = window.__app;
const P = await import('/src/gameplay/profile.ts');
const L = await import('/src/world/layout.ts');
localStorage.clear();
app.beginGame(P.newProfile(), false);
game.frame(1 / 60);
const T = game.player.currPos.constructor;
const shots = [
  ['rustwater', 0.36, 'clear', [-60, 22, 70]],
  ['foundry', 0.72, 'hazy', [80, 30, 90]],
  ['canyons', 0.3, 'clear', [90, 60, -60]],
  ['pit', 0.45, 'dust', [-150, 70, 60]],
  ['fort', 0.9, 'clear', [70, 25, 80]],
  ['home', 0.55, 'storm', [60, 20, -70]],
];
for (const [id, time, weather, off] of shots) {
  const l = L.getLocation(id);
  game.env.time = time;
  game.env.setWeather(weather, true);
  const gy = game.terrain.heightAt(l.x + off[0], l.z + off[2]);
  const ty = game.terrain.heightAt(l.x, l.z);
  game.debugCam = { pos: new T(l.x + off[0], Math.max(gy + 12, ty + off[1]), l.z + off[2]), target: new T(l.x, ty + 3, l.z) };
  if (game.player) game.player.teleport(new T(l.x + off[0] * 0.5, game.terrain.heightAt(l.x + off[0] * 0.5, l.z + off[2] * 0.5) + 2, l.z + off[2] * 0.5), 0);
  for (let i = 0; i < 4; i++) game.frame(1 / 60);
  await shot(`${id}`);
}
return 'ok';
