#!/usr/bin/env node
// Browser benchmark: spawns dev server, drives compute engines via window.__bench,
// writes benchmark/results/browser.json (checkpointed after each case).
//   node benchmark/bench-browser.mjs [--repeats N] [--deseq-repeats N] [--only deseq2,gsea,ora]

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const dataDir = path.join(here, 'data');
const resultsDir = path.join(here, 'results');
fs.mkdirSync(resultsDir, { recursive: true });

const args = process.argv.slice(2);
const repeats = Number(args[args.indexOf('--repeats') + 1]) || 10;
const deseqRepeats = Number(args[args.indexOf('--deseq-repeats') + 1]) || 3;
const onlyArg = args.indexOf('--only') >= 0 ? args[args.indexOf('--only') + 1].split(',') : null;
const want = (name) => !onlyArg || onlyArg.includes(name);
const sizeFilter = args.indexOf('--size') >= 0 ? args[args.indexOf('--size') + 1].split(',') : null;

const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'manifest.json'), 'utf8'));
const read = (rel) => fs.readFileSync(path.join(dataDir, rel), 'utf8');

const parseGmt = (text) =>
  text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      const f = l.split('\t');
      return { term_id: f[0], name: f[1] || f[0], genes: f.slice(2) };
    });
const parseRanked = (text) =>
  text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      const [gene, score] = l.split('\t');
      return { gene, score: Number(score) };
    });
const parseDesign = (text) =>
  text
    .split('\n')
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => {
      const [sample, condition] = l.split('\t');
      return { sample, condition };
    });
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

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
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

const out = {
  generated: new Date().toISOString(),
  repeats,
  deseqRepeats,
  deseq2: [],
  gsea: [],
  gsea_ml: [],
  ora: [],
  ssgsea: [],
};

function parseExprTsv(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  const samples = lines[0].split('\t').slice(1);
  const genes = [];
  const matrix = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split('\t');
    genes.push(f[0]);
    for (let j = 1; j < f.length; j++) matrix.push(Number(f[j]));
  }
  return { genes, samples, matrix };
}
const outPath = path.join(resultsDir, 'browser.json');
// Preserve pipelines not selected by --only so partial runs don't wipe existing results.
if (fs.existsSync(outPath)) {
  try {
    const prev = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    for (const k of ['deseq2', 'gsea', 'gsea_ml', 'ora', 'ssgsea']) {
      const arm = k === 'gsea_ml' ? 'gsea' : k;
      if (!want(arm) && Array.isArray(prev[k])) out[k] = prev[k];
    }
  } catch {
    /* ignore unreadable prior results */
  }
}
const save = () => fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ||
    (fs.existsSync('/usr/sbin/chromium') ? '/usr/sbin/chromium' : undefined),
  headless: true,
  args: ['--no-sandbox'],
});

// Shared context so the ~111 MB DB imports once across all pipelines.
let sharedPage = null;
async function freshPage() {
  if (sharedPage) return sharedPage;
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem('wb.tour.complete', '1');
    localStorage.setItem('wb.hints.v2', JSON.stringify({ dismissed: [], allOff: true }));
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[page-error] ${e?.message || e}`));
  await page.goto(`http://localhost:${port}/enrichment`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__bench !== 'undefined', { timeout: 30_000 });
  sharedPage = { ctx, page };
  return sharedPage;
}

