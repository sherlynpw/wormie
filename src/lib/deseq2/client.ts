// Public surface for /de.
// Flow: runFit (slow, once) -> runOneContrast (primary instance) or runAllContrasts (ContrastPool).

import { getPrimary, runFit as fitImpl, rehydrateFromDdsBlob } from './fit';
export { rehydrateFromDdsBlob };
export { clearBundleCache } from './webr-instance';

// Starts WebR + library(DESeq2) in the background; safe to call multiple times (cached).
export function prewarmWebR(onProgress?: (line: string) => void): void {
  void getPrimary(onProgress);
}
import { runContrast } from './extract';
import { ContrastPool } from './worker-pool';
import type {
  ContrastSpec,
  DESeq2Contrast,
  DESeq2FitRequest,
  DESeq2FitResult,
  Shrinkage,
} from './types';

export type {
  ContrastSpec,
  DESeq2Contrast,
  DESeq2FitRequest,
  DESeq2FitResult,
  DESeq2DesignRow,
  DESeq2Row,
  PairwiseMode,
  Shrinkage,
} from './types';

export function runFit(
  req: DESeq2FitRequest,
  onProgress?: (line: string) => void,
): Promise<DESeq2FitResult> {
  return fitImpl(req, onProgress);
}

export async function runOneContrast(
  pair: ContrastSpec,
  shrinkage: Shrinkage,
  reference: string,
  onProgress?: (line: string) => void,
  alpha = 0.05,
): Promise<DESeq2Contrast> {
  const webR = await getPrimary(onProgress);
  onProgress?.(`[contrast] ${pair.treatment}_vs_${pair.reference} (${shrinkage})`);
  return runContrast(webR, pair, shrinkage, reference, alpha);
}

export async function runAllContrasts(
  ddsBlob: Uint8Array,
  pairs: ContrastSpec[],
  shrinkage: Shrinkage,
  reference: string,
  onProgress?: (line: string) => void,
  onContrast?: (i: number, c: DESeq2Contrast) => void,
  poolSize?: number,
  alpha = 0.05,
): Promise<DESeq2Contrast[]> {
  const pool = new ContrastPool(ddsBlob, reference, { onLine: onProgress, size: poolSize, alpha });
  onProgress?.(`[pool] running ${pairs.length} contrast(s) in parallel ...`);
  try {
    return await pool.runAll(pairs, shrinkage, onContrast);
  } finally {
    await pool.dispose();
  }
}
