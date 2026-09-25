// Usage: node scripts/shot.mjs <url> <out.png> [js-to-eval-before-shot] [waitMs]
import { chromium } from 'playwright';
const [url, out, js = '', wait = '1500'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
if (js) await page.evaluate(js);
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
console.log(logs.join('\n'));
await browser.close();
