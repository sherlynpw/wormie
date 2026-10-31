// Phenotype and anatomy annotations propagated to every ancestor term, so a gene annotated to a
// specific term also counts toward the broader ones (the true path rule). WormBase's tissue,
// phenotype and GO enrichment tools build their sets this way (Angeles-Albores et al. 2016),
// and the build does the same for GO. The tables live in TEMP on the worker's connection and are
// made on first use, which keeps the shipped database and older pinned builds unchanged.
import { execAll } from './sql';

export const PHENOTYPE_ALL = 'gene_phenotype_all';
export const ANATOMY_ALL = 'gene_anatomy_all';

const SOURCES = [
  { table: PHENOTYPE_ALL, direct: 'gene_phenotype', relations: 'phenotype_relations' },
  { table: ANATOMY_ALL, direct: 'gene_anatomy', relations: 'anatomy_relations' },
] as const;

type Db = any;

const ready = new WeakSet<object>();

function hasTable(db: Db, name: string): boolean {
  return (
    execAll<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`,
      [name],
    )[0].n > 0
  );
}

/** Create the propagated tables on `db` if this connection does not have them yet. */
export function ensurePropagated(db: Db): void {
  if (ready.has(db)) return;
  for (const s of SOURCES) {
    if (!hasTable(db, s.direct)) {
      db.exec(`CREATE TEMP TABLE IF NOT EXISTS ${s.table} (wormbase_gene TEXT, term_id TEXT)`);
      continue;
    }
    // Builds without the hierarchy (anatomy before 2026-10) keep their direct annotations.
    const select = hasTable(db, s.relations)
      ? `WITH RECURSIVE anc(term_id, ancestor) AS (
           SELECT DISTINCT term_id, term_id FROM ${s.direct}
           UNION
           SELECT a.term_id, r.parent_id FROM anc a JOIN ${s.relations} r ON r.child_id = a.ancestor
         )
         SELECT DISTINCT d.wormbase_gene, a.ancestor AS term_id
         FROM ${s.direct} d JOIN anc a ON a.term_id = d.term_id`
      : `SELECT DISTINCT wormbase_gene, term_id FROM ${s.direct}`;
    db.exec(`CREATE TEMP TABLE IF NOT EXISTS ${s.table} AS ${select}`);
    db.exec(`CREATE INDEX IF NOT EXISTS temp.idx_${s.table}_term ON ${s.table}(term_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS temp.idx_${s.table}_gene ON ${s.table}(wormbase_gene)`);
  }
  ready.add(db);
}

/** True when `sql` reads a propagated table, so the caller must run ensurePropagated first. */
export function usesPropagated(sql: string): boolean {
  return sql.includes(PHENOTYPE_ALL) || sql.includes(ANATOMY_ALL);
}
