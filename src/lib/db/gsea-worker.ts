// Preranked GSEA implementation that runs inside the SQLite worker.
// Based on Subramanian et al. 2005 (running enrichment score) +
// Sergushichev 2016 (O(k) ES computation given precomputed weights) +
// Korotkevich 2016 (adaptive multilevel splitting for tail p-values).

import { multilevelP } from './fgsea-multilevel';
import { bhFdr } from './stats';
import { GO_POSITIVE, CENGEN_MIN_THRESHOLD } from './term-filters';
import { buildWormcatTerms, WORMCAT_LEVEL_ROWS_SQL, type WormcatLevelRow } from './wormcat-terms';
import { classById } from '../synaptogenesis-references';
// Permutation strategy: gene-set permutation (random samples of size |S| from
// the ranked background), standard for preranked GSEA without sample labels.

export type GseaKind =
  | 'go'
  | 'phenotype'
  | 'wormcat'
  | 'neuronal'
  | 'tissue'
  | 'disease'
  | 'cell-type'
  | 'synaptogenesis'
  | 'pathway';

// fgseaMultilevel's default eps: p-values below it are reported as this bound.
const MULTILEVEL_EPS = 1e-50;

export interface GseaResult {
  term_id: string;
  name: string;
  namespace?: string;
  size: number; // |S| in ranked list (after intersection)
  es: number; // enrichment score (-1..+1)
  nes: number; // normalized enrichment score
  p: number; // reported p: multilevel estimate when refined, else p_perm
  // Permutation p, conditional on the sign of ES (fgseaSimple). Absent in results saved
  // before it was recorded, where p is the permutation p unless multilevel replaced it.
  p_perm?: number;
  // True when the set is beyond the multilevel bound and p holds that bound (fgsea's eps),
  // so the true p-value is smaller still.
  p_at_bound?: boolean;
  q: number; // BH-adjusted, from p
  leading_edge: string[]; // genes contributing up to the |ES| peak
  members: string[]; // all set members present in the ranked list (for plotting)
}

// Fisher-Yates partial shuffle into a caller-provided buffer. `pool` must be
// Int32Array length >= N, pre-filled with [0, N). Reusing pool avoids per-call
// allocation churn across ~200k calls. Result is sorted in-place.
function _sampleIndicesInto(
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
  // Insertion sort beats .sort() for k <= 64 due to constant overhead.
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

// xorshift32: fast, reproducible PRNG for permutations.
function _makeRng(seed: number): () => number {
  let s = seed | 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 0xffffffff) / 0xffffffff;
  };
}

// Running-sum enrichment score for one set. Returns { es, peak } where peak
// is the ranked-list index at max |ES|, used for leading-edge extraction.
function computeES(
  positions: ArrayLike<number>,
  weights: Float64Array,
  N: number,
  len?: number,
): { es: number; peak: number } {
  const k = len ?? positions.length;
  if (k === 0 || k >= N) return { es: 0, peak: 0 };

  let totalPos = 0;
  for (let i = 0; i < k; i++) totalPos += weights[positions[i]];
  if (totalPos === 0) return { es: 0, peak: 0 };

  const missDecrement = 1 / (N - k);
  let cur = 0;
  let prev = -1;
  let maxAbs = 0;
  let signedAtMax = 0;
  let peak = 0;

  for (let h = 0; h < k; h++) {
    const pos = positions[h];
    const gap = pos - prev - 1;
    if (gap > 0) {
      cur -= gap * missDecrement;
      if (Math.abs(cur) > maxAbs) {
        maxAbs = Math.abs(cur);
        signedAtMax = cur;
        peak = pos - 1;
      }
    }
    // Hit: cur jumps up by weight/totalPos.
    cur += weights[pos] / totalPos;
    if (Math.abs(cur) > maxAbs) {
      maxAbs = Math.abs(cur);
      signedAtMax = cur;
      peak = pos;
    }
    prev = pos;
  }
  return { es: signedAtMax, peak };
}

function execAll<T>(db: any, sql: string, bind: unknown[] = []): T[] {
  const rows: T[] = [];
  db.exec({
    sql,
    bind,
    rowMode: 'object',
    callback: (row: T) => rows.push(row),
  });
  return rows;
}

