// REVIGO redundancy reduction (Supek et al. 2011, PLoS ONE 6:e21800) for enrichment results.
// GO terms use SimRel (Schlicker et al. 2006) over the ontology, with term frequencies taken from
// the shipped C. elegans annotations so the ancestor closure matches the GOALL propagation in
// build-db.sh. Other term types run the same elimination procedure on the genes behind each term.

import { query } from '$lib/db/client';

export interface CollapseGroup<T> {
  rep: T;
  children: T[];
}

const PROP_RELS = ['is_a', 'part_of', 'regulates', 'positively_regulates', 'negatively_regulates'];
const ROOTS: Record<string, string> = { BP: 'GO:0008150', MF: 'GO:0003674', CC: 'GO:0005575' };
// REVIGO rejects terms annotating more than 5% of the reference as too general to represent a cluster.
const BROAD_FREQ = 0.05;
// A parent is dropped in favour of its child only when the child makes up most of it.
const PARENT_MOSTLY_CHILD = 0.75;
// Pairwise similarity is quadratic and runs on the main thread; past this, callers skip the reduction.
export const REVIGO_MAX_TERMS = 2000;

interface TermInfo {
  namespace: string;
  // Fraction of annotated genes in the namespace carrying this term (propagated).
  freq: number;
  parents: Set<string>;
  // Self plus ancestors, ordered by descending SimRel numerator so the first shared one is the best.
  ancestors: string[];
  ancestorSet: Set<string>;
}

export interface GoSemData {
  terms: Map<string, TermInfo>;
  freq: Map<string, number>;
}

const termCache = new Map<string, TermInfo>();
const freqCache = new Map<string, number>();
let rootCounts: Map<string, number> | null = null;

async function loadRootCounts(): Promise<Map<string, number>> {
  if (rootCounts) return rootCounts;
  const rows = await query<{ go_id: string; n: number }>(
    `SELECT go_id, COUNT(DISTINCT wormbase_gene) AS n FROM gene_go
     WHERE go_id IN (SELECT value FROM json_each(?)) GROUP BY go_id`,
    [JSON.stringify(Object.values(ROOTS))],
  );
  rootCounts = new Map(rows.map((r) => [r.go_id, r.n]));
  return rootCounts;
}

// -ln p(c) * (1 - p(c)): the part of SimRel that depends on the shared ancestor alone.
function ancestorWeight(p: number): number {
  return p > 0 ? -Math.log(p) * (1 - p) : 0;
}

