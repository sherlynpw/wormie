// Shared types between featureCounts worker and main thread.

export interface FeatureCountsRequest {
  /** Files to count. Each entry is the raw BAM bytes + the in-FS filename. */
  bams: { name: string; bytes: Uint8Array }[];
  /** GTF or SAF annotation. Format inferred from extension. */
  annotation: { name: string; bytes: Uint8Array };
  /** Threads for the WASM build's pthread pool. 1-8 are reasonable. */
  threads: number;
  /** Paired-end fragment counting. */
  isPaired: boolean;
  /** Optional extra featureCounts CLI args (advanced users). */
  extraArgs?: string[];
}

export interface FeatureCountsResult {
  /** Tab-separated counts.txt. First line is the command, second is the header. */
  countsTsv: string;
  /** counts.txt.summary as TSV. Per-sample assignment categories. */
  summaryTsv: string;
  /** Parsed numeric counts matrix. Rows = genes, columns = samples (BAM filenames). */
  matrix: {
    genes: string[];
    samples: string[];
    counts: number[][];
  };
  /** Wallclock seconds spent inside featureCounts (R-side). */
  elapsedSec: number;
  /** Captured stdout/stderr from featureCounts (for diagnostic UI). */
  log: string;
}

export type WorkerMessage =
  | { type: 'progress'; line: string }
  | { type: 'result'; payload: FeatureCountsResult }
  | { type: 'error'; message: string };
