// Single-sample GSEA (Barbie 2009 / GSVA::ssgseaParam).
//
// For each sample s and gene set S of size |S|, walk positions p in
// rank-by-expression-desc order:
//   in_step(p)  = |rank_p|^alpha / Σ_{j in S} |rank_j|^alpha   if gene_p ∈ S
//   out_step(p) = 1 / (N − |S|)                                if gene_p ∉ S
//   cum(p) = Σ_{q ≤ p} (in_step(q) − out_step(q))
//   score  = Σ_p cum(p)        (integral form)
// With normalize=true (GSVA default), final scores are scaled by
// (max(scores) − min(scores)) across the full sets × samples matrix.

export interface SsgseaSet {
  term_id: string;
  name: string;
  genes: string[];
}

export interface SsgseaOpts {
  alpha?: number;
  normalize?: boolean;
  minSize?: number;
  maxSize?: number;
}

export interface SsgseaResult {
  term_id: string;
  name: string;
  size: number;
  scores: number[]; // length == nSamples, parallel to the sampleNames array
}

export type ReportFn = (phase: string, current?: number, total?: number) => void;

export interface ExprInput {
  genes: string[];
  samples: string[];
  matrix: Float64Array; // genes × samples, row-major (len = genes*samples)
}

export function runSsgseaSync(
  expr: ExprInput,
  sets: SsgseaSet[],
  opts: SsgseaOpts = {},
  report?: ReportFn,
): { results: SsgseaResult[]; sampleNames: string[] } {
  const alpha = opts.alpha ?? 0.25;
  const normalize = opts.normalize ?? true;
  const minSize = opts.minSize ?? 1;
  const maxSize = opts.maxSize ?? 1e9;

  const N = expr.genes.length;
  const S = expr.samples.length;
  const geneToIdx = new Map<string, number>();
  for (let i = 0; i < N; i++) geneToIdx.set(expr.genes[i], i);

  // Map sets to gene indices, drop genes not in the expression matrix.
  type Set = { term_id: string; name: string; idx: number[] };
  const filtered: Set[] = [];
  for (const s of sets) {
    const idx: number[] = [];
    for (const g of s.genes) {
      const j = geneToIdx.get(g);
      if (j !== undefined) idx.push(j);
    }
    if (idx.length >= minSize && idx.length <= maxSize) {
      filtered.push({ term_id: s.term_id, name: s.name, idx });
    }
  }
  if (filtered.length === 0) return { results: [], sampleNames: expr.samples };

  const scores = new Float64Array(filtered.length * S);
  const buf = new Int32Array(N);
  const order = new Int32Array(N);
  const inWeight = new Float64Array(N);
  // Positions at or after a gene in the walk, averaged over its tie block: the
  // integral of the running sum is the sum of each step times this count.
  const remaining = new Float64Array(N);

  for (let s = 0; s < S; s++) {
    if (s % 4 === 0) report?.(`Sample ${s + 1}/${S}`, s + 1, S);
    for (let g = 0; g < N; g++) buf[g] = g;
    const col = (g: number) => expr.matrix[g * S + s];
    const arr = Array.from(buf);
    arr.sort((a, b) => col(b) - col(a));
    for (let i = 0; i < N; i++) order[i] = arr[i];

    // |rank|^alpha, rank = 1..N from top (highest expression). Tied values share
    // the average of their ranks, as R's rank() does in GSVA, and also share
    // their average position in the walk: count data ties most genes with
    // another, and GSVA's score then depends on the input row order, by up to
    // half a percent of the score range on a 9-sample count table. Averaging
    // the position too makes the score a function of the values alone; without
    // ties both agree with GSVA to the last digit.
    for (let i = 0; i < N; ) {
      let j = i + 1;
      while (j < N && col(order[j]) === col(order[i])) j++;
      const rank = N - (i + j - 1) / 2;
      const w = Math.pow(rank, alpha);
      for (let t = i; t < j; t++) {
        inWeight[t] = w;
        remaining[t] = rank;
      }
      i = j;
    }

    for (let k = 0; k < filtered.length; k++) {
      const setIdx = filtered[k].idx;
      const m = setIdx.length;
      const inSet = new Uint8Array(N);
      for (const g of setIdx) inSet[g] = 1;

      let Z = 0;
      for (let i = 0; i < N; i++) if (inSet[order[i]]) Z += inWeight[i];
      if (Z === 0) {
        scores[k * S + s] = 0;
        continue;
      }
      const outStep = 1 / (N - m);
      let integral = 0;
      for (let i = 0; i < N; i++) {
        const step = inSet[order[i]] ? inWeight[i] / Z : -outStep;
        integral += step * remaining[i];
      }
      scores[k * S + s] = integral;
    }
  }

  if (normalize) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] < lo) lo = scores[i];
      if (scores[i] > hi) hi = scores[i];
    }
    const range = hi - lo;
    if (range > 0) for (let i = 0; i < scores.length; i++) scores[i] = scores[i] / range;
  }

  const results: SsgseaResult[] = filtered.map((f, k) => ({
    term_id: f.term_id,
    name: f.name,
    size: f.idx.length,
    scores: Array.from(scores.subarray(k * S, k * S + S)),
  }));
  return { results, sampleNames: expr.samples };
}