/** Loads ancestors and frequencies for the given GO ids; ids unknown to the DB are left out. */
export async function loadGoSemData(termIds: string[]): Promise<GoSemData> {
  const missing = [...new Set(termIds)].filter((id) => !termCache.has(id));
  if (missing.length > 0) {
    const ids = JSON.stringify(missing);
    const rels = JSON.stringify(PROP_RELS);
    const [roots, closure, direct] = await Promise.all([
      loadRootCounts(),
      query<{ term: string; anc: string }>(
        `WITH RECURSIVE closure(term, anc) AS (
           SELECT value, value FROM json_each(?1)
           UNION
           SELECT c.term, r.parent_id FROM closure c
           JOIN go_relations r ON r.child_id = c.anc
           WHERE r.rel_type IN (SELECT value FROM json_each(?2))
         )
         SELECT term, anc FROM closure`,
        [ids, rels],
      ),
      query<{ child_id: string; parent_id: string }>(
        `SELECT child_id, parent_id FROM go_relations
         WHERE child_id IN (SELECT value FROM json_each(?1))
           AND rel_type IN (SELECT value FROM json_each(?2))`,
        [ids, rels],
      ),
    ]);
    const needFreq = [...new Set(closure.map((r) => r.anc))].filter((id) => !freqCache.has(id));
    const counts = await query<{ go_id: string; namespace: string; n: number }>(
      `SELECT t.go_id, t.namespace, COUNT(DISTINCT g.wormbase_gene) AS n
       FROM go_terms t LEFT JOIN gene_go g ON g.go_id = t.go_id
       WHERE t.go_id IN (SELECT value FROM json_each(?)) GROUP BY t.go_id`,
      [JSON.stringify(needFreq)],
    );
    const nsOf = new Map<string, string>();
    for (const c of counts) {
      const total = roots.get(ROOTS[c.namespace]) ?? 0;
      freqCache.set(c.go_id, total > 0 ? Math.min(1, c.n / total) : 0);
      nsOf.set(c.go_id, c.namespace);
    }
    const ancOf = new Map<string, string[]>();
    for (const r of closure) {
      let list = ancOf.get(r.term);
      if (!list) ancOf.set(r.term, (list = []));
      list.push(r.anc);
    }
    const parentsOf = new Map<string, Set<string>>();
    for (const r of direct) {
      let set = parentsOf.get(r.child_id);
      if (!set) parentsOf.set(r.child_id, (set = new Set()));
      set.add(r.parent_id);
    }
    for (const id of missing) {
      const namespace = nsOf.get(id);
      if (!namespace) continue;
      const ancestors = (ancOf.get(id) ?? [id])
        .filter((a) => (freqCache.get(a) ?? 0) > 0)
        .sort(
          (a, b) => ancestorWeight(freqCache.get(b) ?? 0) - ancestorWeight(freqCache.get(a) ?? 0),
        );
      termCache.set(id, {
        namespace,
        freq: freqCache.get(id) ?? 0,
        parents: parentsOf.get(id) ?? new Set(),
        ancestors,
        ancestorSet: new Set(ancestors),
      });
    }
  }
  const terms = new Map<string, TermInfo>();
  for (const id of termIds) {
    const t = termCache.get(id);
    if (t) terms.set(id, t);
  }
  return { terms, freq: freqCache };
}

/** SimRel in [0, 1]; 0 when either term is unannotated or they share no ancestor. */
export function simRel(a: string, b: string, data: GoSemData): number {
  if (a === b) return 1;
  const ta = data.terms.get(a);
  const tb = data.terms.get(b);
  if (!ta || !tb || ta.freq <= 0 || tb.freq <= 0) return 0;
  const denom = -Math.log(ta.freq) - Math.log(tb.freq);
  if (denom <= 0) return 0;
  for (const c of ta.ancestors) {
    if (tb.ancestorSet.has(c)) return (2 * ancestorWeight(data.freq.get(c) ?? 0)) / denom;
  }
  return 0;
}

/** What the elimination procedure needs to know about terms of one kind. */
export interface RevigoAdapter<T> {
  known: (t: T) => boolean;
  sim: (a: T, b: T) => number;
  // Terms too general to represent a cluster (REVIGO: frequency above 5%).
  broad: (t: T) => boolean;
  isParent: (parent: T, child: T) => boolean;
  parentMostlyChild: (parent: T, child: T) => boolean;
  // Terms with different keys are never compared (REVIGO reduces each ontology on its own).
  partition: (t: T) => string;
}

export interface RevigoOpts<T> {
  // Allowed similarity: pairs more similar than this lose one member. Lower = shorter list.
  cutoff: number;
  idOf: (item: T) => string;
  // Ascending significance (p-value); decides which member of a redundant pair survives.
  pOf: (item: T) => number;
  // Extra partition key, e.g. the sign of a GSEA score.
  partitionOf?: (item: T) => number | string;
}

/** GO terms: SimRel similarity, annotation frequency and the ontology's parent links. */
export function goAdapter<T>(data: GoSemData, idOf: (t: T) => string): RevigoAdapter<T> {
  const info = (t: T) => data.terms.get(idOf(t));
  return {
    known: (t) => data.terms.has(idOf(t)),
    sim: (a, b) => simRel(idOf(a), idOf(b), data),
    broad: (t) => (info(t)?.freq ?? 0) > BROAD_FREQ,
    isParent: (parent, child) => info(child)?.parents.has(idOf(parent)) ?? false,
    parentMostlyChild: (parent, child) =>
      (info(child)?.freq ?? 0) / (info(parent)?.freq ?? 1) > PARENT_MOSTLY_CHILD,
    partition: (t) => info(t)?.namespace ?? '',
  };
}

