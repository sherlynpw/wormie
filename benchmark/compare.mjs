#!/usr/bin/env node
// Joins browser.json + r.json, computes concordance and timing, writes results/report.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.join(here, 'results');
const browser = JSON.parse(fs.readFileSync(path.join(resultsDir, 'browser.json'), 'utf8'));
const r = JSON.parse(fs.readFileSync(path.join(resultsDir, 'r.json'), 'utf8'));

const finite = (x) => typeof x === 'number' && Number.isFinite(x);

function pearson(pairs) {
  const n = pairs.length;
  if (n < 2) return NaN;
  let mx = 0;
  let my = 0;
  for (const [x, y] of pairs) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}
function stat(xs) {
  const v = xs.filter(finite);
  if (!v.length) return { mean: NaN, sd: NaN, median: NaN };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : 0;
  const s = [...v].sort((a, b) => a - b);
  return { mean, sd, median: s[Math.floor(s.length / 2)] };
}
function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const uni = sa.size + sb.size - inter;
  return uni === 0 ? 1 : inter / uni;
}
const fmt = (x, d = 4) => (finite(x) ? x.toFixed(d) : 'n/a');
const secPM = (xs) => {
  const s = stat(xs);
  return `${fmt(s.mean / 1000, 1)} ± ${fmt(s.sd / 1000, 2)}`;
};
const msPM = (xs) => {
  const s = stat(xs);
  return `${fmt(s.mean, 0)} ± ${fmt(s.sd, 1)}`;
};

const lines = ['# Benchmark report: browser/WASM vs native R', ''];
lines.push(`Browser run: ${browser.generated} · R run: ${r.generated}`);
lines.push(`Repeats: browser ${browser.repeats}, R ${r.repeats}. Timing as mean ± sd.`, '');

lines.push('## DESeq2', '');
lines.push(
  '| Tier | R (s) | Browser warm (s) | Cold run 0 (s) | log2FC corr | padj corr | sign flips (padj<0.05) | max abs Δlog2FC |',
);
lines.push('|---|---|---|---|---|---|---|---|');
for (const b of browser.deseq2 || []) {
  const rc = (r.deseq2 || []).find((x) => x.label === b.label);
  if (!rc) continue;
  const warm = b.runs.filter((x) => !x.cold).map((x) => x.elapsedMs);
  const cold = b.runs.find((x) => x.cold)?.elapsedMs;
  const rRows = new Map(rc.rows.map((x) => [x.gene, x]));
  const lfc = [];
  const padj = [];
  let flips = 0;
  let maxd = 0;
  for (const cr of b.contrasts[0].rows) {
    const rr = rRows.get(cr.gene);
    if (!rr) continue;
    if (finite(cr.log2FoldChange) && finite(rr.log2FoldChange)) {
      lfc.push([cr.log2FoldChange, rr.log2FoldChange]);
      maxd = Math.max(maxd, Math.abs(cr.log2FoldChange - rr.log2FoldChange));
    }
    if (finite(cr.padj) && finite(rr.padj)) {
      padj.push([cr.padj, rr.padj]);
      if (rr.padj < 0.05 && Math.sign(cr.log2FoldChange) !== Math.sign(rr.log2FoldChange)) flips++;
    }
  }
  lines.push(
    `| ${b.label} | ${secPM(rc.msAll)} | ${secPM(warm)} | ${fmt((cold ?? NaN) / 1000, 1)} | ` +
      `${fmt(pearson(lfc))} | ${fmt(pearson(padj))} | ${flips} | ${fmt(maxd)} |`,
  );
}
lines.push('');

