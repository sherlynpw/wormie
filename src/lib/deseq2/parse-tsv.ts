import type { PCAPoint } from '$lib/components/PCAScatter.svelte';
import type { DispersionRow } from '$lib/components/DispersionPlot.svelte';
import type { SampleBox } from '$lib/components/CountsBoxplot.svelte';

const num = (s: string): number => (s === 'NA' || s === '' ? NaN : Number(s));

export function parsePca(tsv: string, varTsv: string): { points: PCAPoint[]; varExp: number[] } {
  const lines = tsv.split('\n').filter(Boolean);
  if (lines.length < 2) return { points: [], varExp: [] };
  const header = lines[0].split('\t');
  const pc1 = header.indexOf('PC1');
  const pc2 = header.indexOf('PC2');
  const condCol = header.indexOf('condition');
  const batchCol = header.indexOf('batch');
  const sampleCol = header.indexOf('sample');
  if (pc1 < 0 || pc2 < 0) return { points: [], varExp: [] };
  const points: PCAPoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    points.push({
      sample: c[sampleCol] ?? `s${i}`,
      x: num(c[pc1]),
      y: num(c[pc2]),
      group: c[condCol] ?? '?',
      shape: batchCol >= 0 ? (c[batchCol] ?? null) : null,
    });
  }
  const varExp: number[] = [];
  const vlines = varTsv.split('\n').filter(Boolean);
  for (let i = 1; i < vlines.length; i++) {
    const v = vlines[i].split('\t');
    varExp.push(num(v[1]));
  }
  return { points, varExp };
}

export function parseDispersions(
  tsv: string,
  baseMeanByGene: Map<string, number>,
): DispersionRow[] {
  const lines = tsv.split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const out: DispersionRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    const gene = c[0];
    out.push({
      gene,
      baseMean: baseMeanByGene.get(gene) ?? NaN,
      dispGeneEst: num(c[1]),
      dispFit: num(c[2]),
      dispersion: num(c[3]),
    });
  }
  return out;
}

function parseGeneByCellMatrix(tsv: string): { samples: string[]; rows: number[][] } {
  const lines = tsv.split('\n').filter(Boolean);
  if (lines.length < 2) return { samples: [], rows: [] };
  const header = lines[0].split('\t');
  const samples = header.slice(1);
  const rows: number[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    rows.push(c.slice(1).map(num));
  }
  return { samples, rows };
}

export function computeBaseMeanFromNormalizedCounts(tsv: string): Map<string, number> {
  const lines = tsv.split('\n').filter(Boolean);
  const out = new Map<string, number>();
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    let sum = 0;
    let n = 0;
    for (let j = 1; j < c.length; j++) {
      const v = num(c[j]);
      if (Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    out.set(c[0], n > 0 ? sum / n : NaN);
  }
  return out;
}

export function computeSampleDistances(vstTsv: string): { samples: string[]; matrix: number[][] } {
  const { samples, rows } = parseGeneByCellMatrix(vstTsv);
  const n = samples.length;
  if (n === 0) return { samples: [], matrix: [] };
  const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let s = 0;
      for (const r of rows) {
        const d = r[i] - r[j];
        if (Number.isFinite(d)) s += d * d;
      }
      const d = Math.sqrt(s);
      matrix[i][j] = d;
      matrix[j][i] = d;
    }
  }
  return { samples, matrix };
}

