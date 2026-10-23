#!/usr/bin/env node
// Deterministic synthetic-data generator for the WASM-vs-R benchmark (fixed seed, reproducible).
// Commit the generator and manifest, not the generated data.
//   node benchmark/gen-data.mjs [--full]   # --full adds L/XL stress tiers

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, 'data');
const full = process.argv.includes('--full');

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poisson(rand, lambda) {
  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rand();
    } while (p > L);
    return k - 1;
  }
  const u1 = Math.max(rand(), 1e-12);
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rand());
  return Math.max(0, Math.round(lambda + z * Math.sqrt(lambda)));
}
function gauss(rand) {
  const u1 = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rand());
}

const geneId = (i) => `BENCHG${String(i + 1).padStart(6, '0')}`;

function genCounts(label, nGenes, nSamples, seed) {
  const rand = mulberry32(seed);
  const half = nSamples >> 1;
  const samples = Array.from({ length: nSamples }, (_, i) => `s${i + 1}`);
  const conditions = samples.map((_, i) => (i < half ? 'WT' : 'TREAT'));
  const deCount = Math.floor(nGenes * 0.1);
  const lines = [
    '# Program:bench',
    ['Geneid', 'Chr', 'Start', 'End', 'Strand', 'Length', ...samples].join('\t'),
  ];
  for (let g = 0; g < nGenes; g++) {
    const base = Math.exp(2 + gauss(rand) * 1.5) + 5;
    const lfc = g < deCount ? (rand() < 0.5 ? -1 : 1) * (0.8 + rand() * 1.6) : 0;
    const row = [geneId(g), 'I', '1', '1000', '+', '1000'];
    for (let s = 0; s < nSamples; s++) {
      const mu = conditions[s] === 'TREAT' ? base * Math.pow(2, lfc) : base;
      const disp = 0.1 + rand() * 0.2;
      const scaled = mu * (1 + gauss(rand) * Math.sqrt(disp));
      row.push(String(poisson(rand, Math.max(0.01, scaled))));
    }
    lines.push(row.join('\t'));
  }
  const countsPath = path.join(dataDir, 'counts', `counts_${label}.tsv`);
  fs.writeFileSync(countsPath, lines.join('\n') + '\n');
  const designPath = path.join(dataDir, 'counts', `design_${label}.tsv`);
  fs.writeFileSync(
    designPath,
    'sample\tcondition\n' + samples.map((s, i) => `${s}\t${conditions[i]}`).join('\n') + '\n',
  );
  return {
    label,
    nGenes,
    nSamples,
    counts: path.relative(dataDir, countsPath),
    design: path.relative(dataDir, designPath),
    reference: 'WT',
    deCount,
  };
}

