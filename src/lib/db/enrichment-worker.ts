// Enrichment logic that runs inside the SQLite worker.
// Imported only by worker.ts and never bundled into the main thread chunk.

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

// CeNGEN binary calls live at four FACS-calibrated thresholds (1=liberal,
// 2=medium, 3=conservative, 4=stringent). We expose cell-type enrichment at
// the medium threshold by default; that's the same default the CeNGEN app
// uses in its UI. Raising this would shrink each neuron's gene set toward
// the most-confident expression calls.
const CENGEN_MIN_THRESHOLD = 2;

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
  // Input genes that hit this term. Drives REVIGO-style collapse (pairs of
  // terms with high Jaccard on `overlap` are redundant within this analysis).
  // Empty for imported clusterProfiler rows that didn't carry a geneID column.
  overlap: string[];
}

interface BgEntry {
  K: number;
  name: string;
  namespace?: string;
}

interface BgInfo {
  K: Map<string, BgEntry>;
  N: number;
}

import { hyperUpperTail, bhFdr } from './stats';

import { execAll } from './sql';

// --- per-kind background cache (lives for lifetime of worker) ---
const bgCache: Partial<Record<EnrichmentKind, BgInfo>> = {};

function loadBackground(db: any, kind: EnrichmentKind): BgInfo {
  if (bgCache[kind]) return bgCache[kind]!;
  let counts: { term_id: string; df: number; name: string; namespace?: string }[];
  let N: number;
  if (kind === 'go') {
    counts = execAll<{ term_id: string; df: number; name: string; namespace: string }>(
      db,
      `SELECT f.go_id AS term_id, f.df, t.name, t.namespace
			 FROM go_term_freq f JOIN go_terms t ON t.go_id = f.go_id
			 WHERE t.is_obsolete = 0`,
    );
    N = execAll<{ n: number }>(db, 'SELECT COUNT(DISTINCT wormbase_gene) AS n FROM gene_go')[0].n;
  } else if (kind === 'phenotype') {
    counts = execAll<{ term_id: string; df: number; name: string }>(
      db,
      `SELECT gp.term_id,
			        COUNT(DISTINCT gp.wormbase_gene) AS df,
			        COALESCE(pt.name, gp.term_id) AS name
			 FROM gene_phenotype gp
			 LEFT JOIN phenotype_terms pt ON pt.term_id = gp.term_id
			 GROUP BY gp.term_id, pt.name`,
    );
    N = execAll<{ n: number }>(
      db,
      'SELECT COUNT(DISTINCT wormbase_gene) AS n FROM gene_phenotype',
    )[0].n;
  } else if (kind === 'wormcat') {
    counts = execAll<{ term_id: string; df: number; name: string }>(
      db,
      `SELECT category AS term_id, COUNT(DISTINCT wormbase_gene) AS df, category AS name FROM (
			    SELECT wormbase_gene, category_1 AS category FROM wormcat WHERE category_1 IS NOT NULL
			    UNION ALL SELECT wormbase_gene, category_2 FROM wormcat WHERE category_2 IS NOT NULL
			    UNION ALL SELECT wormbase_gene, category_3 FROM wormcat WHERE category_3 IS NOT NULL
			 ) GROUP BY category`,
    );
    N = execAll<{ n: number }>(db, 'SELECT COUNT(DISTINCT wormbase_gene) AS n FROM wormcat')[0].n;
  } else if (kind === 'neuronal') {
    counts = execAll<{ term_id: string; df: number; name: string }>(
      db,
      `SELECT category AS term_id, COUNT(DISTINCT wormbase_gene) AS df, category AS name
			 FROM neuronal WHERE category IS NOT NULL GROUP BY category`,
    );
    N = execAll<{ n: number }>(db, 'SELECT COUNT(DISTINCT wormbase_gene) AS n FROM neuronal')[0].n;
  } else if (kind === 'synaptogenesis') {
    try {
      counts = execAll<{ term_id: string; df: number; name: string }>(
        db,
        `SELECT class AS term_id,
                COUNT(DISTINCT wormbase_gene) AS df,
                class AS name
         FROM synaptogenesis WHERE class IS NOT NULL GROUP BY class`,
      );
      N = execAll<{ n: number }>(
        db,
        'SELECT COUNT(DISTINCT wormbase_gene) AS n FROM synaptogenesis',
      )[0].n;
    } catch {
      counts = [];
      N = 0;
    }
  } else if (kind === 'cell-type') {
    try {
      counts = execAll<{ term_id: string; df: number; name: string }>(
        db,
        `SELECT neuron_type AS term_id,
                COUNT(DISTINCT wormbase_gene) AS df,
                neuron_type AS name
         FROM cengen_calls
         WHERE max_threshold >= ?
         GROUP BY neuron_type`,
        [CENGEN_MIN_THRESHOLD],
      );
      N = execAll<{ n: number }>(
        db,
        `SELECT COUNT(DISTINCT wormbase_gene) AS n FROM cengen_calls WHERE max_threshold >= ?`,
        [CENGEN_MIN_THRESHOLD],
      )[0].n;
    } catch {
      counts = [];
      N = 0;
    }
  } else if (kind === 'pathway') {
    try {
      counts = execAll<{ term_id: string; df: number; name: string }>(
        db,
        `SELECT gkp.pathway_id AS term_id,
                COUNT(DISTINCT gkp.wormbase_gene) AS df,
                COALESCE(p.name, gkp.pathway_id) AS name
         FROM gene_kegg_pathway gkp
         LEFT JOIN kegg_pathway p ON p.pathway_id = gkp.pathway_id
         GROUP BY gkp.pathway_id`,
      );
      N = execAll<{ n: number }>(
        db,
        'SELECT COUNT(DISTINCT wormbase_gene) AS n FROM gene_kegg_pathway',
      )[0].n;
    } catch {
      counts = [];
      N = 0;
    }
  } else if (kind === 'disease') {
    try {
      counts = execAll<{ term_id: string; df: number; name: string }>(
        db,
        `SELECT do_id AS term_id,
				        COUNT(DISTINCT wormbase_gene) AS df,
				        do_name AS name
				 FROM gene_disease GROUP BY do_id, do_name`,
      );
      N = execAll<{ n: number }>(
        db,
        'SELECT COUNT(DISTINCT wormbase_gene) AS n FROM gene_disease',
      )[0].n;
    } catch {
      counts = [];
      N = 0;
    }
  } else {
    // tissue (WormBase anatomy, WBbt). Empty info if the optional tables haven't been ingested.
    try {
      counts = execAll<{ term_id: string; df: number; name: string }>(
        db,
        `SELECT ga.term_id,
				        COUNT(DISTINCT ga.wormbase_gene) AS df,
				        COALESCE(at.name, ga.term_id) AS name
				 FROM gene_anatomy ga
				 LEFT JOIN anatomy_terms at ON at.term_id = ga.term_id
				 GROUP BY ga.term_id, at.name`,
      );
      N = execAll<{ n: number }>(
        db,
        'SELECT COUNT(DISTINCT wormbase_gene) AS n FROM gene_anatomy',
      )[0].n;
    } catch {
      counts = [];
      N = 0;
    }
  }
  const K = new Map<string, BgEntry>();
  for (const r of counts) K.set(r.term_id, { K: r.df, name: r.name, namespace: r.namespace });
  const info: BgInfo = { K, N };
  bgCache[kind] = info;
  return info;
}

