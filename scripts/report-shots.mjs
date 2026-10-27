// One-off: the Step 7 report page on the live site, top to bottom.
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const out = process.argv[2]; await fs.mkdir(out, { recursive: true });
const b = await chromium.launch();
for (const [w, h, tag] of [[1920, 1080, 'wide'], [1280, 800, 'laptop'], [390, 844, 'phone']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('ddg-pip-off', '1'); } catch {} });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto('https://ddg-greenlight.replit.app/signoff/6eca910c-eaa2-4314-a9f0-005dfe788949?after=gev-wave1,gev-wave2,gev-wave3', { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-testid=screen-done]', { timeout: 30000 }).catch(() => console.log('no report'));
  await p.waitForTimeout(3000);
  const total = await p.evaluate(() => document.querySelector('.rp')?.scrollHeight ?? 0);
  console.log(tag, 'scroll height', total);
  for (let i = 0, y = 0; y < total && i < 14; i++, y += h - 120) {
    await p.evaluate((y) => { const el = document.querySelector('.rp'); if (el) { el.style.scrollBehavior = 'auto'; el.scrollTop = y; } }, y);
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${out}/${tag}-${String(i).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 88 });
  }
  if (tag === 'wide') { await p.evaluate(() => { document.querySelectorAll('details.rp-req')[0]?.setAttribute('open', ''); document.getElementById('rp-5')?.scrollIntoView(); }); await p.waitForTimeout(800); await p.screenshot({ path: `${out}/wide-depth-open.jpg`, type: 'jpeg', quality: 88 }); }
  await ctx.close();
}
await b.close();
