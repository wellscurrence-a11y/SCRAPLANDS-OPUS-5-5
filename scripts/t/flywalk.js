const out = {};
// ---- flight ----
let m = api.spawn('air');
game.simulate(1);
api.input.scripted.set('up', 1);
game.simulate(3);
api.input.scripted.delete('up');
out.climb = { alt: m.controller.altitude.toFixed(1), vy: m.velocity.y.toFixed(2), up: m.up().y.toFixed(3), pow: m.powerRatio.toFixed(2), E: m.energy.toFixed(0) };
game.simulate(2);
out.hover = { alt: m.controller.altitude.toFixed(1), vy: m.velocity.y.toFixed(2), speed: m.speed.toFixed(2), up: m.up().y.toFixed(3), thr: m.controller.throttleAvg.toFixed(2) };
game.chase.yaw = 0;
api.input.scripted.set('forward', 1);
game.simulate(5);
out.forward = { speed: (m.speed*3.6).toFixed(0), alt: m.controller.altitude.toFixed(1), up: m.up().y.toFixed(3), pow: m.powerRatio.toFixed(2), E: m.energy.toFixed(0) };
api.input.scripted.delete('forward');
game.simulate(4);
out.stop = { speed: m.speed.toFixed(1), alt: m.controller.altitude.toFixed(1) };
// destroy a rotor
const rotor = m.parts.find(p => p.def.category === 'rotor');
m.damagePartDirect(rotor, 999, null, 'test');
const path = [];
for (let i = 0; i < 6; i++) { game.simulate(0.5); path.push([m.controller.altitude.toFixed(1), m.up().y.toFixed(2), m.angVel.length().toFixed(2)]); }
out.rotorLost = path;
// ---- mech ----
m = api.spawn('mech');
game.simulate(2);
out.mechStand = { y: m.currPos.y.toFixed(2), up: m.up().y.toFixed(3), legs: m.controller.legs.map(l => [l.planted, l.load.toFixed(0)]) };
game.chase.yaw = Math.PI;
api.input.scripted.set('forward', 1);
const walk = [];
for (let i = 0; i < 6; i++) { game.simulate(1); walk.push([(m.speed).toFixed(2), m.up().y.toFixed(3), m.controller.legs.map(l => l.planted ? 'P' : 'S').join('')]); }
out.walk = walk;
api.input.scripted.delete('forward');
game.simulate(1);
game.chase.zoom = 0.6; game.chase.pitch = -0.05; game.chase.yaw = Math.PI + 1.6;
for (let i = 0; i < 20; i++) game.frameUpdate(1/60, 1);
await shot('mechwalk');
// knee destroyed
const knee = m.parts.find(p => p.placed.socket === 'kneejoint');
m.damagePartDirect(knee, 999, null, 'test');
api.input.scripted.set('forward', 1);
game.simulate(3);
out.limp = { speed: m.speed.toFixed(2), up: m.up().y.toFixed(3), tele: m.controller.telemetry().warnings };
api.input.scripted.delete('forward');
return out;
