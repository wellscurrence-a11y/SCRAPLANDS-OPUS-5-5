// End-to-end checks in a headless browser against a throwaway Vite server.
//   npm run e2e
// Each scenario is a script evaluated in the page (see scripts/t/) whose result is asserted here.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';

const server = await createServer({ server: { port: 0, strictPort: false, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const port = server.httpServer.address().port;
const base = `http://localhost:${port}/`;

const browser = await chromium.launch({
  executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function run(file, query = '') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(0);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { window.__manual = true; });
  await page.goto(base + query);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
  const src = fs.readFileSync(file, 'utf8');
  const result = await page.evaluate(`(async () => { const game = window.__game; const api = window.__api; const shot = async () => null; ${src} })()`);
  await page.close();
  return { result, errors };
}

let failed = 0;
function check(name, cond, detail) {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!cond) failed++;
}

const scenarios = [
  [
    'progression loop',
    'scripts/t/progression.js',
    (r) => {
      check('range dummies spawn and die', r.targets === 3 && r.dummiesDead.every((a) => a === false), r.dummiesDead);
      check('salvaged part goes to cargo', r.cargo.length === 1 && r.salvaged === 1, r.cargo);
      check('garage unloads cargo into storage', r.garage.inv === 1 && r.garage.cargo === 0, r.garage);
      check('tutorial completes and unlocks the next story contract', r.garage.done.includes('m_range') && r.garage.active.includes('m_build'), r.garage);
      check('a part installed in the builder completes the next contract on deploy', r.install.added >= 1 && r.install.doneAfterDeploy && r.install.next.includes('m_rats'), r.install);
      check('research tree has options', r.researchAvailable.length > 3, r.researchAvailable);
      check('save round-trips', r.saveRoundTrip === true, r.saveRoundTrip);
      check('merchant sells and delivers', r.buy.inv === 1 && r.buy.paid > 0 && !r.buy.stillInStock, r.buy);
    },
  ],
  [
    'excavator boss',
    'scripts/t/boss.js',
    (r) => {
      check('boss stands on four legs', r.afterSettle.legs === 4 && r.afterSettle.h > 3 && r.afterSettle.up > 0.95, r.afterSettle);
      check('boss hunts the player', r.walk.state === 'engage' && r.walk.moved > 5, r.walk);
      check('boss limps on a lost knee but stays up', r.kneeDestroyed.destroyed && r.kneeDestroyed.up > 0.8, r.kneeDestroyed);
      check('boss dies and credits the player', r.dead.alive === false && r.kills >= 1, r);
      check('unique parts survive for salvage (attached or blown clear as loot)', r.salvageable.length >= 4 && !r.bucket.destroyed, { salvageable: r.salvageable, bucket: r.bucket });
    },
  ],
  [
    'job board contracts',
    'scripts/t/jobs.js',
    (r) => {
      for (const k of ['bounty', 'delivery', 'race', 'salvage', 'capture', 'defend', 'rescue']) check(`${k} contract completes and pays`, r[k]?.done === true && r[k].paid >= 100, r[k]);
    },
  ],
  [
    'story contracts',
    'scripts/t/story.js',
    (r) => {
      for (const k of ['m_rats', 'm_rustwater', 'm_convoy', 'm_foundry', 'm_signal', 'm_fort', 'm_excavator']) check(`${k} completes`, r[k]?.done === true, r[k]);
      check('convoy drives its route and gets ambushed', r.m_convoy?.convoyMoved > 5 && r.m_convoy?.ambushes >= 1, r.m_convoy);
      check('excavator kill is recorded and pays its blueprint', r.m_excavator?.defeated?.includes('excavator') && r.m_excavator?.blueprint, r.m_excavator);
    },
  ],
  [
    'app screens',
    'scripts/t/appflow.js',
    (r) => {
      check('title → world → garage → world', r.mode0 === 'title' && r.mode1 === 'world' && r.mode2 === 'garage' && r.mode3 === 'world', r);
      check('map opens', r.mapOpen === true, r);
      check('market visit is recorded', r.visitedMarket === true, r);
      check('job board is populated', r.board.length === 5, r.board);
    },
  ],
];

const only = process.argv[2];
for (const [name, file, verify] of scenarios) {
  if (only && !name.includes(only)) continue;
  console.log(name);
  try {
    const { result, errors } = await run(file);
    verify(result);
    check('no page errors', errors.length === 0, errors.slice(0, 3));
  } catch (e) {
    check('scenario ran', false, String(e.message ?? e).slice(0, 400));
  }
}

await browser.close();
await server.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
