// One-off: clean, fully loaded screenshots of both live sites for the deck.
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const out = process.argv[2];
await fs.mkdir(out, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const snap = async (page, name) => { try { await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 92, timeout: 90000 }); log('shot', name); } catch (e) { log('fail', name, e.message.slice(0, 200)); } };
const step = async (name, fn) => { try { await fn(); } catch (e) { log('step failed', name, e.message.slice(0, 300)); } };

// ── Greenlight ────────────────────────────────────────────────────────────
await step('greenlight', async () => {
  const gl = 'https://ddg-greenlight.replit.app';
  const projects = await (await fetch(`${gl}/api/greenlight/projects`)).json();
  const runId = projects.find((p) => p.latestRunId)?.latestRunId;
  log('run', runId);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('ddg-pip-off', '1'); localStorage.setItem('ddg-greenlight-results-tour-seen', '1'); sessionStorage.setItem('ddg-orbit-moved', '1'); } catch {} });
  const page = await ctx.newPage();
  await page.goto(`${gl}/`, { waitUntil: 'networkidle' }); await page.waitForTimeout(9000); await snap(page, 'gl-home');
  await page.goto(`${gl}/results/${runId}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(4000); await snap(page, 'gl-results');
  await page.goto(`${gl}/orbit/${runId}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(7000); await snap(page, 'gl-orbit');
  await page.goto(`${gl}/plan/${runId}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(3000); await snap(page, 'gl-plan');
  await page.locator('[data-testid=link-recorded-fix]').click();
  await page.waitForTimeout(15000); await snap(page, 'gl-replay-15s');
  const bb = await page.locator('[data-testid=progress-track]').boundingBox();
  for (const f of [0.45, 0.6, 0.75, 0.88]) { await page.mouse.click(bb.x + bb.width * f, bb.y + bb.height / 2); await page.waitForTimeout(2500); await snap(page, `gl-replay-${Math.round(f * 100)}`); }
  await page.goto(`${gl}/verified/${runId}?after=gev-wave1,gev-wave2,gev-wave3`, { waitUntil: 'networkidle' }); await page.waitForTimeout(5000); await snap(page, 'gl-proof');
  await page.goto(`${gl}/signoff/${runId}?after=gev-wave1,gev-wave2,gev-wave3`, { waitUntil: 'networkidle' }); await page.waitForTimeout(5000); await snap(page, 'gl-done');
  await ctx.close();
});

// ── God's Eye View ────────────────────────────────────────────────────────
await step('gev', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.goto('https://gods-eye-view.replit.app/?nointro', { waitUntil: 'commit', timeout: 120000 });
  await page.waitForFunction(() => !!window.__godsEyeView?.viewer, null, { timeout: 180000 });
  log('viewer up');
  const tune = () => page.evaluate(() => { const g = window.__godsEyeView; try { g.viewer.scene.globe.maximumScreenSpaceError = 1.5; if (g.tileset) g.tileset.maximumScreenSpaceError = 4; } catch {} });
  await tune();
  const loaded = () => page.evaluate(() => { const g = window.__godsEyeView; if (!g) return false; g.requestRender?.('shots'); return !!(g.viewer.scene.globe.tilesLoaded && (!g.tileset || g.tileset.tilesLoaded)); }).catch(() => false);
  const waitLoaded = async (ms) => { const t = Date.now(); let ok = 0; while (Date.now() - t < ms) { ok = (await loaded()) ? ok + 1 : 0; if (ok >= 3) return true; await page.waitForTimeout(1000); } return false; };
  const level = () => page.evaluate(() => (document.querySelector('.gev-tour, [class*="tour"]')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)).catch(() => '');

  // Phase 1: the Director tour; a shot whenever a scene is fully loaded and new.
  let n = 0, lastLevel = '', lastAt = 0; const t0 = Date.now();
  while (Date.now() - t0 < 7 * 60000) {
    await page.waitForTimeout(1000);
    if (!(await loaded())) continue;
    const lv = await level();
    if (lv !== lastLevel || Date.now() - lastAt > 15000) {
      if (!(await waitLoaded(4000))) continue;
      await snap(page, `gev-dir-${String(++n).padStart(2, '0')}`); log('  level', lv); lastLevel = lv; lastAt = Date.now();
    }
  }
  // Phase 2: stop the Director, then daylight places with 3D tiles loaded.
  await page.locator('button[aria-label="Stop the Director"]').click({ timeout: 5000 }).catch(() => log('no stop button'));
  await page.waitForTimeout(2000);
  for (const q of ['Heathrow Airport', 'Port of Rotterdam', 'Dubai International Airport', 'Frankfurt Airport', 'Eiffel Tower Paris', 'Sydney Harbour Bridge']) {
    await step(q, async () => {
      const input = page.locator('input[aria-label="Search a place"]');
      await input.fill(q); await input.press('Enter');
      await page.waitForTimeout(9000); await tune();
      const ok = await waitLoaded(150000); log(q, 'loaded', ok);
      await page.waitForTimeout(2500);
      await snap(page, `gev-place-${q.toLowerCase().replace(/[^a-z]+/g, '-')}`);
    });
  }
  await ctx.close();
});
await browser.close();
