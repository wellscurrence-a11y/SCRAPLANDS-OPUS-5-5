const out = {};
for (const cls of ['ground', 'air', 'mech']) {
  const m = api.spawn(cls);
  game.simulate(2.5);
  game.chase.zoom = 0.55;
  game.chase.yaw = m.cls === 'mech' ? 2.4 : 2.2;
  game.chase.pitch = -0.2;
  for (let i = 0; i < 30; i++) game.frameUpdate(1/60, 1);
  out[cls] = { pos: m.currPos.toArray().map(v => v.toFixed(2)), up: m.up().y.toFixed(3), mass: m.mass.toFixed(0), tele: m.controller.telemetry() };
  await shot(cls);
}
return out;
