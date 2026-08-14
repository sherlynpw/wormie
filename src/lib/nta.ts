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

export type NullModel = 'degree' | 'uniform';

/**
 * BioGRID mixes physical interactions with genetic ones (suppression, synthetic
 * lethality). They support different claims, so which are in play is stated
 * rather than assumed.
 */
export type EdgeKind = 'all' | 'physical' | 'genetic';

export interface NtaResult {
  nodes: string[];
  edges: NtaEdge[];
  connectedNodes: string[];
  observedEdges: number;
  expectedEdges: number;
  edgeZ: number;
  density: number;
  universeSize: number;
  nullModel: NullModel;
  /** Which BioGRID evidence the graph, the null and the edge list were built from. */
  edgeKind: EdgeKind;
  /** Permutations actually run, so exported methods can't quote a stale count. */
  permutations: number;
  /** Row counts behind the full BioGRID table, so the split is visible. */
  edgeCounts: { physical: number; genetic: number };
  /** Query genes that appear in the interaction graph at all; the null matches these. */
  testedNodes: number;
  /**
   * Median degree of the tested query genes against the median degree the null
   * actually sampled. Equal-count bins cannot be degree-homogeneous in the
   * extreme tail, so a hub-heavy query draws replacements of lower degree; that
   * understates the expected count and makes the z-score conservative.
   */
  degreeMatch: { query: number; sampled: number } | null;
}

interface EdgeSet {
  byNode: Map<string, Set<string>>;
  universe: string[];
  physicalEdges: number;
  geneticEdges: number;
  /** Degree-matched bins: every gene sits in a bin of >= MIN_BIN similar-degree genes. */
  bins: string[][];
  binOf: Map<string, number>;
}

// Hub genes are both better studied and better connected, so a uniform null
// flatters any list of well-studied genes.
const MIN_BIN = 100;

function buildDegreeBins(
  universe: string[],
  byNode: Map<string, Set<string>>,
): { bins: string[][]; binOf: Map<string, number> } {
  const degreeOf = (g: string) => byNode.get(g)?.size ?? 0;
  const sorted = [...universe].sort((x, y) => degreeOf(x) - degreeOf(y));
  const bins: string[][] = [];
  const binOf = new Map<string, number>();

  let current: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    current.push(sorted[i]);
    const nextDegreeDiffers =
      i + 1 >= sorted.length || degreeOf(sorted[i + 1]) !== degreeOf(sorted[i]);
    // Close on a degree boundary so equal-degree genes stay together.
    if (current.length >= MIN_BIN && nextDegreeDiffers) {
      bins.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    // Tail too small to stand alone.
    if (bins.length > 0 && current.length < MIN_BIN) bins[bins.length - 1].push(...current);
    else bins.push(current);
  }
  for (let b = 0; b < bins.length; b++) for (const g of bins[b]) binOf.set(g, b);
  return { bins, binOf };
}

const cached = new Map<EdgeKind, Promise<EdgeSet>>();
function loadAllEdges(kind: EdgeKind): Promise<EdgeSet> {
  const hit = cached.get(kind);
  if (hit) return hit;
  const built = (async () => {
    const where =
      kind === 'all'
        ? ''
        : `WHERE experimental_type = '${kind === 'physical' ? 'physical' : 'genetic'}'`;
    const rows = await query<{ a: string; b: string }>(
      `SELECT gene_a AS a, gene_b AS b FROM interactions ${where}`,
    );
    const counts = await query<{ t: string; n: number }>(
      'SELECT experimental_type AS t, COUNT(*) AS n FROM interactions GROUP BY 1',
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
    const universe = [...all];
    const { bins, binOf } = buildDegreeBins(universe, byNode);
    return {
      byNode,
      universe,
      bins,
      binOf,
      physicalEdges: counts.find((c) => c.t === 'physical')?.n ?? 0,
      geneticEdges: counts.find((c) => c.t === 'genetic')?.n ?? 0,
    };
  })();
  cached.set(kind, built);
  return built;
}

export async function runNta(
  geneIds: string[],
  opts: { permutations?: number; nullModel?: NullModel; edgeKind?: EdgeKind } = {},
): Promise<NtaResult> {
  const uniq = [...new Set(geneIds)];
  const perms = opts.permutations ?? 1000;
  const nullModel = opts.nullModel ?? 'degree';
  const edgeKind = opts.edgeKind ?? 'all';
  const { byNode, universe, bins, binOf, physicalEdges, geneticEdges } =
    await loadAllEdges(edgeKind);

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
             AND gene_b IN (${uniq.map(() => '?').join(',')})
             ${edgeKind === 'all' ? '' : 'AND experimental_type = ?'}`,
          edgeKind === 'all' ? [...uniq, ...uniq] : [...uniq, ...uniq, edgeKind],
        );
  const edges: NtaEdge[] = innerRows.map((r) => ({
    a: r.a,
    b: r.b,
    symbol_a: r.symbol_a ?? undefined,
    symbol_b: r.symbol_b ?? undefined,
    experimental_type: r.experimental_type,
  }));

  // Genes absent from the graph contribute no edges under observed or null.
  const present = uniq.filter((g) => byNode.has(g));

  let mean = 0;
  let sd = 0;
  let degreeMatch: { query: number; sampled: number } | null = null;
  if (present.length >= 2 && universe.length >= present.length) {
    const degreeOf = (g: string) => byNode.get(g)?.size ?? 0;
    const median = (xs: number[]) => {
      if (xs.length === 0) return 0;
      const a = [...xs].sort((x, y) => x - y);
      const m = a.length >> 1;
      return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    };
    const sampledMedians: number[] = [];
    const samples = new Array<number>(perms);
    for (let p = 0; p < perms; p++) {
      const picked = new Set<string>();
      if (nullModel === 'degree') {
        for (const g of present) {
          const bin = bins[binOf.get(g) ?? 0];
          let choice = bin[Math.floor(Math.random() * bin.length)];
          // Bounded resampling, then any free gene, so this cannot spin.
          for (let attempt = 0; picked.has(choice) && attempt < 20; attempt++) {
            choice = bin[Math.floor(Math.random() * bin.length)];
          }
          while (picked.has(choice)) {
            choice = universe[Math.floor(Math.random() * universe.length)];
          }
          picked.add(choice);
        }
      } else {
        while (picked.size < present.length) {
          picked.add(universe[Math.floor(Math.random() * universe.length)]);
        }
      }
      samples[p] = countInner(picked, byNode);
      sampledMedians.push(median([...picked].map(degreeOf)));
    }
    degreeMatch = {
      query: median(present.map(degreeOf)),
      sampled: median(sampledMedians),
    };
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
    nullModel,
    edgeKind,
    permutations: present.length >= 2 && universe.length >= present.length ? perms : 0,
    edgeCounts: { physical: physicalEdges, genetic: geneticEdges },
    testedNodes: present.length,
    degreeMatch,
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
