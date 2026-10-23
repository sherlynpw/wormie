// Phase 1: fit DESeqDataSet from counts + design, emit the dds blob plus
// contrast-independent artifacts (size factors, normalized counts, VST).
// Phase 2 (contrast extraction) consumes the dds blob.

import { createWebRInstance, type WebRInstance } from './webr-instance';
import type { DESeq2FitRequest, DESeq2FitResult } from './types';
import { parseCountsTable } from './counts-table';

export function rVec(arr: string[]) {
  return 'c(' + arr.map((s) => JSON.stringify(s)).join(',') + ')';
}

export const parseFeatureCountsTsv = parseCountsTable;

export type RSessionState = 'idle' | 'starting' | 'ready' | 'failed';
export interface RSessionSnapshot {
  state: RSessionState;
  /** Epoch ms of the last state change, so the page can show elapsed time. */
  since: number;
  error: string | null;
  /** Start-up lines so far, so a page opened mid-start can show them. */
  log: string[];
}
export interface RSessionSubscriber {
  onStatus?: (s: RSessionSnapshot) => void;
  onLine?: (line: string) => void;
}

let session: RSessionSnapshot = { state: 'idle', since: 0, error: null, log: [] };
const subscribers = new Set<RSessionSubscriber>();

function setSession(patch: Partial<RSessionSnapshot>) {
  session = { ...session, ...patch, since: Date.now() };
  for (const s of subscribers) s.onStatus?.(session);
}
function broadcastLine(line: string) {
  if (session.state === 'starting') session = { ...session, log: [...session.log, line] };
  for (const s of subscribers) s.onLine?.(line);
}

/**
 * Follow the primary R session from any page instance. The session outlives
 * the page that started it, so the subscriber gets the current snapshot at
 * once and every later start-up and R output line. Returns an unsubscribe.
 */
export function subscribeRSession(sub: RSessionSubscriber): () => void {
  subscribers.add(sub);
  sub.onStatus?.(session);
  return () => {
    subscribers.delete(sub);
  };
}

/** Primary WebR instance singleton (the one that owns the fit). */
let primaryPromise: Promise<WebRInstance> | null = null;
export function getPrimary(): Promise<WebRInstance> {
  if (!primaryPromise) {
    setSession({ state: 'starting', error: null, log: [] });
    const p = createWebRInstance({ onLine: broadcastLine }).then(
      (webR) => {
        if (primaryPromise === p) setSession({ state: 'ready' });
        return webR;
      },
      (e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        if (primaryPromise === p) {
          primaryPromise = null;
          broadcastLine(`[error] R session failed to start: ${message}`);
          setSession({ state: 'failed', error: message });
        }
        throw e;
      },
    );
    primaryPromise = p;
  }
  return primaryPromise;
}

/** Drop the primary session (closing it once it comes up) and start a new one. */
export function restartPrimary(): Promise<WebRInstance> {
  const old = primaryPromise;
  primaryPromise = null;
  if (old) {
    old.then(
      (w) => {
        try {
          w.close();
        } catch {
          /* already gone */
        }
      },
      () => {},
    );
  }
  return getPrimary();
}

/**
 * Hydrate a fit from a previously-saved dds.rds blob. Loads the dds into the
 * primary WebR session and re-derives the shared artifacts (size factors,
 * normalized counts, VST). Avoids the slow DESeq() refit.
 */
