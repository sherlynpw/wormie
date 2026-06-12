// Shared types for the in-browser DESeq2 client.

export interface DESeq2DesignRow {
  /** Sample column name (must match a column in the counts matrix). */
  sample: string;
  /** Condition label, e.g. "WT" / "TGFb". */
  condition: string;
  /** Optional batch label; when set on every row, design becomes ~ batch + condition. */
  batch?: string;
}

export type Shrinkage = 'apeglm' | 'ashr' | 'none';

export type PairwiseMode = 'vs-reference' | 'all-pairwise';

export interface DESeq2FitRequest {
  /** Raw featureCounts-style counts.tsv. */
  countsTsv: string;
  /** Per-sample condition (and optional batch) mapping. */
  design: DESeq2DesignRow[];
  /** Reference level for the factor; all other levels are contrasted against it. */
  reference: string;
  /** Drop genes whose summed counts across samples are below this. 0 disables. */
  minCount?: number;
}

export interface ContrastSpec {
  treatment: string;
  reference: string;
}

export interface DESeq2Row {
  gene: string;
  baseMean: number;
  log2FoldChange: number;
  lfcSE: number;
  stat: number;
  pvalue: number;
  padj: number;
}

export interface DESeq2Contrast {
  /** "<treatment>_vs_<reference>", matches DESeq2's internal coef naming. */
  name: string;
  treatment: string;
  reference: string;
  rows: DESeq2Row[];
  /** Tab-separated rendering of `rows` for download / /enrichment handoff. */
  tsv: string;
  /** Which shrinkage was actually applied to this contrast. */
  shrinkage: Shrinkage;
}

export interface DESeq2FitResult {
  /** Levels in factor order (reference first), used by the UI for pair enumeration. */
  levels: string[];
  /** Library size factors TSV (sample\tsize_factor). */
  sizeFactorsTsv: string;
  /** Median-of-ratios normalized counts (genes × samples TSV). */
  normalizedCountsTsv: string;
  /** Variance-stabilizing transform (genes × samples TSV). */
  vstCountsTsv: string;
  /** Per-sample design (sample\tcondition[\tbatch]) for sharing without R. */
  designTsv: string;
  /** Per-gene dispersion estimates (gene\tdispGeneEst\tdispFit\tdispersion). */
  dispersionsTsv: string;
  /** PCA on VST (sample\tcondition[\tbatch]\tPC1\tPC2\tPC3). */
  pcaTsv: string;
  /** Variance explained per PC (PC\tvar_explained). */
  pcaVarTsv: string;
  /** Serialized dds object via saveRDS; round-trips back into our app or real R. */
  ddsBlob: Uint8Array;
  /** Wallclock seconds for the fit (DESeq + VST + normalized counts). */
  elapsedSec: number;
}
