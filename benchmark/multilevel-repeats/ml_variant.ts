// Adaptive multilevel splitting Monte Carlo for preranked GSEA p-values.
// Korotkevich, Sukhov & Sergushichev (fgseaMultilevel, 2016/2019).
//
// Classical permutation floors at p >= 1/(nperm+1) (~1e-3 for nperm=1000).
// Multilevel estimates tail conditional probabilities level-by-level, reaching
// p << 1/M with ~M*log2(1/p) work.
//
// Algorithm (one-sided positive; mirror for negative):
//   1. Sample M random gene sets of size k and compute ES.
//   2. If >= M/2 exceed esObs, return direct fraction.
//   3. Let z = median ES. Drop lower half; refill by MH-mutating the upper
//      half (single-position swap), conditioning on ES > z.
//   4. Each level multiplies p by 0.5. Continue until z >= esObs.
//   5. Final p = 0.5^L * (count >= esObs) / M.
//
// Mutation is Metropolis-Hastings: swap one set member for a non-member,
// accept iff ES still beats the current threshold. Multiple MH steps per
// replacement improve mixing.

export interface MultilevelOpts {
  M?: number; // population size per level (fgseaMultilevel's own default is 101).
  mhSteps?: number; // MH steps per replacement; mixing quality.
  // Smallest p worth resolving, as fgseaMultilevel's eps (default 1e-50). Each level halves
  // p, so the level cap follows from it; a set beyond it is reported at the bound.
  eps?: number;
  maxLevels?: number; // safety cap to avoid runaway loops; defaults to log2(1/eps).
  seed?: number;
}

export interface MultilevelResult {
  p: number;
  levels: number;
  floorHit: boolean; // true if we bailed out at maxLevels
}

function makeRng(seed: number): () => number {
  let s = seed | 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 0xffffffff) / 0xffffffff;
  };
}

// O(k) running-sum ES given sorted positions. Mirrors gsea-worker.ts.
function computeES(positions: Int32Array, weights: Float64Array, N: number, k: number): number {
  if (k === 0 || k >= N) return 0;
  let totalPos = 0;
  for (let i = 0; i < k; i++) totalPos += weights[positions[i]];
  if (totalPos === 0) return 0;

  const missDecrement = 1 / (N - k);
  let cur = 0;
  let prev = -1;
  let maxAbs = 0;
  let signedAtMax = 0;

  for (let h = 0; h < k; h++) {
    const pos = positions[h];
    const gap = pos - prev - 1;
    if (gap > 0) {
      cur -= gap * missDecrement;
      const ab = cur < 0 ? -cur : cur;
      if (ab > maxAbs) {
        maxAbs = ab;
        signedAtMax = cur;
      }
    }
    cur += weights[pos] / totalPos;
    const ab = cur < 0 ? -cur : cur;
    if (ab > maxAbs) {
      maxAbs = ab;
      signedAtMax = cur;
    }
    prev = pos;
  }
  return signedAtMax;
}

// Insertion-sort Int32Array in place; faster than TypedArray.sort() for k <= 64.
function sortSmall(buf: Int32Array, k: number): void {
  if (k <= 64) {
    for (let i = 1; i < k; i++) {
      const v = buf[i];
      let j = i - 1;
      while (j >= 0 && buf[j] > v) {
        buf[j + 1] = buf[j];
        j--;
      }
      buf[j + 1] = v;
    }
  } else {
    buf.subarray(0, k).sort();
  }
}

// Uniformly random size-k subset of [0, N) into out, sorted.
function sampleSubset(
  pool: Int32Array,
  N: number,
  k: number,
  rng: () => number,
  out: Int32Array,
): void {
  const last = Math.min(k, N - 1);
  for (let i = 0; i < last; i++) {
    const j = i + Math.floor(rng() * (N - i));
    const t = pool[i];
    pool[i] = pool[j];
    pool[j] = t;
  }
  for (let i = 0; i < k; i++) out[i] = pool[i];
  sortSmall(out, k);
}

// One MH step: swap a random set member for a random non-member; accept iff
// resulting ES still beats threshold. membership is a bitset over [0, N).
function mhSwap(
  curr: Int32Array,
  k: number,
  N: number,
  weights: Float64Array,
  threshold: number,
  currES: number,
  signPositive: boolean,
  membership: Uint8Array,
  rng: () => number,
  scratch: Int32Array,
): number {
  const slot = Math.floor(rng() * k);
  let cand = Math.floor(rng() * N);
  // Re-roll until cand not in set; fast when k << N. Bail after 64 tries (pathological).
  let tries = 0;
  while (membership[cand] === 1) {
    cand = Math.floor(rng() * N);
    if (++tries > 64) return currES;
  }
  // Build proposed sorted positions in scratch.
  const old = curr[slot];
  for (let i = 0; i < k; i++) scratch[i] = curr[i];
  scratch[slot] = cand;
  sortSmall(scratch, k);
  const newES = computeES(scratch, weights, N, k);
  const ok = signPositive ? newES > threshold : newES < threshold;
  if (ok) {
    for (let i = 0; i < k; i++) curr[i] = scratch[i];
    membership[old] = 0;
    membership[cand] = 1;
    return newES;
  }
  return currES;
}

