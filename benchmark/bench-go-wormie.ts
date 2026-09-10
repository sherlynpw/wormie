#!/usr/bin/env bun
// WormIE arm of the propagated-GO comparison against clusterProfiler::enrichGO.
// Drives the production enrichment module against an uncompressed local SQLite,
// and emits the query plus the exact background universe so the R arm can use
// the identical gene set.
//   bun benchmark/bench-go-wormie.ts <wormie.sqlite> <genes.txt>

import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { runEnrichmentSync } from '../src/lib/db/enrichment-worker';
import { GO_POSITIVE } from '../src/lib/db/enrichment-worker';

const dbPath = process.argv[2];
const genePath = process.argv[3];
if (!dbPath || !genePath) {
  console.error('usage: bun benchmark/bench-go-wormie.ts <wormie.sqlite> <genes.txt>');
  process.exit(1);
}

const raw = new Database(dbPath, { readonly: true });
// Shim matching the oo1.Database.exec() surface execAll() expects.
const db = {
  exec<T>(opts: { sql: string; bind?: unknown[]; rowMode?: string; callback?: (row: T) => void }) {
    const rows = raw.query(opts.sql).all(...((opts.bind ?? []) as any[])) as T[];
    if (opts.callback) for (const r of rows) opts.callback(r);
    return rows;
  },
};

const ids = fs
  .readFileSync(genePath, 'utf8')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

// The universe the hypergeometric N is taken from, spelled out gene by gene.
const background = (
  raw.query(`SELECT DISTINCT wormbase_gene AS g FROM gene_go WHERE ${GO_POSITIVE}`).all() as {
    g: string;
  }[]
).map((r) => r.g);

const t0 = performance.now();
const results = runEnrichmentSync(db, ids, 'go', { minK: 1, maxQ: 1 });
const elapsedMs = performance.now() - t0;

const resultsDir = path.join(import.meta.dir, 'results');
fs.mkdirSync(resultsDir, { recursive: true });
const out = {
  generated: new Date().toISOString(),
  dbVersion: JSON.parse(
    fs.readFileSync(path.join(import.meta.dir, '..', 'static/data/version.json'), 'utf8'),
  ),
  geneFile: path.basename(genePath),
  nQuery: ids.length,
  nBackground: background.length,
  elapsedMs,
  query: ids,
  background,
  results: results.map((r) => ({
    term_id: r.term_id,
    name: r.name,
    namespace: r.namespace,
    k: r.k,
    K: r.K,
    n: r.n,
    N: r.N,
    p: r.p,
    q: r.q,
  })),
};
fs.writeFileSync(path.join(resultsDir, 'go-wormie.json'), JSON.stringify(out, null, 2));
const sig = out.results.filter((r) => r.q < 0.05).length;
console.log(
  `wormie GO: ${ids.length} query / ${background.length} background / ` +
    `${out.results.length} terms tested / ${sig} at q<0.05 (${Math.round(elapsedMs)}ms)`,
);
console.log('==> wrote benchmark/results/go-wormie.json');
