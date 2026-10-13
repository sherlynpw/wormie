// DEV-only hook: exposes window.__bench for benchmark/bench-browser.mjs.

import { runFit, runOneContrast } from '$lib/deseq2/client';
import type { ContrastSpec, DESeq2DesignRow, Shrinkage } from '$lib/deseq2/client';
import { getPrimary, parseFeatureCountsTsv, rVec } from '$lib/deseq2/fit';
import { runCustomGSEA, runCustomEnrichment, runCustomSsgsea } from '$lib/db/client';
import { createWebRInstance, clearBundleCache } from '$lib/deseq2/webr-instance';
import type { CustomTermSet, GseaInput } from '$lib/db/client';

// measureUserAgentSpecificMemory() blocks for minutes in headless Chromium.
async function sampleMemory(): Promise<number | null> {
  return null;
}

export interface BenchDeseqArgs {
  countsTsv: string;
  design: DESeq2DesignRow[];
  reference: string;
  shrinkage?: Shrinkage;
}
export interface BenchGseaArgs {
  ranked: GseaInput[];
  sets: CustomTermSet[];
  opts?: Record<string, unknown>;
}
export interface BenchEnrichArgs {
  ids: string[];
  sets: CustomTermSet[];
  opts?: Record<string, unknown>;
}
export interface BenchSsgseaArgs {
  expr: { genes: string[]; samples: string[]; matrix: Float64Array | number[] };
  sets: CustomTermSet[];
  opts?: Record<string, unknown>;
}

// Phase boundaries are read off the progress lines createWebRInstance already
// emits, so measuring startup does not require instrumenting the init path.
const STARTUP_PHASES: [string, RegExp][] = [
  ['module', /loading WebR module/],
  ['session', /starting WebR session/],
  ['bundle', /^\[cache\]/],
  ['mount', /mounting bundle/],
  ['library', /loading DESeq2 library/],
];

async function timeInstance(): Promise<{
  totalMs: number;
  phases: Record<string, number>;
  bundleCached: boolean;
}> {
  const marks: { at: number; phase: string }[] = [];
  let bundleCached = false;
  const t0 = performance.now();
  const webR = await createWebRInstance({
    onLine: (s) => {
      if (/^\[cache\] hit/.test(s)) bundleCached = true;
      for (const [phase, re] of STARTUP_PHASES) {
        if (re.test(s) && !marks.some((m) => m.phase === phase)) {
          marks.push({ at: performance.now(), phase });
          return;
        }
      }
    },
  });
  const end = performance.now();
  webR.close();
  const phases: Record<string, number> = {};
  for (let i = 0; i < marks.length; i++) {
    phases[marks[i].phase] = (marks[i + 1]?.at ?? end) - marks[i].at;
  }
  return { totalMs: end - t0, phases, bundleCached };
}

