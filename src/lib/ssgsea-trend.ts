// Trend test on per-sample set scores: one limma linear model per gene set,
// scores against a sample variable, moderated statistics across sets and BH
// adjustment. The design follows Hanzelmann et al. 2013 (GSVA), which fits
// limma to the per-sample enrichment score matrix; the spline option for time
// courses follows the limma user guide (Ritchie et al. 2015).

import type { SsgseaScores } from '$lib/db/client';
import { createWebRInstance, type WebRInstance } from '$lib/deseq2/webr-instance';
import { rVec } from '$lib/deseq2/fit';

export type TrendModel = 'linear' | 'factor' | 'spline';

export interface SampleTable {
  samples: string[];
  columns: string[];
  /** One row per sample, column name to raw cell text. */
  rows: Record<string, string>[];
}

export interface TrendRequest {
  scores: SsgseaScores[];
  sampleNames: string[];
  table: SampleTable;
  variable: string;
  model: TrendModel;
  /** Degrees of freedom for the natural spline; ignored by the other models. */
  splineDf?: number;
  onLine?: (s: string) => void;
}

export interface TrendRow {
  term_id: string;
  name: string;
  size: number;
  /** Slope per unit of the variable (linear), the level difference (two-level factor), otherwise the F statistic. */
  estimate: number;
  stat: number;
  p: number;
  adjP: number;
}

export interface TrendResult {
  rows: TrendRow[];
  model: TrendModel;
  variable: string;
  /** Factor levels in the order fitted, or empty for a numeric variable. */
  levels: string[];
  residualDf: number;
  limmaVersion: string;
  elapsedMs: number;
}

/** Parse a pasted sample table: header row `sample<TAB>var1[<TAB>var2 ...]`, tab or comma separated. */
export function parseSampleTable(text: string): SampleTable | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) return null;
  const split = (l: string) => l.split(/\t|,/).map((x) => x.trim().replace(/^"+|"+$/g, ''));
  const header = split(lines[0]);
  if (header.length < 2) return null;
  const columns = header.slice(1);
  const samples: string[] = [];
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const f = split(line);
    if (!f[0]) continue;
    samples.push(f[0]);
    const row: Record<string, string> = {};
    columns.forEach((c, i) => (row[c] = f[i + 1] ?? ''));
    rows.push(row);
  }
  return { samples, columns, rows };
}

export function isNumericColumn(table: SampleTable, column: string): boolean {
  return table.rows.every((r) => r[column] !== '' && Number.isFinite(Number(r[column])));
}

/** Residual degrees of freedom the model would leave, or the reason it cannot be fitted. */
export function checkDesign(
  values: string[],
  model: TrendModel,
  splineDf = 3,
): { ok: true; residualDf: number; levels: string[] } | { ok: false; reason: string } {
  const n = values.length;
  if (model === 'factor') {
    const levels = [...new Set(values)];
    if (levels.length < 2) return { ok: false, reason: 'the variable has a single level' };
    const counts = levels.map((l) => values.filter((v) => v === l).length);
    if (counts.every((c) => c === 1))
      return {
        ok: false,
        reason:
          'every level has one sample, so there is no within-level variance to test against; add replicates or model the variable as a number',
      };
    const residualDf = n - levels.length;
    if (residualDf < 1)
      return { ok: false, reason: 'no residual degrees of freedom (one sample per level)' };
    return { ok: true, residualDf, levels };
  }
  const nums = values.map(Number);
  if (!nums.every(Number.isFinite))
    return { ok: false, reason: 'the variable is not numeric; model it as a factor instead' };
  const distinct = new Set(nums).size;
  if (distinct < 2) return { ok: false, reason: 'the variable takes a single value' };
  const p = model === 'spline' ? 1 + splineDf : 2;
  if (model === 'spline' && distinct < 5)
    return {
      ok: false,
      reason: 'a spline needs at least five distinct values of the variable; use the linear model',
    };
  const residualDf = n - p;
  if (residualDf < 1)
    return {
      ok: false,
      reason: `${n} samples leave no residual degrees of freedom for a model with ${p} coefficients`,
    };
  return { ok: true, residualDf, levels: [] };
}

let instancePromise: Promise<WebRInstance> | null = null;

