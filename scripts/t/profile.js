// CPU profile of a representative fight at a Chromebook resolution: where does frame time go?
// Usage: URL=http://localhost:5173/ node scripts/harness.mjs scripts/t/profile.js screenshots/prof
const app = window.__app;
const P = await import('/src/gameplay/profile.ts');
const q = window.__profileQuality ?? 'low';
localStorage.clear();
app.settings.quality = q;
app.settings.autoQuality = false;
app.applySettings();
app.beginGame(P.newProfile(), false);
game.frame(1 / 60);
const pl = game.player;
const T = pl.currPos.constructor;
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2;
  app.director.spawn({ faction: i % 2 ? 'scrappers' : 'authority', tier: 1, pos: new T(pl.currPos.x + Math.cos(a) * 55, 0, pl.currPos.z + 60 + Math.sin(a) * 40) });
}
game.simulate(3);
game.chase.yaw = Math.PI; // look toward the fight

const acc = {};
const wrap = (obj, name, label) => {
  const f = obj[name];
  obj[name] = function (...a) {
    const t = performance.now();
    const r = f.apply(this, a);
    acc[label] = (acc[label] ?? 0) + performance.now() - t;
    return r;
  };
};
const MP = pl.constructor.prototype;
wrap(MP, 'prePhysics', 'machine.prePhysics');
wrap(MP, 'postPhysics', 'machine.postPhysics');
wrap(MP, 'update', 'machine.update(visual)');
wrap(game.physics, 'step', 'rapier.step');
wrap(app.director, 'fixedUpdate', 'ai.pilots');
wrap(app.missions, 'fixedUpdate', 'missions');
wrap(game.ctx.projectiles, 'fixedUpdate', 'projectiles');
wrap(app.hud, 'update', 'hud(dom)');
wrap(game.env, 'update', 'env(sky/fog/shadow cam)');
wrap(game.fx, 'update', 'particles');
wrap(game.ctx.debris, 'update', 'debris');
wrap(game.chase, 'update', 'camera');
wrap(app.audio, 'update', 'audio');
wrap(app.props, 'update', 'props');

const R = game.renderer.renderer;
const gl = R.getContext();
const N = 30;
const t = { sim: 0, frameUpdate: 0, render: 0, gpuFinish: 0 };
const time = (fn) => {
  const s = performance.now();
  fn();
  return performance.now() - s;
};
// Chromebook-ish viewport: 1366x768 at devicePixelRatio 1
const resize = (w, h) => {
  game.renderer.container.style.width = `${w}px`;
  game.renderer.container.style.height = `${h}px`;
  game.renderer.resize();
};
resize(1366, 768);
game.renderer.setQuality(q);
game.renderer.render(game.scene, game.camera, 1 / 30);
gl.finish();
R.info.autoReset = true;
for (let i = 0; i < N; i++) {
  t.sim += time(() => {
    game.step(1 / 60);
    game.step(1 / 60);
  });
  t.frameUpdate += time(() => game.frameUpdate(1 / 30, 1));
  t.render += time(() => game.renderer.render(game.scene, game.camera, 1 / 30));
  t.gpuFinish += time(() => gl.finish());
}
R.info.autoReset = false;
R.info.reset();
game.renderer.render(game.scene, game.camera, 1 / 30);
const info = { calls: R.info.render.calls, triangles: R.info.render.triangles, programs: R.info.programs?.length, geometries: R.info.memory.geometries, textures: R.info.memory.textures };
R.shadowMap.autoUpdate = false;
R.info.reset();
game.renderer.render(game.scene, game.camera, 1 / 30);
info.withoutShadowPass = { calls: R.info.render.calls, triangles: R.info.render.triangles };
R.shadowMap.autoUpdate = true;
R.info.autoReset = true;
// what is in view, by top-level group (frustum-tested bounding spheres)
const cam = game.camera;
cam.updateMatrixWorld();
const fr = new (await import('/node_modules/.vite/deps/three.js')).Frustum();
const M4 = (await import('/node_modules/.vite/deps/three.js')).Matrix4;
fr.setFromProjectionMatrix(new M4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
const cats = {};
const tops = [];
for (const top of game.scene.children) {
  if (!top.name && top.type === 'Group') for (const c of top.children) tops.push([`Group/${c.name || c.type}`, c]);
  else tops.push([top.name || top.type, top]);
}
for (const [key0, top] of tops) {
  const key = key0.replace(/_\d+_\d+$/, '_*');
  top.traverseVisible((o) => {
    if (!o.isMesh && !o.isPoints) return;
    const g = o.geometry;
    if (!g) return;
    if (o.frustumCulled && g.boundingSphere) {
      const sph = g.boundingSphere.clone().applyMatrix4(o.matrixWorld);
      if (!fr.intersectsSphere(sph)) return;
    } else if (o.frustumCulled && !g.boundingSphere) g.computeBoundingSphere();
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const inst = o.isInstancedMesh ? o.count : 1;
    const c = (cats[key] ??= { draws: 0, tris: 0, shadowCasters: 0 });
    c.draws++;
    c.tris += tris * inst;
    if (o.castShadow) { c.shadowCasters++; c.shadowTris = (c.shadowTris ?? 0) + tris * inst; }
  });
}
info.inView = Object.fromEntries(Object.entries(cats).sort((a, b) => b[1].tris - a[1].tris).map(([k, v]) => [k, { draws: v.draws, ktris: +(v.tris / 1000).toFixed(1), shadowCasters: v.shadowCasters, shadowKtris: +((v.shadowTris ?? 0) / 1000).toFixed(1) }]));
// render submission with a tiny framebuffer: isolates CPU/driver cost from rasterisation
resize(96, 54);
let tiny = 0;
for (let i = 0; i < 10; i++) tiny += time(() => { game.renderer.render(game.scene, game.camera, 1 / 30); gl.finish(); });
resize(1366, 768);
await shot(q);
const per = (v) => +(v / N).toFixed(2);
const breakdown = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, per(v)]).sort((a, b) => b[1] - a[1]));
return {
  quality: q,
  machines: game.ctx.machines.length,
  msPerFrame: { sim2steps: per(t.sim), frameUpdate: per(t.frameUpdate), renderSubmit: per(t.render), gpuFinish_swiftshader: per(t.gpuFinish), renderTinyFb: +(tiny / 10).toFixed(2) },
  breakdown,
  info,
  drawingBuffer: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
};
