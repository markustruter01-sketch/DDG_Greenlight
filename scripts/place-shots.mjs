// One-off: one place on the live God's Eye View, waited on until the 3D tiles
// have loaded, then an asset near the middle clicked so its panel opens.
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const [out, query, slug] = process.argv.slice(2);
await fs.mkdir(out, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const snap = async (name) => { try { await page.screenshot({ path: `${out}/${slug}-${name}.jpg`, type: 'jpeg', quality: 92, timeout: 120000 }); log('shot', name); } catch (e) { log('fail', name, e.message.slice(0, 200)); } };
const loaded = () => page.evaluate(() => { const g = window.__godsEyeView; if (!g) return false; g.requestRender?.('shots'); return !!(g.viewer.scene.globe.tilesLoaded && (!g.tileset || g.tileset.tilesLoaded)); }).catch(() => false);
const waitLoaded = async (ms) => { const t = Date.now(); let ok = 0; while (Date.now() - t < ms) { ok = (await loaded()) ? ok + 1 : 0; if (ok >= 3) return true; await page.waitForTimeout(1000); } return false; };
try {
  await page.goto('https://gods-eye-view.replit.app/?nointro', { waitUntil: 'commit', timeout: 120000 });
  await page.waitForFunction(() => !!window.__godsEyeView?.viewer, null, { timeout: 180000 });
  await page.waitForTimeout(15000);
  await page.locator('button[aria-label="Stop the Director"]').click({ timeout: 5000 }).catch(() => log('no stop button'));
  const input = page.locator('input[aria-label="Search a place"]');
  await input.fill(query); await input.press('Enter');
  await page.waitForTimeout(10000);
  log('place loaded', await waitLoaded(300000));
  await page.waitForTimeout(3000);
  await snap('a-place');
  // Find something pickable (aircraft, ship, camera) nearest the middle and click it.
  const hit = await page.evaluate(() => {
    const s = window.__godsEyeView.viewer.scene; const W = s.canvas.clientWidth, H = s.canvas.clientHeight; const found = [];
    for (let y = 120; y < H - 120; y += 24) for (let x = 120; x < W - 120; x += 24) {
      let p; try { p = s.pick({ x, y }); } catch { p = null; }
      if (p && (p.id || p.primitive?.id)) { const id = p.id?.id ?? p.id ?? p.primitive?.id; found.push({ x, y, d: Math.hypot(x - W / 2, y - H / 2), id: String(typeof id === 'object' ? (id.id ?? id.name ?? 'obj') : id).slice(0, 60) }); }
    }
    found.sort((a, b) => a.d - b.d); return found.slice(0, 8);
  });
  log('pickable', JSON.stringify(hit));
  const target = hit.find((h) => !/tile|globe|terrain/i.test(h.id)) ?? hit[0];
  if (target) {
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(8000);
    log('after click loaded', await waitLoaded(240000));
    await page.waitForTimeout(3000);
    await snap('b-asset');
    await page.waitForTimeout(20000);
    await snap('c-asset-later');
  }
} catch (e) { log('error', e.message.slice(0, 300)); }
await browser.close();
