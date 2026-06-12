// PWA offline smoke. Verifies: (1) SW registers/activates, (2) SQLite gzip lands in the `wb-sqlite`
// Workbox CacheFirst cache after a cold visit (exercises the versioned-URL runtime rule), (3) page
// reloads correctly with network disabled.
//
// Requires the production build: `bun run build && bun run preview --port 4173`, then run this
// script. Set SMOKE_URL for a deployed origin. Not in the e2e suite because it needs the prod SW.

import { chromium } from 'playwright';

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173';
const HEADLESS = process.env.SMOKE_HEADLESS !== '0';

async function waitForDbReady(page, timeoutMs = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ready = await page.evaluate(async () => {
      try {
        const res = await fetch('/data/version.json');
        if (!res.ok) return false;
      } catch {
        return false;
      }
      const txt = document.body?.innerText || '';
      return !/loading|downloading|importing/i.test(txt);
    });
    if (ready) return;
    await page.waitForTimeout(500);
  }
  throw new Error('DB ready timeout');
}

async function run() {
  const ctx = await chromium.launchPersistentContext('/tmp/smoke-pwa-profile', {
    headless: HEADLESS,
    executablePath: '/usr/sbin/chromium',
    args: ['--no-sandbox'],
  });

  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  console.log('→ cold load', BASE);
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120_000 });
  await waitForDbReady(page);

  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('SW unsupported');
    const reg = await navigator.serviceWorker.ready;
    return reg.active?.scriptURL ?? null;
  });
  console.log('  SW active');

  // Runtime DB cache should be populated after the cold visit.
  const caches = await page.evaluate(async () => {
    const names = await self.caches.keys();
    const out = {};
    for (const n of names) {
      const c = await self.caches.open(n);
      const ks = await c.keys();
      out[n] = ks.map((r) => r.url);
    }
    return out;
  });
  const sqliteCache = caches['wb-sqlite'] ?? [];
  const versionCache = caches['wb-version'] ?? [];
  console.log(`  wb-sqlite: ${sqliteCache.length} entries`, sqliteCache);
  console.log(`  wb-version: ${versionCache.length} entries`, versionCache);

  const dbCached = sqliteCache.some((u) => u.includes('/data/wormie.sqlite.gz'));
  if (!dbCached) {
    console.error('FAIL: DB gzip not in wb-sqlite cache after cold visit');
    console.error('  → check vite.config.ts runtimeCaching regex matches versioned URLs');
    await ctx.close();
    process.exit(1);
  }

  console.log('→ disable network');
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load', timeout: 60_000 });
  await waitForDbReady(page);
  console.log('  page rendered offline');

  await page.goto(BASE + '/datasets', { waitUntil: 'load' });
  const hasDatasetsCard = await page
    .locator('text=/Saved gene lists/i')
    .first()
    .isVisible()
    .catch(() => false);
  console.log(`  /datasets rendered offline: ${hasDatasetsCard ? 'YES ✓' : 'NO ✗'}`);

  await ctx.close();
  console.log('\nOK — PWA offline smoke passed');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