interface TermSet {
  term_id: string;
  name: string;
  namespace?: string;
  genes: string[];
}

function loadTermSets(db: any, kind: GseaKind): TermSet[] {
  if (kind === 'go') {
    const rows = execAll<{ go_id: string; name: string; namespace: string; wormbase_gene: string }>(
      db,
      `SELECT DISTINCT t.go_id, t.name, t.namespace, gg.wormbase_gene
			 FROM gene_go gg
			 JOIN go_terms t ON t.go_id = gg.go_id
			 WHERE t.is_obsolete = 0 AND ${GO_POSITIVE}
			 ORDER BY t.go_id`,
    );
    const sets = new Map<string, TermSet>();
    for (const r of rows) {
      let s = sets.get(r.go_id);
      if (!s) {
        s = { term_id: r.go_id, name: r.name, namespace: r.namespace, genes: [] };
        sets.set(r.go_id, s);
      }
      s.genes.push(r.wormbase_gene);
    }
    return [...sets.values()];
  }
  if (kind === 'phenotype') {
    const rows = execAll<{ term_id: string; name: string; wormbase_gene: string }>(
      db,
      `SELECT DISTINCT gp.term_id, COALESCE(pt.name, gp.term_id) AS name, gp.wormbase_gene
			 FROM gene_phenotype gp
			 LEFT JOIN phenotype_terms pt ON pt.term_id = gp.term_id`,
    );
    const sets = new Map<string, TermSet>();
    for (const r of rows) {
      let s = sets.get(r.term_id);
      if (!s) {
        s = { term_id: r.term_id, name: r.name, genes: [] };
        sets.set(r.term_id, s);
      }
      s.genes.push(r.wormbase_gene);
    }
    return [...sets.values()];
  }
  if (kind === 'wormcat') {
    const terms = buildWormcatTerms(execAll<WormcatLevelRow>(db, WORMCAT_LEVEL_ROWS_SQL));
    return [...terms].map(([term_id, genes]) => ({ term_id, name: term_id, genes: [...genes] }));
  }
  if (kind === 'neuronal') {
    const rows = execAll<{ term_id: string; wormbase_gene: string }>(
      db,
      `SELECT category AS term_id, wormbase_gene FROM neuronal WHERE category IS NOT NULL`,
    );
    const sets = new Map<string, TermSet>();
    for (const r of rows) {
      let s = sets.get(r.term_id);
      if (!s) {
        s = { term_id: r.term_id, name: r.term_id, genes: [] };
        sets.set(r.term_id, s);
      }
      s.genes.push(r.wormbase_gene);
    }
    return [...sets.values()];
  }
  if (kind === 'disease') {
    let drows: { term_id: string; name: string; wormbase_gene: string }[] = [];
    try {
      drows = execAll<{ term_id: string; name: string; wormbase_gene: string }>(
        db,
        `SELECT DISTINCT do_id AS term_id, do_name AS name, wormbase_gene
				 FROM gene_disease`,
      );
    } catch {
      // gene_disease table not yet ingested
    }
    const sets = new Map<string, TermSet>();
    for (const r of drows) {
      let s = sets.get(r.term_id);
      if (!s) {
        s = { term_id: r.term_id, name: r.name, genes: [] };
        sets.set(r.term_id, s);
      }
      s.genes.push(r.wormbase_gene);
    }
    return [...sets.values()];
  }
  if (kind === 'synaptogenesis') {
    let srows: { term_id: string; wormbase_gene: string }[] = [];
    try {
      srows = execAll<{ term_id: string; wormbase_gene: string }>(
        db,
        'SELECT DISTINCT class AS term_id, wormbase_gene FROM synaptogenesis WHERE class IS NOT NULL',
      );
    } catch {
      // synaptogenesis table not yet ingested
    }
    const sets = new Map<string, TermSet>();
    for (const r of srows) {
      let s = sets.get(r.term_id);
      if (!s) {
        s = { term_id: r.term_id, name: classById(r.term_id)?.label ?? r.term_id, genes: [] };
        sets.set(r.term_id, s);
      }
      s.genes.push(r.wormbase_gene);
    }
    return [...sets.values()];
  }
  if (kind === 'pathway') {
    // Mirrors enrichment-worker's pathway sets; empty on DISABLE_KEGG builds,
    // where the UI hides the tab anyway.
    let prows: { term_id: string; name: string; wormbase_gene: string }[] = [];
    try {
      prows = execAll<{ term_id: string; name: string; wormbase_gene: string }>(
        db,
        `SELECT DISTINCT gkp.pathway_id AS term_id,
                COALESCE(p.name, gkp.pathway_id) AS name,
                gkp.wormbase_gene
         FROM gene_kegg_pathway gkp
         LEFT JOIN kegg_pathway p ON p.pathway_id = gkp.pathway_id`,
      );
    } catch {
      // KEGG tables not ingested (DISABLE_KEGG build)
    }
    const sets = new Map<string, TermSet>();
    for (const r of prows) {
      let s = sets.get(r.term_id);
      if (!s) {
        s = { term_id: r.term_id, name: r.name, genes: [] };
        sets.set(r.term_id, s);
      }
      s.genes.push(r.wormbase_gene);
    }
    return [...sets.values()];
  }

  if (kind === 'cell-type') {
    let crows: { term_id: string; wormbase_gene: string }[] = [];
    try {
      crows = execAll<{ term_id: string; wormbase_gene: string }>(
        db,
        `SELECT DISTINCT neuron_type AS term_id, wormbase_gene
         FROM cengen_calls WHERE max_threshold >= ?`,
        [CENGEN_MIN_THRESHOLD],
      );
    } catch {
      // cengen tables not ingested
    }
    const sets = new Map<string, TermSet>();
    for (const r of crows) {
      let s = sets.get(r.term_id);
      if (!s) {
        s = { term_id: r.term_id, name: r.term_id, genes: [] };
        sets.set(r.term_id, s);
      }
      s.genes.push(r.wormbase_gene);
    }
    return [...sets.values()];
  }
  // tissue
  let trows: { term_id: string; name: string; wormbase_gene: string }[] = [];
  try {
    trows = execAll<{ term_id: string; name: string; wormbase_gene: string }>(
      db,
      `SELECT DISTINCT ga.term_id,
			        COALESCE(at.name, ga.term_id) AS name,
			        ga.wormbase_gene
			 FROM gene_anatomy ga
			 LEFT JOIN anatomy_terms at ON at.term_id = ga.term_id`,
    );
  } catch {
    // anatomy tables not yet ingested
  }
  const sets = new Map<string, TermSet>();
  for (const r of trows) {
    let s = sets.get(r.term_id);
    if (!s) {
      s = { term_id: r.term_id, name: r.name, genes: [] };
      sets.set(r.term_id, s);
    }
    s.genes.push(r.wormbase_gene);
  }
  return [...sets.values()];
}

