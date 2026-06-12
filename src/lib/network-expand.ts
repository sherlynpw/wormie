// Multi-hop interaction graph expansion + Steiner-style prune.
//
// Given a focal gene, walk the BioGRID interaction graph up to `maxHops`
// and keep only nodes that lie on a path from the focal to any gene in the
// caller's filter set (the "target" set). Nodes whose role on that path is
// purely structural (not a target, not the focal) are tagged as
// "intermediate" so the UI can style them differently.
//
// The page calls this each time the user changes hops / edge-type filter /
// target set. Termination guards (node cap, time cap) protect against
// hub-gene blow-up on dense subgraphs.

import { getInteractionsBatch, type InteractionEdge } from '$lib/queries';

export type EdgeTypeFilter = ('physical' | 'genetic' | 'other')[];

export interface ExpandOptions {
  focal: string;
  // Set of WBGene IDs the user picked as the target filter. Empty set means
  // "no filter": show everything within `maxHops`.
  targets: Set<string>;
  // 1..N. Pass -1 (or any non-positive value) to mean "no cap": BFS will
  // run until the frontier dries up.
  maxHops: number;
  // Soft cap on total visited; stops BFS early. -1 (or non-positive) = no cap.
  maxNodes: number;
  edgeTypes: EdgeTypeFilter;
}

export interface ExpansionResult {
  // Final visible nodes after Steiner prune. Includes role tag.
  nodes: Map<string, NodeMeta>;
  // Final visible edges between kept nodes. De-duplicated by undirected key.
  edges: PairedEdge[];
  // BFS stats, used by the UI to flag truncation.
  visitedTotal: number;
  truncated: boolean;
  hopsRun: number;
  targetsReachable: number;
  // One shortest path per reached target. Each entry is the path from focal
  // to target as a list of node IDs. Multiple equal-length paths are not
  // enumerated; we take the canonical one fixed by BFS discovery order.
  paths: PathRow[];
}

export interface PathRow {
  target_id: string;
  target_name: string | null;
  hops: number;
  // path_ids[0] === focal, path_ids.at(-1) === target_id
  path_ids: string[];
  path_names: (string | null)[];
}

export interface NodeMeta {
  id: string;
  name: string | null;
  hop: number; // shortest distance from focal
  role: 'focal' | 'target' | 'intermediate';
  // True iff this node is a member of the filter target set. Tracked
  // independently of `role` so we can flag the focal when it's also a
  // target (role='focal' but is_target=true).
  is_target: boolean;
}

export interface PairedEdge {
  source: string;
  target: string;
  types: Set<'physical' | 'genetic' | 'other'>;
  count: number; // distinct evidence rows aggregated into this undirected edge
}

function classifyType(raw: string | null): 'physical' | 'genetic' | 'other' {
  const t = (raw ?? '').toLowerCase();
  if (t === 'physical') return 'physical';
  if (t === 'genetic') return 'genetic';
  return 'other';
}

function undirectedKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export async function expandNetwork(opts: ExpandOptions): Promise<ExpansionResult> {
  const { focal, edgeTypes } = opts;
  // Resolve non-positive sentinels (-1, 0) to Infinity so BFS stops naturally (empty frontier).
  const maxHops = opts.maxHops > 0 ? opts.maxHops : Number.POSITIVE_INFINITY;
  const maxNodes = opts.maxNodes > 0 ? opts.maxNodes : Number.POSITIVE_INFINITY;

  // BFS state: hop distances, undirected adjacency, aggregated edges, name cache, predecessor map.
  const hopOf = new Map<string, number>();
  hopOf.set(focal, 0);
  const adj = new Map<string, Set<string>>();
  // Edges keyed by undirected pair; filtered to kept-only after Steiner prune.
  const edgeMap = new Map<string, PairedEdge>();
  const nameOf = new Map<string, string | null>();
  // predOf[id] = node it was first discovered from; used to reconstruct shortest paths.
  const predOf = new Map<string, string>();

  let frontier: string[] = [focal];
  let hop = 0;
  let truncated = false;

  // Chunk size 250: IN-list scans grow linearly, so chunking keeps SQL plans small.
  // Sweet spot on the WASM build: 4-5 chunks of a 1000-gene frontier all return in <300ms.
  const CHUNK = 250;
  while (frontier.length > 0 && hop < maxHops && hopOf.size < maxNodes) {
    hop++;
    const rows: InteractionEdge[] = [];
    for (let i = 0; i < frontier.length; i += CHUNK) {
      const chunk = frontier.slice(i, i + CHUNK);
      const batch = await getInteractionsBatch(chunk, { types: edgeTypes });
      for (const r of batch) rows.push(r);
      if (hopOf.size + rows.length > maxNodes) break;
    }
    const next = new Set<string>();
    for (const r of rows) {
      const a = r.source;
      const b = r.target;
      const aSeen = hopOf.has(a);
      const bSeen = hopOf.has(b);
      // Drop rows that would exceed maxNodes; edges between already-seen nodes still aggregate.
      const newNodes = (aSeen ? 0 : 1) + (bSeen ? 0 : 1);
      if (newNodes > 0 && hopOf.size + newNodes > maxNodes) {
        truncated = true;
        continue;
      }
      if (!nameOf.has(a)) nameOf.set(a, r.source_name);
      if (!nameOf.has(b)) nameOf.set(b, r.target_name);
      // Edge aggregation
      const key = undirectedKey(a, b);
      let e = edgeMap.get(key);
      if (!e) {
        e = {
          source: a,
          target: b,
          types: new Set<'physical' | 'genetic' | 'other'>(),
          count: 0,
        };
        edgeMap.set(key, e);
      }
      e.types.add(classifyType(r.experimental_type));
      e.count++;
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
      // Hop tracking + predecessor recording.
      const aHop = hopOf.get(a);
      const bHop = hopOf.get(b);
      if (aHop === undefined) {
        hopOf.set(a, hop);
        if (bHop !== undefined && bHop === hop - 1) predOf.set(a, b);
      }
      if (bHop === undefined) {
        hopOf.set(b, hop);
        if (aHop !== undefined && aHop === hop - 1) predOf.set(b, a);
      }
      if (hopOf.get(a) === hop) next.add(a);
      if (hopOf.get(b) === hop) next.add(b);
    }
    if (hopOf.size >= maxNodes) {
      truncated = true;
      break;
    }
    frontier = [...next];
  }
  const hopsRun = hop;

  // Identify target nodes that were reached.
  const visited = new Set(hopOf.keys());
  const reachedTargets = new Set<string>();
  for (const t of opts.targets) if (visited.has(t)) reachedTargets.add(t);

  // Steiner prune: skip if no target filter (keep everything). Otherwise, multi-source BFS from
  // all reached targets gives d_target; keep node n iff d_focal(n) + d_target(n) <= maxHops.
  let keep: Set<string>;
  if (opts.targets.size === 0) {
    keep = visited;
  } else {
    const dTarget = new Map<string, number>();
    const queue: string[] = [];
    for (const t of reachedTargets) {
      dTarget.set(t, 0);
      queue.push(t);
    }
    while (queue.length > 0) {
      const n = queue.shift()!;
      const d = dTarget.get(n)!;
      const neighbours = adj.get(n);
      if (!neighbours) continue;
      for (const m of neighbours) {
        if (dTarget.has(m)) continue;
        dTarget.set(m, d + 1);
        queue.push(m);
      }
    }
    keep = new Set<string>([focal]);
    const limit = Number.isFinite(maxHops) ? maxHops : Infinity;
    for (const [n, df] of hopOf) {
      const dt = dTarget.get(n);
      if (dt === undefined) continue;
      if (df + dt <= limit) keep.add(n);
    }
    // Defensive: always keep reached targets (handles maxHops=0 corner case).
    for (const t of reachedTargets) keep.add(t);
  }

  const nodes = new Map<string, NodeMeta>();
  for (const id of keep) {
    const isTarget = opts.targets.has(id);
    const role: NodeMeta['role'] = id === focal ? 'focal' : isTarget ? 'target' : 'intermediate';
    nodes.set(id, {
      id,
      name: nameOf.get(id) ?? null,
      hop: hopOf.get(id) ?? 0,
      role,
      is_target: isTarget,
    });
  }
  const edges: PairedEdge[] = [];
  for (const e of edgeMap.values()) {
    if (keep.has(e.source) && keep.has(e.target)) edges.push(e);
  }

  // Reconstruct one shortest path per reached target by walking predOf back to focal.
  // Targets without a predecessor chain (simultaneous two-sided BFS discovery, rare) are omitted.
  const paths: PathRow[] = [];
  for (const t of reachedTargets) {
    // Skip focal-as-target: the Targets TSV already reports hops=0 for it; singleton path is noise.
    if (t === focal) continue;
    const ids: string[] = [];
    let cur: string | undefined = t;
    let safety = 0;
    while (cur !== undefined && cur !== focal && safety++ < 50) {
      ids.unshift(cur);
      cur = predOf.get(cur);
    }
    if (cur !== focal) continue; // didn't reach focal, skip
    ids.unshift(focal);
    paths.push({
      target_id: t,
      target_name: nameOf.get(t) ?? null,
      hops: ids.length - 1,
      path_ids: ids,
      path_names: ids.map((id) => nameOf.get(id) ?? null),
    });
  }
  paths.sort((a, b) => a.hops - b.hops || (a.target_name ?? '').localeCompare(b.target_name ?? ''));

  return {
    nodes,
    edges,
    visitedTotal: visited.size,
    truncated,
    hopsRun,
    targetsReachable: reachedTargets.size,
    paths,
  };
}
