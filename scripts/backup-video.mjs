/**
 * Records the pitch flow on the live site as a video, for the day the venue
 * network fails: loader → home → explainer → results → guided tour (full) →
 * fix page → recorded fix (played at 4×, then skipped to the end card) →
 * lights to green on the orbit → How it checks. 1920×1080, WebM, with no
 * audio (the room's audio comes from the presenter).
 *
 *   node scripts/backup-video.mjs https://ddg-greenlight.replit.app
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = (process.argv[2] || 'https://ddg-greenlight.replit.app').replace(/\/$/, '');
const out = 'backup';
await fs.mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: out, size: { width: 1920, height: 1080 } } });
const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);

const projects = await (await fetch(`${base}/api/greenlight/projects`)).json().catch(() => []);
const runId = (Array.isArray(projects) ? projects : []).find((p) => p.latestRunId)?.latestRunId;
if (!runId) throw new Error('no demo run');

await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
await wait(8000);                                   // loader + home
await page.locator('[data-testid=button-watch-how]').click().catch(() => {});
await wait(47000);                                  // explainer video
await page.keyboard.press('Escape');
await wait(1000);

await page.goto(`${base}/results/${runId}`, { waitUntil: 'networkidle' });
await wait(4000);
const prompt = page.locator('[data-testid=button-tour-play]');
if (await prompt.isVisible().catch(() => false)) await prompt.click(); else await page.locator('[data-testid=button-play-tour]').click();
for (let i = 0; i < 60; i++) {                      // full tour
  await wait(3000);
  if (await page.locator('[data-testid=button-tour-done]').isVisible().catch(() => false)) break;
}
await wait(2000);
await page.locator('[data-testid=button-tour-done]').click().catch(() => {});
await wait(1500);

await page.goto(`${base}/fix/${runId}`, { waitUntil: 'networkidle' });
await wait(4000);
await page.locator('[data-testid=link-recorded-fix]').click();
await wait(15000);                                  // first 15 s at 1×
await page.locator('[data-testid=button-speed-4]').click().catch(() => {});
await wait(60000);                                  // 4 minutes of the run at 4×
await page.keyboard.press('End');
await wait(6000);                                   // end card
await page.locator('[data-testid=button-outcome-exit]').click().catch(() => {});
await wait(7000);                                   // lights to green
await page.goto(`${base}/how-it-checks`, { waitUntil: 'networkidle' });
await wait(6000);

const video = page.video();
await context.close();
const file = await video.path();
await fs.rename(file, path.join(out, 'greenlight-backup.webm'));
await browser.close();
console.log('wrote', path.join(out, 'greenlight-backup.webm'));