// Single-linkage cluster ordering: returns permutation of [0..n-1] for visual
// grouping in heatmap. Not a full dendrogram.
export function hclustOrder(matrix: number[][]): number[] {
  const n = matrix.length;
  if (n <= 2) return matrix.map((_, i) => i);
  const clusters: number[][] = matrix.map((_, i) => [i]);
  const dist: number[][] = matrix.map((row) => row.slice());
  while (clusters.length > 1) {
    let bestI = 0,
      bestJ = 1,
      bestD = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (dist[i][j] < bestD) {
          bestD = dist[i][j];
          bestI = i;
          bestJ = j;
        }
      }
    }
    // Pick merge orientation that keeps closest endpoints adjacent.
    const a = clusters[bestI];
    const b = clusters[bestJ];
    const aFirst = a[0],
      aLast = a[a.length - 1];
    const bFirst = b[0],
      bLast = b[b.length - 1];
    const opts: [number, number[]][] = [
      [matrix[aLast][bFirst], [...a, ...b]],
      [matrix[aLast][bLast], [...a, ...b.slice().reverse()]],
      [matrix[aFirst][bFirst], [...a.slice().reverse(), ...b]],
      [matrix[aFirst][bLast], [...a.slice().reverse(), ...b.slice().reverse()]],
    ];
    opts.sort((x, y) => x[0] - y[0]);
    const merged = opts[0][1];
    const newDist: number[] = [];
    for (let k = 0; k < clusters.length; k++) {
      if (k === bestI || k === bestJ) continue;
      newDist.push(Math.min(dist[bestI][k], dist[bestJ][k]));
    }
    const keep = clusters.filter((_, k) => k !== bestI && k !== bestJ);
    const keepDist = dist
      .filter((_, k) => k !== bestI && k !== bestJ)
      .map((row) => row.filter((_, k) => k !== bestI && k !== bestJ));
    for (let k = 0; k < keep.length; k++) {
      keepDist[k].push(newDist[k]);
    }
    newDist.push(0);
    keepDist.push(newDist);
    clusters.length = 0;
    clusters.push(...keep, merged);
    dist.length = 0;
    dist.push(...keepDist);
  }
  return clusters[0];
}

export function reorderDistance(
  samples: string[],
  matrix: number[][],
  order: number[],
): { samples: string[]; matrix: number[][] } {
  return {
    samples: order.map((i) => samples[i]),
    matrix: order.map((i) => order.map((j) => matrix[i][j])),
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function summarizeCountsToBoxes(tsv: string, log = true): SampleBox[] {
  const { samples, rows } = parseGeneByCellMatrix(tsv);
  const cols: number[][] = samples.map(() => []);
  for (const r of rows) {
    for (let j = 0; j < samples.length; j++) {
      const v = r[j];
      if (!Number.isFinite(v)) continue;
      cols[j].push(log ? Math.log10(v + 1) : v);
    }
  }
  return samples.map((s, j) => {
    const arr = cols[j].slice().sort((a, b) => a - b);
    return {
      sample: s,
      min: arr.length ? arr[0] : 0,
      q1: quantile(arr, 0.25),
      median: quantile(arr, 0.5),
      q3: quantile(arr, 0.75),
      max: arr.length ? arr[arr.length - 1] : 0,
    };
  });
}

export function geneRowFromCountsTsv(tsv: string, gene: string): Map<string, number> | null {
  const lines = tsv.split('\n').filter(Boolean);
  if (lines.length < 2) return null;
  const header = lines[0].split('\t');
  const samples = header.slice(1);
  const want = `${gene}\t`;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].startsWith(want) && lines[i].split('\t')[0] !== gene) continue;
    const c = lines[i].split('\t');
    if (c[0] !== gene) continue;
    const out = new Map<string, number>();
    for (let j = 0; j < samples.length; j++) out.set(samples[j], num(c[j + 1]));
    return out;
  }
  return null;
}

export function summarizeRawCountsFromFeatureCountsTsv(tsv: string, log = true): SampleBox[] {
  const lines = tsv.split('\n').filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) return [];
  const header = lines[0].split('\t');
  const sampleStart = 6;
  const samples = header.slice(sampleStart);
  const cols: number[][] = samples.map(() => []);
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    for (let j = 0; j < samples.length; j++) {
      const v = Number(c[sampleStart + j]);
      if (!Number.isFinite(v)) continue;
      cols[j].push(log ? Math.log10(v + 1) : v);
    }
  }
  return samples.map((s, j) => {
    const arr = cols[j].slice().sort((a, b) => a - b);
    return {
      sample: s,
      min: arr.length ? arr[0] : 0,
      q1: quantile(arr, 0.25),
      median: quantile(arr, 0.5),
      q3: quantile(arr, 0.75),
      max: arr.length ? arr[arr.length - 1] : 0,
    };
  });
}
