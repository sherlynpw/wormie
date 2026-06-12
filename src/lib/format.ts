// Number formatting helpers for enrichment/GSEA tables, plots, and cross-reference panels.

// p/q-value: fixed >=0.01, scientific otherwise; "< 1e-300" guards exact zero
// (permutation p-value float floor).
export function fmtP(p: number): string {
  if (p === 0) return '< 1e-300';
  if (p >= 0.01) return p.toFixed(3);
  return p.toExponential(2);
}

// Fold-enrichment: 2 dp (scaled down at 10x/100x). Negative folds are guarded even though ORA shouldn't produce them.
export function fmtFold(f: number): string {
  if (!Number.isFinite(f)) return '—';
  if (Math.abs(f) >= 100) return f.toFixed(0);
  if (Math.abs(f) >= 10) return f.toFixed(1);
  return f.toFixed(2);
}
