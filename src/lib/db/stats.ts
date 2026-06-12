// Statistical helpers shared by enrichment and GSEA workers (lgamma, logSumExp, hypergeometric, BH FDR).

export function lgamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
}

export function logSumExp(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const m = Math.max(a, b);
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
}

// P(X >= k | K, n, N): k=observed hits, K=feature count in population, n=sample size, N=population size. Used for ORA p-values.
export function hyperUpperTail(k: number, K: number, n: number, N: number): number {
  if (k <= 0) return 1;
  if (k > Math.min(n, K)) return 0;
  let logSum = -Infinity;
  const top = Math.min(n, K);
  for (let i = k; i <= top; i++) {
    const lp = logChoose(K, i) + logChoose(N - K, n - i) - logChoose(N, n);
    logSum = logSumExp(logSum, lp);
  }
  return Math.exp(Math.min(logSum, 0));
}

// Benjamini-Hochberg step-up FDR adjustment.
export function bhFdr(pvalues: number[]): number[] {
  const m = pvalues.length;
  const idx = pvalues.map((_, i) => i).sort((a, b) => pvalues[a] - pvalues[b]);
  const q = new Array<number>(m);
  let prev = 1.0;
  for (let r = m - 1; r >= 0; r--) {
    const i = idx[r];
    const adj = Math.min(prev, (pvalues[i] * m) / (r + 1));
    q[i] = adj;
    prev = adj;
  }
  return q;
}
