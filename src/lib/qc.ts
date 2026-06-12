// Pre-fit sample QC: library sizes, log2-CPM, sample correlation, PCA on a featureCounts-style counts matrix.

export interface CountsMatrix {
  genes: string[];
  samples: string[];
  counts: Float64Array; // genes × samples, row-major
}

export function parseFeatureCountsTsv(text: string): CountsMatrix {
  const lines = text.split('\n').filter((l) => l.length && !l.startsWith('#'));
  if (lines.length < 2) return { genes: [], samples: [], counts: new Float64Array(0) };
  const header = lines[0].split('\t');
  // featureCounts: Geneid + 5 meta cols then samples (detect via chr header); plain gene\tS1\tS2 also accepted.
  const metaCols = header[1]?.toLowerCase() === 'chr' ? 6 : 1;
  const samples = header.slice(metaCols);
  const G = lines.length - 1;
  const S = samples.length;
  const genes = new Array<string>(G);
  const counts = new Float64Array(G * S);
  for (let g = 0; g < G; g++) {
    const f = lines[g + 1].split('\t');
    genes[g] = f[0];
    for (let s = 0; s < S; s++) counts[g * S + s] = Number(f[metaCols + s]) || 0;
  }
  return { genes, samples, counts };
}

export function librarySizes(m: CountsMatrix): number[] {
  const S = m.samples.length;
  const out = new Array(S).fill(0);
  for (let g = 0; g < m.genes.length; g++) {
    const off = g * S;
    for (let s = 0; s < S; s++) out[s] += m.counts[off + s];
  }
  return out;
}

export function log2cpm(m: CountsMatrix, libs: number[]): Float64Array {
  const G = m.genes.length;
  const S = m.samples.length;
  const out = new Float64Array(G * S);
  const lib = libs.map((l) => Math.max(l, 1));
  for (let g = 0; g < G; g++) {
    const off = g * S;
    for (let s = 0; s < S; s++) out[off + s] = Math.log2((m.counts[off + s] * 1e6) / lib[s] + 1);
  }
  return out;
}

/** Per-sample Pearson correlation on a genes × samples matrix. */
export function sampleCorrelation(values: Float64Array, G: number, S: number): number[][] {
  const mean = new Float64Array(S);
  for (let g = 0; g < G; g++) {
    const off = g * S;
    for (let s = 0; s < S; s++) mean[s] += values[off + s];
  }
  for (let s = 0; s < S; s++) mean[s] /= G;
  const sd = new Float64Array(S);
  for (let g = 0; g < G; g++) {
    const off = g * S;
    for (let s = 0; s < S; s++) {
      const d = values[off + s] - mean[s];
      sd[s] += d * d;
    }
  }
  for (let s = 0; s < S; s++) sd[s] = Math.sqrt(sd[s] / Math.max(G - 1, 1));
  const cor: number[][] = Array.from({ length: S }, () => new Array<number>(S).fill(0));
  for (let i = 0; i < S; i++) {
    for (let j = i; j < S; j++) {
      let s = 0;
      for (let g = 0; g < G; g++) {
        s += (values[g * S + i] - mean[i]) * (values[g * S + j] - mean[j]);
      }
      const c = s / (Math.max(G - 1, 1) * sd[i] * sd[j] || 1);
      cor[i][j] = c;
      cor[j][i] = c;
    }
  }
  return cor;
}

/**
 * Top-2 PCA via Gram matrix X^T X eigen-decomposition (power iteration + deflation).
 * X is genes x samples (row-major); centering is per-gene. Restricts to top `topVar` (default 500) most-variable genes.
 */
export function pca2(
  X: Float64Array,
  G: number,
  S: number,
  topVar = 500,
): { scores: { x: number; y: number }[]; varExp: [number, number] } {
  const rowMean = new Float64Array(G);
  for (let g = 0; g < G; g++) {
    let m = 0;
    const off = g * S;
    for (let s = 0; s < S; s++) m += X[off + s];
    rowMean[g] = m / S;
  }
  const rowVar = new Float64Array(G);
  for (let g = 0; g < G; g++) {
    let v = 0;
    const off = g * S;
    for (let s = 0; s < S; s++) {
      const d = X[off + s] - rowMean[g];
      v += d * d;
    }
    rowVar[g] = v;
  }
  const idx = Array.from({ length: G }, (_, i) => i);
  idx.sort((a, b) => rowVar[b] - rowVar[a]);
  const keep = idx.slice(0, Math.min(topVar, G));

  // Build Gram matrix G_M = X^T X / (n-1), samples x samples.
  const Gm: number[][] = Array.from({ length: S }, () => new Array<number>(S).fill(0));
  for (const g of keep) {
    const m = rowMean[g];
    const off = g * S;
    for (let i = 0; i < S; i++) {
      const xi = X[off + i] - m;
      for (let j = i; j < S; j++) {
        const xj = X[off + j] - m;
        Gm[i][j] += xi * xj;
      }
    }
  }
  for (let i = 0; i < S; i++) for (let j = i + 1; j < S; j++) Gm[j][i] = Gm[i][j];

  let trace = 0;
  for (let i = 0; i < S; i++) trace += Gm[i][i];

  const mv = (M: number[][], v: number[]): number[] => {
    const r = new Array<number>(S).fill(0);
    for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) r[i] += M[i][j] * v[j];
    return r;
  };
  const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
  const norm = (v: number[]) => Math.sqrt(dot(v, v));

  function powerIter(M: number[][]): { v: number[]; lambda: number } {
    let v = new Array<number>(S).fill(0).map((_, i) => Math.sin(i + 1));
    const n = norm(v);
    for (let i = 0; i < S; i++) v[i] /= n;
    for (let it = 0; it < 200; it++) {
      const Mv = mv(M, v);
      const m = norm(Mv);
      if (m < 1e-12) break;
      const next = Mv.map((x) => x / m);
      let drift = 0;
      for (let i = 0; i < S; i++) drift += Math.abs(next[i] - v[i]);
      v = next;
      if (drift < 1e-10) break;
    }
    return { v, lambda: dot(v, mv(M, v)) };
  }

  const e1 = powerIter(Gm);
  const G2: number[][] = Gm.map((r, i) => r.map((x, j) => x - e1.lambda * e1.v[i] * e1.v[j]));
  const e2 = powerIter(G2);

  const sx = e1.v.map((c) => c * Math.sqrt(Math.abs(e1.lambda)));
  const sy = e2.v.map((c) => c * Math.sqrt(Math.abs(e2.lambda)));
  const scores = Array.from({ length: S }, (_, i) => ({ x: sx[i], y: sy[i] }));
  const varExp: [number, number] = trace > 0 ? [e1.lambda / trace, e2.lambda / trace] : [0, 0];
  return { scores, varExp };
}