// Gene-to-term_ids index per kind, cached for worker lifetime. Avoids SQLite
// round-trips on subsequent calls and the IN(?) parameter limit.
const annotIndexCache: Partial<Record<EnrichmentKind, Map<string, string[]>>> = {};

function loadAnnotationIndex(db: any, kind: EnrichmentKind): Map<string, string[]> {
  if (annotIndexCache[kind]) return annotIndexCache[kind]!;
  let rows: { wormbase_gene: string; term_id: string }[];
  if (kind === 'go') {
    rows = execAll<{ wormbase_gene: string; term_id: string }>(
      db,
      'SELECT DISTINCT wormbase_gene, go_id AS term_id FROM gene_go',
    );
  } else if (kind === 'phenotype') {
    rows = execAll<{ wormbase_gene: string; term_id: string }>(
      db,
      'SELECT DISTINCT wormbase_gene, term_id FROM gene_phenotype',
    );
  } else if (kind === 'wormcat') {
    rows = execAll<{ wormbase_gene: string; term_id: string }>(
      db,
      `SELECT DISTINCT wormbase_gene, category AS term_id FROM (
			    SELECT wormbase_gene, category_1 AS category FROM wormcat WHERE category_1 IS NOT NULL
			    UNION ALL SELECT wormbase_gene, category_2 FROM wormcat WHERE category_2 IS NOT NULL
			    UNION ALL SELECT wormbase_gene, category_3 FROM wormcat WHERE category_3 IS NOT NULL
			 )`,
    );
  } else if (kind === 'neuronal') {
    rows = execAll<{ wormbase_gene: string; term_id: string }>(
      db,
      `SELECT DISTINCT wormbase_gene, category AS term_id FROM neuronal WHERE category IS NOT NULL`,
    );
  } else if (kind === 'synaptogenesis') {
    try {
      rows = execAll<{ wormbase_gene: string; term_id: string }>(
        db,
        'SELECT DISTINCT wormbase_gene, class AS term_id FROM synaptogenesis WHERE class IS NOT NULL',
      );
    } catch {
      rows = [];
    }
  } else if (kind === 'cell-type') {
    try {
      rows = execAll<{ wormbase_gene: string; term_id: string }>(
        db,
        `SELECT DISTINCT wormbase_gene, neuron_type AS term_id
         FROM cengen_calls WHERE max_threshold >= ?`,
        [CENGEN_MIN_THRESHOLD],
      );
    } catch {
      rows = [];
    }
  } else if (kind === 'pathway') {
    try {
      rows = execAll<{ wormbase_gene: string; term_id: string }>(
        db,
        'SELECT DISTINCT wormbase_gene, pathway_id AS term_id FROM gene_kegg_pathway',
      );
    } catch {
      rows = [];
    }
  } else if (kind === 'disease') {
    try {
      rows = execAll<{ wormbase_gene: string; term_id: string }>(
        db,
        'SELECT DISTINCT wormbase_gene, do_id AS term_id FROM gene_disease',
      );
    } catch {
      rows = [];
    }
  } else {
    try {
      rows = execAll<{ wormbase_gene: string; term_id: string }>(
        db,
        'SELECT DISTINCT wormbase_gene, term_id FROM gene_anatomy',
      );
    } catch {
      rows = [];
    }
  }
  const idx = new Map<string, string[]>();
  for (const r of rows) {
    let arr = idx.get(r.wormbase_gene);
    if (!arr) {
      arr = [];
      idx.set(r.wormbase_gene, arr);
    }
    arr.push(r.term_id);
  }
  annotIndexCache[kind] = idx;
  return idx;
}