/**
 * Terms without an ontology: the genes behind each term stand in for the hierarchy. Similarity
 * is their Jaccard index, breadth is the share of the universe the term annotates, and a term
 * whose genes contain another's plays the parent.
 */
export function geneSetAdapter<T>(
  setOf: (t: T) => Iterable<string>,
  fractionOf: (t: T) => number,
): RevigoAdapter<T> {
  const sets = new Map<T, Set<string>>();
  const set = (t: T) => {
    let s = sets.get(t);
    if (!s) sets.set(t, (s = new Set(setOf(t))));
    return s;
  };
  const contains = (big: Set<string>, small: Set<string>) => {
    for (const g of small) if (!big.has(g)) return false;
    return true;
  };
  return {
    known: (t) => set(t).size > 0,
    sim: (a, b) => {
      const sa = set(a);
      const sb = set(b);
      let inter = 0;
      for (const g of sa) if (sb.has(g)) inter++;
      const union = sa.size + sb.size - inter;
      return union === 0 ? 0 : inter / union;
    },
    broad: (t) => fractionOf(t) > BROAD_FREQ,
    isParent: (parent, child) =>
      set(parent).size > set(child).size && contains(set(parent), set(child)),
    parentMostlyChild: (parent, child) => set(child).size / set(parent).size > PARENT_MOSTLY_CHILD,
    partition: () => '',
  };
}

/**
 * REVIGO's greedy elimination: repeatedly take the most similar remaining pair and reject one
 * member (too general, then less significant, then the child). Rejected terms fold under the
 * term that displaced them. REVIGO breaks remaining ties at random; this uses the term id so
 * results are reproducible.
 */
export function revigoReduce<T>(
  items: T[],
  adapter: RevigoAdapter<T>,
  opts: RevigoOpts<T>,
): CollapseGroup<T>[] {
  const n = items.length;
  const ids = items.map(opts.idOf);
  const ps = items.map(opts.pOf);
  const part = items.map(
    (it) => `${adapter.partition(it)}|${opts.partitionOf ? opts.partitionOf(it) : ''}`,
  );

  const pairs: { i: number; j: number; sim: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (!adapter.known(items[i])) continue;
    for (let j = i + 1; j < n; j++) {
      if (part[i] !== part[j] || !adapter.known(items[j])) continue;
      const sim = adapter.sim(items[i], items[j]);
      if (sim > opts.cutoff) pairs.push({ i, j, sim });
    }
  }
  pairs.sort((a, b) => b.sim - a.sim || a.i - b.i || a.j - b.j);

  // Returns the index to reject.
  function loser(i: number, j: number): number {
    const broadI = adapter.broad(items[i]);
    const broadJ = adapter.broad(items[j]);
    if (broadI !== broadJ) return broadI ? i : j;
    if (ps[i] !== ps[j]) return ps[i] > ps[j] ? i : j;
    if (adapter.isParent(items[j], items[i])) {
      return adapter.parentMostlyChild(items[j], items[i]) ? j : i;
    }
    if (adapter.isParent(items[i], items[j])) {
      return adapter.parentMostlyChild(items[i], items[j]) ? i : j;
    }
    return ids[i] < ids[j] ? j : i;
  }

  const foldedInto = new Int32Array(n).fill(-1);
  for (const { i, j } of pairs) {
    if (foldedInto[i] !== -1 || foldedInto[j] !== -1) continue;
    const out = loser(i, j);
    foldedInto[out] = out === i ? j : i;
  }

  const groups = new Map<number, CollapseGroup<T>>();
  for (let i = 0; i < n; i++) {
    if (foldedInto[i] === -1) groups.set(i, { rep: items[i], children: [] });
  }
  for (let i = 0; i < n; i++) {
    if (foldedInto[i] === -1) continue;
    let root = foldedInto[i];
    while (foldedInto[root] !== -1) root = foldedInto[root];
    groups.get(root)!.children.push(items[i]);
  }
  return [...groups.values()];
}
