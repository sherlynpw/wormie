// Main-thread client for featureCounts.

import type { FeatureCountsRequest, FeatureCountsResult } from './types';
import { prettySample } from '$lib/sample-names';

const DEFAULT_BASE = '/wasm-cran/featurecounts/';

interface FCModule {
  FS: {
    mkdir(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string, opts: { encoding: 'utf8' }): string;
    unlink(path: string): void;
    analyzePath?: (p: string) => { exists: boolean };
  };
  callMain(args: string[]): number;
  print?: (s: string) => void;
  printErr?: (s: string) => void;
}
type FCFactory = (opts: object) => Promise<FCModule>;

// Cache UMD script load + factory across runs in the same page session.
let factoryPromise: Promise<FCFactory> | null = null;
function loadModuleFactory(base = DEFAULT_BASE): Promise<FCFactory> {
  if (!factoryPromise) {
    factoryPromise = new Promise<FCFactory>((resolve, reject) => {
      const existing = (globalThis as unknown as { createFeatureCounts?: FCFactory })
        .createFeatureCounts;
      if (existing) return resolve(existing);
      const s = document.createElement('script');
      s.src = `${base}featureCounts.js`;
      s.onload = () => {
        const fn = (globalThis as unknown as { createFeatureCounts?: FCFactory })
          .createFeatureCounts;
        if (typeof fn !== 'function') {
          reject(new Error('createFeatureCounts not exposed after script load'));
          return;
        }
        resolve(fn);
      };
      s.onerror = () => reject(new Error(`failed to load ${s.src}`));
      document.head.appendChild(s);
    });
  }
  return factoryPromise;
}

/**
 * Warm the service worker cache with the featureCounts WASM so /counts keeps
 * working offline. The module itself is only instantiated on the first run, so
 * without this nothing fetches these files until the user is already counting.
 */
export async function prefetchFeatureCounts(opts?: { baseUrl?: string }): Promise<void> {
  const base = opts?.baseUrl ?? DEFAULT_BASE;
  await Promise.all(
    ['featureCounts.js', 'featureCounts.wasm'].map((f) => fetch(base + f).catch(() => undefined)),
  );
}

// Sample columns are named after the staged MEMFS path ("/x.bam"); rename them at the source so
// downloads and every downstream page carry the bare sample name.
function cleanHeader(tsv: string, sampleStart: number): string {
  const lines = tsv.split('\n');
  const h = lines.findIndex((l) => l && !l.startsWith('#'));
  if (h < 0) return tsv;
  lines[h] = lines[h]
    .split('\t')
    .map((c, i) => (i >= sampleStart ? prettySample(c) : c))
    .join('\t');
  return lines.join('\n');
}

function parseCountsMatrix(tsv: string): FeatureCountsResult['matrix'] {
  const lines = tsv.split('\n').filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) return { genes: [], samples: [], counts: [] };
  const header = lines[0].split('\t');
  const samples = header.slice(6);
  const genes: string[] = [];
  const counts: number[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split('\t');
    if (row.length < 7) continue;
    genes.push(row[0]);
    counts.push(row.slice(6).map((s) => Number(s) || 0));
  }
  return { genes, samples, counts };
}

export interface FeatureCountsClient {
  run(req: FeatureCountsRequest, onProgress?: (line: string) => void): Promise<FeatureCountsResult>;
  /** Backwards-compat; no worker to terminate now, kept for symmetry. */
  terminate(): void;
}

export function createFeatureCountsClient(opts?: { baseUrl?: string }): FeatureCountsClient {
  const base = opts?.baseUrl ?? DEFAULT_BASE;

  async function run(
    req: FeatureCountsRequest,
    onProgress?: (line: string) => void,
  ): Promise<FeatureCountsResult> {
    const log: string[] = [];
    // Strip ANSI color codes from featureCounts stdout/stderr for plain-text log rendering.
    // eslint-disable-next-line no-control-regex
    const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
    const reportLine = (s: string) => {
      const clean = stripAnsi(s);
      log.push(clean);
      onProgress?.(clean);
    };

    const createFC = await loadModuleFactory(base);
    reportLine('[boot] instantiating featureCounts module ...');
    const Module = await createFC({
      mainScriptUrlOrBlob: `${base}featureCounts.js`,
      locateFile: (f: string) => base + f,
      print: reportLine,
      printErr: reportLine,
    });

    reportLine(`[fs] staging ${req.bams.length} BAM(s) + annotation`);
    const stagedPaths: string[] = [];
    for (const b of req.bams) {
      const path = `/${b.name}`;
      Module.FS.writeFile(path, b.bytes);
      stagedPaths.push(path);
      // Drop JS-side ref; wasm owns its copy.
      (b as { bytes?: Uint8Array }).bytes = undefined;
    }
    const annotPath = `/${req.annotation.name}`;
    Module.FS.writeFile(annotPath, req.annotation.bytes);
    stagedPaths.push(annotPath);
    (req.annotation as { bytes?: Uint8Array }).bytes = undefined;

    const isSaf = /\.(saf|tsv)$/i.test(req.annotation.name);
    const args = [
      '-a',
      annotPath,
      '-F',
      isSaf ? 'SAF' : 'GTF',
      '-T',
      String(Math.max(1, Math.min(8, req.threads | 0))),
      '-o',
      '/counts.txt',
    ];
    if (!isSaf) args.push('-t', 'exon', '-g', 'gene_id');
    if (req.isPaired) args.push('-p', '--countReadPairs');
    if (req.extraArgs?.length) args.push(...req.extraArgs);
    for (const b of req.bams) args.push(`/${b.name}`);

    reportLine(`[fc] argv: featureCounts ${args.join(' ')}`);

    const t0 = performance.now();
    const rc = Module.callMain(args);
    const elapsedSec = (performance.now() - t0) / 1000;
    if (rc !== 0) throw new Error(`featureCounts exited with code ${rc}`);

    const countsTsv = cleanHeader(Module.FS.readFile('/counts.txt', { encoding: 'utf8' }), 6);
    const summaryTsv = cleanHeader(
      Module.FS.readFile('/counts.txt.summary', { encoding: 'utf8' }),
      1,
    );

    // Free wasm MEMFS to prevent per-run heap accumulation.
    for (const p of [...stagedPaths, '/counts.txt', '/counts.txt.summary']) {
      try {
        Module.FS.unlink(p);
      } catch {
        /* ignore missing */
      }
    }

    return {
      countsTsv,
      summaryTsv,
      matrix: parseCountsMatrix(countsTsv),
      elapsedSec,
      log: log.join('\n'),
    };
  }

  return { run, terminate: () => {} };
}
