// Network Topology Analysis over the BioGRID interaction graph. Computes the
// induced subgraph edge count and a z-score vs. same-size random permutations.
// Full edge set is fetched once and cached; permutations run locally.

import { query } from '$lib/db/client';

export interface NtaEdge {
  a: string;
  b: string;
  symbol_a?: string;
  symbol_b?: string;
  experimental_type: string;
}

export interface NtaResult {
  nodes: string[];
  edges: NtaEdge[];
  connectedNodes: string[];
  observedEdges: number;
  expectedEdges: number;
  edgeZ: number;
  density: number;
  universeSize: number;
}

interface EdgeSet {
  byNode: Map<string, Set<string>>;
  universe: string[];
}

let cached: Promise<EdgeSet> | null = null;
function loadAllEdges(): Promise<EdgeSet> {
  if (cached) return cached;
  cached = (async () => {
    const rows = await query<{ a: string; b: string }>(
      'SELECT gene_a AS a, gene_b AS b FROM interactions',
    );
    const byNode = new Map<string, Set<string>>();
    const all = new Set<string>();
    for (const r of rows) {
      if (!byNode.has(r.a)) byNode.set(r.a, new Set());
      if (!byNode.has(r.b)) byNode.set(r.b, new Set());
      byNode.get(r.a)!.add(r.b);
      byNode.get(r.b)!.add(r.a);
      all.add(r.a);
      all.add(r.b);
    }
    return { byNode, universe: [...all] };
  })();
  return cached;
}

export async function runNta(
  geneIds: string[],
  opts: { permutations?: number } = {},
): Promise<NtaResult> {
  const uniq = [...new Set(geneIds)];
  const perms = opts.permutations ?? 1000;
  const { byNode, universe } = await loadAllEdges();

  const querySet = new Set(uniq);
  const observed = countInner(querySet, byNode);

  const innerRows =
    uniq.length === 0
      ? []
      : await query<{
          a: string;
          b: string;
          symbol_a: string | null;
          symbol_b: string | null;
          experimental_type: string;
        }>(
          `SELECT DISTINCT gene_a AS a, gene_b AS b, symbol_a, symbol_b, experimental_type
           FROM interactions
           WHERE gene_a IN (${uniq.map(() => '?').join(',')})
             AND gene_b IN (${uniq.map(() => '?').join(',')})`,
          [...uniq, ...uniq],
        );
  const edges: NtaEdge[] = innerRows.map((r) => ({
    a: r.a,
    b: r.b,
    symbol_a: r.symbol_a ?? undefined,
    symbol_b: r.symbol_b ?? undefined,
    experimental_type: r.experimental_type,
  }));

  let mean = 0;
  let sd = 0;
  if (uniq.length >= 2 && universe.length >= uniq.length) {
    const samples = new Array<number>(perms);
    for (let p = 0; p < perms; p++) {
      const picked = new Set<string>();
      while (picked.size < uniq.length) {
        picked.add(universe[Math.floor(Math.random() * universe.length)]);
      }
      samples[p] = countInner(picked, byNode);
    }
    mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance =
      samples.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, samples.length - 1);
    sd = Math.sqrt(variance);
  }
  const z = sd > 0 ? (observed - mean) / sd : 0;

  const connected = new Set<string>();
  for (const e of edges) {
    connected.add(e.a);
    connected.add(e.b);
  }
  const density = uniq.length > 1 ? (2 * observed) / (uniq.length * (uniq.length - 1)) : 0;

  return {
    nodes: uniq,
    edges,
    connectedNodes: [...connected],
    observedEdges: observed,
    expectedEdges: mean,
    edgeZ: z,
    density,
    universeSize: universe.length,
  };
}

function countInner(set: Set<string>, byNode: Map<string, Set<string>>): number {
  let n = 0;
  for (const a of set) {
    const nbrs = byNode.get(a);
    if (!nbrs) continue;
    for (const b of nbrs) {
      if (set.has(b) && a < b) n++;
    }
  }
  return n;
}
