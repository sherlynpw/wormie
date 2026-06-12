#!/usr/bin/env node
// Headless smoke for the featureCounts WASM module. Spawns the COOP/COEP Python server,
// attaches BAM + GTF in Chromium, runs featureCounts, prints log + counts table.
// Usage: node scripts/smoke-featurecounts.mjs [bam] [gtf] [threads]
// Defaults: /tmp/tiny.bam + WBcel235 GTF from ../go-kegg.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const BAM = process.argv[2] || '/tmp/tiny.bam';
const GTF = process.argv[3] || '/home/rayandrew/code/uwisc/go-kegg/Caenorhabditis_elegans.WBcel235.115.gtf';
const THREADS = process.argv[4] || '4';

if (!fs.existsSync(BAM)) { console.error(`BAM not found: ${BAM}`); process.exit(2); }
if (!fs.existsSync(GTF)) { console.error(`GTF not found: ${GTF}`); process.exit(2); }

console.log(`==> inputs: BAM=${BAM} (${(fs.statSync(BAM).size/1e6).toFixed(1)} MB), GTF=${GTF} (${(fs.statSync(GTF).size/1e6).toFixed(1)} MB), THREADS=${THREADS}`);

console.log('==> spawning COOP/COEP server on :8765 ...');
const serverProc = spawn('python3', [path.join(repoRoot, 'scripts/webr-serve.py')], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
serverProc.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
serverProc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

// Wait for server to bind
await new Promise((r) => setTimeout(r, 500));

const cleanup = () => {
  try {
    serverProc.kill('SIGTERM');
  } catch {
    /* already dead */
  }
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

try {
  const chromiumExe = fs.existsSync('/usr/sbin/chromium') ? '/usr/sbin/chromium'
                    : fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium'
                    : undefined;
  console.log(`==> launching chromium (${chromiumExe || 'playwright bundle'}) ...`);
  const browser = await chromium.launch({
    executablePath: chromiumExe,
    headless: true,
    args: ['--no-sandbox'],   // for system chromium under playwright
  });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  page.on('console', (msg) => {
    const txt = msg.text();
    if (!txt) return;
    console.log(`[page] ${txt}`);
  });
  page.on('pageerror', (e) => console.error(`[page-error] ${e?.message || e}`));

  console.log('==> opening test page ...');
  await page.goto('http://127.0.0.1:8765/scripts/featurecounts-test.html', { waitUntil: 'domcontentloaded' });

  console.log('==> attaching files ...');
  await page.setInputFiles('#bamFile', BAM);
  await page.setInputFiles('#gtfFile', GTF);
  await page.fill('#threads', THREADS);
  if (process.env.FC_SINGLE_END === '1') {
    await page.uncheck('#paired');
    console.log('==> single-end mode (FC_SINGLE_END=1)');
  }

  console.log('==> clicking Run, waiting for completion (up to 10 min) ...');
  const tStart = Date.now();
  await page.click('#run');

  await page.waitForFunction(() => {
    const logEl = document.getElementById('log');
    if (!logEl) return false;
    return /\[fc\] DONE rc=/.test(logEl.textContent) ||
           /\[fc\] callMain threw/.test(logEl.textContent) ||
           /\[boot\] (import|init).+ failed/.test(logEl.textContent);
  }, { timeout: 10 * 60_000 });

  const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
  console.log(`==> page reported completion in ${elapsed}s`);

  const finalLog = await page.evaluate(() => document.getElementById('log').textContent);
  console.log('==> ===== full page log =====');
  console.log(finalLog);

  await browser.close();
} finally {
  cleanup();
}
