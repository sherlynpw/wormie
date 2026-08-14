// Phase 2: extract a single contrast from an already-fitted dds (primary
// instance or pool member after loadDdsBlob).

import type { WebRInstance } from './webr-instance';
import type { ContrastSpec, DESeq2Contrast, DESeq2Row, Shrinkage } from './types';

/** Load a serialized dds blob into a worker's R session as `dds`. */
export async function loadDdsBlob(webR: WebRInstance, blob: Uint8Array): Promise<void> {
  await webR.FS.writeFile('/tmp/dds.rds', blob);
  await webR.evalRVoid('dds <- readRDS("/tmp/dds.rds")');
}

function rStr(s: string) {
  return JSON.stringify(s);
}

function parseRows(tsv: string): DESeq2Row[] {
  const rows: DESeq2Row[] = [];
  const lines = tsv.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    if (c.length < 7) continue;
    const n = (s: string) => (s === 'NA' ? NaN : Number(s));
    rows.push({
      gene: c[0],
      baseMean: n(c[1]),
      log2FoldChange: n(c[2]),
      lfcSE: n(c[3]),
      stat: n(c[4]),
      pvalue: n(c[5]),
      padj: n(c[6]),
    });
  }
  return rows;
}

export async function runContrast(
  webR: WebRInstance,
  pair: ContrastSpec,
  shrinkage: Shrinkage,
  reference: string,
  alpha = 0.05,
): Promise<DESeq2Contrast> {
  const shrinkable = pair.reference === reference;
  // apeglm only works for coefficients against the factor reference; other pairs
  // fall back to ashr (matches celegans-pipeline).
  const effective: Shrinkage =
    shrinkage === 'none' ? 'none' : shrinkage === 'apeglm' && !shrinkable ? 'ashr' : shrinkage;

  const shrinkR =
    effective === 'apeglm'
      ? `tryCatch(lfcShrink(dds, coef = paste0("condition_", ${rStr(pair.treatment)}, "_vs_", ${rStr(pair.reference)}), type = "apeglm", quiet = TRUE), error = function(e) res)`
      : effective === 'ashr'
        ? `tryCatch(lfcShrink(dds, contrast = c("condition", ${rStr(pair.treatment)}, ${rStr(pair.reference)}), type = "ashr", quiet = TRUE), error = function(e) res)`
        : 'res';

  const script = `
    fmt <- function(x) ifelse(is.na(x), "NA", formatC(x, format = "g", digits = 6))
    res <- results(dds, contrast = c("condition", ${rStr(pair.treatment)}, ${rStr(pair.reference)}), alpha = ${Number.isFinite(alpha) && alpha > 0 && alpha < 1 ? alpha : 0.05})
    stat_values <- res$stat
    res <- ${shrinkR}
    df <- as.data.frame(res)
    df$gene <- rownames(df)
    df$stat <- stat_values
    paste(c(
      "gene\\tbaseMean\\tlog2FoldChange\\tlfcSE\\tstat\\tpvalue\\tpadj",
      apply(df, 1, function(r) paste(
        r[["gene"]], fmt(as.numeric(r[["baseMean"]])),
        fmt(as.numeric(r[["log2FoldChange"]])), fmt(as.numeric(r[["lfcSE"]])),
        fmt(as.numeric(r[["stat"]])), fmt(as.numeric(r[["pvalue"]])),
        fmt(as.numeric(r[["padj"]])),
        sep = "\\t"
      ))
    ), collapse = "\\n")
  `;
  const r = await webR.evalR(script, { captureStreams: false, captureConditions: false });
  const o = await r.toJs();
  const tsv = (o.values as unknown as string[])[0] ?? '';
  return {
    name: `${pair.treatment}_vs_${pair.reference}`,
    treatment: pair.treatment,
    reference: pair.reference,
    rows: parseRows(tsv),
    tsv,
    shrinkage: effective,
  };
}
