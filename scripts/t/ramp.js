// Can the starter buggy climb the Pit haul ramp?
const L = await import('/src/world/layout.ts');
const R = L.PIT_RAMP;
const m = api.spawn('ground');
const T = m.currPos.constructor;
// start at the bottom, facing up the ramp (toward a)
const bx = R.ax + (R.bx - R.ax) * 0.92, bz = R.az + (R.bz - R.az) * 0.92;
const yaw = Math.atan2(-(R.ax - R.bx), -(R.az - R.bz));
m.teleport(new T(bx, game.terrain.heightAt(bx, bz) + 1.5, bz), yaw);
game.simulate(1.5);
const y0 = m.currPos.y;
api.input.scripted.set('forward', 1);
const trace = [];
for (let i = 0; i < 12; i++) { game.simulate(2); trace.push({ t: (i + 1) * 2, y: +m.currPos.y.toFixed(1), v: +(m.velocity.length() * 3.6).toFixed(0) }); }
api.input.scripted.delete('forward');
const dTop = Math.hypot(m.currPos.x - R.ax, m.currPos.z - R.az);
return { y0: +y0.toFixed(1), yEnd: +m.currPos.y.toFixed(1), dTop: +dTop.toFixed(0), trace };