// Module-scope cache; key = kind. Loaded once per worker lifetime.
const termSetsCache: Partial<Record<GseaKind, TermSet[]>> = {};

function getTermSets(db: any, kind: GseaKind): TermSet[] {
  if (!termSetsCache[kind]) termSetsCache[kind] = loadTermSets(db, kind);
  return termSetsCache[kind]!;
}

export interface GseaInput {
  gene: string;
  score: number;
}

export type ReportFn = (phase: string, current?: number, total?: number) => void;

// Compute-worker pool for parallel permutation sampling. Created lazily, reused per SQLite worker.
let permPool: any[] | null = null;
function getPermPool(): Worker[] {
  if (permPool) return permPool;
  const maxCores = (self as DedicatedWorkerGlobalScope).navigator?.hardwareConcurrency ?? 4;
  // Reserve one core for main thread + sqlite worker; cap at 6 to bound RAM.
  const N = Math.max(1, Math.min(6, maxCores - 1));
  const workers: Worker[] = [];
  for (let i = 0; i < N; i++) {
    workers.push(new Worker(new URL('./gsea-perm-worker.ts', import.meta.url), { type: 'module' }));
  }
  permPool = workers;
  return workers;
}

interface PermResp {
  type: 'perm';
  posArrays: Float64Array[];
  negArrays: Float64Array[];
}

