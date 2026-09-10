#!/usr/bin/env node
// Measures WebR startup: the cost the gene-set reimplementation avoids.
// Three settings, because they are what a user actually pays:
//   cold  - first visit, empty OPFS: bundle fetched, WebR booted, DESeq2 loaded
//   warm  - return visit, bundle served from OPFS
//   extra - one more pool instance in a page that already has one
// Writes benchmark/results/startup.json.
//   node benchmark/bench-startup.mjs [--repeats N]

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostInfo } from './host.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const resultsDir = path.join(here, 'results');
fs.mkdirSync(resultsDir, { recursive: true });

const args = process.argv.slice(2);
const repeats = Number(args[args.indexOf('--repeats') + 1]) || 3;

console.log('==> starting vite dev server ...');
const vite = spawn('bun', ['run', 'dev'], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('vite did not start in 30s')), 30_000);
  const onData = (chunk) => {
    const m = chunk.toString().match(/Local:\s+http:\/\/[^:]+:(\d+)/);
    if (m) {
      clearTimeout(timer);
      resolve(Number(m[1]));
    }
  };
  vite.stdout.on('data', onData);
  vite.stderr.on('data', onData);
  vite.on('exit', (c) => reject(new Error(`vite exited ${c}`)));
});
console.log(`==> vite on :${port}`);
const cleanup = () => {
  try {
    vite.kill('SIGTERM');
  } catch {
    /* */
  }
};
process.on('exit', cleanup);

const browser = await chromium.launch({
  executablePath: fs.existsSync('/usr/sbin/chromium') ? '/usr/sbin/chromium' : undefined,
  headless: true,
  args: ['--no-sandbox'],
});

const bundleBytes = (() => {
  try {
    return fs.statSync(path.join(repoRoot, 'scripts/wasm-cran/deseq2-bundle.data')).size;
  } catch {
    return null;
  }
})();

const out = {
  generated: new Date().toISOString(),
  repeats,
  host: hostInfo(),
  browser: browser.version(),
  bundleBytes,
  // Dev serves the bundle from local disk, so the fetch leg is a lower bound on
  // what a real visitor pays; the boot and library legs are compute-bound.
  bundleServedFrom: 'localhost (vite)',
  runs: [],
};

async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[page-error] ${e?.message || e}`));
  await page.goto(`http://localhost:${port}/de`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__bench !== 'undefined', { timeout: 30_000 });
  return page;
}

try {
  for (let i = 0; i < repeats; i++) {
    // A fresh context starts with empty OPFS, which is exactly a first visit.
    const ctx = await browser.newContext();
    const page = await newPage(ctx);
    console.log(`-- rep ${i}: cold instance + 1 extra ...`);
    const cold = await page.evaluate(() => window.__bench.webrStartup({ extraInstances: 1 }));

    // Same context, new page: OPFS now holds the bundle, so this is a return visit.
    await page.close();
    const page2 = await newPage(ctx);
    console.log(`-- rep ${i}: warm instance ...`);
    const warm = await page2.evaluate(() => window.__bench.webrStartup({ extraInstances: 0 }));
    await ctx.close();

    out.runs.push({
      rep: i,
      cold: cold.first,
      extra: cold.extra[0],
      warm: warm.first,
      hardwareConcurrency: cold.hardwareConcurrency,
    });
    fs.writeFileSync(path.join(resultsDir, 'startup.json'), JSON.stringify(out, null, 2));
    const s = (x) => (x.totalMs / 1000).toFixed(1);
    console.log(
      `   cold ${s(cold.first)}s (bundle cached=${cold.first.bundleCached}), ` +
        `extra ${s(cold.extra[0])}s, warm ${s(warm.first)}s`,
    );
  }
  await browser.close();
} finally {
  cleanup();
  fs.writeFileSync(path.join(resultsDir, 'startup.json'), JSON.stringify(out, null, 2));
}
console.log('==> wrote benchmark/results/startup.json');
