import DbDedicatedWorker from './worker?worker';
import { jobs } from '$lib/stores/jobs.svelte';
import { recoverFromStaleServiceWorker } from '$lib/sw-recovery';

export interface TaskProgress {
  phase: string;
  current?: number;
  total?: number;
}

type Pending = {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  onProgress?: (p: TaskProgress) => void;
};
type InitOptions = {
  dbUrl: string;
  version: string;
  onProgress?: (received: number, total: number) => void;
  onStatus?: (message: string) => void;
};

type WorkerLike = {
  postMessage: (msg: unknown) => void;
  addEventListener: (type: 'message', listener: (e: MessageEvent) => void) => void;
};
function createWorker(): WorkerLike {
  const w = new DbDedicatedWorker();
  let booted = false;
  w.addEventListener('message', () => (booted = true), { once: true });
  w.addEventListener('error', (ev) => {
    if (booted) return;
    ev.preventDefault?.();
    void recoverFromStaleServiceWorker();
  });
  return {
    postMessage: (m) => w.postMessage(m),
    addEventListener: (t, l) => w.addEventListener(t, l),
  };
}
const worker = createWorker();
const pending = new Map<number, Pending>();
let nextId = 1;
let initPromise: Promise<void> | null = null;
let progressCb: InitOptions['onProgress'];
let statusCb: InitOptions['onStatus'];

worker.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'progress') {
    progressCb?.(msg.received, msg.total);
    return;
  }
  if (msg.type === 'status') {
    statusCb?.(msg.message);
    return;
  }
  if (msg.type === 'taskProgress') {
    const p = pending.get(msg.id);
    p?.onProgress?.({ phase: msg.phase, current: msg.current, total: msg.total });
    return;
  }
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.ok) p.resolve(msg);
  else p.reject(new Error(msg.error));
});

function call<T>(payload: object, onProgress?: (p: TaskProgress) => void): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, ...payload });
  });
}

export function initDb(opts: InitOptions): Promise<void> {
  if (initPromise) return initPromise;
  progressCb = opts.onProgress;
  statusCb = opts.onStatus;
  initPromise = call<void>({
    type: 'init',
    dbUrl: opts.dbUrl,
    version: opts.version,
  });
  return initPromise;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (initPromise) await initPromise;
  const plainParams = params.length === 0 ? params : Array.from(params);
  const res = await call<{ rows: T[] }>({ type: 'query', sql, params: plainParams });
  return res.rows;
}

export type EnrichmentKind =
  | 'go'
  | 'phenotype'
  | 'wormcat'
  | 'neuronal'
  | 'tissue'
  | 'disease'
  | 'cell-type'
  | 'synaptogenesis'
  | 'pathway';

export interface EnrichmentResult {
  term_id: string;
  name: string;
  namespace?: string;
  k: number;
  K: number;
  n: number;
  N: number;
  fold: number;
  p: number;
  q: number;
  // Genes hitting this term; drives REVIGO-style collapse. Empty for clusterProfiler rows lacking a geneID column.
  overlap: string[];
}

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

export interface GseaInput {
  gene: string;
  score: number;
}

export interface GseaResult {
  term_id: string;
  name: string;
  namespace?: string;
  size: number;
  es: number;
  nes: number;
  p: number;
  q: number;
  leading_edge: string[];
  members: string[];
}

let jobSeq = 0;
const nextJobId = (prefix: string) => `${prefix}-${++jobSeq}`;