export async function rehydrateFromDdsBlob(
  blob: Uint8Array,
  onProgress?: (line: string) => void,
): Promise<DESeq2FitResult> {
  const webR = await getPrimary();
  onProgress?.(
    `[rehydrate] writing dds.rds blob (${(blob.byteLength / 1024 / 1024).toFixed(1)} MB) ...`,
  );
  const t0 = performance.now();
  await webR.FS.writeFile('/tmp/dds.rds', blob);
  onProgress?.(
    '[rehydrate] reading dds, then computing VST + PCA + artifacts (may take 30-60s) ...',
  );
  const r = await webR.evalR(
    `
    dds <- readRDS("/tmp/dds.rds")
    if (!inherits(dds, "DESeqDataSet")) {
      stop("uploaded blob is not a DESeqDataSet (got ", paste(class(dds), collapse="/"), ")")
    }
    factor_levels <- levels(colData(dds)$condition)

    sf <- sizeFactors(dds)
    size_factors_tsv <- paste(c(
      "sample\\tsize_factor",
      paste(names(sf), formatC(as.numeric(sf), format = "g", digits = 6), sep = "\\t")
    ), collapse = "\\n")

    nc <- counts(dds, normalized = TRUE)
    nc_header <- paste(c("gene", colnames(nc)), collapse = "\\t")
    nc_rows <- paste(rownames(nc), apply(nc, 1, function(r) paste(formatC(r, format = "g", digits = 6), collapse = "\\t")), sep = "\\t")
    normalized_counts_tsv <- paste(c(nc_header, nc_rows), collapse = "\\n")

    # VST shared by vst_counts.tsv and PCA. blind=TRUE is design-independent (matches plotPCA) and avoids a second pass.
    vst_mat <- tryCatch(
      assay(vst(dds, blind = TRUE)),
      error = function(e) assay(varianceStabilizingTransformation(dds, blind = TRUE))
    )
    vst_header <- paste(c("gene", colnames(vst_mat)), collapse = "\\t")
    vst_rows <- paste(rownames(vst_mat), apply(vst_mat, 1, function(r) paste(formatC(r, format = "g", digits = 6), collapse = "\\t")), sep = "\\t")
    vst_counts_tsv <- paste(c(vst_header, vst_rows), collapse = "\\n")

    design_df <- as.data.frame(colData(dds))
    design_cols <- intersect(c("condition", "batch"), colnames(design_df))
    design_header <- paste(c("sample", design_cols), collapse = "\\t")
    design_rows <- paste(rownames(design_df), apply(design_df[, design_cols, drop = FALSE], 1, function(r) paste(as.character(r), collapse = "\\t")), sep = "\\t")
    design_tsv <- paste(c(design_header, design_rows), collapse = "\\n")

    disp_df <- data.frame(
      gene       = rownames(dds),
      dispGeneEst = mcols(dds)$dispGeneEst,
      dispFit     = mcols(dds)$dispFit,
      dispersion  = mcols(dds)$dispersion
    )
    disp_tsv <- paste(c(
      "gene\\tdispGeneEst\\tdispFit\\tdispersion",
      apply(disp_df, 1, function(r) paste(
        r[["gene"]],
        formatC(as.numeric(r[["dispGeneEst"]]), format = "g", digits = 6),
        formatC(as.numeric(r[["dispFit"]]),     format = "g", digits = 6),
        formatC(as.numeric(r[["dispersion"]]),  format = "g", digits = 6),
        sep = "\\t"
      ))
    ), collapse = "\\n")

    pca <- prcomp(t(vst_mat), center = TRUE, scale. = FALSE)
    n_pc <- min(3L, ncol(pca$x))
    pca_var <- (pca$sdev^2) / max(1e-12, sum(pca$sdev^2))
    pca_score <- pca$x[, seq_len(n_pc), drop = FALSE]
    colnames(pca_score) <- paste0("PC", seq_len(n_pc))
    pca_meta <- as.data.frame(colData(dds))[rownames(pca_score), , drop = FALSE]
    pca_cols <- intersect(c("condition", "batch"), colnames(pca_meta))
    pca_header <- paste(c("sample", pca_cols, colnames(pca_score)), collapse = "\\t")
    pca_rows <- vapply(seq_len(nrow(pca_score)), function(i) paste(c(
      rownames(pca_score)[i],
      as.character(pca_meta[i, pca_cols]),
      formatC(as.numeric(pca_score[i, ]), format = "g", digits = 6)
    ), collapse = "\\t"), character(1))
    pca_tsv <- paste(c(pca_header, pca_rows), collapse = "\\n")
    pca_var_tsv <- paste(c(
      "PC\\tvar_explained",
      paste(paste0("PC", seq_along(pca_var)),
            formatC(pca_var, format = "g", digits = 6), sep = "\\t")
    ), collapse = "\\n")

    out <- list(
      levels = factor_levels,
      size_factors = size_factors_tsv,
      normalized_counts = normalized_counts_tsv,
      vst_counts = vst_counts_tsv,
      design = design_tsv,
      dispersions = disp_tsv,
      pca = pca_tsv,
      pca_var = pca_var_tsv
    )
    rm(sf, nc, nc_header, nc_rows,
       vst_mat, vst_header, vst_rows,
       size_factors_tsv, normalized_counts_tsv, vst_counts_tsv,
       design_df, design_cols, design_header, design_rows, design_tsv,
       disp_df, disp_tsv, factor_levels,
       pca, pca_score, pca_meta, pca_cols, pca_header, pca_rows,
       pca_var, pca_tsv, pca_var_tsv)
    if (file.exists("/tmp/dds.rds")) file.remove("/tmp/dds.rds")
    invisible(gc(full = TRUE, verbose = FALSE))
    out
  `,
    { captureStreams: false, captureConditions: false },
  );
  const o = await r.toJs();
  const levels = ((o.values[0] as { values: string[] }).values ?? []) as string[];
  const pick = (i: number) => (o.values[i] as { values: string[] }).values[0] ?? '';
  onProgress?.(`[rehydrate] done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  return {
    levels,
    sizeFactorsTsv: pick(1),
    normalizedCountsTsv: pick(2),
    vstCountsTsv: pick(3),
    designTsv: pick(4),
    dispersionsTsv: pick(5),
    pcaTsv: pick(6),
    pcaVarTsv: pick(7),
    ddsBlob: blob,
    elapsedSec: (performance.now() - t0) / 1000,
  };
}

export async function runFit(
  req: DESeq2FitRequest,
  onProgress?: (line: string) => void,
): Promise<DESeq2FitResult> {
  const webR = await getPrimary();

  const { genes, samples, counts } = parseFeatureCountsTsv(req.countsTsv);
  if (samples.length !== req.design.length) {
    throw new Error(
      `design has ${req.design.length} samples but counts has ${samples.length} columns`,
    );
  }
  const condBySample = new Map(req.design.map((d) => [d.sample, d.condition]));
  const conds = samples.map((s) => {
    const c = condBySample.get(s);
    if (!c) throw new Error(`design is missing condition for sample "${s}"`);
    return c;
  });
  if (!conds.includes(req.reference)) {
    throw new Error(`reference "${req.reference}" not in design conditions`);
  }
  const uniqueConds = Array.from(new Set(conds));
  const otherLevels = uniqueConds.filter((c) => c !== req.reference);
  if (otherLevels.length === 0) {
    throw new Error('design has only one condition; nothing to contrast');
  }
  const factorLevels = [req.reference, ...otherLevels];

  const batchBySample = new Map(req.design.map((d) => [d.sample, d.batch ?? '']));
  const batches = samples.map((s) => batchBySample.get(s) ?? '');
  const useBatch = batches.every((b) => b.length > 0);
  if (batches.some((b) => b.length > 0) && !useBatch) {
    throw new Error(
      "partial batch labels; either fill every sample's batch column or clear all of them",
    );
  }
  const designFormula = useBatch ? '~ batch + condition' : '~ condition';
  // Pass counts as a binary Int32 blob: a large inlined c(...) literal overflows WebR's parser.
  const nCells = genes.length * samples.length;
  const flatI32 = new Int32Array(nCells);
  for (let i = 0, k = 0; i < counts.length; i++) {
    const row = counts[i];
    for (let j = 0; j < row.length; j++) flatI32[k++] = row[j];
  }
  const COUNTS_PATH = '/tmp/counts.bin';
  await webR.FS.writeFile(COUNTS_PATH, new Uint8Array(flatI32.buffer));

  onProgress?.('[fit] DESeq() + size factors + normalized counts + VST ...');
  const t0 = performance.now();
  const r = await webR.evalR(
    `
    .fit_result <- tryCatch({
    counts <- matrix(
      readBin("${COUNTS_PATH}", what = "integer", n = ${nCells}, size = 4L, endian = "little"),
      nrow = ${genes.length}, ncol = ${samples.length}, byrow = TRUE)
    file.remove("${COUNTS_PATH}")
    rownames(counts) <- ${rVec(genes)}
    colnames(counts) <- ${rVec(samples)}
    coldata <- data.frame(
      condition = factor(${rVec(conds)}, levels = ${rVec(factorLevels)}),
      ${useBatch ? `batch = factor(${rVec(batches)}),` : ''}
      row.names = colnames(counts)
    )
    t0 <- Sys.time()
    dds <- DESeqDataSetFromMatrix(countData = counts, colData = coldata, design = ${designFormula})
    ${
      (req.minCount ?? 0) > 0
        ? `dds <- dds[rowSums(counts(dds)) >= ${req.minCount}, ]
           message(sprintf("[filter] keeping %d genes after rowSums >= ${req.minCount}", nrow(dds)))`
        : ''
    }
    dds <- DESeq(dds, quiet = TRUE)
    elapsed <- as.numeric(difftime(Sys.time(), t0, units = "secs"))

    sf <- sizeFactors(dds)
    size_factors_tsv <- paste(c(
      "sample\\tsize_factor",
      paste(names(sf), formatC(as.numeric(sf), format = "g", digits = 6), sep = "\\t")
    ), collapse = "\\n")

    nc <- counts(dds, normalized = TRUE)
    nc_header <- paste(c("gene", colnames(nc)), collapse = "\\t")
    nc_rows <- paste(rownames(nc), apply(nc, 1, function(r) paste(formatC(r, format = "g", digits = 6), collapse = "\\t")), sep = "\\t")
    normalized_counts_tsv <- paste(c(nc_header, nc_rows), collapse = "\\n")

    # VST shared by vst_counts.tsv and PCA. blind=TRUE is design-independent (matches plotPCA) and avoids a second pass.
    vst_mat <- tryCatch(
      assay(vst(dds, blind = TRUE)),
      error = function(e) assay(varianceStabilizingTransformation(dds, blind = TRUE))
    )
    vst_header <- paste(c("gene", colnames(vst_mat)), collapse = "\\t")
    vst_rows <- paste(rownames(vst_mat), apply(vst_mat, 1, function(r) paste(formatC(r, format = "g", digits = 6), collapse = "\\t")), sep = "\\t")
    vst_counts_tsv <- paste(c(vst_header, vst_rows), collapse = "\\n")

    design_df <- as.data.frame(colData(dds))
    design_cols <- intersect(c("condition", "batch"), colnames(design_df))
    design_header <- paste(c("sample", design_cols), collapse = "\\t")
    design_rows <- paste(rownames(design_df), apply(design_df[, design_cols, drop = FALSE], 1, function(r) paste(as.character(r), collapse = "\\t")), sep = "\\t")
    design_tsv <- paste(c(design_header, design_rows), collapse = "\\n")

    disp_df <- data.frame(
      gene       = rownames(dds),
      dispGeneEst = mcols(dds)$dispGeneEst,
      dispFit     = mcols(dds)$dispFit,
      dispersion  = mcols(dds)$dispersion
    )
    disp_tsv <- paste(c(
      "gene\\tdispGeneEst\\tdispFit\\tdispersion",
      apply(disp_df, 1, function(r) paste(
        r[["gene"]],
        formatC(as.numeric(r[["dispGeneEst"]]), format = "g", digits = 6),
        formatC(as.numeric(r[["dispFit"]]),     format = "g", digits = 6),
        formatC(as.numeric(r[["dispersion"]]),  format = "g", digits = 6),
        sep = "\\t"
      ))
    ), collapse = "\\n")

    pca <- prcomp(t(vst_mat), center = TRUE, scale. = FALSE)
    n_pc <- min(3L, ncol(pca$x))
    pca_var <- (pca$sdev^2) / max(1e-12, sum(pca$sdev^2))
    pca_score <- pca$x[, seq_len(n_pc), drop = FALSE]
    colnames(pca_score) <- paste0("PC", seq_len(n_pc))
    pca_meta <- as.data.frame(colData(dds))[rownames(pca_score), , drop = FALSE]
    pca_cols <- intersect(c("condition", "batch"), colnames(pca_meta))
    pca_header <- paste(c("sample", pca_cols, colnames(pca_score)), collapse = "\\t")
    pca_rows <- vapply(seq_len(nrow(pca_score)), function(i) paste(c(
      rownames(pca_score)[i],
      as.character(pca_meta[i, pca_cols]),
      formatC(as.numeric(pca_score[i, ]), format = "g", digits = 6)
    ), collapse = "\\t"), character(1))
    pca_tsv <- paste(c(pca_header, pca_rows), collapse = "\\n")
    pca_var_tsv <- paste(c(
      "PC\\tvar_explained",
      paste(paste0("PC", seq_along(pca_var)),
            formatC(pca_var, format = "g", digits = 6), sep = "\\t")
    ), collapse = "\\n")

    # Serialize dds for worker-pool handoff.
    saveRDS(dds, file = "/tmp/dds.rds")

    out <- list(
      elapsed = elapsed,
      size_factors = size_factors_tsv,
      normalized_counts = normalized_counts_tsv,
      vst_counts = vst_counts_tsv,
      design = design_tsv,
      dispersions = disp_tsv,
      pca = pca_tsv,
      pca_var = pca_var_tsv
    )

    rm(counts, coldata, sf, nc, nc_header, nc_rows,
       vst_mat, vst_header, vst_rows,
       size_factors_tsv, normalized_counts_tsv, vst_counts_tsv,
       design_df, design_cols, design_header, design_rows, design_tsv,
       disp_df, disp_tsv,
       pca, pca_score, pca_meta, pca_cols, pca_header, pca_rows,
       pca_var, pca_tsv, pca_var_tsv)
    invisible(gc(full = TRUE, verbose = FALSE))

    out
    }, error = function(e) list(.fit_error = conditionMessage(e)))
    .fit_result
  `,
    { captureStreams: false, captureConditions: false },
  );
  const o = await r.toJs();
  const oNames = (o as { names?: string[] }).names;
  if (oNames?.includes('.fit_error')) {
    const msg = (o.values[oNames.indexOf('.fit_error')] as { values?: string[] }).values?.[0];
    throw new Error(`DESeq2 fit failed in R: ${msg ?? 'unknown error'}`);
  }
  const elapsed = (o.values[0] as { values: number[] }).values[0];
  const pick = (i: number) => (o.values[i] as { values: string[] }).values[0] ?? '';

  const ddsBlob = await webR.FS.readFile('/tmp/dds.rds');
  // Remove the on-disk copy; the dds R object stays in the session for lazy contrast extraction.
  await webR.evalRVoid(
    'if (file.exists("/tmp/dds.rds")) file.remove("/tmp/dds.rds"); invisible(gc(full = TRUE, verbose = FALSE))',
  );
  onProgress?.(
    `[fit] done in ${elapsed.toFixed(1)}s (dds blob ${(ddsBlob.byteLength / 1024 / 1024).toFixed(1)} MB)`,
  );

  return {
    levels: factorLevels,
    sizeFactorsTsv: pick(1),
    normalizedCountsTsv: pick(2),
    vstCountsTsv: pick(3),
    designTsv: pick(4),
    dispersionsTsv: pick(5),
    pcaTsv: pick(6),
    pcaVarTsv: pick(7),
    ddsBlob,
    elapsedSec: (performance.now() - t0) / 1000,
  };
}