lines.push('## GSEA (preranked)', '');
lines.push('| universe | nSets | R (ms) | Browser (ms) | slowdown | NES corr | sig-set Jaccard (q<0.05) |');
lines.push('|---|---|---|---|---|---|---|');
for (const b of browser.gsea || []) {
  const rc = (r.gsea || []).find((x) => x.universe === b.universe && x.nSets === b.nSets);
  if (!rc) continue;
  const rMap = new Map(rc.results.map((x) => [x.term_id, x]));
  const nes = [];
  for (const br of b.results) {
    const rr = rMap.get(br.term_id);
    if (rr && finite(br.nes) && finite(rr.nes)) nes.push([br.nes, rr.nes]);
  }
  const bSig = b.results.filter((x) => finite(x.q) && x.q < 0.05).map((x) => x.term_id);
  const rSig = rc.results.filter((x) => finite(x.q) && x.q < 0.05).map((x) => x.term_id);
  const slowdown = stat(b.engineMsAll).mean / stat(rc.msAll).mean;
  lines.push(
    `| ${b.universe} | ${b.nSets} | ${msPM(rc.msAll)} | ${msPM(b.engineMsAll)} | ` +
      `${fmt(slowdown, 2)}x | ${fmt(pearson(nes))} | ${fmt(jaccard(bSig, rSig), 3)} |`,
  );
}
lines.push('');

lines.push('## ORA (hypergeometric)', '');
lines.push('| universe | nSets | querySize | R (ms) | Browser (ms) | slowdown | -log10(p) corr | k exact-match |');
lines.push('|---|---|---|---|---|---|---|---|');
for (const b of browser.ora || []) {
  const rc = (r.ora || []).find(
    (x) => x.universe === b.universe && x.nSets === b.nSets && x.querySize === b.querySize,
  );
  if (!rc) continue;
  const rMap = new Map(rc.results.map((x) => [x.term_id, x]));
  const lp = [];
  let kTotal = 0;
  let kMatch = 0;
  for (const br of b.results) {
    const rr = rMap.get(br.term_id);
    if (!rr) continue;
    if (finite(br.p) && finite(rr.p) && br.p > 0 && rr.p > 0) {
      lp.push([-Math.log10(br.p), -Math.log10(rr.p)]);
    }
    kTotal++;
    if (br.k === rr.k) kMatch++;
  }
  const slowdown = stat(b.engineMsAll).mean / stat(rc.msAll).mean;
  lines.push(
    `| ${b.universe} | ${b.nSets} | ${b.querySize} | ${msPM(rc.msAll)} | ${msPM(b.engineMsAll)} | ` +
      `${fmt(slowdown, 2)}x | ${fmt(pearson(lp))} | ${kMatch}/${kTotal} |`,
  );
}
lines.push('');

lines.push('## ssGSEA', '');
if (browser.ssgsea?.length) {
  lines.push(
    '| universe | nSets | nSamples | R (ms) | Browser (ms) | slowdown | score corr | max abs Δ |',
  );
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const b of browser.ssgsea) {
    const rc = (r.ssgsea || []).find((x) => x.universe === b.universe && x.nSets === b.nSets);
    if (!rc) continue;
    const rMap = new Map(rc.scores.map((x) => [x.term_id, x.values]));
    const pairs = [];
    let maxd = 0;
    for (const br of b.results || []) {
      const rv = rMap.get(br.term_id);
      if (!rv) continue;
      for (let i = 0; i < br.scores.length && i < rv.length; i++) {
        if (finite(br.scores[i]) && finite(rv[i])) {
          pairs.push([br.scores[i], rv[i]]);
          maxd = Math.max(maxd, Math.abs(br.scores[i] - rv[i]));
        }
      }
    }
    const slowdown = stat(b.engineMsAll).mean / stat(rc.msAll ?? [rc.elapsedMs]).mean;
    lines.push(
      `| ${b.universe} | ${b.nSets} | ${b.nSamples} | ${msPM(rc.msAll ?? [rc.elapsedMs])} | ` +
        `${msPM(b.engineMsAll)} | ${fmt(slowdown, 2)}x | ${fmt(pearson(pairs))} | ${fmt(maxd)} |`,
    );
  }
} else if (r.ssgsea?.length) {
  lines.push('R-only (browser arm did not run):', '');
  lines.push('| universe | nSets | nSamples | R (ms) |');
  lines.push('|---|---|---|---|');
  for (const s of r.ssgsea) {
    lines.push(`| ${s.universe} | ${s.nSets} | ${s.nSamples} | ${msPM(s.msAll ?? [s.elapsedMs])} |`);
  }
} else {
  lines.push('No ssGSEA results.');
}
lines.push('');

const report = lines.join('\n') + '\n';
fs.writeFileSync(path.join(resultsDir, 'report.md'), report);
console.log(report);
console.log('==> wrote benchmark/results/report.md');
