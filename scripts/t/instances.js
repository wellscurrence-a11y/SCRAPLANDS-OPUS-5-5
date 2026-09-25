const app = window.__app;
const P = await import('/src/gameplay/profile.ts');
localStorage.clear();
app.settings.quality = 'low';
app.applySettings();
app.beginGame(P.newProfile(), false);
game.frame(1 / 60);
const out = [];
game.scene.traverse((o) => {
  if (!o.isInstancedMesh) return;
  const g = o.geometry;
  const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
  out.push({ name: o.name || o.parent?.name, count: o.count, trisEach: tris, ktotal: +((tris * o.count) / 1000).toFixed(1), castShadow: o.castShadow, frustumCulled: o.frustumCulled, hasBS: !!o.boundingSphere });
});
const props = [];
for (const c of app.props.group.children) {
  let t = 0, d = 0;
  c.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) { d++; t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
  props.push({ name: c.name, draws: d, ktris: +(t / 1000).toFixed(1) });
}
return { instanced: out, props: props.sort((a, b) => b.ktris - a.ktris) };