function dispatchOne(
  w: Worker,
  weights: Float64Array,
  N: number,
  bucketSizes: Int32Array,
  nperm: number,
  seed: number,
): Promise<PermResp> {
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent<PermResp>) => {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
      resolve(e.data);
    };
    const onErr = (e: ErrorEvent) => {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
      reject(new Error(e.message || 'perm worker error'));
    };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    // Copy: don't transfer, we still need weights locally.
    const weightsCopy = new Float64Array(weights);
    const sizesCopy = new Int32Array(bucketSizes);
    w.postMessage({ type: 'perm', weights: weightsCopy, N, bucketSizes: sizesCopy, nperm, seed }, [
      weightsCopy.buffer as ArrayBuffer,
      sizesCopy.buffer as ArrayBuffer,
    ]);
  });
}

function runPermInline(
  weights: Float64Array,
  N: number,
  bucketSizes: Int32Array,
  nperm: number,
  seed: number,
): PermResp {
  const numBuckets = bucketSizes.length;
  const rng = _makeRng(seed);
  const pool = new Int32Array(N);
  for (let i = 0; i < N; i++) pool[i] = i;
  let maxK = 0;
  for (let i = 0; i < numBuckets; i++) if (bucketSizes[i] > maxK) maxK = bucketSizes[i];
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
      _sampleIndicesInto(pool, N, k, rng, sampleBuf);
      const { es } = computeES(sampleBuf, weights, N, k);
      if (es >= 0) pos[np++] = es;
      else neg[nn++] = es;
    }
    posArrays[b] = pos.slice(0, np);
    negArrays[b] = neg.slice(0, nn);
  }
  return { type: 'perm', posArrays, negArrays };
}

export interface CustomGseaSet {
  term_id: string;
  name: string;
  genes: string[];
}

