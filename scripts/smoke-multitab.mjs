import { chromium } from 'playwright';

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:5173';
const HEADLESS = process.env.SMOKE_HEADLESS !== '0';

const fmtMB = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';

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

async function totalMem(page) {
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

async function statusBanner(page) {
  return await page.evaluate(() => {
    const t = document.body?.innerText || '';
    const lines = t
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return lines.find((l) => /memory|opfs|offline|loading/i.test(l)) ?? null;
  });
}

async function run() {
  const userDataDir = '/tmp/smoke-multitab-profile';
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: HEADLESS,
    executablePath: '/usr/sbin/chromium',
    args: ['--no-sandbox', '--enable-precise-memory-info'],
  });

  console.log('→ tab 1 (cold, expects OPFS path)');
  const tab1 = await ctx.newPage();
  tab1.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error')
      console.log(`  [tab1:${m.type()}]`, m.text());
  });
  const t1Start = Date.now();
  await tab1.goto(BASE, { waitUntil: 'networkidle', timeout: 120_000 });
  await waitForDbReady(tab1);
  const t1Ready = Date.now() - t1Start;
  const t1Mem = await totalMem(tab1);
  console.log(`  tab1 ready in ${t1Ready} ms, total agent ${fmtMB(t1Mem)}`);

  console.log('→ tab 2 (concurrent, expects memory fallback)');
  const tab2 = await ctx.newPage();
  tab2.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error')
      console.log(`  [tab2:${m.type()}]`, m.text());
  });
  const t2Start = Date.now();
  await tab2.goto(BASE, { waitUntil: 'networkidle', timeout: 120_000 });
  await waitForDbReady(tab2);
  const t2Ready = Date.now() - t2Start;
  const t2Mem = await totalMem(tab2);
  const t2Banner = await statusBanner(tab2);
  console.log(`  tab2 ready in ${t2Ready} ms, total agent ${fmtMB(t2Mem)}`);
  if (t2Banner) console.log(`  tab2 status banner: ${t2Banner}`);

  // Confirm proxy returns real SQL results in the guest tab.
  await tab2.goto(BASE + '/gene/WBGene00006789', { waitUntil: 'networkidle' });
  await tab2.waitForTimeout(2000);
  const t2GeneText = await tab2.evaluate(() => document.body?.innerText?.slice(0, 200) ?? '');
  console.log(`  tab2 gene page text (first 200 chars):`);
  console.log(`    ${t2GeneText.replace(/\n+/g, ' / ').slice(0, 180)}`);

  console.log('→ close tab 1, then tab 3');
  await tab1.close();
  await tab2.waitForTimeout(500);
  const tab3 = await ctx.newPage();
  tab3.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error')
      console.log(`  [tab3:${m.type()}]`, m.text());
  });
  const t3Start = Date.now();
  await tab3.goto(BASE, { waitUntil: 'networkidle', timeout: 120_000 });
  await waitForDbReady(tab3);
  const t3Ready = Date.now() - t3Start;
  const t3Mem = await totalMem(tab3);
  console.log(`  tab3 ready in ${t3Ready} ms, total agent ${fmtMB(t3Mem)}`);

  await ctx.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
