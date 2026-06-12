// REVIGO-style greedy term clusterer. Groups enrichment/GSEA terms whose gene-set Jaccard exceeds
// a cutoff; the most-significant term per cluster becomes the representative. Deduplicates noisy
// tables where a parent GO term and children all pass thresholds (shared leading-edge genes).
// Fast proxy for Resnik IC similarity; works for any term type without an ontology IC table.

export interface CollapseGroup<T> {
  rep: T;
  children: T[];
}

export interface CollapseOpts<T> {
  // Jaccard threshold above which two terms are redundant; lower = more aggressive.
  cutoff: number;
  // Gene-set (or leading-edge set) accessor; pairwise Jaccard is computed on these.
  geneSetOf: (item: T) => Iterable<string>;
  // Ascending score accessor (e.g. q-value); lowest score becomes the cluster representative.
  scoreOf: (item: T) => number;
  // Optional tiebreaker when scoreOf ties (e.g. p-value).
  tiebreaker?: (item: T) => number;
  // Optional partition key: items with different keys (e.g. up/down GSEA) never merge.
  // Default returns 0 (all mergeable).
  partitionOf?: (item: T) => number;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const small = a.size <= b.size ? a : b;
  const big = small === a ? b : a;
  let overlap = 0;
  for (const g of small) if (big.has(g)) overlap++;
  const denom = a.size + b.size - overlap;
  return denom === 0 ? 0 : overlap / denom;
}

export function collapseTerms<T>(items: T[], opts: CollapseOpts<T>): CollapseGroup<T>[] {
  if (items.length === 0) return [];
  const score = opts.scoreOf;
  const tie = opts.tiebreaker ?? (() => 0);
  const partition = opts.partitionOf ?? (() => 0);
  const sorted = [...items].sort((a, b) => score(a) - score(b) || tie(a) - tie(b));
  const groups: CollapseGroup<T>[] = [];
  // Cached gene set + partition tag per group, indexed parallel to `groups`.
  const cachedSets: { set: Set<string>; tag: number }[] = [];
  for (const r of sorted) {
    const mySet = new Set(opts.geneSetOf(r));
    const myTag = partition(r);
    let mergedInto = -1;
    let bestJ = 0;
    for (let i = 0; i < cachedSets.length; i++) {
      const info = cachedSets[i];
      if (info.tag !== myTag) continue;
      const j = jaccard(mySet, info.set);
      if (j > bestJ && j >= opts.cutoff) {
        bestJ = j;
        mergedInto = i;
      }
    }
    if (mergedInto === -1) {
      groups.push({ rep: r, children: [] });
      cachedSets.push({ set: mySet, tag: myTag });
    } else {
      groups[mergedInto].children.push(r);
    }
  }
  return groups;
}
