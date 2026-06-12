/// <reference lib="webworker" />
// GSEA permutation-null worker. Spawned as a pool (one per core) from the SQLite
// worker. Pure math only, no DB access. Each worker handles a share of total
// permutations across all bucket sizes and returns per-bucket pos/neg null arrays.

interface PermJob {
  type: 'perm';
  weights: Float64Array;
  N: number;
  bucketSizes: Int32Array;
  nperm: number; // permutation count assigned to THIS worker
  seed: number;
}

interface PermResp {
  type: 'perm';
  posArrays: Float64Array[];
  negArrays: Float64Array[];
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

function sampleIndicesInto(
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
  if (k <= 64) {
    for (let i = 1; i < k; i++) {
      const v = out[i];
      let j = i - 1;
      while (j >= 0 && out[j] > v) {
        out[j + 1] = out[j];
        j--;
      }
      out[j + 1] = v;
    }
  } else {
    out.subarray(0, k).sort();
  }
}

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

self.onmessage = (e: MessageEvent<PermJob>) => {
  const { weights, N, bucketSizes, nperm, seed } = e.data;
  const numBuckets = bucketSizes.length;
  const rng = makeRng(seed);

  const pool = new Int32Array(N);
  for (let i = 0; i < N; i++) pool[i] = i;
  let maxK = 0;
  for (let i = 0; i < numBuckets; i++) {
    if (bucketSizes[i] > maxK) maxK = bucketSizes[i];
  }
  const sampleBuf = new Int32Array(maxK);

  const posArrays: Float64Array[] = new Array(numBuckets);
  const negArrays: Float64Array[] = new Array(numBuckets);

  for (let b = 0; b < numBuckets; b++) {
    const k = bucketSizes[b];
    const pos = new Float64Array(nperm);
    const neg = new Float64Array(nperm);
    let np = 0;
    let nn = 0;
    for (let i = 0; i < nperm; i++) {
      sampleIndicesInto(pool, N, k, rng, sampleBuf);
      const es = computeES(sampleBuf, weights, N, k);
      if (es >= 0) pos[np++] = es;
      else neg[nn++] = es;
    }
    // Trim to actual count so transferred buffers aren't oversized.
    const posOut = new Float64Array(np);
    const negOut = new Float64Array(nn);
    for (let i = 0; i < np; i++) posOut[i] = pos[i];
    for (let i = 0; i < nn; i++) negOut[i] = neg[i];
    posArrays[b] = posOut;
    negArrays[b] = negOut;
  }

  const transfers: ArrayBuffer[] = [];
  for (const a of posArrays) transfers.push(a.buffer as ArrayBuffer);
  for (const a of negArrays) transfers.push(a.buffer as ArrayBuffer);
  const resp: PermResp = { type: 'perm', posArrays, negArrays };
  (self as DedicatedWorkerGlobalScope).postMessage(resp, transfers);
};
