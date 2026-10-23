/**
 * Captures the live site for review: plays the guided tour on the public demo
 * assessment and screenshots it every few seconds, then the fix page and the
 * recorded fix replay. Output: JPEGs in ./screens (pushed to the `screens`
 * branch by .github/workflows/screens.yml).
 *
 *   node scripts/screens.mjs https://ddg-greenlight.replit.app
 */
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const base = (process.argv[2] || 'https://ddg-greenlight.replit.app').replace(/\/$/, '');
const out = 'screens';
await fs.mkdir(out, { recursive: true });
const log = [];
const note = (s) => { console.log(s); log.push(s); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => note(`PAGEERROR ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') note(`CONSOLE ${m.text().slice(0, 300)}`); });
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 72 }); note(`shot ${name}`); };

// Find the public demo assessment.
const projects = await (await fetch(`${base}/api/greenlight/projects`)).json().catch(() => []);
const runId = (Array.isArray(projects) ? projects : []).find((p) => p.latestRunId)?.latestRunId;
note(`demo run: ${runId || 'none'}`);
if (!runId) { await fs.writeFile(`${out}/log.txt`, log.join('\n')); process.exit(1); }

await page.goto(`${base}/results/${runId}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
await shot('00-results');
const prompt = page.locator('[data-testid=button-tour-play]');
if (await prompt.isVisible().catch(() => false)) await prompt.click();
else await page.locator('[data-testid=button-play-tour]').click();

// Play the whole tour in real time, one frame every 3.5 s.
const t0 = Date.now();
for (let i = 0; i < 48; i++) {
  await page.waitForTimeout(3500 - ((Date.now() - t0) % 3500));
  const slide = await page.locator('[data-testid=tour-caption] .tour-cap-kicker').textContent().catch(() => '');
  const n = (slide || '').match(/^(\d+)/)?.[1] ?? 'x';
  await shot(`tour-${String(i).padStart(2, '0')}-slide${n}-${Math.round((Date.now() - t0) / 1000)}s`);
  if (await page.locator('[data-testid=button-tour-done]').isVisible().catch(() => false)) break;
}

await page.goto(`${base}/fix/${runId}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await shot('80-fix');
await page.locator('[data-testid=link-recorded-fix]').click().catch(() => note('no recorded-fix link'));
await page.waitForTimeout(12000);
await shot('81-replay-12s');
await page.keyboard.press('End');
await page.waitForTimeout(1500);
await shot('82-replay-end');

await fs.writeFile(`${out}/log.txt`, log.join('\n'));
await browser.close();