// A WebR session of its own: loading DESeq2 costs a minute and this test needs
// only limma. limma has no WebAssembly build on r-universe or repo.r-wasm.org,
// so it comes only from the baked bundle; a bundle without it fails here at once.
async function getInstance(onLine?: (s: string) => void): Promise<WebRInstance> {
  if (!instancePromise) {
    instancePromise = (async () => {
      const webR = await createWebRInstance({ onLine, skipLibrary: true });
      onLine?.('[webr] loading limma ...');
      const have = await webR.evalR('requireNamespace("limma", quietly = TRUE)');
      const ok = ((await have.toJs()).values[0] as boolean) === true;
      if (!ok)
        throw new Error(
          'limma is not in the R bundle this build ships; the trend test needs a bundle baked with limma (scripts/wasm-build/bake-bundle.sh)',
        );
      await webR.evalRVoid('suppressPackageStartupMessages(library(limma))');
      return webR;
    })().catch((e) => {
      instancePromise = null;
      throw e;
    });
  }
  return instancePromise;
}

export async function runTrendTest(req: TrendRequest): Promise<TrendResult> {
  const t0 = performance.now();
  const { scores, sampleNames, table, variable, model } = req;
  const splineDf = req.splineDf ?? 3;
  if (!table.columns.includes(variable))
    throw new Error(`no column "${variable}" in the sample table`);
  const valueOf = new Map(table.samples.map((s, i) => [s, table.rows[i][variable]]));
  const missing = sampleNames.filter((s) => !valueOf.has(s));
  if (missing.length)
    throw new Error(
      `the sample table has no row for ${missing.length} sample${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''}`,
    );
  const values = sampleNames.map((s) => valueOf.get(s)!);
  const check = checkDesign(values, model, splineDf);
  if (!check.ok) throw new Error(`Cannot test: ${check.reason}.`);

  const webR = await getInstance(req.onLine);
  req.onLine?.(
    `[trend] fitting ${scores.length} sets, ${sampleNames.length} samples, ${model} model on ${variable}`,
  );
  const flat: number[] = [];
  for (const r of scores) flat.push(...r.scores);
  const designR =
    model === 'factor'
      ? `f <- factor(x, levels = ${rVec(check.levels)}); design <- model.matrix(~ f)`
      : model === 'spline'
        ? `x <- as.numeric(x); design <- model.matrix(~ splines::ns(x, df = ${splineDf}))`
        : `x <- as.numeric(x); design <- model.matrix(~ x)`;
  const r = await webR.evalR(
    `
    scores <- matrix(c(${flat.join(',')}), nrow = ${scores.length}, byrow = TRUE,
                     dimnames = list(${rVec(scores.map((s) => s.term_id))}, ${rVec(sampleNames)}))
    x <- ${rVec(values)}
    ${designR}
    if (nrow(design) - ncol(design) < 1) stop("no residual degrees of freedom")
    fit <- limma::eBayes(limma::lmFit(scores, design))
    coefs <- 2:ncol(design)
    tt <- limma::topTable(fit, coef = coefs, number = Inf, adjust.method = "BH", sort.by = "none")
    est <- if (length(coefs) == 1) tt[["logFC"]] else tt[["F"]]
    stat <- if (length(coefs) == 1) tt[["t"]] else tt[["F"]]
    out <- paste(rownames(tt), est, stat, tt[["P.Value"]], tt[["adj.P.Val"]], sep = "\\t")
    list(paste(out, collapse = "\\n"), as.character(packageVersion("limma")), fit$df.residual[1])
  `,
    { captureStreams: false, captureConditions: false },
  );
  const o = await r.toJs();
  const pick = (i: number) => (o.values[i] as { values: unknown[] }).values[0];
  const tsv = pick(0) as string;
  const byId = new Map(scores.map((s) => [s.term_id, s]));
  const rows: TrendRow[] = tsv
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [id, est, stat, p, adj] = line.split('\t');
      const s = byId.get(id)!;
      return {
        term_id: id,
        name: s.name,
        size: s.size,
        estimate: Number(est),
        stat: Number(stat),
        p: Number(p),
        adjP: Number(adj),
      };
    })
    .sort((a, b) => a.p - b.p);
  return {
    rows,
    model,
    variable,
    levels: check.levels,
    residualDf: Number(pick(2)),
    limmaVersion: String(pick(1)),
    elapsedMs: performance.now() - t0,
  };
}