export type ReportFn = (phase: string, current?: number, total?: number) => void;

export interface CustomSet {
  term_id: string;
  name: string;
  genes: string[];
}

// Hypergeometric enrichment against a user-supplied GMT (skips the DB).
// Universe N = union of all genes across supplied sets (self-contained background,
// matching clusterProfiler's enricher() when no upstream universe is given).
export function runCustomEnrichmentSync(
  ids: string[],
  sets: CustomSet[],
  opts: { minK?: number; maxQ?: number } = {},
  report?: ReportFn,
): EnrichmentResult[] {
  const minK = opts.minK ?? 2;
  const maxQ = opts.maxQ ?? 1;
  if (ids.length < 2 || sets.length === 0) return [];
  report?.('Indexing custom sets...');
  const annot = new Map<string, string[]>();
  const universe = new Set<string>();
  const setNames = new Map<string, string>();
  const setSizes = new Map<string, number>();
  for (const s of sets) {
    setNames.set(s.term_id, s.name);
    const uniq = new Set(s.genes);
    setSizes.set(s.term_id, uniq.size);
    for (const g of uniq) {
      universe.add(g);
      let arr = annot.get(g);
      if (!arr) {
        arr = [];
        annot.set(g, arr);
      }
      arr.push(s.term_id);
    }
  }
  const N = universe.size;
  const overlapByTerm = new Map<string, string[]>();
  const annotatedSelection = new Set<string>();
  for (const g of ids) {
    const terms = annot.get(g);
    if (!terms) continue;
    annotatedSelection.add(g);
    for (const t of terms) {
      const arr = overlapByTerm.get(t);
      if (arr) arr.push(g);
      else overlapByTerm.set(t, [g]);
    }
  }
  const n = annotatedSelection.size;
  if (n === 0 || N === 0) return [];
  report?.(`Scoring ${sets.length} terms...`);
  const candidates: EnrichmentResult[] = [];
  for (const [term_id, overlap] of overlapByTerm) {
    const k = overlap.length;
    if (k < minK) continue;
    const K = setSizes.get(term_id) ?? 0;
    if (K === 0) continue;
    const p = hyperUpperTail(k, K, n, N);
    const fold = K === 0 || n === 0 ? 0 : k / n / (K / N);
    candidates.push({
      term_id,
      name: setNames.get(term_id) ?? term_id,
      k,
      K,
      n,
      N,
      fold,
      p,
      q: 0,
      overlap,
    });
  }
  if (candidates.length === 0) return [];
  const qs = bhFdr(candidates.map((c) => c.p));
  for (let i = 0; i < candidates.length; i++) candidates[i].q = qs[i];
  return candidates.filter((c) => c.q <= maxQ).sort((a, b) => a.p - b.p);
}

