// WormCat's three nested levels as one family of gene sets for enrichment. WormCat
// repeats a category one level down when it has no subdivision, so a name shared by
// two levels almost always carries the same genes there and is tested once. Where a
// shared name carries different genes (e.g. "Non-coding RNA: tRNA" at levels 2 and 3),
// the deeper level becomes its own term so neither gene set is lost.

export const WORMCAT_LEVEL_ROWS_SQL = `
  SELECT wormbase_gene, 1 AS level, category_1 AS category FROM wormcat WHERE category_1 IS NOT NULL
  UNION ALL SELECT wormbase_gene, 2, category_2 FROM wormcat WHERE category_2 IS NOT NULL
  UNION ALL SELECT wormbase_gene, 3, category_3 FROM wormcat WHERE category_3 IS NOT NULL`;

export interface WormcatLevelRow {
  wormbase_gene: string;
  level: number;
  category: string;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export function buildWormcatTerms(rows: WormcatLevelRow[]): Map<string, Set<string>> {
  const byName = new Map<string, Map<number, Set<string>>>();
  for (const r of rows) {
    let levels = byName.get(r.category);
    if (!levels) byName.set(r.category, (levels = new Map()));
    let genes = levels.get(r.level);
    if (!genes) levels.set(r.level, (genes = new Set()));
    genes.add(r.wormbase_gene);
  }
  const terms = new Map<string, Set<string>>();
  for (const [name, levels] of byName) {
    const kept: Set<string>[] = [];
    for (const level of [...levels.keys()].sort((a, b) => a - b)) {
      const genes = levels.get(level)!;
      if (kept.some((k) => sameSet(k, genes))) continue;
      terms.set(kept.length === 0 ? name : `${name} (level ${level})`, genes);
      kept.push(genes);
    }
  }
  return terms;
}