// A tenth of the sets are concentrated at the top of the ranked list. Without
// planted signal neither arm calls anything significant, so set-level agreement
// compares an empty set to an empty set and reports a vacuous Jaccard of 1.
function genGmt(universe, nSets, seed, order) {
  const rand = mulberry32(seed);
  const nSignal = Math.max(3, Math.round(nSets * 0.1));
  const topN = Math.max(50, Math.floor(universe * 0.1));
  const lines = [];
  const sets = [];
  for (let i = 0; i < nSets; i++) {
    const size = 15 + Math.floor(rand() * 185);
    const genes = new Set();
    const signal = i < nSignal;
    if (signal) {
      const planted = Math.floor(size * 0.7);
      while (genes.size < planted) genes.add(order[Math.floor(rand() * topN)]);
    }
    while (genes.size < size) genes.add(geneId(Math.floor(rand() * universe)));
    const id = `SET${String(i + 1).padStart(4, '0')}`;
    lines.push([id, 'bench', ...genes].join('\t'));
    sets.push({ id, genes: [...genes], signal });
  }
  const p = path.join(dataDir, 'gsea', `sets_u${universe}_n${nSets}.gmt`);
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return { rel: path.relative(dataDir, p), sets };
}
function genRanked(universe, seed) {
  const rand = mulberry32(seed);
  const rows = [];
  for (let g = 0; g < universe; g++) rows.push([geneId(g), gauss(rand) * 3]);
  rows.sort((a, b) => b[1] - a[1]);
  const p = path.join(dataDir, 'gsea', `ranked_u${universe}.rnk`);
  fs.writeFileSync(p, rows.map((r) => `${r[0]}\t${r[1].toFixed(6)}`).join('\n') + '\n');
  return { rel: path.relative(dataDir, p), order: rows.map((r) => r[0]) };
}
// Likewise over-represent a few sets in the query, so ORA has significant terms.
function genQuery(universe, nSets, size, seed, sets) {
  const rand = mulberry32(seed);
  const genes = new Set();
  for (const s of sets.filter((x) => x.signal).slice(0, 3)) {
    const take = Math.min(s.genes.length, Math.floor(size / 6));
    for (let i = 0; i < take && genes.size < size; i++) {
      genes.add(s.genes[Math.floor(rand() * s.genes.length)]);
    }
  }
  while (genes.size < size) genes.add(geneId(Math.floor(rand() * universe)));
  // The collection size is part of the name: both collections of a universe
  // carry their own planted sets, and a shared name let the 500-set queries
  // overwrite the 50-set ones.
  const p = path.join(dataDir, 'ora', `query_u${universe}_n${nSets}_k${size}.txt`);
  fs.writeFileSync(p, [...genes].join('\n') + '\n');
  return path.relative(dataDir, p);
}
function genExpr(universe, nSamples, seed) {
  const rand = mulberry32(seed);
  const samples = Array.from({ length: nSamples }, (_, i) => `s${i + 1}`);
  const lines = ['gene\t' + samples.join('\t')];
  for (let g = 0; g < universe; g++) {
    const base = gauss(rand) * 2 + 6;
    lines.push(geneId(g) + '\t' + samples.map(() => (base + gauss(rand)).toFixed(4)).join('\t'));
  }
  const p = path.join(dataDir, 'ssgsea', `expr_u${universe}_s${nSamples}.tsv`);
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return path.relative(dataDir, p);
}

for (const sub of ['counts', 'gsea', 'ora', 'ssgsea']) {
  fs.mkdirSync(path.join(dataDir, sub), { recursive: true });
}

const deseqTiers = [
  { label: 'XS', nGenes: 1500, nSamples: 6 },
  { label: 'S', nGenes: 8000, nSamples: 6 },
  { label: 'M', nGenes: 18000, nSamples: 8 },
];
if (full) {
  deseqTiers.push({ label: 'L', nGenes: 18000, nSamples: 24 });
  deseqTiers.push({ label: 'XL', nGenes: 18000, nSamples: 60 });
}
const universes = full ? [2000, 10000, 18000] : [2000, 10000];
const setCounts = [50, 500];
const querySizes = [100, 500];

const manifest = {
  seed: 12345,
  generated: new Date().toISOString(),
  deseq2: [],
  gsea: [],
  ora: [],
  ssgsea: [],
};

let seed = manifest.seed;
for (const t of deseqTiers) manifest.deseq2.push(genCounts(t.label, t.nGenes, t.nSamples, seed++));
for (const u of universes) {
  const { rel: ranked, order } = genRanked(u, seed++);
  const expr = genExpr(u, 12, seed++);
  for (const n of setCounts) {
    const { rel: gmt, sets } = genGmt(u, n, seed++, order);
    manifest.gsea.push({ universe: u, nSets: n, nperm: 1000, ranked, gmt });
    manifest.ssgsea.push({ universe: u, nSets: n, expr, gmt, nSamples: 12 });
    for (const k of querySizes) {
      manifest.ora.push({
        universe: u,
        nSets: n,
        querySize: k,
        gmt,
        query: genQuery(u, n, k, seed++, sets),
      });
    }
  }
}

fs.writeFileSync(path.join(dataDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(
  `generated ${manifest.deseq2.length} DESeq2 / ${manifest.gsea.length} GSEA / ` +
    `${manifest.ora.length} ORA / ${manifest.ssgsea.length} ssGSEA cases into benchmark/data/`,
);