try {
  if (want('deseq2')) {
    const { page } = await freshPage();
    console.log(`==> deseq2 (page ready) · ${deseqRepeats} repeats`);
    for (const c of manifest.deseq2) {
      if (sizeFilter && !sizeFilter.includes(c.label)) continue;
      const countsTsv = read(c.counts);
      const design = parseDesign(read(c.design));
      console.log(`-- deseq2 ${c.label} (${c.nGenes}x${c.nSamples})`);
      const runs = [];
      let last;
      for (let i = 0; i < deseqRepeats; i++) {
        try {
          last = await page.evaluate(
            async ({ countsTsv, design, reference }) =>
              window.__bench.deseq2core({ countsTsv, design, reference }),
            { countsTsv, design, reference: c.reference },
          );
          runs.push({ cold: i === 0, elapsedMs: last.elapsedMs });
          console.log(
            `   run ${i}${i === 0 ? ' (cold)' : ''}: ${(last.elapsedMs / 1000).toFixed(1)}s`,
          );
        } catch (e) {
          console.error(`   run ${i} FAILED: ${e?.message || e}`);
        }
      }
      out.deseq2.push({
        label: c.label,
        nGenes: c.nGenes,
        nSamples: c.nSamples,
        runs,
        memBytes: last?.memBytes,
        contrasts: last?.contrasts,
      });
      save();
    }
  }

  if (want('gsea')) {
    const { page } = await freshPage();
    console.log(`==> gsea (fresh page) · ${repeats} repeats`);
    for (const g of manifest.gsea) {
      const ranked = parseRanked(read(g.ranked));
      const sets = parseGmt(read(g.gmt));
      const times = [];
      let last;
      for (let i = 0; i < repeats; i++) {
        try {
          last = await page.evaluate(
            // multilevel: false and sizes 1-100000 match bench-r.R's fgseaSimple call.
            async ({ ranked, sets, nperm }) =>
              window.__bench.gsea({
                ranked,
                sets,
                opts: { nperm, seed: 1337, multilevel: false, minSize: 1, maxSize: 100000 },
              }),
            { ranked, sets, nperm: g.nperm },
          );
          times.push(last.engineMs);
        } catch (e) {
          console.error(`   gsea run ${i} FAILED: ${e?.message || e}`);
        }
      }
      out.gsea.push({
        universe: g.universe,
        nSets: g.nSets,
        nperm: g.nperm,
        engineMsMedian: median(times),
        engineMsAll: times,
        memBytes: last?.memBytes,
        results: last?.results,
      });
      console.log(`-- gsea u${g.universe} n${g.nSets}: ${median(times).toFixed(0)}ms`);
      save();

      // Multilevel arm, against bench-r.R's fgseaMultilevel(eps = 0).
      const mlTimes = [];
      let ml;
      for (let i = 0; i < Math.min(repeats, 3); i++) {
        try {
          ml = await page.evaluate(
            async ({ ranked, sets, nperm }) =>
              window.__bench.gsea({
                ranked,
                sets,
                opts: { nperm, seed: 1337, multilevel: true, minSize: 1, maxSize: 100000 },
              }),
            { ranked, sets, nperm: g.nperm },
          );
          mlTimes.push(ml.engineMs);
        } catch (e) {
          console.error(`   gsea multilevel run ${i} FAILED: ${e?.message || e}`);
        }
      }
      out.gsea_ml.push({
        universe: g.universe,
        nSets: g.nSets,
        nperm: g.nperm,
        engineMsMedian: median(mlTimes),
        engineMsAll: mlTimes,
        results: ml?.results,
      });
      console.log(`-- gsea multilevel u${g.universe} n${g.nSets}: ${median(mlTimes).toFixed(0)}ms`);
      save();
    }
  }

  if (want('ssgsea')) {
    const { page } = await freshPage();
    console.log(`==> ssgsea (fresh page) · ${repeats} repeats`);
    for (const s of manifest.ssgsea) {
      const expr = parseExprTsv(read(s.expr));
      const sets = parseGmt(read(s.gmt));
      const times = [];
      let last;
      for (let i = 0; i < repeats; i++) {
        try {
          last = await page.evaluate(
            async ({ expr, sets }) => window.__bench.ssgsea({ expr, sets }),
            { expr, sets },
          );
          times.push(last.engineMs);
        } catch (e) {
          console.error(`   ssgsea run ${i} FAILED: ${e?.message || e}`);
        }
      }
      out.ssgsea.push({
        universe: s.universe,
        nSets: s.nSets,
        nSamples: s.nSamples,
        engineMsMedian: median(times),
        engineMsAll: times,
        memBytes: last?.memBytes,
        sampleNames: last?.sampleNames,
        results: last?.results,
      });
      console.log(`-- ssgsea u${s.universe} n${s.nSets}: ${median(times).toFixed(0)}ms`);
      save();
    }
  }

  if (want('ora')) {
    const { page } = await freshPage();
    console.log(`==> ora (fresh page) · ${repeats} repeats`);
    for (const o of manifest.ora) {
      const ids = read(o.query).split('\n').filter(Boolean);
      const sets = parseGmt(read(o.gmt));
      const times = [];
      let last;
      for (let i = 0; i < repeats; i++) {
        try {
          last = await page.evaluate(
            async ({ ids, sets }) => window.__bench.enrichment({ ids, sets, opts: { minK: 1 } }),
            { ids, sets },
          );
          times.push(last.engineMs);
        } catch (e) {
          console.error(`   ora run ${i} FAILED: ${e?.message || e}`);
        }
      }
      out.ora.push({
        universe: o.universe,
        nSets: o.nSets,
        querySize: o.querySize,
        engineMsMedian: median(times),
        engineMsAll: times,
        memBytes: last?.memBytes,
        results: last?.results,
      });
      console.log(
        `-- ora u${o.universe} n${o.nSets} k${o.querySize}: ${median(times).toFixed(0)}ms`,
      );
      save();
    }
  }

  await browser.close();
} finally {
  cleanup();
  save();
}

console.log('==> wrote benchmark/results/browser.json');