export async function runGseaSync(
  db: any,
  ranked: GseaInput[],
  kind: GseaKind,
  opts: {
    minSize?: number;
    maxSize?: number;
    weight?: number; // p exponent in |score|^p (1 = classic weighted)
    nperm?: number;
    seed?: number;
    // If provided, used instead of DB-backed term sets (supports /gmt route with user collections).
    customSets?: CustomGseaSet[];
    // When true (default), refines p-values at the permutation floor (p ~ 1/(nperm+1))
    // via Korotkevich's adaptive multilevel estimator (~M*log2(1/p) extra work per term).
    multilevel?: boolean;
    multilevelM?: number; // population size per level (default 500).
    multilevelMhSteps?: number; // MH mixing steps per replacement (default 10).
  } = {},
  report?: ReportFn,
): Promise<GseaResult[]> {
  const minSize = opts.minSize ?? 5;
  const maxSize = opts.maxSize ?? 1000;
  const p = opts.weight ?? 1;
  const nperm = opts.nperm ?? 1000;
  const seed = opts.seed ?? 1337;

  // A gene listed twice (two aliases resolving to one WBGene, or a duplicated row)
  // keeps its strongest score, so input order never changes the ranking.
  const best = new Map<string, number>();
  for (const r of ranked) {
    if (!r.gene || !Number.isFinite(r.score)) continue;
    const prev = best.get(r.gene);
    if (prev === undefined || Math.abs(r.score) > Math.abs(prev)) best.set(r.gene, r.score);
  }
  const cleaned: GseaInput[] = [...best].map(([gene, score]) => ({ gene, score }));
  cleaned.sort((a, b) => b.score - a.score);
  if (cleaned.length < 10) return [];

  const N = cleaned.length;
  const geneToPos = new Map<string, number>();
  const weights = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    geneToPos.set(cleaned[i].gene, i);
    weights[i] = Math.pow(Math.abs(cleaned[i].score), p);
  }

  let termSets: TermSet[];
  if (opts.customSets && opts.customSets.length > 0) {
    report?.(`Using ${opts.customSets.length} custom term sets...`);
    termSets = opts.customSets.map((s) => ({
      term_id: s.term_id,
      name: s.name,
      genes: s.genes,
    }));
  } else {
    const termSetsCold = !termSetsCache[kind];
    if (termSetsCold) report?.(`Loading ${kind} term sets...`);
    termSets = getTermSets(db, kind);
  }

  report?.(`Scoring observed ES (${termSets.length} terms)...`);

  type Cand = TermSet & { positions: number[]; es: number; peak: number };
  const candidates: Cand[] = [];
  for (const ts of termSets) {
    const posSet = new Set<number>();
    for (const g of ts.genes) {
      const pos = geneToPos.get(g);
      if (pos !== undefined) posSet.add(pos);
    }
    const positions = [...posSet];
    if (positions.length < minSize || positions.length > maxSize) continue;
    positions.sort((a, b) => a - b);
    const { es, peak } = computeES(positions, weights, N);
    candidates.push({ ...ts, positions, es, peak });
  }
  if (candidates.length === 0) return [];

  // Null distribution by gene-set permutation, bucketed in log space (fgsea-style):
  // sizes within ~10% share one bucket, reducing ~200 unique sizes to ~25 buckets.
  const BUCKET_LOG_WIDTH = Math.log(1.1);
  const bucketKeyForSize = (k: number) => Math.round(Math.log(k) / BUCKET_LOG_WIDTH);
  const bucketRepSize = new Map<number, number>(); // key -> a representative size
  for (const c of candidates) {
    const key = bucketKeyForSize(c.positions.length);
    if (!bucketRepSize.has(key)) bucketRepSize.set(key, c.positions.length);
  }

  // Each worker runs nperm/poolSize permutations for every bucket (unique seed),
  // results are concatenated. Uniform bucket assignment avoids load imbalance.
  const bucketKeys = [...bucketRepSize.keys()];
  const bucketSizes = new Int32Array(bucketKeys.length);
  for (let i = 0; i < bucketKeys.length; i++) bucketSizes[i] = bucketRepSize.get(bucketKeys[i])!;

  let partials: PermResp[];
  try {
    const workers = getPermPool();
    const share = Math.ceil(nperm / workers.length);
    report?.(
      `Permutations (${nperm.toLocaleString()} × ${bucketSizes.length} buckets, ${workers.length} workers)`,
      0,
      workers.length,
    );

    let completed = 0;
    const jobs = workers.map((w, i) => {
      const p = dispatchOne(w, weights, N, bucketSizes, share, seed + i * 0x9e37);
      p.then(() => {
        completed++;
        report?.(
          `Permutations (${nperm.toLocaleString()} × ${bucketSizes.length} buckets)`,
          completed,
          workers.length,
        );
      });
      return p;
    });
    partials = await Promise.all(jobs);
  } catch {
    if (permPool) {
      for (const w of permPool) {
        try {
          w.terminate();
        } catch {
          /* ignore */
        }
      }
      permPool = null;
    }
    report?.(
      `Permutations (${nperm.toLocaleString()} × ${bucketSizes.length} buckets, single-threaded)`,
    );
    partials = [runPermInline(weights, N, bucketSizes, nperm, seed)];
  }

  const nullByBucket = new Map<
    number,
    { pos: Float64Array; neg: Float64Array; nPos: number; nNeg: number }
  >();
  for (let b = 0; b < bucketKeys.length; b++) {
    let posLen = 0;
    let negLen = 0;
    for (const p of partials) {
      posLen += p.posArrays[b].length;
      negLen += p.negArrays[b].length;
    }
    const pos = new Float64Array(posLen || 1);
    const neg = new Float64Array(negLen || 1);
    let po = 0;
    let no = 0;
    for (const p of partials) {
      pos.set(p.posArrays[b], po);
      po += p.posArrays[b].length;
      neg.set(p.negArrays[b], no);
      no += p.negArrays[b].length;
    }
    nullByBucket.set(bucketKeys[b], { pos, neg, nPos: posLen, nNeg: negLen });
  }
  report?.('Computing NES and FDR...');

  // signFrac is fgsea's denomProb: the share of null ES with the observed sign. The
  // permutation p is conditional on that sign, so the unconditional multilevel
  // estimate is divided by it to put both on the same scale.
  function nesForSize(es: number, k: number): { nes: number; pval: number; signFrac: number } {
    const buckets = nullByBucket.get(bucketKeyForSize(k))!;
    const nAll = buckets.nPos + buckets.nNeg;
    const signFrac = ((es >= 0 ? buckets.nPos : buckets.nNeg) + 1) / (nAll + 1);
    if (es >= 0) {
      let sum = 0;
      for (const v of buckets.pos) sum += v;
      const mean = buckets.pos.length ? sum / buckets.pos.length : 1e-9;
      const denom = Math.abs(mean) || 1e-9;
      const nes = es / denom;
      let more = 0;
      for (const v of buckets.pos) if (v >= es) more++;
      const pval = (more + 1) / (buckets.pos.length + 1);
      return { nes, pval, signFrac };
    } else {
      let sum = 0;
      for (const v of buckets.neg) sum += v;
      const mean = buckets.neg.length ? sum / buckets.neg.length : -1e-9;
      const denom = Math.abs(mean) || 1e-9;
      const nes = -Math.abs(es / denom);
      let more = 0;
      for (const v of buckets.neg) if (v <= es) more++;
      const pval = (more + 1) / (buckets.neg.length + 1);
      return { nes, pval, signFrac };
    }
  }

  const signFracs: number[] = [];
  const enriched: GseaResult[] = candidates.map((c) => {
    const { nes, pval, signFrac } = nesForSize(c.es, c.positions.length);
    signFracs.push(signFrac);
    // Leading edge: positions <= peak (positive ES) or >= peak (negative ES).
    let leading: number[];
    if (c.es >= 0) leading = c.positions.filter((x) => x <= c.peak);
    else leading = c.positions.filter((x) => x >= c.peak);
    const leadingGenes = leading.map((idx) => cleaned[idx].gene);
    const members = c.positions.map((idx) => cleaned[idx].gene);
    return {
      term_id: c.term_id,
      name: c.name,
      namespace: c.namespace,
      size: c.positions.length,
      es: c.es,
      nes,
      p: pval,
      p_perm: pval,
      q: 0,
      leading_edge: leadingGenes,
      members,
    };
  });

  // Multilevel refinement (Korotkevich et al. 2016/2019): any term within 3x
  // of the permutation floor (1/(nperm+1)) gets a per-term multilevel estimate
  // that reaches p << 1/nperm without additional permutations.
  const useMultilevel = opts.multilevel !== false;
  if (useMultilevel) {
    const M_ml = opts.multilevelM ?? 500;
    const mhSteps = opts.multilevelMhSteps ?? 10;
    const refineCutoff = 3 / (nperm + 1);
    const toRefine: number[] = [];
    for (let i = 0; i < enriched.length; i++) {
      if (enriched[i].p <= refineCutoff) toRefine.push(i);
    }
    if (toRefine.length > 0) {
      report?.(`Multilevel refinement (${toRefine.length} terms)...`, 0, toRefine.length);
      for (let r = 0; r < toRefine.length; r++) {
        const i = toRefine[r];
        const c = candidates[i];
        const ml = multilevelP(N, c.positions.length, weights, c.es, {
          eps: MULTILEVEL_EPS,
          M: M_ml,
          mhSteps,
          seed: seed + 0x515a + i * 137,
        });
        if (ml.floorHit) {
          enriched[i].p = MULTILEVEL_EPS;
          enriched[i].p_at_bound = true;
        } else {
          const pMl = Math.max(MULTILEVEL_EPS, Math.min(1, ml.p / signFracs[i]));
          // Only adopt if smaller and non-zero; larger values indicate MC noise above the floor.
          if (pMl > 0 && pMl < enriched[i].p) {
            enriched[i].p = pMl;
            if (pMl <= MULTILEVEL_EPS) enriched[i].p_at_bound = true;
          }
        }
        if (r % 8 === 7 || r === toRefine.length - 1) {
          report?.('Multilevel refinement', r + 1, toRefine.length);
        }
      }
    }
  }

  const qs = bhFdr(enriched.map((e) => e.p));
  for (let i = 0; i < enriched.length; i++) enriched[i].q = qs[i];

  // q < 0.25 significant first, then by |NES| desc.
  enriched.sort((a, b) => {
    const ag = a.q < 0.25 ? 1 : 0;
    const bg = b.q < 0.25 ? 1 : 0;
    if (bg !== ag) return bg - ag;
    return Math.abs(b.nes) - Math.abs(a.nes);
  });
  return enriched;
}
