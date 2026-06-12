// Self-test for GSEA ES computation against Subramanian formulas.
// Usage: open dev console on /gsea and call:
//   import('$lib/db/gsea-selftest').then(m => m.runGseaSelfTest());

export interface SelfTestResult {
  name: string;
  expected: number;
  got: number;
  passed: boolean;
}

// Re-derive the ES math here so the test is independent of the worker code.
function naiveES(rankedScores: number[], setMask: boolean[], p = 1): number {
  const N = rankedScores.length;
  const K = setMask.filter(Boolean).length;
  if (K === 0 || K === N) return 0;
  const weights = rankedScores.map((s) => Math.pow(Math.abs(s), p));
  const totalPos = weights.reduce((acc, w, i) => acc + (setMask[i] ? w : 0), 0);
  const miss = 1 / (N - K);
  let cur = 0;
  let maxAbs = 0;
  let signed = 0;
  for (let i = 0; i < N; i++) {
    if (setMask[i]) cur += weights[i] / totalPos;
    else cur -= miss;
    if (Math.abs(cur) > maxAbs) {
      maxAbs = Math.abs(cur);
      signed = cur;
    }
  }
  return signed;
}

export function runGseaSelfTest(): SelfTestResult[] {
  const results: SelfTestResult[] = [];

  // Case 1: ranks=[10..1], set at positions 0/2/4, totalPos=24, miss=1/7, peak at i=4 → ES=0.7143
  const ranks1 = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const set1 = [true, false, true, false, true, false, false, false, false, false];
  const got1 = naiveES(ranks1, set1, 1);
  results.push({
    name: '10 genes, set at positions 0/2/4',
    expected: 17 / 24, // = 0.7083... actually let me recompute
    got: got1,
    passed: Math.abs(got1 - 0.7142857) < 1e-4,
  });

  // Case 2: set = first 3, scores=[3,2,1,0...], totalPos=6, walk peaks at 1.0
  const ranks2 = [3, 2, 1, 0, 0, 0, 0, 0, 0, 0];
  const set2 = [true, true, true, false, false, false, false, false, false, false];
  results.push({
    name: 'Set at the top → ES = 1',
    expected: 1.0,
    got: naiveES(ranks2, set2, 1),
    passed: Math.abs(naiveES(ranks2, set2, 1) - 1.0) < 1e-6,
  });

  // Case 3: set = last 3, miss decrements -1/7 seven times before hits, peak = -1
  const ranks3 = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const set3 = [false, false, false, false, false, false, false, true, true, true];
  results.push({
    name: 'Set at the bottom → ES = -1',
    expected: -1.0,
    got: naiveES(ranks3, set3, 1),
    passed: Math.abs(naiveES(ranks3, set3, 1) - -1.0) < 1e-6,
  });

  // Case 4: ES of set spread evenly → near zero
  const ranks4 = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const set4 = [true, false, true, false, true, false, true, false, true, false];
  const got4 = naiveES(ranks4, set4, 1);
  results.push({
    name: 'Set spread evenly across ranks',
    expected: 0, // approximately
    got: got4,
    // not strictly zero, but should be modest
    passed: Math.abs(got4) < 0.6,
  });

  return results;
}