// Estimate P(ES >= esObs | positive) or P(ES <= esObs | negative) via adaptive
// multilevel. N = ranked-list length, k = gene-set size, weights[i] = |score_i|^p.
export function multilevelP(
  N: number,
  k: number,
  weights: Float64Array,
  esObs: number,
  opts: MultilevelOpts = {},
): MultilevelResult {
  const M = opts.M ?? 1000;
  const mhSteps = opts.mhSteps ?? 10;
  const eps = opts.eps ?? 1e-50;
  const maxLevels = opts.maxLevels ?? Math.ceil(Math.log2(1 / eps));
  const rng = makeRng(opts.seed ?? 0x9e37 + k * 31 + Math.round(esObs * 1e6));

  if (k <= 0 || k >= N || esObs === 0) return { p: 1, levels: 0, floorHit: false };

  const signPositive = esObs > 0;
  const target = esObs;

  // Initial population: M random size-k samples with their ES values.
  const samples = new Int32Array(M * k);
  const es = new Float64Array(M);
  const pool = new Int32Array(N);
  for (let i = 0; i < N; i++) pool[i] = i;
  const tmp = new Int32Array(k);
  for (let s = 0; s < M; s++) {
    sampleSubset(pool, N, k, rng, tmp);
    const offset = s * k;
    for (let i = 0; i < k; i++) samples[offset + i] = tmp[i];
    es[s] = computeES(tmp, weights, N, k);
  }

  // Fast path: if >= M/2 of initial sample already exceed target, return direct fraction.
  let direct = 0;
  for (let s = 0; s < M; s++) {
    if (signPositive ? es[s] >= target : es[s] <= target) direct++;
  }
  if (direct >= M / 2) {
    return { p: Math.max(1 / (M + 1), direct / M), levels: 0, floorHit: false };
  }

  let logP = 0; // accumulated log2 of conditional probabilities (sum of -1 per level).
  const idx = new Int32Array(M);
  const membership = new Uint8Array(N);
  const swap = new Int32Array(k);
  const scratch = new Int32Array(k);

  for (let level = 0; level < maxLevels; level++) {
    // Sort indices by ES to split at median: ascending for positive side
    // (drop lower half), descending for negative (drop less-negative half).
    for (let i = 0; i < M; i++) idx[i] = i;
    if (signPositive) {
      idx.subarray(0, M).sort((a, b) => es[a] - es[b]);
    } else {
      idx.subarray(0, M).sort((a, b) => es[b] - es[a]);
    }
    const half = M >>> 1;
    const medianIdx = idx[half];
    const z = es[medianIdx];

    // Stopping: median reached or passed target.
    if (signPositive ? z >= target : z <= target) {
      // Count how many of the final M samples are at-or-beyond target.
      let above = 0;
      for (let s = 0; s < M; s++) {
        if (signPositive ? es[s] >= target : es[s] <= target) above++;
      }
      const frac = Math.max(above, 1) / M;
      const logFinal = Math.log2(frac);
      return {
        p: Math.pow(2, logP + logFinal),
        levels: level,
        floorHit: false,
      };
    }

    // Replace worse half with MH-mutated copies of the upper half (ES > z).
    for (let i = 0; i < half; i++) {
      const target_i = idx[i];
      const parentSlot = idx[half + Math.floor(rng() * (M - half))];
      const parentOffset = parentSlot * k;
      const targetOffset = target_i * k;
      for (let j = 0; j < N; j++) membership[j] = 0;
      for (let j = 0; j < k; j++) {
        swap[j] = samples[parentOffset + j];
        membership[swap[j]] = 1;
      }
      let curES = es[parentSlot];
      for (let step = 0; step < mhSteps; step++) {
        curES = mhSwap(swap, k, N, weights, z, curES, signPositive, membership, rng, scratch);
      }
      for (let j = 0; j < k; j++) samples[targetOffset + j] = swap[j];
      es[target_i] = curES;
    }

    if ((opts as any).mutateAll) {
      for (let i = half; i < M; i++) {
        const slot = idx[i];
        const off = slot * k;
        for (let j = 0; j < N; j++) membership[j] = 0;
        for (let j = 0; j < k; j++) {
          swap[j] = samples[off + j];
          membership[swap[j]] = 1;
        }
        let curES = es[slot];
        for (let step = 0; step < mhSteps; step++)
          curES = mhSwap(swap, k, N, weights, z, curES, signPositive, membership, rng, scratch);
        for (let j = 0; j < k; j++) samples[off + j] = swap[j];
        es[slot] = curES;
      }
    }
    logP -= 1; // each level halves the conditional probability
  }

  // Level cap hit; return smallest claimable p.
  return { p: Math.pow(2, logP), levels: maxLevels, floorHit: true };
}