export function runEnrichmentSync(
  db: any,
  ids: string[],
  kind: EnrichmentKind,
  opts: { minK?: number; maxQ?: number; background?: string[] } = {},
  report?: ReportFn,
): EnrichmentResult[] {
  const minK = opts.minK ?? 2;
  const maxQ = opts.maxQ ?? 1;
  if (ids.length < 2) return [];

  const bgCold = !bgCache[kind];
  if (bgCold) report?.(`Loading ${kind} background...`);
  const bg = loadBackground(db, kind);
  const idxCold = !annotIndexCache[kind];
  if (idxCold) report?.(`Indexing ${kind} annotations...`);
  const annotIndex = loadAnnotationIndex(db, kind);
  report?.(`Scoring ${ids.length} genes...`);

  // Custom background: restrict N and per-term K to the supplied universe,
  // needed for biased screens (e.g. neuronal-restricted assays). Without a
  // background, falls back to the full annotated genome (clusterProfiler default).
  let N = bg.N;
  let perTermK = bg.K;
  if (opts.background && opts.background.length > 0) {
    const bgSet = new Set(opts.background);
    const restrictedK = new Map<string, BgEntry>();
    let nAnnotated = 0;
    for (const [gene, terms] of annotIndex.entries()) {
      if (!bgSet.has(gene)) continue;
      nAnnotated++;
      for (const t of terms) {
        const prev = restrictedK.get(t);
        const meta = bg.K.get(t);
        if (!meta) continue;
        if (!prev) restrictedK.set(t, { K: 1, name: meta.name, namespace: meta.namespace });
        else prev.K += 1;
      }
    }
    N = nAnnotated;
    perTermK = restrictedK;
    // Selection genes must also be inside the custom background to count.
    const restrictedIds = ids.filter((g) => bgSet.has(g));
    ids = restrictedIds;
  }

  const overlapByTerm = new Map<string, string[]>();
  const annotatedSelection = new Set<string>();
  for (const gene of ids) {
    const terms = annotIndex.get(gene);
    if (!terms || terms.length === 0) continue;
    annotatedSelection.add(gene);
    for (const t of terms) {
      const arr = overlapByTerm.get(t);
      if (arr) arr.push(gene);
      else overlapByTerm.set(t, [gene]);
    }
  }
  const n = annotatedSelection.size;
  if (n === 0 || N === 0) return [];

  const candidates: EnrichmentResult[] = [];
  for (const [term_id, overlap] of overlapByTerm) {
    const k = overlap.length;
    if (k < minK) continue;
    const meta = perTermK.get(term_id);
    if (!meta) continue;
    const K = meta.K;
    if (K < k) continue; // background mismatch; shouldn't happen but defensive
    const p = hyperUpperTail(k, K, n, N);
    const fold = K === 0 || n === 0 ? 0 : k / n / (K / N);
    candidates.push({
      term_id,
      name: meta.name,
      namespace: meta.namespace,
      k,
      K,
      n,
      N,
      fold,
      p,
      q: 0,
      overlap,
    });
  }
  if (candidates.length === 0) return [];

  const qs = bhFdr(candidates.map((c) => c.p));
  for (let i = 0; i < candidates.length; i++) candidates[i].q = qs[i];

  return candidates.filter((c) => c.q <= maxQ).sort((a, b) => a.p - b.p);
}