export async function runGSEA(
  ranked: GseaInput[],
  kind: GseaKind,
  opts: {
    minSize?: number;
    maxSize?: number;
    weight?: number;
    nperm?: number;
    seed?: number;
    multilevel?: boolean;
    multilevelM?: number;
    multilevelMhSteps?: number;
  } = {},
  onProgress?: (p: TaskProgress) => void,
): Promise<{ results: GseaResult[]; elapsedMs: number }> {
  const plainRanked: GseaInput[] = ranked.map((r) => ({
    gene: String(r.gene),
    score: Number(r.score),
  }));
  const jobId = nextJobId('gsea');
  jobs.start(jobId, `GSEA · ${kind}`);
  try {
    const res = await call<{ results: GseaResult[]; elapsedMs: number }>(
      { type: 'gsea', ranked: plainRanked, kind, opts: { ...opts } },
      (p) => {
        jobs.update(jobId, p.phase, p.current, p.total);
        onProgress?.(p);
      },
    );
    jobs.finish(jobId);
    return { results: res.results, elapsedMs: res.elapsedMs };
  } catch (err) {
    jobs.fail(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export interface CustomTermSet {
  term_id: string;
  name: string;
  genes: string[];
}

export async function runCustomEnrichment(
  ids: string[],
  sets: CustomTermSet[],
  opts: { minK?: number; maxQ?: number } = {},
  onProgress?: (p: TaskProgress) => void,
): Promise<{ results: EnrichmentResult[]; elapsedMs: number }> {
  const plainIds = Array.from(ids);
  const plainSets = sets.map((s) => ({
    term_id: String(s.term_id),
    name: String(s.name),
    genes: Array.from(s.genes),
  }));
  const jobId = nextJobId('enrich-gmt');
  jobs.start(jobId, 'Enrichment · GMT');
  try {
    const res = await call<{ results: EnrichmentResult[]; elapsedMs: number }>(
      { type: 'customEnrichment', ids: plainIds, sets: plainSets, opts: { ...opts } },
      (p) => {
        jobs.update(jobId, p.phase, p.current, p.total);
        onProgress?.(p);
      },
    );
    jobs.finish(jobId);
    return { results: res.results, elapsedMs: res.elapsedMs };
  } catch (err) {
    jobs.fail(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export interface SsgseaScores {
  term_id: string;
  name: string;
  size: number;
  scores: number[];
}

export async function runCustomSsgsea(
  expr: { genes: string[]; samples: string[]; matrix: Float64Array },
  sets: CustomTermSet[],
  opts: { alpha?: number; normalize?: boolean; minSize?: number; maxSize?: number } = {},
  onProgress?: (p: TaskProgress) => void,
): Promise<{ results: SsgseaScores[]; sampleNames: string[]; elapsedMs: number }> {
  const plainSets = sets.map((s) => ({
    term_id: String(s.term_id),
    name: String(s.name),
    genes: Array.from(s.genes),
  }));
  const jobId = nextJobId('ssgsea-gmt');
  jobs.start(jobId, 'ssGSEA · GMT');
  try {
    const res = await call<{ results: SsgseaScores[]; sampleNames: string[]; elapsedMs: number }>(
      { type: 'customSsgsea', expr, sets: plainSets, opts: { ...opts } },
      (p) => {
        jobs.update(jobId, p.phase, p.current, p.total);
        onProgress?.(p);
      },
    );
    jobs.finish(jobId);
    return res;
  } catch (err) {
    jobs.fail(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export async function runCustomGSEA(
  ranked: GseaInput[],
  sets: CustomTermSet[],
  opts: {
    minSize?: number;
    maxSize?: number;
    weight?: number;
    nperm?: number;
    seed?: number;
    multilevel?: boolean;
    multilevelM?: number;
    multilevelMhSteps?: number;
  } = {},
  onProgress?: (p: TaskProgress) => void,
): Promise<{ results: GseaResult[]; elapsedMs: number }> {
  const plainRanked = ranked.map((r) => ({ gene: String(r.gene), score: Number(r.score) }));
  const plainSets = sets.map((s) => ({
    term_id: String(s.term_id),
    name: String(s.name),
    genes: Array.from(s.genes),
  }));
  const jobId = nextJobId('gsea-gmt');
  jobs.start(jobId, 'GSEA · GMT');
  try {
    const res = await call<{ results: GseaResult[]; elapsedMs: number }>(
      { type: 'customGsea', ranked: plainRanked, sets: plainSets, opts: { ...opts } },
      (p) => {
        jobs.update(jobId, p.phase, p.current, p.total);
        onProgress?.(p);
      },
    );
    jobs.finish(jobId);
    return { results: res.results, elapsedMs: res.elapsedMs };
  } catch (err) {
    jobs.fail(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export async function runEnrichment(
  ids: string[],
  kind: EnrichmentKind,
  opts: { minK?: number; maxQ?: number; background?: string[] } = {},
  onProgress?: (p: TaskProgress) => void,
): Promise<{ results: EnrichmentResult[]; elapsedMs: number }> {
  const plainIds = Array.from(ids);
  const plainOpts = {
    minK: opts.minK,
    maxQ: opts.maxQ,
    background: opts.background ? Array.from(opts.background) : undefined,
  };
  const jobId = nextJobId('enrich');
  jobs.start(jobId, `Enrichment · ${kind}`);
  try {
    const res = await call<{ results: EnrichmentResult[]; elapsedMs: number }>(
      { type: 'enrichment', ids: plainIds, kind, opts: plainOpts },
      (p) => {
        jobs.update(jobId, p.phase, p.current, p.total);
        onProgress?.(p);
      },
    );
    jobs.finish(jobId);
    return { results: res.results, elapsedMs: res.elapsedMs };
  } catch (err) {
    jobs.fail(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
