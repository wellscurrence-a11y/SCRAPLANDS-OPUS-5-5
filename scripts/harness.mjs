// Headless test harness: node scripts/harness.mjs <script.js> [outprefix]
// The script file is evaluated inside the page with `api`, `game`, `THREE`-free helpers and returns JSON-able results.
import { chromium } from 'playwright';
import fs from 'node:fs';
const [scriptFile, prefix = 'screenshots/h'] = process.argv.slice(2);
const url = process.env.URL ?? 'http://localhost:5173/?debug';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(0);
const logs = [];
page.on('console', (m) => { if (!m.text().includes('[vite]')) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.addInitScript(() => { window.__manual = true; });
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const src = fs.readFileSync(scriptFile, 'utf8');
let shotN = 0;
await page.exposeFunction('__shot', async (name) => {
  const file = `${prefix}_${name ?? shotN++}.png`;
  await page.screenshot({ path: file, timeout: 180000 });
  return file;
});
try {
  const result = await page.evaluate(`(async () => { const game = window.__game; const api = window.__api; const shot = async (n) => { game.frame(1/60); await new Promise(r => setTimeout(r, 30)); return window.__shot(n); }; ${src} })()`);
  console.log(JSON.stringify(result, null, 1));
} catch (e) {
  console.log('EVAL ERROR', e.message);
}
console.log(logs.slice(-40).join('\n'));
await browser.close();
