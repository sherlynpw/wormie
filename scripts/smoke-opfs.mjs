import { chromium } from 'playwright';

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173';
const HEADLESS = process.env.SMOKE_HEADLESS !== '0';

function fmtMB(b) {
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

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

async function getJsHeap(page) {
  const c = await page.context().newCDPSession(page);
  const { result } = await c.send('Runtime.evaluate', {
    expression: 'performance.memory ? performance.memory.usedJSHeapSize : 0',
    returnByValue: true,
  });
  return result.value;
}

// Cross-realm total (workers + iframes). Requires cross-origin isolation, exercising COOP/COEP headers.
async function getTotalAgentMemory(page) {
  try {
    return await page.evaluate(async () => {
      if (typeof performance.measureUserAgentSpecificMemory !== 'function') return null;
      const m = await performance.measureUserAgentSpecificMemory();
      return m?.bytes ?? null;
    });
  } catch {
    return null;
  }
}

async function run() {
  const userDataDir = '/tmp/smoke-opfs-profile';
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: HEADLESS,
    executablePath: '/usr/sbin/chromium',
    args: ['--no-sandbox', '--enable-precise-memory-info'],
  });

  // Pass 1: cold start (fresh profile, no OPFS yet).
  try {
    await ctx.clearCookies();
  } catch {
    // fresh profile dir may not have cookies yet; ignore
  }

  const page = await ctx.newPage();
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') console.log(`[browser:${t}]`, m.text());
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  console.log('→ cold load', BASE);
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120_000 });
  await waitForDbReady(page);
  const tCold = Date.now() - t0;
  const heapCold = await getJsHeap(page);
  const totalCold = await getTotalAgentMemory(page);
  console.log(
    `  cold ready in ${tCold} ms, page heap ${fmtMB(heapCold)}` +
      (totalCold ? `, total agent ${fmtMB(totalCold)}` : ''),
  );

  await page.goto(BASE + '/enrichment', { waitUntil: 'networkidle' });
  await waitForDbReady(page);
  const heapAfterNav = await getJsHeap(page);
  console.log(`  after /enrichment nav, JS heap ${fmtMB(heapAfterNav)}`);

  // Pass 2: warm reload, OPFS should be hit (no large download).
  console.log('→ warm reload');
  const t1 = Date.now();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await waitForDbReady(page);
  const tWarm = Date.now() - t1;
  const heapWarm = await getJsHeap(page);
  const totalWarm = await getTotalAgentMemory(page);
  console.log(
    `  warm ready in ${tWarm} ms, page heap ${fmtMB(heapWarm)}` +
      (totalWarm ? `, total agent ${fmtMB(totalWarm)}` : ''),
  );

  const opfs = await page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const entries = [];
      for await (const [name, handle] of root.entries()) {
        if (handle.kind === 'file') {
          const f = await handle.getFile();
          entries.push({ name, size: f.size });
        } else {
          entries.push({ name, kind: 'dir' });
        }
      }
      return entries;
    } catch (e) {
      return { error: String(e) };
    }
  });
  console.log('  OPFS root:', JSON.stringify(opfs));

  await ctx.close();

  const expectWarmFaster = tWarm < tCold;
  console.log('');
  console.log(
    `Result: cold=${tCold}ms heap=${fmtMB(heapCold)} | warm=${tWarm}ms heap=${fmtMB(heapWarm)}`,
  );
  console.log(`Warm faster than cold: ${expectWarmFaster ? 'YES ✓' : 'NO ✗'}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
