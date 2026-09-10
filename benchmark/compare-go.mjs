#!/usr/bin/env node
// Joins go-wormie.json + go-cp.json, writes results/report-go.md.
// Reports set-level agreement as recovered/added counts, which is how the
// manuscript phrases it, rather than as precision and recall.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.join(here, 'results');
const w = JSON.parse(fs.readFileSync(path.join(resultsDir, 'go-wormie.json'), 'utf8'));
const c = JSON.parse(fs.readFileSync(path.join(resultsDir, 'go-cp.json'), 'utf8'));

const finite = (x) => typeof x === 'number' && Number.isFinite(x);
function pearson(pairs) {
  const n = pairs.length;
  if (n < 2) return NaN;
  let mx = 0,
    my = 0;
  for (const [x, y] of pairs) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}
function spearman(pairs) {
  const rank = (vals) => {
    const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(vals.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(pairs.map((p) => p[0]));
  const ry = rank(pairs.map((p) => p[1]));
  return pearson(rx.map((v, i) => [v, ry[i]]));
}
const fmt = (x, d = 4) => (finite(x) ? x.toFixed(d) : 'n/a');

const wMap = new Map(w.results.map((r) => [r.term_id, r]));
const cMap = new Map(c.results.map((r) => [r.term_id, r]));
const shared = [...wMap.keys()].filter((t) => cMap.has(t));

const SIG = 0.05;
const wSig = new Set(w.results.filter((r) => finite(r.q) && r.q < SIG).map((r) => r.term_id));
const cSig = new Set(c.results.filter((r) => finite(r.q) && r.q < SIG).map((r) => r.term_id));
const recovered = [...cSig].filter((t) => wSig.has(t));
const added = [...wSig].filter((t) => !cSig.has(t));
const missed = [...cSig].filter((t) => !wSig.has(t));
const jaccard = recovered.length / (wSig.size + cSig.size - recovered.length);

// Only terms both tested can be compared on the arithmetic itself.
const lp = [];
const kPairs = [];
let kMatch = 0;
let maxKDelta = 0;
for (const t of shared) {
  const a = wMap.get(t),
    b = cMap.get(t);
  if (finite(a.p) && finite(b.p) && a.p > 0 && b.p > 0)
    lp.push([-Math.log10(a.p), -Math.log10(b.p)]);
  kPairs.push([a.k, b.k]);
  if (a.k === b.k) kMatch++;
  maxKDelta = Math.max(maxKDelta, Math.abs(a.k - b.k));
}

// K is the count of background genes propagated onto a term, so agreement on K
// is the direct test of whether the two hierarchies resolve to the same members.
let kkMatch = 0;
let maxKKDelta = 0;
let kkBigger = 0;
let kkSmaller = 0;
for (const t of shared) {
  const a = wMap.get(t),
    b = cMap.get(t);
  if (a.K === b.K) kkMatch++;
  else if (a.K > b.K) kkBigger++;
  else kkSmaller++;
  maxKKDelta = Math.max(maxKKDelta, Math.abs(a.K - b.K));
}

const byNs = (set, map) => {
  const counts = {};
  for (const t of set) {
    const ns = map.get(t)?.namespace ?? '?';
    counts[ns] = (counts[ns] ?? 0) + 1;
  }
  return counts;
};

const L = [];
L.push('# GO over-representation: WormIE vs clusterProfiler::enrichGO', '');
L.push(`WormIE run: ${w.generated} · clusterProfiler run: ${c.generated}`);
L.push(
  `Gene list: \`${w.geneFile}\` (${w.nQuery} genes). ` +
    `WormIE database ${w.dbVersion.version} (GO ${w.dbVersion.sources.go.date}, ${w.dbVersion.sources.wormbase.release}); ` +
    `clusterProfiler ${c.clusterProfilerVersion}, org.Ce.eg.db ${c.orgDbVersion}, GO.db ${c.goDbVersion}.`,
);
L.push('');
L.push('## Universe', '');
// Both tools scope the hypergeometric to one GO aspect at a time, so the
// universe is only meaningful per aspect.
const perAspect = (rs) => {
  const m = {};
  for (const r of rs) if (r.namespace && !m[r.namespace]) m[r.namespace] = { n: r.n, N: r.N };
  return m;
};
const wA = perAspect(w.results);
const cA = perAspect(c.results);
L.push('| aspect | WormIE query / background | clusterProfiler query / background |');
L.push('|---|---|---|');
for (const ns of ['BP', 'MF', 'CC']) {
  const a = wA[ns];
  const b = cA[ns];
  L.push(`| ${ns} | ${a ? `${a.n} / ${a.N}` : 'n/a'} | ${b ? `${b.n} / ${b.N}` : 'n/a'} |`);
}
L.push('');
L.push(
  `Gene pool before aspect scoping: ${w.nBackground} (WormIE) vs ${c.nBackgroundMapped} genes ` +
    `org.Ce.eg.db can map. GO terms tested: ${w.results.length} vs ${c.results.length}, ` +
    `${shared.length} by both.`,
);
L.push('');
L.push('## Set-level agreement at q < 0.05', '');
L.push(
  `- clusterProfiler calls **${cSig.size}** terms significant; WormIE calls **${wSig.size}**.`,
);
L.push(
  `- WormIE **recovers ${recovered.length} of clusterProfiler's ${cSig.size}** significant terms ` +
    `while adding **${added.length}** that clusterProfiler does not call.`,
);
L.push(`- Misses: ${missed.length}. Jaccard: ${fmt(jaccard, 3)}.`);
L.push(`- Recovered by aspect: ${JSON.stringify(byNs(recovered, cMap))}.`);
L.push(`- Added by aspect: ${JSON.stringify(byNs(added, wMap))}.`);
L.push(`- Missed by aspect: ${JSON.stringify(byNs(missed, cMap))}.`);
L.push('');
L.push('## Term-level agreement on the terms both tested', '');
L.push(`- -log10(p) Pearson r: **${fmt(pearson(lp))}** (n = ${lp.length}).`);
L.push(`- -log10(p) Spearman rho: **${fmt(spearman(lp))}**.`);
L.push(`- Query hits k identical: **${kMatch}/${shared.length}**; max |dk| = ${maxKDelta}.`);
L.push(
  `- Background members K identical: **${kkMatch}/${shared.length}**; max |dK| = ${maxKKDelta}.`,
);
L.push(
  `- Where K differs, WormIE is larger on ${kkBigger} terms and smaller on ${kkSmaller}, ` +
    'so the two snapshots disagree in both directions rather than one being a subset of the other.',
);
L.push(
  `- The two universes differ by ${Math.abs(w.nBackground - c.nBackgroundMapped)} genes ` +
    `(N = ${w.nBackground} vs ${c.nBackgroundMapped}), so identical p values are not expected ` +
    'even where the members agree. The hypergeometric arithmetic itself is checked against ' +
    '`phyper` in the main report.',
);
L.push('');
L.push('## Largest disagreements by p-value rank', '');
L.push('| GO | aspect | name | WormIE k/K | cP k/K | WormIE q | cP q |');
L.push('|---|---|---|---|---|---|---|');
const disagree = [...new Set([...added, ...missed])]
  .map((t) => ({ t, w: wMap.get(t), c: cMap.get(t) }))
  .sort((a, b) => Math.min(a.w?.q ?? 1, a.c?.q ?? 1) - Math.min(b.w?.q ?? 1, b.c?.q ?? 1))
  .slice(0, 15);
for (const d of disagree) {
  L.push(
    `| ${d.t} | ${d.w?.namespace ?? d.c?.namespace ?? '?'} | ${(d.w?.name ?? d.c?.name ?? '').slice(0, 44)} | ` +
      `${d.w ? `${d.w.k}/${d.w.K}` : 'not tested'} | ${d.c ? `${d.c.k}/${d.c.K}` : 'not tested'} | ` +
      `${d.w ? d.w.q.toExponential(2) : 'n/a'} | ${d.c ? d.c.q.toExponential(2) : 'n/a'} |`,
  );
}
L.push('');
L.push('## Timing', '');
L.push(
  `WormIE ${Math.round(w.elapsedMs)} ms, clusterProfiler ${Math.round(c.elapsedMs)} ms (single run, not repeated).`,
);
L.push('');

const report = L.join('\n') + '\n';
fs.writeFileSync(path.join(resultsDir, 'report-go.md'), report);
console.log(report);
console.log('==> wrote benchmark/results/report-go.md');
