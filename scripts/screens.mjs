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

// First arrival: the loader over the landscape, then the home page once it fades.
await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await shot('0a-loader-2s');
await page.waitForTimeout(5500);
await shot('0b-home');
await page.locator('[data-testid=button-watch-how]').click().catch(() => note('no watch button'));
await page.waitForTimeout(2500);
await shot('0c-explainer-modal');
await page.keyboard.press('Escape');

// A clean results screen first (tour already seen), then the tour from a fresh state.
await page.addInitScript(() => { try { localStorage.setItem('ddg-greenlight-results-tour-seen', '1'); } catch {} });
await page.goto(`${base}/results/${runId}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);
await shot('00-results');
await page.locator('[data-testid^=button-annunciator-]').first().click().catch(() => {});
await page.waitForTimeout(1500);
await shot('01-results-theme');
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { try { localStorage.removeItem('ddg-greenlight-results-tour-seen'); } catch {} });
await page.goto(`${base}/results/${runId}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
const prompt = page.locator('[data-testid=button-tour-play]');
if (await prompt.isVisible().catch(() => false)) await prompt.click();
else await page.locator('[data-testid=button-play-tour]').click();

// Play the whole tour in real time, one frame every 3.5 s.
const t0 = Date.now();
for (let i = 0; i < 48; i++) {
  await page.waitForTimeout(3500 - ((Date.now() - t0) % 3500));
  const slide = await page.locator('[data-testid=tour-caption] .tour-cap-kicker').textContent().catch(() => '');
  const n = (slide || '').match(/^(\d+)/)?.[1] ?? 'x';
  // What the arrow is doing, for review without a browser.
  const arrow = await page.evaluate(() => {
    const g = document.querySelector('.tour-pointer');
    if (!g) return 'no arrow';
    const d = g.querySelector('.tp-line')?.getAttribute('d') ?? '';
    return `${g.querySelector('.tp-label text')?.textContent ?? '(no label)'} · ${g.querySelector('.tp-box') ? 'box' : g.querySelector('.tp-ring') ? 'ring' : 'plain'} · ${d.slice(0, 60)} · caption ${document.querySelector('[data-testid=tour-caption]')?.getAttribute('data-slot')}`;
  }).catch(() => '?');
  note(`  arrow: ${arrow}`);
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
