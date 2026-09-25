const m = game.player;
const out = {};
const t0 = performance.now();
game.simulate(1.5);
out.settle = { y: m.currPos.y.toFixed(2), up: m.up().y.toFixed(3), comp: m.controller.contacts.map(c => c.compression.toFixed(3)) };
m.input.throttle = 1;
const samples = [];
// Scripted: hold throttle
api.input.scripted.set('forward', 1);
for (let i = 0; i < 10; i++) { game.simulate(1); const t = m.controller.telemetry(); samples.push([(t.speed*3.6).toFixed(0), t.gear, t.rpm.toFixed(0), m.up().y.toFixed(2)]); }
out.accel = samples;
api.input.scripted.set('right', 1);
game.simulate(2);
out.turn = { speed: (m.speed*3.6).toFixed(0), up: m.up().y.toFixed(2), yawRate: m.angVel.y.toFixed(2) };
api.input.scripted.delete('right');
api.input.scripted.delete('forward');
api.input.scripted.set('back', 1);
game.simulate(3);
out.brake = { speed: (m.speed*3.6).toFixed(0) };
api.input.scripted.delete('back');
out.ms = (performance.now() - t0).toFixed(0);
game.frameUpdate(0.016, 1);
await shot('drive');
return out;