const bench = {
  // Cost the reimplementation decision avoids: bundle fetch, WebR boot and
  // library(DESeq2), plus the marginal cost of each extra pool instance.
  async webrStartup(args: { clearCache?: boolean; extraInstances?: number } = {}) {
    if (args.clearCache) await clearBundleCache();
    const first = await timeInstance();
    const extra = [];
    for (let i = 0; i < (args.extraInstances ?? 1); i++) extra.push(await timeInstance());
    return { first, extra, hardwareConcurrency: navigator.hardwareConcurrency ?? null };
  },

  // DESeq + lfcShrink only, R-timed (matches benchmark/bench-r.R exactly).
  async deseq2core(args: BenchDeseqArgs & { treatment?: string }) {
    const webR = await getPrimary();
    const shrink: Shrinkage = args.shrinkage ?? 'apeglm';
    const { genes, samples, counts } = parseFeatureCountsTsv(args.countsTsv);
    const condBySample = new Map(args.design.map((d) => [d.sample, d.condition]));
    const conds = samples.map((s) => condBySample.get(s) ?? '');
    const ref = args.reference;
    const treatment = args.treatment ?? conds.find((c) => c !== ref) ?? '';
    const coef = `condition_${treatment}_vs_${ref}`;

    const nCells = genes.length * samples.length;
    const i32 = new Int32Array(nCells);
    for (let i = 0, k = 0; i < counts.length; i++) {
      const row = counts[i];
      for (let j = 0; j < row.length; j++) i32[k++] = row[j];
    }
    await webR.FS.writeFile('/tmp/bench_counts.bin', new Uint8Array(i32.buffer));

    const r = await webR.evalR(
      `
      .bench <- tryCatch({
      counts <- matrix(
        readBin("/tmp/bench_counts.bin", what = "integer", n = ${nCells}, size = 4L, endian = "little"),
        nrow = ${genes.length}, ncol = ${samples.length}, byrow = TRUE)
      file.remove("/tmp/bench_counts.bin")
      rownames(counts) <- ${rVec(genes)}
      colnames(counts) <- ${rVec(samples)}
      coldata <- data.frame(condition = factor(${rVec(conds)}, levels = ${rVec([ref, treatment])}),
                            row.names = colnames(counts))
      t0 <- Sys.time()
      dds <- DESeqDataSetFromMatrix(countData = counts, colData = coldata, design = ~condition)
      dds <- DESeq(dds, quiet = TRUE)
      res <- lfcShrink(dds, coef = "${coef}", type = "${shrink}", quiet = TRUE)
      res_df <- as.data.frame(res)
      elapsed <- as.numeric(difftime(Sys.time(), t0, units = "secs"))
      header <- "gene\\tbaseMean\\tlog2FoldChange\\tpvalue\\tpadj"
      # 17 significant digits round-trips a double exactly. At 8 the serialized
      # value, not the arithmetic, sets the floor on any agreement measured here.
      rows <- paste(rownames(res_df),
        formatC(res_df$baseMean, format = "g", digits = 17),
        formatC(res_df$log2FoldChange, format = "g", digits = 17),
        formatC(res_df$pvalue, format = "g", digits = 17),
        formatC(res_df$padj, format = "g", digits = 17), sep = "\\t")
      .out <- list(elapsed = elapsed, tsv = paste(c(header, rows), collapse = "\\n"))
      rm(counts, coldata, dds, res, res_df, rows)
      invisible(gc(full = TRUE, verbose = FALSE))
      .out
      }, error = function(e) list(.error = conditionMessage(e)))
      .bench
      `,
      { captureStreams: false, captureConditions: false },
    );
    const o = await r.toJs();
    const names = (o as { names?: string[] }).names;
    if (names?.includes('.error')) {
      const msg = (o.values[names.indexOf('.error')] as { values?: string[] }).values?.[0];
      throw new Error(`deseq2core failed in R: ${msg ?? 'unknown error'}`);
    }
    const elapsedSec = (o.values[0] as { values: number[] }).values[0];
    const tsv = (o.values[1] as { values: string[] }).values[0];
    const rows = tsv
      .split('\n')
      .slice(1)
      .filter(Boolean)
      .map((l) => {
        const [gene, baseMean, log2FoldChange, pvalue, padj] = l.split('\t');
        return {
          gene,
          baseMean: Number(baseMean),
          log2FoldChange: Number(log2FoldChange),
          pvalue: Number(pvalue),
          padj: Number(padj),
        };
      });
    return {
      elapsedMs: elapsedSec * 1000,
      memBytes: await sampleMemory(),
      contrasts: [{ name: `${treatment}_vs_${ref}`, rows }],
    };
  },

  async deseq2(args: BenchDeseqArgs) {
    const shrinkage: Shrinkage = args.shrinkage ?? 'apeglm';
    const t0 = performance.now();
    const fit = await runFit({
      countsTsv: args.countsTsv,
      design: args.design,
      reference: args.reference,
    });
    const fitMs = performance.now() - t0;
    const pairs: ContrastSpec[] = fit.levels
      .slice(1)
      .map((treatment) => ({ treatment, reference: fit.levels[0] }));
    const t1 = performance.now();
    const contrasts = [];
    for (const pair of pairs) {
      contrasts.push(await runOneContrast(pair, shrinkage, fit.levels[0]));
    }
    const contrastMs = performance.now() - t1;
    return {
      elapsedMs: performance.now() - t0,
      fitMs,
      contrastMs,
      fitSecReported: fit.elapsedSec,
      memBytes: await sampleMemory(),
      contrasts: contrasts.map((c) => ({
        name: c.name,
        rows: c.rows.map((r) => ({
          gene: r.gene,
          baseMean: r.baseMean,
          log2FoldChange: r.log2FoldChange,
          stat: r.stat,
          pvalue: r.pvalue,
          padj: r.padj,
        })),
      })),
    };
  },

  async gsea(args: BenchGseaArgs) {
    const t0 = performance.now();
    const res = await runCustomGSEA(args.ranked, args.sets, args.opts ?? {});
    return {
      elapsedMs: performance.now() - t0,
      engineMs: res.elapsedMs,
      memBytes: await sampleMemory(),
      results: res.results.map((r) => ({
        term_id: r.term_id,
        size: r.size,
        es: r.es,
        nes: r.nes,
        p: r.p,
        p_perm: r.p_perm,
        p_at_bound: r.p_at_bound,
        q: r.q,
      })),
    };
  },

  async ssgsea(args: BenchSsgseaArgs) {
    const matrix =
      args.expr.matrix instanceof Float64Array
        ? args.expr.matrix
        : Float64Array.from(args.expr.matrix);
    const t0 = performance.now();
    const res = await runCustomSsgsea(
      { genes: args.expr.genes, samples: args.expr.samples, matrix },
      args.sets,
      args.opts ?? {},
    );
    return {
      elapsedMs: performance.now() - t0,
      engineMs: res.elapsedMs,
      memBytes: await sampleMemory(),
      sampleNames: res.sampleNames,
      results: res.results,
    };
  },

  async enrichment(args: BenchEnrichArgs) {
    const t0 = performance.now();
    const res = await runCustomEnrichment(args.ids, args.sets, args.opts ?? {});
    return {
      elapsedMs: performance.now() - t0,
      engineMs: res.elapsedMs,
      memBytes: await sampleMemory(),
      results: res.results.map((r) => ({
        term_id: r.term_id,
        k: r.k,
        K: r.K,
        n: r.n,
        N: r.N,
        fold: r.fold,
        p: r.p,
        q: r.q,
      })),
    };
  },
};

export type BenchApi = typeof bench;

export function installBenchHook(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  (window as unknown as { __bench: BenchApi }).__bench = bench;
  console.log('[bench] window.__bench installed');
}
