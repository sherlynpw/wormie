import { query } from '$lib/db/client';
import { searchSchema } from '$lib/stores/search-schema.svelte';
import { GO_POSITIVE, CENGEN_MIN_THRESHOLD } from '$lib/db/term-filters';
import {
  buildWormcatTerms,
  WORMCAT_LEVEL_ROWS_SQL,
  type WormcatLevelRow,
} from '$lib/db/wormcat-terms';
import type { EnrichmentKind } from '$lib/db/client';
import type { Gene } from '$lib/types';
import {
  opValueTokens,
  escapeFts,
  parseQuery,
  FTS_OP_COLUMNS,
  globToLike,
  type ParsedQuery,
  type FtsField,
  type Op,
  type SeqItem,
} from '$lib/search';

// Markers used by FTS5 snippet() to flag matched terms. Unicode SOH/STX so
// they can't collide with real data. Stripped/parsed client-side.
const MATCH_START = '';
const MATCH_END = '';

// Columns shown in the "Matched in" line; skips already-highlighted columns (gene_name, sequence_name, descriptions).
type MatchField =
  | 'phenotypes'
  | 'alleles'
  | 'tissues'
  | 'go_terms'
  | 'wormcat'
  | 'neuronal'
  | 'orthologs'
  | 'synaptogenesis'
  | 'domains';
// snippet() column indexes count every column of genes_fts in table order,
// unindexed ones included (wormbase_gene 0 ... legacy_description 8).
const MATCH_COLS: { idx: number; field: MatchField; label: string }[] = [
  { idx: 9, field: 'phenotypes', label: 'Phenotypes' },
  { idx: 10, field: 'alleles', label: 'Alleles' },
  { idx: 11, field: 'tissues', label: 'Tissues' },
  { idx: 12, field: 'go_terms', label: 'GO' },
  { idx: 13, field: 'wormcat', label: 'WormCat' },
  { idx: 14, field: 'neuronal', label: 'Neuronal genes' },
  { idx: 15, field: 'orthologs', label: 'Orthologs' },
  { idx: 16, field: 'synaptogenesis', label: 'Synapse panel' },
];
const DOMAINS_MATCH_COL = { idx: 18, field: 'domains' as MatchField, label: 'Domain' };
function matchCols() {
  return searchSchema.domains ? [...MATCH_COLS, DOMAINS_MATCH_COL] : MATCH_COLS;
}

/** Drops full-text fields the loaded build does not have. */
export function availableFtsFields(fields: readonly FtsField[]): FtsField[] {
  return fields.filter((f) => f !== 'domains' || searchSchema.domains);
}

/** Reads the optional search columns once the database is open. */
export async function detectSearchSchema(): Promise<void> {
  searchSchema.domains = await hasColumn('genes_fts', 'domains');
}

export interface MatchedField {
  field: MatchField;
  label: string;
  segments: { t: string; m: boolean }[];
}

function parseSnippet(raw: string | null): {
  matched: boolean;
  segments: { t: string; m: boolean }[];
} {
  if (!raw) return { matched: false, segments: [] };
  const matched = raw.includes(MATCH_START);
  if (!matched) return { matched: false, segments: [] };
  const segments: { t: string; m: boolean }[] = [];
  let i = 0;
  while (i < raw.length) {
    const s = raw.indexOf(MATCH_START, i);
    if (s === -1) {
      if (i < raw.length) segments.push({ t: raw.slice(i), m: false });
      break;
    }
    if (s > i) segments.push({ t: raw.slice(i, s), m: false });
    const e = raw.indexOf(MATCH_END, s);
    if (e === -1) break;
    segments.push({ t: raw.slice(s + 1, e), m: true });
    i = e + 1;
  }
  return { matched: true, segments };
}

// WormBase writes literal placeholders (e.g. "none available") for unannotated genes (e.g. 21U piRNAs).
// Build pipeline strips them at ingest, but pre-fix DBs still contain them; treat as empty everywhere.
const DESC_PLACEHOLDERS = [
  'none available',
  'not available',
  'no description available',
  'unavailable',
  'n/a',
  'na',
];
function isDescPlaceholder(v: string | null | undefined): boolean {
  if (!v) return true;
  const t = v.trim().toLowerCase();
  return t === '' || DESC_PLACEHOLDERS.includes(t);
}

// Bucket on curated concise descriptions only; legacy/automated descriptions are generated for almost every gene
// so they're not a useful annotation-quality signal. Placeholders scrubbed at DB load, so IS NOT NULL is correct.
const HAS_DESC = `(a.concise_description IS NOT NULL)`;
// Secondary bucket: named gene (daf-2) > sequence-only (Y110A7A.10) > WBGene-id-only, within each HAS_DESC tier.
const HAS_NAME = `(a.gene_name IS NOT NULL)`;
// Combined rank: annotation tier, then name presence, then alphabetical fallback.
const NAME_RANK = `${HAS_DESC} DESC, ${HAS_NAME} DESC, COALESCE(a.gene_name, a.sequence_name, a.wormbase_gene)`;

function scrubDescriptions<
  T extends {
    concise_description?: string | null;
    legacy_description?: string | null;
    gene_class_description?: string | null;
  },
>(r: T): T {
  if (isDescPlaceholder(r.concise_description)) r.concise_description = null;
  if (isDescPlaceholder(r.legacy_description)) r.legacy_description = null;
  if (isDescPlaceholder(r.gene_class_description)) r.gene_class_description = null;
  return r;
}

const BASE_COLUMNS = `
	SELECT a.wormbase_gene, a.gene_name, a.sequence_name, a.gene_type, a.status,
	       a.gene_class_description, a.concise_description, a.legacy_description,
	       a.other_names, a.operon,
	       (SELECT entrez_id FROM wb_to_entrez WHERE wormbase_gene = a.wormbase_gene LIMIT 1) AS entrez_id`;
const LOCATION_COLUMNS = `,
	       l.chromosome, l.start_pos, l.end_pos, l.strand, l.cm`;
const NO_LOCATION_COLUMNS = `,
	       NULL AS chromosome, NULL AS start_pos, NULL AS end_pos, NULL AS strand, NULL AS cm`;

// The deployed database can predate gene_location by up to a week, so the
// column list is decided once per session from the schema rather than assumed.
export function hasGeneLocation(): Promise<boolean> {
  return hasTable('gene_location');
}
async function baseSelect(): Promise<string> {
  return BASE_COLUMNS + ((await hasGeneLocation()) ? LOCATION_COLUMNS : NO_LOCATION_COLUMNS);
}
// Joined after every `FROM annotations a`; harmless when the table is absent because
// the join is only emitted when it exists.
async function locationJoin(): Promise<string> {
  return (await hasGeneLocation())
    ? ' LEFT JOIN gene_location l ON l.wormbase_gene = a.wormbase_gene'
    : '';
}

export interface GeneRow extends Gene {
  rank?: number;
  matched_fields?: MatchedField[];
}

export interface SearchOpts {
  term: string;
  limit?: number;
}

// One bound JSON array instead of a placeholder per id: a pasted list of a few
// thousand ids, bound three times, passes SQLite's variable limit otherwise.
const JSON_LIST = '(SELECT value FROM json_each(?))';
const jsonList = (ids: string[]) => JSON.stringify(ids);

export async function getGenesByIds(ids: string[]): Promise<GeneRow[]> {
  if (ids.length === 0) return [];
  const rows = await query<GeneRow>(
    `${await baseSelect()}
		 FROM annotations a${await locationJoin()}
		 WHERE a.wormbase_gene IN ${JSON_LIST}
		 ORDER BY ${NAME_RANK}`,
    [jsonList(ids)],
  );
  return rows.map(scrubDescriptions);
}

export async function listGenes(limit = 50, offset = 0): Promise<GeneRow[]> {
  // No gene_name filter: facets count all annotations so pagination must match; GeneCard falls back to wormbase_gene.
  const rows = await query<GeneRow>(
    `${await baseSelect()}
		 FROM annotations a${await locationJoin()}
		 ORDER BY ${NAME_RANK}
		 LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  return rows.map(scrubDescriptions);
}

function opLikeSubquery(op: Op): { sql: string; params: unknown[] } | null {
  const v = op.value.trim();
  if (!v) return null;
  const like = globToLike(v).toLowerCase();
  switch (op.key) {
    case 'name':
      return {
        sql: `SELECT wormbase_gene FROM annotations
				      WHERE LOWER(gene_name) LIKE ? ESCAPE '\\'
				         OR LOWER(other_names) LIKE ? ESCAPE '\\'`,
        params: [like, like],
      };
    case 'seq':
      return {
        sql: `SELECT wormbase_gene FROM annotations WHERE LOWER(sequence_name) LIKE ? ESCAPE '\\'`,
        params: [like],
      };
    case 'wb':
      return {
        sql: `SELECT wormbase_gene FROM annotations WHERE LOWER(wormbase_gene) LIKE ? ESCAPE '\\'`,
        params: [like],
      };
    case 'desc':
      return {
        sql: `SELECT wormbase_gene FROM annotations
				      WHERE LOWER(concise_description) LIKE ? ESCAPE '\\'
				         OR LOWER(legacy_description) LIKE ? ESCAPE '\\'
				         OR LOWER(gene_class_description) LIKE ? ESCAPE '\\'`,
        params: [like, like, like],
      };
  }
  return null;
}

// chr:x, chr:chrIII, chr:mtdna all name the WBcel235 chromosome as the Alliance writes it.
export function normalizeChromosome(v: string): string {
  const c = v.trim().replace(/^chr/i, '');
  if (/^mt/i.test(c)) return 'MtDNA';
  return c.toUpperCase();
}

function opSubquery(op: Op): { sql: string; params: unknown[] } | null {
  const v = op.value.trim();
  if (!v) return null;
  switch (op.key) {
    case 'go':
      return {
        sql: `SELECT gg.wormbase_gene FROM gene_go gg
				      JOIN go_fts f ON f.go_id = gg.go_id
				      WHERE go_fts MATCH ?`,
        params: [escapeFts(opValueTokens(v))],
      };
    case 'cat':
      return {
        sql: `SELECT wormbase_gene FROM wormcat_fts WHERE wormcat_fts MATCH ?`,
        params: [escapeFts(opValueTokens(v))],
      };
    case 'neuronal':
      return {
        sql: `SELECT DISTINCT wormbase_gene FROM neuronal
				      WHERE LOWER(category) LIKE ? OR LOWER(supercategory) LIKE ?`,
        params: [`%${v.toLowerCase()}%`, `%${v.toLowerCase()}%`],
      };
    case 'syn':
      // Matches class, subclass, notes via case-insensitive LIKE.
      // Spaces also map to underscores so "active zone" matches "06_active_zone".
      return {
        sql: `SELECT DISTINCT wormbase_gene FROM synaptogenesis
				      WHERE LOWER(class) LIKE ?
				         OR LOWER(class) LIKE ?
				         OR LOWER(subclass) LIKE ?
				         OR LOWER(notes) LIKE ?`,
        params: [
          `%${v.toLowerCase()}%`,
          `%${v.toLowerCase().replace(/\s+/g, '_')}%`,
          `%${v.toLowerCase()}%`,
          `%${v.toLowerCase()}%`,
        ],
      };
    case 'pathway':
      return {
        sql: `SELECT gkp.wormbase_gene FROM gene_kegg_pathway gkp
              JOIN kegg_fts f ON f.pathway_id = gkp.pathway_id
              WHERE kegg_fts MATCH ?`,
        params: [escapeFts(opValueTokens(v))],
      };
    case 'wb':
      return {
        sql: `SELECT wormbase_gene FROM annotations WHERE wormbase_gene = ?`,
        params: [v.replace(/^WBGENE/i, 'WBGene')],
      };
    case 'domain':
      // Accession (PF00250, IPR001766) or a word of the domain name.
      return {
        sql: `SELECT DISTINCT wormbase_gene FROM gene_domain
              WHERE UPPER(accession) = ? OR LOWER(name) LIKE ?`,
        params: [v.toUpperCase(), `%${v.toLowerCase()}%`],
      };
    case 'chr':
      return {
        sql: `SELECT wormbase_gene FROM gene_location WHERE chromosome = ?`,
        params: [normalizeChromosome(v)],
      };
    case 'status':
      return {
        sql: `SELECT wormbase_gene FROM annotations WHERE LOWER(status) = ?`,
        params: [v.toLowerCase()],
      };
    case 'type':
      return {
        sql: `SELECT wormbase_gene FROM annotations WHERE LOWER(gene_type) LIKE ?`,
        params: [`%${normalizeBiotype(v)}%`],
      };
    case 'expressed': {
      // Syntax variants: expressed:AVA (medium threshold), expressed:AVA@stringent (liberal|medium|conservative|stringent),
      // expressed:AVA@3 (numeric level 1-4), expressed:AVA>10 (bulk TMM comparison), expressed:AVA,AVB (either neuron).
      // Try threshold-named or TMM-numeric form first; fall back to default binary call.
      const named: Record<string, number> = {
        liberal: 1,
        medium: 2,
        conservative: 3,
        stringent: 4,
        '1': 1,
        '2': 2,
        '3': 3,
        '4': 4,
      };
      const atMatch = v.match(/^(.+?)@([a-z0-9]+)$/i);
      if (atMatch) {
        const types = atMatch[1]
          .split(/[,;|/]/)
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean);
        const level = named[atMatch[2].toLowerCase()];
        if (types.length && level) {
          const inList = types.map(() => '?').join(',');
          return {
            sql: `SELECT DISTINCT wormbase_gene FROM cengen_calls
						      WHERE UPPER(neuron_type) IN (${inList}) AND max_threshold >= ?`,
            params: [...types, level],
          };
        }
      }
      const numMatch = v.match(/^([^<>=]+?)\s*(>=|<=|>|<|=)\s*(\d+(?:\.\d+)?)$/);
      if (numMatch) {
        const types = numMatch[1]
          .split(/[,;|/]/)
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean);
        const cmp = numMatch[2];
        const threshold = parseFloat(numMatch[3]);
        if (types.length) {
          const inList = types.map(() => '?').join(',');
          return {
            sql: `SELECT DISTINCT wormbase_gene FROM cengen_expression
						      WHERE UPPER(neuron_type) IN (${inList}) AND tmm ${cmp} ?`,
            params: [...types, threshold],
          };
        }
      }
      // Default: binary call at medium threshold (level 2), same as CeNGEN app default.
      const types = v
        .split(/[,;|/]/)
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean);
      if (types.length === 0) return null;
      const inList = types.map(() => '?').join(',');
      return {
        sql: `SELECT DISTINCT wormbase_gene FROM cengen_calls
				      WHERE UPPER(neuron_type) IN (${inList}) AND max_threshold >= 2`,
        params: types,
      };
    }
  }
  return null;
}

export interface BulkLookupHit {
  input: string;
  wormbase_gene: string;
  gene_name: string | null;
  sequence_name: string | null;
  concise_description: string | null;
  /** WormBase gene status: Live, Dead or Suppressed. Surfaced, never filtered on. */
  status: string | null;
  chromosome?: string | null;
  cm?: number | null;
}

/**
 * Map foreign-species gene symbols/IDs (e.g. human "TP53", HGNC IDs, mouse
 * "Trp53", MGI IDs) to C. elegans WBGene IDs via the Alliance ortholog table.
 *
 * `species` matches the Alliance `species` column ("Homo sapiens", "Mus musculus",
 * "Danio rerio", etc.). Returns per-input the mapped worm genes (could be 0..N).
 */
export interface OrthologHit {
  input: string;
  worm_genes: string[];
}

export async function resolveOrthologs(tokens: string[], species: string): Promise<OrthologHit[]> {
  const unique = [...new Set(tokens.map((t) => t.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const rows = await query<{ input: string; wormbase_gene: string }>(
    `SELECT lower(ortholog_symbol) AS input, wormbase_gene FROM orthologs
       WHERE species = ? AND lower(ortholog_symbol) IN ${JSON_LIST}
     UNION
     SELECT ortholog_id AS input, wormbase_gene FROM orthologs
       WHERE species = ? AND ortholog_id IN ${JSON_LIST}`,
    [species, jsonList(unique.map((t) => t.toLowerCase())), species, jsonList(unique)],
  );
  const byInput = new Map<string, Set<string>>();
  for (const t of unique) byInput.set(t, new Set());
  for (const r of rows) {
    const norm = unique.find((u) => u.toLowerCase() === r.input || u === r.input);
    if (norm) byInput.get(norm)!.add(r.wormbase_gene);
  }
  return [...byInput.entries()].map(([input, set]) => ({ input, worm_genes: [...set] }));
}

export async function bulkLookup(
  tokens: string[],
): Promise<{ hits: BulkLookupHit[]; misses: string[] }> {
  const unique = [...new Set(tokens.map((t) => t.trim()).filter(Boolean))];
  if (unique.length === 0) return { hits: [], misses: [] };
  const lowered = unique.map((t) => t.toLowerCase());
  const chromCol = (await hasGeneLocation())
    ? ', (SELECT chromosome FROM gene_location WHERE wormbase_gene = a.wormbase_gene) AS chromosome, (SELECT cm FROM gene_location WHERE wormbase_gene = a.wormbase_gene) AS cm'
    : '';

  const { jobs } = await import('$lib/stores/jobs.svelte');
  const jobId = `bulkLookup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  jobs.start(jobId, 'Resolving gene names');
  jobs.update(jobId, `Looking up ${unique.length.toLocaleString()} tokens...`);

  try {
    // Partition: indexed equality on WBGene tokens (fast), fuzzy OR scan on residual only.
    // A single non-WBGene token previously pushed the entire batch to the slow path (catastrophic for 100k+ inputs).
    type Row = {
      input_lower: string;
      wormbase_gene: string;
      gene_name: string | null;
      sequence_name: string | null;
      chromosome?: string | null;
      cm?: number | null;
      concise_description: string | null;
      status: string | null;
    };
    const WBGENE_RE = /^WBGene\d+$/i;
    const ENTREZ_RE = /^\d+$/;
    const wbgeneTokens = unique.filter((t) => WBGENE_RE.test(t));
    const entrezTokens = unique.filter((t) => ENTREZ_RE.test(t));
    const residual = unique.filter((t) => !WBGENE_RE.test(t) && !ENTREZ_RE.test(t));
    void lowered; // residualLower is built below from `residual` only.
    const rows: Row[] = [];
    if (wbgeneTokens.length > 0) {
      // Normalise to canonical "WBGene" prefix so the BINARY idx_anno_wb index is used.
      // COLLATE NOCASE forces a full scan (verified via EXPLAIN QUERY PLAN).
      const canonical = wbgeneTokens.map((t) => t.replace(/^WBGENE/i, 'WBGene'));
      jobs.update(jobId, `Indexed lookup · ${canonical.length.toLocaleString()} WBGene IDs`);
      const raw = await query<{
        input_id: string;
        wormbase_gene: string;
        gene_name: string | null;
        sequence_name: string | null;
        chromosome?: string | null;
        cm?: number | null;
        concise_description: string | null;
        status: string | null;
      }>(
        `WITH inputs(input_id) AS (
			   SELECT value FROM json_each(?)
			 )
			 SELECT i.input_id,
			        a.wormbase_gene, a.gene_name, a.sequence_name, a.concise_description, a.status${chromCol}
			 FROM inputs i
			 JOIN annotations a ON a.wormbase_gene = i.input_id`,
        [JSON.stringify(canonical)],
      );
      for (const r of raw) {
        rows.push({
          input_lower: r.input_id.toLowerCase(),
          wormbase_gene: r.wormbase_gene,
          gene_name: r.gene_name,
          sequence_name: r.sequence_name,
          chromosome: r.chromosome ?? null,
          cm: r.cm ?? null,
          concise_description: r.concise_description,
          status: r.status,
        });
      }
    }
    if (entrezTokens.length > 0) {
      jobs.update(jobId, `Entrez lookup · ${entrezTokens.length.toLocaleString()} IDs`);
      const entrezRows = await query<Row>(
        `WITH inputs(input_lower) AS (
			   SELECT value FROM json_each(?)
			 )
			 SELECT i.input_lower,
			        a.wormbase_gene, a.gene_name, a.sequence_name, a.concise_description, a.status${chromCol}
			 FROM inputs i
			 JOIN wb_to_entrez we ON we.entrez_id = i.input_lower
			 JOIN annotations a ON a.wormbase_gene = we.wormbase_gene`,
        [JSON.stringify(entrezTokens)],
      );
      for (const r of entrezRows) rows.push(r);
    }
    if (residual.length > 0) {
      const residualLower = residual.map((t) => t.toLowerCase());
      jobs.update(jobId, `Fuzzy match · ${residual.length.toLocaleString()} tokens (slow path)`);
      // WBGene tokens handled above; LOWER(a.wormbase_gene) OR dropped from this branch.
      const fuzzyRows = await query<Row>(
        `WITH inputs(input_lower) AS (
			   SELECT value FROM json_each(?)
			 )
			 SELECT i.input_lower,
			        a.wormbase_gene, a.gene_name, a.sequence_name, a.concise_description, a.status${chromCol}
			 FROM inputs i
			 JOIN annotations a
			   ON LOWER(a.gene_name) = i.input_lower
			   OR LOWER(a.sequence_name) = i.input_lower
			   OR LOWER(a.other_names) = i.input_lower
			   OR '|' || LOWER(REPLACE(REPLACE(a.other_names, ' ', ''), ',', '|')) || '|'
			        LIKE '%|' || i.input_lower || '|%'`,
        [JSON.stringify(residualLower)],
      );
      for (const r of fuzzyRows) rows.push(r);
    }

    const matchedByLower = new Map<string, BulkLookupHit[]>();
    for (const r of rows) {
      const key = r.input_lower;
      const hit: BulkLookupHit = {
        input: '', // filled below
        wormbase_gene: r.wormbase_gene,
        gene_name: r.gene_name,
        sequence_name: r.sequence_name,
        chromosome: r.chromosome ?? null,
        cm: r.cm ?? null,
        concise_description: r.concise_description,
        status: r.status,
      };
      if (!matchedByLower.has(key)) matchedByLower.set(key, []);
      matchedByLower.get(key)!.push(hit);
    }

    const hits: BulkLookupHit[] = [];
    const misses: string[] = [];
    for (const token of unique) {
      const list = matchedByLower.get(token.toLowerCase());
      if (list && list.length > 0) {
        for (const h of list) hits.push({ ...h, input: token });
      } else {
        misses.push(token);
      }
    }
    jobs.finish(jobId);
    return { hits, misses };
  } catch (err) {
    jobs.fail(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function searchByGeneList(ids: string[], limit: number, offset = 0): Promise<GeneRow[]> {
  const lower = jsonList(ids.map((id) => id.toLowerCase()));
  const rows = await query<GeneRow>(
    `${await baseSelect()}
		 FROM annotations a${await locationJoin()}
		 WHERE a.wormbase_gene IN ${JSON_LIST}
		    OR LOWER(a.gene_name) IN ${JSON_LIST}
		    OR LOWER(a.sequence_name) IN ${JSON_LIST}
		 ORDER BY ${NAME_RANK}
		 LIMIT ? OFFSET ?`,
    [jsonList(ids), lower, lower, limit, offset],
  );
  return rows.map(scrubDescriptions);
}

export interface SearchResult {
  rows: GeneRow[];
  parsed: ParsedQuery;
}

// One subquery per term of a query that mixes AND/OR/NOT with table-routed prefixes,
// joined as a compound select in token order. An empty term is skipped together with
// the connector before it; a leading NOT subtracts from the whole gene table.
function compoundSubquery(
  sequence: SeqItem[],
  globalFields: readonly FtsField[] | undefined,
): { sql: string; params: unknown[] } | null {
  const CONN: Record<'AND' | 'OR' | 'NOT', string> = {
    AND: 'INTERSECT',
    OR: 'UNION',
    NOT: 'EXCEPT',
  };
  const parts: string[] = [];
  const params: unknown[] = [];
  let pending: 'AND' | 'OR' | 'NOT' | null = null;
  for (const item of sequence) {
    if (item.kind === 'conn') {
      pending = item.conn;
      continue;
    }
    let sq: { sql: string; params: unknown[] } | null = null;
    if (item.kind === 'free') {
      const e = escapeFts([item.token], globalFields);
      if (e)
        sq = { sql: `SELECT wormbase_gene FROM genes_fts WHERE genes_fts MATCH ?`, params: [e] };
    } else if (item.op.mode === 'like') {
      sq = opLikeSubquery(item.op);
    } else if (FTS_OP_COLUMNS[item.op.key]) {
      const tokens = opValueTokens(item.op.value);
      const e = tokens.length ? escapeFts(tokens, FTS_OP_COLUMNS[item.op.key]) : '';
      if (e)
        sq = { sql: `SELECT wormbase_gene FROM genes_fts WHERE genes_fts MATCH ?`, params: [e] };
    } else {
      sq = opSubquery(item.op);
    }
    if (!sq) {
      pending = null;
      continue;
    }
    if (parts.length === 0) {
      if (pending === 'NOT') parts.push('SELECT wormbase_gene FROM annotations');
      else pending = null;
    }
    if (parts.length > 0) parts.push(CONN[pending ?? 'AND']);
    parts.push(sq.sql);
    params.push(...sq.params);
    pending = null;
  }
  if (parts.length === 0) return null;
  return { sql: parts.join('\n'), params };
}

// Build a single FTS5 MATCH expression from free-text tokens and scoped FTS ops (pheno:, tissue:, etc.).
// Each scoped op becomes `{col1 col2}: ("a" OR "b")`; all components are ANDed.
function buildFtsExpression(
  freeTextTokens: string[],
  globalFields: readonly FtsField[] | undefined,
  ftsOps: Op[],
  sequence?: SeqItem[],
): string {
  // When the query contains explicit AND/OR/NOT and every op is FTS-routable, preserve token order.
  // e.g. `desc:"TGF-beta" OR pheno:Daf-c` produces `{desc cols}:("TGF-beta") OR {phenotypes}:("Daf-c")`
  // instead of collapsing into free-text scope.
  const hasConn = sequence?.some((s) => s.kind === 'conn');
  const allOpsFts = sequence?.every((s) => s.kind !== 'op' || !!FTS_OP_COLUMNS[s.op.key]);
  if (sequence && hasConn && allOpsFts) {
    const out: string[] = [];
    for (const item of sequence) {
      if (item.kind === 'conn') {
        out.push(item.conn);
        continue;
      }
      let part = '';
      if (item.kind === 'free') {
        part = escapeFts([item.token], globalFields);
      } else {
        const cols = FTS_OP_COLUMNS[item.op.key];
        const tokens = opValueTokens(item.op.value);
        if (cols && tokens.length) part = escapeFts(tokens, cols);
      }
      if (!part) continue;
      // Insert implicit AND between adjacent parts (mirrors FTS5 implicit AND), but skip if prev was a connector.
      const prev = out[out.length - 1];
      if (out.length && prev !== 'AND' && prev !== 'OR' && prev !== 'NOT') {
        out.push('AND');
      }
      out.push(part);
    }
    // Trim a dangling trailing connector if a part after it ended up empty.
    while (out.length && /^(AND|OR|NOT)$/.test(out[out.length - 1])) out.pop();
    return out.join(' ');
  }

  const parts: string[] = [];
  if (freeTextTokens.length) {
    const e = escapeFts(freeTextTokens, globalFields);
    if (e) parts.push(e);
  }
  for (const op of ftsOps) {
    const cols = FTS_OP_COLUMNS[op.key];
    if (!cols) continue;
    const tokens = opValueTokens(op.value);
    if (!tokens.length) continue;
    const e = escapeFts(tokens, cols);
    if (e) parts.push(e);
  }
  // FTS5 precedence: column-filter > NOT > AND > OR. Bare AND join is unambiguous;
  // outer parens per part are not needed and trip up some FTS5 query-parser paths.
  return parts.join(' AND ');
}

// Routes a parsed query into the gene subqueries that runSearch and the facet
// counts both intersect, so the result list and its counter cannot disagree.
function routeQuery(
  parsed: ParsedQuery,
  fields: readonly FtsField[] | undefined,
): {
  ftsExpr: string;
  tableOps: Op[];
  likeOps: Op[];
  compound: boolean;
  intersects: string[];
  params: unknown[];
} {
  const ftsOps: Op[] = [];
  const tableOps: Op[] = [];
  const likeOps: Op[] = [];
  for (const op of parsed.ops) {
    if (op.mode === 'like') likeOps.push(op);
    else if (FTS_OP_COLUMNS[op.key] && (op.key !== 'domain' || searchSchema.domains))
      ftsOps.push(op);
    else tableOps.push(op);
  }

  const intersects: string[] = [];
  const params: unknown[] = [];

  // Hybrid pre-filter: when IDs are mixed with ops (e.g. "WBGene00018330 desc:presyn"),
  // restrict to those IDs first. CTE matches wormbase_gene OR gene_name OR sequence_name.
  if (parsed.ids.length > 0) {
    const lowered = jsonList(parsed.ids.map((t) => t.toLowerCase()));
    intersects.push(
      `SELECT a.wormbase_gene FROM annotations a
		   WHERE a.wormbase_gene IN ${JSON_LIST}
		      OR LOWER(a.gene_name) IN ${JSON_LIST}
		      OR LOWER(a.sequence_name) IN ${JSON_LIST}`,
    );
    params.push(jsonList(parsed.ids), lowered, lowered);
  }

  // Explicit AND/OR/NOT with a prefix that is not FTS-routable (go:, expressed:, ...)
  // cannot be expressed inside one MATCH, so each term becomes a subquery and the
  // connectors become INTERSECT / UNION / EXCEPT. SQLite evaluates a compound select
  // left to right, so `a OR b AND c` reads as (a OR b) AND c here. Ranking by bm25
  // and match snippets are unavailable in this mode.
  const hasConn = parsed.sequence?.some((s) => s.kind === 'conn') ?? false;
  const allOpsFts =
    parsed.sequence?.every((s) => s.kind !== 'op' || !!FTS_OP_COLUMNS[s.op.key]) ?? true;
  const compound = hasConn && !allOpsFts ? compoundSubquery(parsed.sequence!, fields) : null;
  const ftsExpr = compound
    ? ''
    : buildFtsExpression(parsed.freeTextTokens, fields, ftsOps, parsed.sequence);
  if (compound) {
    intersects.push(compound.sql);
    params.push(...compound.params);
  }
  if (ftsExpr) {
    intersects.push(`SELECT wormbase_gene FROM genes_fts WHERE genes_fts MATCH ?`);
    params.push(ftsExpr);
  }
  for (const op of compound ? [] : tableOps) {
    const sq = opSubquery(op);
    if (!sq) continue;
    intersects.push(sq.sql);
    params.push(...sq.params);
  }
  for (const op of compound ? [] : likeOps) {
    const sq = opLikeSubquery(op);
    if (!sq) continue;
    intersects.push(sq.sql);
    params.push(...sq.params);
  }
  return { ftsExpr, tableOps, likeOps, compound: !!compound, intersects, params };
}

export async function runSearch(
  input: string,
  limit = 500,
  offset = 0,
  fields?: readonly FtsField[],
): Promise<SearchResult> {
  const parsed = parseQuery(input);

  if (parsed.mode === 'empty') {
    return { rows: await listGenes(limit, offset), parsed };
  }

  if (parsed.mode === 'genelist') {
    return { rows: await searchByGeneList(parsed.ids, limit, offset), parsed };
  }

  const { ftsExpr, tableOps, likeOps, compound, intersects, params } = routeQuery(parsed, fields);

  if (intersects.length === 0) {
    return { rows: await listGenes(limit, offset), parsed };
  }

  // Fast path for status/type-only queries: push conditions directly into WHERE,
  // avoiding the IN-subquery overhead. Cuts status:live load from ~2s to <100ms.
  const annoOnly =
    !compound &&
    !ftsExpr &&
    likeOps.length === 0 &&
    tableOps.length > 0 &&
    tableOps.every((o) => o.key === 'status' || o.key === 'type');
  if (annoOnly) {
    const conds: string[] = [];
    const annoParams: unknown[] = [];
    for (const op of tableOps) {
      const v = op.value.trim();
      if (op.key === 'status') {
        conds.push('LOWER(a.status) = ?');
        annoParams.push(v.toLowerCase());
      } else {
        conds.push('LOWER(a.gene_type) LIKE ?');
        annoParams.push(`%${normalizeBiotype(v)}%`);
      }
    }
    const sql = `${await baseSelect()}
		             FROM annotations a${await locationJoin()}
		             WHERE ${conds.join(' AND ')}
		             ORDER BY ${NAME_RANK}
		             LIMIT ? OFFSET ?`;
    annoParams.push(limit, offset);
    const rows = (await query<GeneRow>(sql, annoParams)).map(scrubDescriptions);
    return { rows, parsed };
  }

  const intersected = intersects.join(' INTERSECT ');

  const wantsSnippets = !!ftsExpr;
  const snippetSelect = wantsSnippets
    ? ',\n' +
      matchCols()
        .map(
          (c) =>
            `snippet(genes_fts, ${c.idx}, '${MATCH_START}', '${MATCH_END}', '', 8) AS m_${c.field}`,
        )
        .join(',\n')
    : '';

  let sql: string;
  if (ftsExpr) {
    sql = `${await baseSelect()}, bm25(genes_fts) AS rank${snippetSelect}
		       FROM annotations a${await locationJoin()}
		       JOIN genes_fts f ON f.wormbase_gene = a.wormbase_gene
		       WHERE a.wormbase_gene IN (${intersected})
		         AND genes_fts MATCH ?
		       ORDER BY ${HAS_DESC} DESC, ${HAS_NAME} DESC, rank
		       LIMIT ? OFFSET ?`;
    params.push(ftsExpr, limit, offset);
  } else {
    sql = `${await baseSelect()}
		       FROM annotations a${await locationJoin()}
		       WHERE a.wormbase_gene IN (${intersected})
		       ORDER BY ${NAME_RANK}
		       LIMIT ? OFFSET ?`;
    params.push(limit, offset);
  }

  type Raw = GeneRow & Partial<Record<`m_${MatchField}`, string | null>>;
  const raw = await query<Raw>(sql, params);
  const rows: GeneRow[] = raw.map((r) => {
    scrubDescriptions(r);
    if (!wantsSnippets) return r;
    const matched: MatchedField[] = [];
    for (const c of matchCols()) {
      const snip = r[`m_${c.field}`];
      const { matched: m, segments } = parseSnippet(snip ?? null);
      if (m) matched.push({ field: c.field, label: c.label, segments });
      delete (r as unknown as Record<string, unknown>)[`m_${c.field}`];
    }
    if (matched.length) r.matched_fields = matched;
    return r;
  });
  return { rows, parsed };
}

// Convenience wrapper for callers that only need the gene rows.
export async function searchGenes(opts: SearchOpts): Promise<GeneRow[]> {
  const { rows } = await runSearch(opts.term, opts.limit ?? 500);
  return rows;
}

// Phenotype detail for hover previews and TermHover.
export interface PhenotypeDetail {
  term_id: string;
  name: string;
  definition: string | null;
  n_genes: number;
}
export async function getPhenotypeDetail(term_id: string): Promise<PhenotypeDetail | null> {
  const rows = await query<PhenotypeDetail>(
    `SELECT pt.term_id, pt.name, pt.definition,
		        (SELECT COUNT(DISTINCT wormbase_gene) FROM gene_phenotype WHERE term_id = pt.term_id) AS n_genes
		 FROM phenotype_terms pt
		 WHERE pt.term_id = ? AND COALESCE(pt.is_obsolete, 0) = 0`,
    [term_id],
  );
  return rows[0] ?? null;
}

export interface PhenotypeNeighbor {
  term_id: string;
  name: string;
  n_genes: number;
}

// Batched parents lookup: one row per (child, parent) edge with parent name and gene count.
// Mirrors getGoEdges shape. Avoids N+1 queries when building the per-gene phenotype-DAG view.
export async function getPhenotypeParentsBulk(
  term_ids: string[],
): Promise<{ child_id: string; parent_id: string; parent_name: string; parent_n_genes: number }[]> {
  if (term_ids.length === 0) return [];
  return query<{
    child_id: string;
    parent_id: string;
    parent_name: string;
    parent_n_genes: number;
  }>(
    `WITH inputs(child) AS (SELECT value FROM json_each(?))
		 SELECT r.child_id, r.parent_id,
		        COALESCE(pt.name, r.parent_id) AS parent_name,
		        (SELECT COUNT(DISTINCT wormbase_gene) FROM gene_phenotype WHERE term_id = r.parent_id) AS parent_n_genes
		 FROM phenotype_relations r
		 JOIN inputs i ON i.child = r.child_id
		 LEFT JOIN phenotype_terms pt ON pt.term_id = r.parent_id
		 WHERE COALESCE(pt.is_obsolete, 0) = 0`,
    [JSON.stringify(term_ids)],
  );
}

export async function getPhenotypeEdges(
  term_id: string,
  direction: 'parents' | 'children',
): Promise<PhenotypeNeighbor[]> {
  const sql =
    direction === 'parents'
      ? `SELECT t.term_id, t.name,
			          (SELECT COUNT(DISTINCT wormbase_gene) FROM gene_phenotype WHERE term_id = t.term_id) AS n_genes
			   FROM phenotype_relations r
			   JOIN phenotype_terms t ON t.term_id = r.parent_id
			   WHERE r.child_id = ? AND COALESCE(t.is_obsolete, 0) = 0
			   ORDER BY t.name`
      : `SELECT t.term_id, t.name,
			          (SELECT COUNT(DISTINCT wormbase_gene) FROM gene_phenotype WHERE term_id = t.term_id) AS n_genes
			   FROM phenotype_relations r
			   JOIN phenotype_terms t ON t.term_id = r.child_id
			   WHERE r.parent_id = ? AND COALESCE(t.is_obsolete, 0) = 0
			   ORDER BY t.name`;
  return query<PhenotypeNeighbor>(sql, [term_id]);
}

export interface PhenotypeGeneRow {
  wormbase_gene: string;
  gene_name: string | null;
  concise_description: string | null;
  // total gene_phenotype rows (RNAi + allele + transgene)
  n_evidence: number;
  // subset of evidence rows supported by a WBVar allele; n_evidence > n_alleles
  // implies the rest is RNAi/transgene.
  n_alleles: number;
}

// Returns both wormbase_gene and gene_name; DESeq2 result tables often carry gene names rather than WBGene IDs.
export type TermMemberRow = { wormbase_gene: string; gene_name: string | null };
export async function getTermMembers(
  term_id: string,
  kind:
    | 'go'
    | 'phenotype'
    | 'wormcat'
    | 'neuronal'
    | 'tissue'
    | 'disease'
    | 'cell-type'
    | 'synaptogenesis'
    | 'domain'
    | 'pathway',
): Promise<TermMemberRow[]> {
  if (kind === 'pathway') {
    try {
      return await query<TermMemberRow>(
        `SELECT DISTINCT gkp.wormbase_gene, a.gene_name
           FROM gene_kegg_pathway gkp
           LEFT JOIN annotations a ON a.wormbase_gene = gkp.wormbase_gene
           WHERE gkp.pathway_id = ?`,
        [term_id],
      );
    } catch {
      return [];
    }
  }
  if (kind === 'go') {
    return query<TermMemberRow>(
      `SELECT DISTINCT gg.wormbase_gene, a.gene_name
			 FROM gene_go gg LEFT JOIN annotations a ON a.wormbase_gene = gg.wormbase_gene
			 WHERE gg.go_id = ?`,
      [term_id],
    );
  }
  if (kind === 'phenotype') {
    return query<TermMemberRow>(
      `SELECT DISTINCT gp.wormbase_gene, a.gene_name
			 FROM gene_phenotype gp LEFT JOIN annotations a ON a.wormbase_gene = gp.wormbase_gene
			 WHERE gp.term_id = ?`,
      [term_id],
    );
  }
  if (kind === 'domain') {
    try {
      return await query<TermMemberRow>(
        `SELECT DISTINCT gd.wormbase_gene, a.gene_name
         FROM gene_domain gd LEFT JOIN annotations a ON a.wormbase_gene = gd.wormbase_gene
         WHERE gd.accession = ?`,
        [term_id],
      );
    } catch {
      return [];
    }
  }
  if (kind === 'disease') {
    try {
      return await query<TermMemberRow>(
        `SELECT DISTINCT gd.wormbase_gene, a.gene_name
				 FROM gene_disease gd LEFT JOIN annotations a ON a.wormbase_gene = gd.wormbase_gene
				 WHERE gd.do_id = ?`,
        [term_id],
      );
    } catch {
      return [];
    }
  }
  if (kind === 'wormcat') {
    return query<TermMemberRow>(
      `SELECT DISTINCT wc.wormbase_gene, a.gene_name
			 FROM (
			   SELECT wormbase_gene FROM wormcat WHERE category_1 = ?
			   UNION SELECT wormbase_gene FROM wormcat WHERE category_2 = ?
			   UNION SELECT wormbase_gene FROM wormcat WHERE category_3 = ?
			 ) wc LEFT JOIN annotations a ON a.wormbase_gene = wc.wormbase_gene`,
      [term_id, term_id, term_id],
    );
  }
  if (kind === 'neuronal') {
    return query<TermMemberRow>(
      `SELECT DISTINCT n.wormbase_gene, a.gene_name
			 FROM neuronal n LEFT JOIN annotations a ON a.wormbase_gene = n.wormbase_gene
			 WHERE n.category = ?`,
      [term_id],
    );
  }
  if (kind === 'tissue') {
    try {
      return await query<TermMemberRow>(
        `SELECT DISTINCT ga.wormbase_gene, a.gene_name
				 FROM gene_anatomy ga LEFT JOIN annotations a ON a.wormbase_gene = ga.wormbase_gene
				 WHERE ga.term_id = ?`,
        [term_id],
      );
    } catch {
      return [];
    }
  }
  if (kind === 'synaptogenesis') {
    try {
      return await query<TermMemberRow>(
        `SELECT DISTINCT s.wormbase_gene, a.gene_name
				 FROM synaptogenesis s LEFT JOIN annotations a ON a.wormbase_gene = s.wormbase_gene
				 WHERE s.class = ?`,
        [term_id],
      );
    } catch {
      return [];
    }
  }
  if (kind === 'cell-type') {
    // term_id is the CeNGEN neuron_type string. Threshold >=2 (medium) matches the enrichment worker.
    try {
      return await query<TermMemberRow>(
        `SELECT DISTINCT cc.wormbase_gene, a.gene_name
				 FROM cengen_calls cc LEFT JOIN annotations a ON a.wormbase_gene = cc.wormbase_gene
				 WHERE cc.neuron_type = ? AND cc.max_threshold >= 2`,
        [term_id],
      );
    } catch {
      return [];
    }
  }
  return [];
}

export async function getGenesForPhenotype(
  term_id: string,
  limit = 100,
): Promise<PhenotypeGeneRow[]> {
  // gene_phenotype covers allele + RNAi + transgene; allele_phenotype is the WBVar subset.
  // n_alleles=0 with n_evidence>0 means RNAi/non-allele evidence only.
  return query<PhenotypeGeneRow>(
    `SELECT a.wormbase_gene, a.gene_name, a.concise_description,
		        COUNT(*) AS n_evidence,
		        COALESCE(
		          (SELECT COUNT(DISTINCT ap.allele_id)
		           FROM allele_phenotype ap
		           WHERE ap.wormbase_gene = a.wormbase_gene AND ap.term_id = ?),
		          0
		        ) AS n_alleles
		 FROM gene_phenotype gp
		 JOIN annotations a ON a.wormbase_gene = gp.wormbase_gene
		 WHERE gp.term_id = ?
		 GROUP BY a.wormbase_gene
		 ORDER BY n_alleles DESC, n_evidence DESC, a.gene_name
		 LIMIT ?`,
    [term_id, term_id, limit],
  );
}

// Anatomy (tissue) detail for hover previews.
export interface AnatomyDetail {
  term_id: string;
  name: string;
  definition: string | null;
  n_genes: number;
}
export async function getAnatomyDetail(term_id: string): Promise<AnatomyDetail | null> {
  try {
    const rows = await query<AnatomyDetail>(
      `SELECT at.term_id, at.name, at.definition,
			        (SELECT COUNT(DISTINCT wormbase_gene) FROM gene_anatomy WHERE term_id = at.term_id) AS n_genes
			 FROM anatomy_terms at
			 WHERE at.term_id = ?`,
      [term_id],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

// Term suggestions for the search-bar dropdown across phenotypes, tissues, and GO terms.
// Each row carries a `kind` for routing to the right scoped query (pheno:, tissue:, go:).
export interface TermSuggestion {
  kind: 'phenotype' | 'tissue' | 'go';
  term_id: string;
  name: string;
  n_genes: number;
}
export async function suggestTerms(
  prefix: string,
  limit = 6,
  kindFilter?: TermSuggestion['kind'],
): Promise<TermSuggestion[]> {
  const p = prefix.trim();
  // Scoped (e.g. pheno:d) fires at 1 char; free-text still needs >=2.
  const minLen = kindFilter ? 1 : 2;
  if (p.length < minLen) return [];
  const cleaned = p.replace(/["()*:~{}[\]]/g, '').trim();
  if (cleaned.length < minLen) return [];
  const wantPheno = !kindFilter || kindFilter === 'phenotype';
  const wantTissue = !kindFilter || kindFilter === 'tissue';
  const wantGo = !kindFilter || kindFilter === 'go';
  const tokens = cleaned.split(/\s+/);
  const expr = tokens.map((t) => `"${t}"*`).join(' AND ');
  const out: TermSuggestion[] = [];
  if (wantPheno)
    try {
      const ph = await query<{ term_id: string; name: string; n_genes: number }>(
        `SELECT pt.term_id, pt.name,
			        (SELECT COUNT(DISTINCT wormbase_gene) FROM gene_phenotype WHERE term_id = pt.term_id) AS n_genes
			 FROM phenotype_terms pt
			 WHERE COALESCE(pt.is_obsolete,0)=0
			   AND (LOWER(pt.name) LIKE ? OR pt.term_id IN (
			        SELECT term_id FROM phenotype_synonyms WHERE LOWER(synonym) LIKE ?
			   ))
			 ORDER BY n_genes DESC, pt.name
			 LIMIT ?`,
        [`%${cleaned.toLowerCase()}%`, `%${cleaned.toLowerCase()}%`, limit],
      );
      for (const r of ph) out.push({ kind: 'phenotype', ...r });
    } catch {
      // phenotype_synonyms may not exist in older DBs; fall back to name-only.
      try {
        const ph2 = await query<{ term_id: string; name: string; n_genes: number }>(
          `SELECT pt.term_id, pt.name,
				        (SELECT COUNT(DISTINCT wormbase_gene) FROM gene_phenotype WHERE term_id = pt.term_id) AS n_genes
				 FROM phenotype_terms pt
				 WHERE COALESCE(pt.is_obsolete,0)=0 AND LOWER(pt.name) LIKE ?
				 ORDER BY n_genes DESC, pt.name LIMIT ?`,
          [`%${cleaned.toLowerCase()}%`, limit],
        );
        for (const r of ph2) out.push({ kind: 'phenotype', ...r });
      } catch {
        // noop
      }
    }
  if (wantTissue)
    try {
      const ti = await query<{ term_id: string; name: string; n_genes: number }>(
        `SELECT at.term_id, at.name,
			        (SELECT COUNT(DISTINCT wormbase_gene) FROM gene_anatomy WHERE term_id = at.term_id) AS n_genes
			 FROM anatomy_terms at
			 WHERE LOWER(at.name) LIKE ?
			 ORDER BY n_genes DESC, at.name
			 LIMIT ?`,
        [`%${cleaned.toLowerCase()}%`, limit],
      );
      for (const r of ti) out.push({ kind: 'tissue', ...r });
    } catch {
      // noop
    }
  if (wantGo) {
    // Use go_fts for bm25 ranking; much faster than LIKE on go_terms.
    try {
      const go = await query<{ term_id: string; name: string; n_genes: number }>(
        `SELECT t.go_id AS term_id, t.name,
			        (SELECT COUNT(DISTINCT wormbase_gene) FROM gene_go WHERE go_id = t.go_id) AS n_genes
			 FROM go_fts f
			 JOIN go_terms t ON t.go_id = f.go_id
			 WHERE go_fts MATCH ? AND t.is_obsolete = 0
			 ORDER BY bm25(go_fts)
			 LIMIT ?`,
        [expr, limit],
      );
      for (const r of go) out.push({ kind: 'go', ...r });
    } catch {
      // noop
    }
  }
  return out;
}

// Fetch all matched gene IDs (no row body) for Export / "Send to tool" actions. Capped at 100k.
export async function getMatchedIds(
  term: string,
  cap = 100_000,
  fields?: readonly FtsField[],
): Promise<string[]> {
  const parsed = parseQuery(term);
  if (parsed.mode === 'empty') {
    const rows = await query<{ wormbase_gene: string }>(
      `SELECT wormbase_gene FROM annotations LIMIT ?`,
      [cap],
    );
    return rows.map((r) => r.wormbase_gene);
  }
  if (parsed.mode === 'genelist') {
    const rows = await searchByGeneList(parsed.ids, cap, 0);
    return rows.map((r) => r.wormbase_gene);
  }
  const match = matchedGenesSubquery(term, fields);
  if (!match) {
    const rows = await query<{ wormbase_gene: string }>(
      `SELECT wormbase_gene FROM annotations LIMIT ?`,
      [cap],
    );
    return rows.map((r) => r.wormbase_gene);
  }
  const rows = await query<{ wormbase_gene: string }>(
    `SELECT wormbase_gene FROM (${match.sql}) LIMIT ?`,
    [...match.params, cap],
  );
  return rows.map((r) => r.wormbase_gene);
}

// Matched gene rows (names + descriptions) for the Export button. Capped at 50k.
export async function getMatchedRowsForExport(term: string, cap = 50_000): Promise<GeneRow[]> {
  const parsed = parseQuery(term);
  if (parsed.mode === 'empty') return listGenes(cap, 0);
  if (parsed.mode === 'genelist') return searchByGeneList(parsed.ids, cap, 0);
  const { rows } = await runSearch(term, cap, 0);
  return rows;
}

// WormBase writes biotypes with spaces ('protein coding'); our examples use
// underscores.
export function normalizeBiotype(v: string): string {
  return v.toLowerCase().trim().replace(/[_-]+/g, ' ');
}

// Batch resolve WBGene IDs to {gene_name, sequence_name}: one round-trip beats N hover-time fetches.
export interface GeneNameMeta {
  wormbase_gene: string;
  gene_name: string | null;
  sequence_name: string | null;
  gene_type: string | null;
}

export async function getGeneNames(ids: string[]): Promise<Map<string, GeneNameMeta>> {
  const out = new Map<string, GeneNameMeta>();
  if (ids.length === 0) return out;
  // DESeq2/featureCounts tables may carry WBGene IDs, gene symbols, or sequence names.
  // Split into two paths to avoid SQL parameter ceiling on 20k-gene tables:
  // WBGene tokens via indexed equality join; residual via case-insensitive gene_name/sequence_name.
  const unique = [...new Set(ids.map((t) => t.trim()).filter(Boolean))];
  const WBGENE_RE = /^WBGene\d+$/i;
  const wbTokens = unique.filter((t) => WBGENE_RE.test(t));
  const residual = unique.filter((t) => !WBGENE_RE.test(t));

  if (wbTokens.length > 0) {
    const canonical = wbTokens.map((t) => t.replace(/^WBGENE/i, 'WBGene'));
    const rows = await query<{
      input_id: string;
      wormbase_gene: string;
      gene_name: string | null;
      sequence_name: string | null;
      gene_type: string | null;
    }>(
      `WITH inputs(input_id) AS (SELECT value FROM json_each(?))
       SELECT i.input_id, a.wormbase_gene, a.gene_name, a.sequence_name, a.gene_type
       FROM inputs i JOIN annotations a ON a.wormbase_gene = i.input_id`,
      [JSON.stringify(canonical)],
    );
    for (const r of rows) {
      out.set(r.input_id, {
        wormbase_gene: r.wormbase_gene,
        gene_name: r.gene_name,
        sequence_name: r.sequence_name,
        gene_type: r.gene_type,
      });
    }
  }

  if (residual.length > 0) {
    const lower = residual.map((t) => t.toLowerCase());
    const rows = await query<{
      input_lower: string;
      wormbase_gene: string;
      gene_name: string | null;
      sequence_name: string | null;
      gene_type: string | null;
    }>(
      `WITH inputs(input_lower) AS (SELECT value FROM json_each(?))
       SELECT i.input_lower, a.wormbase_gene, a.gene_name, a.sequence_name, a.gene_type
       FROM inputs i JOIN annotations a
         ON LOWER(a.gene_name) = i.input_lower
         OR LOWER(a.sequence_name) = i.input_lower`,
      [JSON.stringify(lower)],
    );
    const lowerToOriginal = new Map(residual.map((t) => [t.toLowerCase(), t]));
    for (const r of rows) {
      const original = lowerToOriginal.get(r.input_lower);
      if (!original) continue;
      out.set(original, {
        wormbase_gene: r.wormbase_gene,
        gene_name: r.gene_name,
        sequence_name: r.sequence_name,
        gene_type: r.gene_type,
      });
    }
  }

  return out;
}

export interface DiseaseAssociation {
  do_id: string;
  do_name: string;
  association_type: string | null;
  with_ortholog: string | null;
  evidence_count: number;
  reference: string | null;
}

// Alliance disease associations (DOID terms), sorted by evidence count.
export async function getDiseasesFor(wormbase_gene: string): Promise<DiseaseAssociation[]> {
  return query<DiseaseAssociation>(
    `SELECT do_id, do_name, association_type, with_ortholog, evidence_count, reference
		 FROM gene_disease
		 WHERE wormbase_gene = ?
		 ORDER BY evidence_count DESC, do_name`,
    [wormbase_gene],
  );
}

// A cached DB build can be older than the app deployed against it, so an older
// build degrades instead of throwing.
const schemaFeature = new Map<string, Promise<boolean>>();

function hasTable(name: string): Promise<boolean> {
  const key = `t:${name}`;
  let p = schemaFeature.get(key);
  if (!p) {
    p = query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`,
      [name],
    )
      .then((r) => (r[0]?.n ?? 0) > 0)
      .catch(() => false);
    schemaFeature.set(key, p);
  }
  return p;
}

function hasColumn(table: string, column: string): Promise<boolean> {
  const key = `c:${table}.${column}`;
  let p = schemaFeature.get(key);
  if (!p) {
    p = query<{ n: number }>(`SELECT COUNT(*) AS n FROM pragma_table_info(?) WHERE name = ?`, [
      table,
      column,
    ])
      .then((r) => (r[0]?.n ?? 0) > 0)
      .catch(() => false);
    schemaFeature.set(key, p);
  }
  return p;
}

export interface CengenCoexprNeighbor {
  wormbase_gene: string;
  gene_name: string | null;
  concise_description: string | null;
  pearson: number;
  mutual_rank: number;
  /** Neighbour's position in this gene's list. */
  rank_self: number;
  /** This gene's position in the neighbour's list. 0 on pre-rank builds. */
  rank_other: number;
}

// Co-expressed genes across CeNGEN's 52 bulk-sequenced neuron types. A stored pair is both
// significant at p < 0.001 and reciprocal (each gene in the other's top 200), so
// the list is bounded at 200 per gene. Ordering is by mutual rank rather than raw
// Pearson, which otherwise puts the same broadly expressed genes atop every list.
// Pass `neuronType` to further restrict to genes called expressed there at `minThreshold`
// (binary calls); Pearson scores still come from the global vector.
export async function getCengenCoexpressionFor(
  wormbase_gene: string,
  limit = 20,
  opts: { neuronType?: string; minThreshold?: number } = {},
): Promise<CengenCoexprNeighbor[]> {
  const ranked = await hasColumn('cengen_coexpression', 'mutual_rank');
  const hasRanks = ranked && (await hasColumn('cengen_coexpression', 'rank_self'));
  const scoreCols = hasRanks
    ? `c.mutual_rank, c.rank_self, c.rank_other`
    : ranked
      ? `c.mutual_rank, 0 AS rank_self, 0 AS rank_other`
      : `0 AS mutual_rank, 0 AS rank_self, 0 AS rank_other`;
  const order = ranked ? 'c.mutual_rank ASC' : 'c.pearson DESC';
  if (opts.neuronType) {
    return query<CengenCoexprNeighbor>(
      `SELECT c.neighbor AS wormbase_gene,
			        a.gene_name,
			        a.concise_description,
			        c.pearson,
			        ${scoreCols}
			 FROM cengen_coexpression c
			 JOIN cengen_calls cc ON cc.wormbase_gene = c.neighbor
			 LEFT JOIN annotations a ON a.wormbase_gene = c.neighbor
			 WHERE c.wormbase_gene = ?
			   AND cc.neuron_type = ?
			   AND cc.max_threshold >= ?
			 ORDER BY ${order}
			 LIMIT ?`,
      [wormbase_gene, opts.neuronType, opts.minThreshold ?? 2, limit],
    );
  }
  return query<CengenCoexprNeighbor>(
    `SELECT c.neighbor AS wormbase_gene,
		        a.gene_name,
		        a.concise_description,
		        c.pearson,
		        ${scoreCols}
		 FROM cengen_coexpression c
		 LEFT JOIN annotations a ON a.wormbase_gene = c.neighbor
		 WHERE c.wormbase_gene = ?
		 ORDER BY ${order}
		 LIMIT ?`,
    [wormbase_gene, limit],
  );
}

export interface CengenExpressionRow {
  neuron_type: string;
  tmm: number | null; // mean across bulk replicates, null when type has no bulk coverage
  max_threshold: number | null; // 1..4 FACS-calibrated call level, null when not called expressed
  n_replicates: number; // 0 if this neuron type has no bulk replicates
  has_binary: number; // 1 if covered by binary CSVs (128 types), 0 otherwise
}

// CeNGEN L4 expression: union of neuron types where the gene has bulk TMM signal (cengen_expression)
// or a binary FACS-calibrated call (cengen_calls). Sorted by threshold desc, then TMM desc.
export async function getCengenExpressionFor(
  wormbase_gene: string,
): Promise<CengenExpressionRow[]> {
  return query<CengenExpressionRow>(
    `WITH all_types AS (
			SELECT neuron_type FROM cengen_expression WHERE wormbase_gene = ?
			UNION
			SELECT neuron_type FROM cengen_calls      WHERE wormbase_gene = ?
		)
		SELECT t.neuron_type,
		       e.tmm AS tmm,
		       c.max_threshold AS max_threshold,
		       n.n_replicates,
		       n.has_binary
		FROM all_types t
		JOIN cengen_neurons n  ON n.neuron_type  = t.neuron_type
		LEFT JOIN cengen_expression e ON e.neuron_type = t.neuron_type AND e.wormbase_gene = ?
		LEFT JOIN cengen_calls      c ON c.neuron_type = t.neuron_type AND c.wormbase_gene = ?
		ORDER BY COALESCE(c.max_threshold, 0) DESC, COALESCE(e.tmm, 0) DESC`,
    [wormbase_gene, wormbase_gene, wormbase_gene, wormbase_gene],
  );
}

export interface NeuronTypeSummary {
  neuron_type: string;
  n_genes: number;
  n_replicates: number;
  has_binary: number;
}

// One row per CeNGEN neuron type; gene counts at threshold >= 2 (medium), same as cell-type enrichment.
export async function getNeuronTypeSummary(): Promise<NeuronTypeSummary[]> {
  return query<NeuronTypeSummary>(
    `SELECT n.neuron_type,
            COALESCE(c.n_genes, 0) AS n_genes,
            n.n_replicates,
            n.has_binary
     FROM cengen_neurons n
     LEFT JOIN (
       SELECT neuron_type, COUNT(DISTINCT wormbase_gene) AS n_genes
       FROM cengen_calls WHERE max_threshold >= 2
       GROUP BY neuron_type
     ) c ON c.neuron_type = n.neuron_type
     ORDER BY n.neuron_type`,
  );
}

export interface NeuronGeneRow {
  wormbase_gene: string;
  gene_name: string | null;
  max_threshold: number;
  tmm: number | null;
}

// Genes expressed in one neuron type, sorted by call confidence then bulk TMM.
export async function getGenesByNeuronType(
  neuronType: string,
  minThreshold = 2,
): Promise<NeuronGeneRow[]> {
  return query<NeuronGeneRow>(
    `SELECT cc.wormbase_gene,
            a.gene_name,
            cc.max_threshold,
            ce.tmm
     FROM cengen_calls cc
     LEFT JOIN annotations a ON a.wormbase_gene = cc.wormbase_gene
     LEFT JOIN cengen_expression ce
       ON ce.wormbase_gene = cc.wormbase_gene AND ce.neuron_type = cc.neuron_type
     WHERE cc.neuron_type = ? AND cc.max_threshold >= ?
     ORDER BY cc.max_threshold DESC, ce.tmm DESC, a.gene_name`,
    [neuronType, minThreshold],
  );
}

export interface RnaiRow {
  wbrnai_id: string;
  phenotype_count: number;
  phenotype_ids: string[];
  phenotype_names: string[];
  paper_ids: string[];
}

// RNAi reagents for a gene with observed phenotypes.
// WormBase rnai_phenotypes has one record per (gene, reagent, phenotype); grouped and deduped here.
export async function getRnaiForGene(wormbase_gene: string): Promise<RnaiRow[]> {
  type Raw = {
    wbrnai_id: string;
    phenotype_id: string | null;
    phenotype_name: string | null;
    paper_id: string | null;
  };
  const rows = await query<Raw>(
    `SELECT gr.wbrnai_id, gr.phenotype_id, pt.name AS phenotype_name, gr.paper_id
     FROM gene_rnai gr
     LEFT JOIN phenotype_terms pt ON pt.term_id = gr.phenotype_id
     WHERE gr.wormbase_gene = ?
     ORDER BY gr.wbrnai_id`,
    [wormbase_gene],
  );
  const byReagent = new Map<string, RnaiRow>();
  for (const r of rows) {
    let agg = byReagent.get(r.wbrnai_id);
    if (!agg) {
      agg = {
        wbrnai_id: r.wbrnai_id,
        phenotype_count: 0,
        phenotype_ids: [],
        phenotype_names: [],
        paper_ids: [],
      };
      byReagent.set(r.wbrnai_id, agg);
    }
    if (r.phenotype_id && !agg.phenotype_ids.includes(r.phenotype_id)) {
      agg.phenotype_ids.push(r.phenotype_id);
      agg.phenotype_names.push(r.phenotype_name ?? r.phenotype_id);
    }
    if (r.paper_id && !agg.paper_ids.includes(r.paper_id)) agg.paper_ids.push(r.paper_id);
  }
  for (const agg of byReagent.values()) agg.phenotype_count = agg.phenotype_ids.length;
  return [...byReagent.values()].sort((a, b) => b.phenotype_count - a.phenotype_count);
}

export async function getGene(id: string): Promise<GeneRow | null> {
  // Try wormbase_gene first, then case-insensitive gene_name.
  let rows = await query<GeneRow>(
    `${await baseSelect()} FROM annotations a${await locationJoin()} WHERE a.wormbase_gene = ? LIMIT 1`,
    [id],
  );
  if (rows.length === 0) {
    rows = await query<GeneRow>(
      `${await baseSelect()} FROM annotations a${await locationJoin()} WHERE LOWER(a.gene_name) = LOWER(?) LIMIT 1`,
      [id],
    );
  }
  return rows[0] ? scrubDescriptions(rows[0]) : null;
}

export interface WormcatAssignment {
  category_1: string | null;
  category_2: string | null;
  category_3: string | null;
}

export async function getWormcatFor(wormbase_gene: string): Promise<WormcatAssignment | null> {
  const rows = await query<WormcatAssignment>(
    'SELECT category_1, category_2, category_3 FROM wormcat WHERE wormbase_gene = ? LIMIT 1',
    [wormbase_gene],
  );
  return rows[0] ?? null;
}

export interface PathwayMembership {
  pathway_id: string;
  name: string;
}

export interface PathwayImage {
  mime: string;
  width: number | null;
  height: number | null;
  bytes: Uint8Array;
}

export async function getPathwayImage(pathway_id: string): Promise<PathwayImage | null> {
  try {
    const rows = await query<{
      mime: string;
      width: number | null;
      height: number | null;
      bytes: Uint8Array;
    }>('SELECT mime, width, height, bytes FROM kegg_image WHERE pathway_id = ?', [pathway_id]);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function getPathwaysFor(wormbase_gene: string): Promise<PathwayMembership[]> {
  try {
    return await query<PathwayMembership>(
      `SELECT gkp.pathway_id, COALESCE(p.name, gkp.pathway_id) AS name
       FROM gene_kegg_pathway gkp
       LEFT JOIN kegg_pathway p ON p.pathway_id = gkp.pathway_id
       WHERE gkp.wormbase_gene = ?
       ORDER BY p.name`,
      [wormbase_gene],
    );
  } catch {
    return [];
  }
}

export interface NeuronalAssignment {
  category: string | null;
  supercategory: string | null;
}

export async function getNeuronalFor(wormbase_gene: string): Promise<NeuronalAssignment[]> {
  return query<NeuronalAssignment>(
    'SELECT category, supercategory FROM neuronal WHERE wormbase_gene = ?',
    [wormbase_gene],
  );
}

export interface SynaptogenesisAssignment {
  class: string;
  subclass: string | null;
  notes: string | null;
  /** Absent on builds before the refs column was added. */
  refs?: string | null;
}

export async function getSynaptogenesisFor(
  wormbase_gene: string,
): Promise<SynaptogenesisAssignment[]> {
  return query<SynaptogenesisAssignment>(
    // SELECT * rather than naming refs: a database built before that column exists must still load.
    'SELECT * FROM synaptogenesis WHERE wormbase_gene = ? ORDER BY class',
    [wormbase_gene],
  );
}

export interface GoAnnotation {
  go_id: string;
  name: string;
  namespace: string;
  qualifier: string | null;
  evidence_code: string;
  reference: string | null;
  aspect: string;
}

export async function getGoFor(wormbase_gene: string): Promise<GoAnnotation[]> {
  // Exclude IEA-PROP rows (DAG ancestor closure inserted at build time for enrichment/GSEA);
  // they would drown a gene card in generic terms like "biological_process".
  return query<GoAnnotation>(
    `SELECT gg.go_id, t.name, t.namespace, gg.qualifier, gg.evidence_code, gg.reference, gg.aspect
		 FROM gene_go gg
		 JOIN go_terms t ON t.go_id = gg.go_id
		 WHERE gg.wormbase_gene = ? AND gg.evidence_code != 'IEA-PROP'
		 ORDER BY t.namespace, gg.evidence_code`,
    [wormbase_gene],
  );
}

// ---- Phenotypes ----

export interface PhenotypeRow {
  term_id: string;
  name: string;
  // distinct alleles supporting this term (allele_phenotype). 0 means the
  // association comes entirely from RNAi / transgene / non-allele evidence.
  n_alleles: number;
  // total distinct evidence rows in gene_phenotype (allele + RNAi +
  // transgene combined). n_evidence > n_alleles implies RNAi/other support.
  n_evidence: number;
}

export interface AlleleRow {
  allele_id: string;
  // Public allele name (e.g. e1370); falls back to the WBVar id when WormBase gives none.
  name: string;
  n_phenotypes: number;
  phenotype_term_ids: string; // pipe-joined for compact transport
  phenotype_names: string;
}

// Rolls each phenotype annotation up to its top-level WBPhenotype parent for the per-gene category heatmap.
// Aggregates evidence counts across all descendants of each top-level category.
export interface PhenotypeCategoryRoll {
  top_id: string;
  top_name: string;
  // number of distinct gene_phenotype rows that fall under this top-level
  n_evidence: number;
  // distinct WBPhenotype leaf terms the gene has under this top-level
  n_terms: number;
}
export async function getPhenotypeCategoriesFor(
  wormbase_gene: string,
): Promise<PhenotypeCategoryRoll[]> {
  // Root discovered at runtime as the non-obsolete term never appearing as a child
  // (currently WBPhenotype:0000886, but discovered dynamically to avoid hardcode brittleness).
  return query<PhenotypeCategoryRoll>(
    `WITH RECURSIVE
		   roots AS (
		     SELECT term_id FROM phenotype_terms
		     WHERE is_obsolete = 0
		       AND term_id NOT IN (SELECT child_id FROM phenotype_relations)
		   ),
		   gene_terms AS (
		     SELECT term_id, COUNT(*) AS n_ev
		     FROM gene_phenotype
		     WHERE wormbase_gene = ?
		     GROUP BY term_id
		   ),
		   -- Depth-1 (e.g. "physiology phenotype") gives only ~2 buckets; depth-2 yields
		   -- the biological categories users expect (behavior, morphology, development, ...).
		   level1 AS (
		     SELECT DISTINCT pr.child_id AS t
		     FROM phenotype_relations pr
		     WHERE pr.parent_id IN (SELECT term_id FROM roots)
		   ),
		   top_set AS (
		     SELECT DISTINCT pr.child_id AS t
		     FROM phenotype_relations pr
		     WHERE pr.parent_id IN (SELECT t FROM level1)
		   ),
		   walk(start_term, current, n_ev, hops) AS (
		     SELECT g.term_id, g.term_id, g.n_ev, 0 FROM gene_terms g
		     UNION
		     SELECT w.start_term, pr.parent_id, w.n_ev, w.hops + 1
		     FROM walk w
		     JOIN phenotype_relations pr ON pr.child_id = w.current
		     WHERE w.hops < 25
		   ),
		   rollup AS (
		     SELECT start_term, current AS top_id, n_ev, MIN(hops) AS d
		     FROM walk
		     WHERE current IN (SELECT t FROM top_set)
		     GROUP BY start_term, current
		   )
		 SELECT r.top_id,
		        COALESCE(pt.name, r.top_id) AS top_name,
		        SUM(r.n_ev) AS n_evidence,
		        COUNT(DISTINCT r.start_term) AS n_terms
		 FROM rollup r
		 LEFT JOIN phenotype_terms pt ON pt.term_id = r.top_id
		 GROUP BY r.top_id, pt.name
		 ORDER BY n_evidence DESC, top_name`,
    [wormbase_gene],
  );
}

export async function getPhenotypesFor(wormbase_gene: string): Promise<PhenotypeRow[]> {
  // gene_phenotype: full GAF (allele + RNAi + transgene). allele_phenotype is WBVar-only subset.
  return query<PhenotypeRow>(
    `SELECT gp.term_id,
		        COALESCE(pt.name, gp.term_id) AS name,
		        COUNT(*) AS n_evidence,
		        COALESCE(
		          (SELECT COUNT(DISTINCT ap.allele_id)
		           FROM allele_phenotype ap
		           WHERE ap.wormbase_gene = gp.wormbase_gene AND ap.term_id = gp.term_id),
		          0
		        ) AS n_alleles
		 FROM gene_phenotype gp
		 LEFT JOIN phenotype_terms pt ON pt.term_id = gp.term_id
		 WHERE gp.wormbase_gene = ?
		 GROUP BY gp.term_id, pt.name
		 ORDER BY n_alleles DESC, n_evidence DESC, name`,
    [wormbase_gene],
  );
}

// One row per allele with aggregated phenotypes for the allele x phenotype matrix.
export async function getAllelesFor(wormbase_gene: string): Promise<AlleleRow[]> {
  // allele_names arrived with a later build; older cached DBs fall back to the WBVar id.
  const named = await hasTable('allele_names');
  return query<AlleleRow>(
    `SELECT ap.allele_id,
		        ${named ? 'COALESCE(an.name, ap.allele_id)' : 'ap.allele_id'} AS name,
		        COUNT(DISTINCT ap.term_id) AS n_phenotypes,
		        GROUP_CONCAT(DISTINCT ap.term_id) AS phenotype_term_ids,
		        GROUP_CONCAT(DISTINCT COALESCE(pt.name, ap.term_id)) AS phenotype_names
		 FROM allele_phenotype ap
		 LEFT JOIN phenotype_terms pt ON pt.term_id = ap.term_id
		 ${named ? 'LEFT JOIN allele_names an ON an.allele_id = ap.allele_id' : ''}
		 WHERE ap.wormbase_gene = ?
		 GROUP BY ap.allele_id
		 ORDER BY n_phenotypes DESC, name`,
    [wormbase_gene],
  );
}

// ---- References / papers ----

export interface PaperRef {
  reference: string; // "PMID:12345" or "WB_REF:WBPaper00012345"
  prefix: 'PMID' | 'WBPaper';
  id: string;
  url: string;
  n_go: number;
  n_pheno: number;
  total: number;
  // Resolved bibliography metadata (Alliance dump), when available.
  title?: string;
  doi?: string;
  journal?: string;
  year?: string;
  authors?: string;
}

interface PaperMetaRow {
  paper_id: string;
  pmid: string | null;
  doi: string | null;
  title: string | null;
  journal: string | null;
  year: string | null;
  authors: string | null;
}

// Distinct papers cited across gene_go + allele_phenotype. Skips GO_REF:* and non-publication identifiers.
export async function getPapersFor(wormbase_gene: string, limit = 20): Promise<PaperRef[]> {
  const rows = await query<{ reference: string; n_go: number; n_pheno: number }>(
    `SELECT reference, SUM(g) AS n_go, SUM(p) AS n_pheno FROM (
		   SELECT reference, 1 AS g, 0 AS p FROM gene_go WHERE wormbase_gene = ? AND reference IS NOT NULL
		   UNION ALL
		   SELECT reference, 0, 1 FROM allele_phenotype WHERE wormbase_gene = ? AND reference IS NOT NULL
		 )
		 GROUP BY reference`,
    [wormbase_gene, wormbase_gene],
  );
  const out: PaperRef[] = [];
  for (const r of rows) {
    const ref = r.reference;
    if (!ref) continue;
    if (ref.startsWith('PMID:')) {
      const id = ref.slice(5);
      out.push({
        reference: ref,
        prefix: 'PMID',
        id,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        n_go: r.n_go,
        n_pheno: r.n_pheno,
        total: r.n_go + r.n_pheno,
      });
    } else if (ref.startsWith('WB_REF:')) {
      const id = ref.slice('WB_REF:'.length);
      if (!id.startsWith('WBPaper')) continue;
      out.push({
        reference: ref,
        prefix: 'WBPaper',
        id,
        url: `https://wormbase.org/species/all/paper/${id}`,
        n_go: r.n_go,
        n_pheno: r.n_pheno,
        total: r.n_go + r.n_pheno,
      });
    }
    // drop GO_REF:* and others (curation references, not papers)
  }
  // GO cites by PMID and phenotypes by WBPaper id, so one paper can arrive as
  // two references. Merge on the resolved paper before ranking.
  const paperOf = await enrichPaperMeta(out);
  const merged = new Map<string, PaperRef>();
  for (const p of out) {
    const key = paperOf.get(p.reference) ?? p.reference;
    const seen = merged.get(key);
    if (!seen) {
      merged.set(key, p);
      continue;
    }
    seen.n_go += p.n_go;
    seen.n_pheno += p.n_pheno;
    seen.total += p.total;
  }
  return [...merged.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

// Resolve titles/DOIs for a list of papers from the paper_meta table (built from
// the Alliance bibliography) and rewrite each link to prefer the DOI. Papers not
// in the dump (e.g. published after the dump cutoff) keep their WBPaper/PMID link.
// Returns each resolved reference's paper_meta id.
async function enrichPaperMeta(papers: PaperRef[]): Promise<Map<string, string>> {
  const paperOf = new Map<string, string>();
  if (papers.length === 0) return paperOf;
  const paperIds = papers.filter((p) => p.prefix === 'WBPaper').map((p) => p.id);
  const pmids = papers.filter((p) => p.prefix === 'PMID').map((p) => p.id);
  if (paperIds.length === 0 && pmids.length === 0) return paperOf;

  const clauses: string[] = [];
  const params: string[] = [];
  if (paperIds.length) {
    clauses.push(`paper_id IN (${paperIds.map(() => '?').join(',')})`);
    params.push(...paperIds);
  }
  if (pmids.length) {
    clauses.push(`pmid IN (${pmids.map(() => '?').join(',')})`);
    params.push(...pmids);
  }

  let rows: PaperMetaRow[];
  try {
    rows = await query<PaperMetaRow>(
      `SELECT paper_id, pmid, doi, title, journal, year, authors
		   FROM paper_meta WHERE ${clauses.join(' OR ')}`,
      params,
    );
  } catch {
    return paperOf; // table absent (older DB build): leave the bare links in place
  }

  const byPaperId = new Map<string, PaperMetaRow>();
  const byPmid = new Map<string, PaperMetaRow>();
  for (const r of rows) {
    byPaperId.set(r.paper_id, r);
    if (r.pmid) byPmid.set(r.pmid, r);
  }

  for (const p of papers) {
    const meta = p.prefix === 'WBPaper' ? byPaperId.get(p.id) : byPmid.get(p.id);
    if (!meta) continue;
    paperOf.set(p.reference, meta.paper_id);
    p.title = meta.title ?? undefined;
    p.doi = meta.doi ?? undefined;
    p.journal = meta.journal ?? undefined;
    p.year = meta.year ?? undefined;
    p.authors = meta.authors ?? undefined;
    if (meta.doi) p.url = `https://doi.org/${meta.doi}`;
  }
  return paperOf;
}

export interface GenePaper {
  pmid: string;
  url: string;
  title?: string;
  doi?: string;
  journal?: string;
  year?: string;
  authors?: string;
}

// Comprehensive per-gene literature (NCBI gene2pubmed), enriched with titles/DOIs
// from paper_meta. Newest first; unresolved PMIDs keep a plain PubMed link.
export async function getGenePapers(wormbase_gene: string): Promise<GenePaper[]> {
  let rows: Array<{
    pmid: string;
    doi: string | null;
    title: string | null;
    journal: string | null;
    year: string | null;
    authors: string | null;
  }>;
  try {
    // A PMID can map to more than one paper_meta row (e.g. two WBPaper records
    // cross-referencing the same PMID), so collapse to one row per PMID. MAX()
    // ignores NULLs, preferring a resolved value when any duplicate has one.
    rows = await query(
      `SELECT gp.pmid,
			   MAX(pm.doi) AS doi, MAX(pm.title) AS title, MAX(pm.journal) AS journal,
			   MAX(pm.year) AS year, MAX(pm.authors) AS authors
		   FROM gene_paper gp
		   LEFT JOIN paper_meta pm ON pm.pmid = gp.pmid
		   WHERE gp.wormbase_gene = ?
		   GROUP BY gp.pmid
		   ORDER BY year DESC, gp.pmid DESC`,
      [wormbase_gene],
    );
  } catch {
    return []; // table absent (older DB build)
  }
  return rows.map((r) => ({
    pmid: r.pmid,
    title: r.title ?? undefined,
    doi: r.doi ?? undefined,
    journal: r.journal ?? undefined,
    year: r.year ?? undefined,
    authors: r.authors ?? undefined,
    url: r.doi ? `https://doi.org/${r.doi}` : `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`,
  }));
}

// ---- Anatomy (tissue expression) ----

export interface AnatomyRow {
  term_id: string;
  name: string;
  n_evidence: number;
}

export async function getAnatomyFor(wormbase_gene: string): Promise<AnatomyRow[]> {
  try {
    return await query<AnatomyRow>(
      `SELECT ga.term_id,
			        COALESCE(at.name, ga.term_id) AS name,
			        COUNT(*) AS n_evidence
			 FROM gene_anatomy ga
			 LEFT JOIN anatomy_terms at ON at.term_id = ga.term_id
			 WHERE ga.wormbase_gene = ?
			 GROUP BY ga.term_id, at.name
			 ORDER BY n_evidence DESC, name`,
      [wormbase_gene],
    );
  } catch {
    return [];
  }
}

// ---- Cross-references (NCBI / UniProt / Ensembl / InterPro / RefSeq) ----

export interface XrefRow {
  transcript_seq_name: string | null;
  wormpep_acc: string | null;
  insdc_parent_acc: string | null;
  insdc_locus_tag: string | null;
  insdc_protein_id: string | null;
  uniprot_acc: string | null;
}

export async function getXrefsFor(wormbase_gene: string): Promise<XrefRow[]> {
  try {
    return await query<XrefRow>(
      `SELECT transcript_seq_name, wormpep_acc, insdc_parent_acc,
			        insdc_locus_tag, insdc_protein_id, uniprot_acc
			 FROM gene_xrefs
			 WHERE wormbase_gene = ?`,
      [wormbase_gene],
    );
  } catch {
    return [];
  }
}

// ---- Facets ----

export interface Facets {
  n_genes: number;
  n_wormcat_categories: number;
  n_go_terms: number;
  n_neuronal_categories: number;
  /** Genes per chromosome in the result; empty on a database without gene_location. */
  chromosomes?: ChromosomeCount[];
}

export interface ChromosomeCount {
  chromosome: string;
  n: number;
}

const CHROMOSOME_ORDER = ['I', 'II', 'III', 'IV', 'V', 'X', 'MtDNA'];
function sortChromosomes(rows: ChromosomeCount[]): ChromosomeCount[] {
  const rank = (c: string) => {
    const i = CHROMOSOME_ORDER.indexOf(c);
    return i === -1 ? CHROMOSOME_ORDER.length : i;
  };
  return rows.sort(
    (a, b) => rank(a.chromosome) - rank(b.chromosome) || a.chromosome.localeCompare(b.chromosome),
  );
}

async function chromosomeFacets(
  match: { sql: string; params: unknown[] } | null,
): Promise<ChromosomeCount[]> {
  if (!(await hasGeneLocation())) return [];
  const rows = match
    ? await query<ChromosomeCount>(
        `SELECT chromosome, COUNT(*) AS n FROM gene_location WHERE wormbase_gene IN (${match.sql}) GROUP BY chromosome`,
        match.params,
      )
    : await query<ChromosomeCount>(
        `SELECT chromosome, COUNT(*) AS n FROM gene_location GROUP BY chromosome`,
      );
  return sortChromosomes(rows);
}

// Returns the matched-genes subquery for the current query, or null if input is empty (no filter).
// `fields` must be the same set the result list searches, or the count, the
// facets and "send all matches" describe genes the list never shows.
function matchedGenesSubquery(
  input: string,
  fields?: readonly FtsField[],
): { sql: string; params: unknown[] } | null {
  const parsed = parseQuery(input);
  if (parsed.mode === 'empty') return null;

  if (parsed.mode === 'genelist') {
    const lower = jsonList(parsed.ids.map((id) => id.toLowerCase()));
    return {
      sql: `SELECT a.wormbase_gene FROM annotations a
			      WHERE a.wormbase_gene IN ${JSON_LIST}
			         OR LOWER(a.gene_name) IN ${JSON_LIST}
			         OR LOWER(a.sequence_name) IN ${JSON_LIST}`,
      params: [jsonList(parsed.ids), lower, lower],
    };
  }

  const { intersects, params } = routeQuery(parsed, fields);
  if (intersects.length === 0) return null;
  return {
    sql: intersects.join(' INTERSECT '),
    params,
  };
}

// Per-status counts for the sidebar (cached for page lifetime).
export interface StatusCounts {
  live: number;
  dead: number;
  all: number;
}
let statusCountsCache: StatusCounts | null = null;
export async function getStatusCounts(): Promise<StatusCounts> {
  if (statusCountsCache) return statusCountsCache;
  const rows = await query<StatusCounts>(
    `SELECT
			SUM(CASE WHEN LOWER(status)='live' THEN 1 ELSE 0 END) AS live,
			SUM(CASE WHEN LOWER(status)='dead' THEN 1 ELSE 0 END) AS dead,
			COUNT(*) AS all
		 FROM annotations`,
  );
  statusCountsCache = rows[0];
  return rows[0];
}

// Gene-name suggestions for the search bar dropdown. FTS prefix matching on gene_name/sequence_name/other_names.
export interface SuggestRow {
  wormbase_gene: string;
  gene_name: string | null;
  sequence_name: string | null;
  gene_class_description: string | null;
}
export async function suggestGenes(prefix: string, limit = 6): Promise<SuggestRow[]> {
  const p = prefix.trim();
  if (p.length < 2) return [];
  // Strip FTS-meta chars rather than escape them; autocomplete only, real search runs on Enter.
  const cleaned = p.replace(/["()*:~{}[\]]/g, '').trim();
  if (cleaned.length < 2) return [];
  const tokens = cleaned.split(/\s+/);
  const expr = tokens.map((t) => `"${t}"*`).join(' AND ');
  const scoped = `{gene_name wb_id entrez_id sequence_name other_names}: (${expr})`;
  // FTS5 unicode61 splits on '-', so "daf-2" tokenises to daf+2 and matches daf-2, daf-22, daf-200 equally.
  // The CASE re-imposes order: 0=exact, 1=starts-with gene/seq/wormbase_gene, 2=starts-with other_names, 3=FTS.
  // Within a tier: shorter name first, then has concise_description, then bm25.
  const lower = cleaned.toLowerCase();
  const startsWith = lower + '%';
  try {
    return await query<SuggestRow>(
      `SELECT a.wormbase_gene, a.gene_name, a.sequence_name, a.gene_class_description
			 FROM genes_fts f
			 JOIN annotations a ON a.wormbase_gene = f.wormbase_gene
			 LEFT JOIN wb_to_entrez we ON we.wormbase_gene = a.wormbase_gene
			 WHERE genes_fts MATCH ?
			 ORDER BY
				CASE
					WHEN LOWER(a.gene_name) = ?           THEN 0
					WHEN LOWER(a.wormbase_gene) = ?       THEN 0
					WHEN we.entrez_id = ?                  THEN 0
					WHEN LOWER(a.sequence_name) = ?       THEN 0
					WHEN LOWER(a.gene_name) LIKE ?        THEN 1
					WHEN LOWER(a.wormbase_gene) LIKE ?    THEN 1
					WHEN LOWER(a.sequence_name) LIKE ?    THEN 1
					WHEN LOWER(a.other_names) LIKE ?      THEN 2
					ELSE 3
				END,
				LENGTH(COALESCE(a.gene_name, a.sequence_name, a.wormbase_gene)),
				(a.concise_description IS NOT NULL) DESC,
				bm25(genes_fts)
			 LIMIT ?`,
      [
        scoped,
        lower,
        lower,
        cleaned, // entrez ids are stored as plain numeric strings
        lower,
        startsWith,
        startsWith,
        startsWith,
        startsWith,
        limit,
      ],
    );
  } catch {
    return [];
  }
}

// Unfiltered facets cached for page lifetime (in-memory DB never changes between queries).
let unfilteredFacetsCache: Facets | null = null;
async function getUnfilteredFacets(): Promise<Facets> {
  if (unfilteredFacetsCache) return unfilteredFacetsCache;
  const rows = await query<Facets>(
    `SELECT
			(SELECT COUNT(*) FROM annotations) AS n_genes,
			(SELECT COUNT(DISTINCT category_1) FROM wormcat WHERE category_1 IS NOT NULL) AS n_wormcat_categories,
			(SELECT COUNT(*) FROM go_terms WHERE is_obsolete=0) AS n_go_terms,
			(SELECT COUNT(DISTINCT supercategory) FROM neuronal WHERE supercategory IS NOT NULL) AS n_neuronal_categories`,
  );
  unfilteredFacetsCache = { ...rows[0], chromosomes: await chromosomeFacets(null) };
  return unfilteredFacetsCache;
}

export async function getFacets(term: string, fields?: readonly FtsField[]): Promise<Facets> {
  const parsed = parseQuery(term);
  const match = matchedGenesSubquery(term, fields);
  if (!match) return getUnfilteredFacets();

  // Fast path for status/type-only filters: IN-subqueries against gene_go (~1M rows), wormcat, and neuronal
  // are overhead when status:live matches ~96% of genes. Compute filtered n_genes only; reuse unfiltered counts.
  const annoOnly =
    parsed.mode === 'search' &&
    parsed.freeTextTokens.length === 0 &&
    !parsed.sequence.some((it) => it.kind === 'conn') &&
    parsed.ops.length > 0 &&
    parsed.ops.every((o) => o.mode === 'fts' && (o.key === 'status' || o.key === 'type'));
  if (annoOnly) {
    const conds: string[] = [];
    const params: unknown[] = [];
    for (const op of parsed.ops) {
      if (op.key === 'status') {
        conds.push('LOWER(status) = ?');
        params.push(op.value.toLowerCase());
      } else if (op.key === 'type') {
        conds.push('LOWER(gene_type) LIKE ?');
        params.push(`%${normalizeBiotype(op.value)}%`);
      }
    }
    const where = conds.join(' AND ');
    const [count, base] = await Promise.all([
      query<{ n: number }>(`SELECT COUNT(*) AS n FROM annotations WHERE ${where}`, params),
      getUnfilteredFacets(),
    ]);
    return { ...base, n_genes: count[0]?.n ?? 0 };
  }

  // General path: matched subquery repeated once per facet.
  const params = [...match.params, ...match.params, ...match.params, ...match.params];
  const chromosomes = chromosomeFacets(match);
  const rows = await query<Facets>(
    `SELECT
			(SELECT COUNT(*) FROM (${match.sql})) AS n_genes,
			(SELECT COUNT(DISTINCT category_1) FROM wormcat WHERE wormbase_gene IN (${match.sql}) AND category_1 IS NOT NULL) AS n_wormcat_categories,
			(SELECT COUNT(DISTINCT go_id) FROM gene_go WHERE wormbase_gene IN (${match.sql}) AND evidence_code != 'IEA-PROP') AS n_go_terms,
			(SELECT COUNT(DISTINCT supercategory) FROM neuronal WHERE wormbase_gene IN (${match.sql}) AND supercategory IS NOT NULL) AS n_neuronal_categories`,
    params,
  );
  return { ...rows[0], chromosomes: await chromosomes };
}

// ---- WormCat tree ----

export interface CatCount {
  category_1: string;
  category_2: string | null;
  category_3: string | null;
  n: number;
}

export async function getWormcatTree(term: string): Promise<CatCount[]> {
  const match = matchedGenesSubquery(term);
  if (!match) {
    return query<CatCount>(
      `SELECT category_1, category_2, category_3, COUNT(*) AS n
			 FROM wormcat
			 WHERE category_1 IS NOT NULL
			 GROUP BY category_1, category_2, category_3
			 ORDER BY category_1, category_2, category_3`,
    );
  }
  return query<CatCount>(
    `SELECT w.category_1, w.category_2, w.category_3, COUNT(*) AS n
		 FROM wormcat w
		 WHERE w.wormbase_gene IN (${match.sql}) AND w.category_1 IS NOT NULL
		 GROUP BY w.category_1, w.category_2, w.category_3
		 ORDER BY w.category_1, w.category_2, w.category_3`,
    match.params,
  );
}

export interface CatGene {
  wormbase_gene: string;
  gene_name: string | null;
  concise_description: string | null;
}

export async function getWormcatGenes(
  term: string,
  cat1: string,
  cat2?: string | null,
  cat3?: string | null,
): Promise<CatGene[]> {
  const match = matchedGenesSubquery(term);
  const conds = ['w.category_1 = ?'];
  const params: unknown[] = [];
  if (match) {
    conds.unshift(`w.wormbase_gene IN (${match.sql})`);
    params.push(...match.params);
  }
  params.push(cat1);
  if (cat2 !== undefined) {
    if (cat2 === null) conds.push('w.category_2 IS NULL');
    else {
      conds.push('w.category_2 = ?');
      params.push(cat2);
    }
  }
  if (cat3 !== undefined) {
    if (cat3 === null) conds.push('w.category_3 IS NULL');
    else {
      conds.push('w.category_3 = ?');
      params.push(cat3);
    }
  }
  return query<CatGene>(
    `SELECT w.wormbase_gene, a.gene_name, a.concise_description
		 FROM wormcat w
		 LEFT JOIN annotations a ON a.wormbase_gene = w.wormbase_gene
		 WHERE ${conds.join(' AND ')}
		 ORDER BY a.gene_name`,
    params,
  );
}

// ---- Expression across life stages and gene model ----

export interface StageExpression {
  stage_id: string;
  stage: string;
  stage_order: number;
  n_libraries: number;
  mean_fpkm: number | null;
  median_fpkm: number | null;
}

export async function getStageExpressionFor(wormbase_gene: string): Promise<StageExpression[]> {
  if (!(await hasTable('stage_expression'))) return [];
  return query<StageExpression>(
    `SELECT stage_id, stage, stage_order, n_libraries, mean_fpkm, median_fpkm
     FROM stage_expression WHERE wormbase_gene = ? ORDER BY stage_order`,
    [wormbase_gene],
  );
}

export interface GeneTranscript {
  transcript_id: string;
  biotype: string | null;
  exons: number;
  length_nt: number;
  cds_nt: number;
}

export async function getTranscriptsFor(wormbase_gene: string): Promise<GeneTranscript[]> {
  if (!(await hasTable('gene_transcript'))) return [];
  return query<GeneTranscript>(
    `SELECT transcript_id, biotype, exons, length_nt, cds_nt
     FROM gene_transcript WHERE wormbase_gene = ? ORDER BY transcript_id`,
    [wormbase_gene],
  );
}

export interface GeneDomain {
  source: string;
  accession: string;
  name: string | null;
}

export async function getDomainsFor(wormbase_gene: string): Promise<GeneDomain[]> {
  if (!(await hasTable('gene_domain'))) return [];
  return query<GeneDomain>(
    `SELECT source, accession, name FROM gene_domain WHERE wormbase_gene = ?
     ORDER BY CASE source WHEN 'InterPro' THEN 0 WHEN 'Pfam' THEN 1 WHEN 'SMART' THEN 2 ELSE 3 END, accession`,
    [wormbase_gene],
  );
}

// ---- Synaptogenesis tree ----

export interface SynaptoCount {
  class: string;
  subclass: string | null;
  n: number;
}

export async function getSynaptogenesisTree(term: string): Promise<SynaptoCount[]> {
  const match = matchedGenesSubquery(term);
  if (!match) {
    return query<SynaptoCount>(
      `SELECT class, subclass, COUNT(*) AS n
			 FROM synaptogenesis
			 WHERE class IS NOT NULL
			 GROUP BY class, subclass
			 ORDER BY class, subclass`,
    );
  }
  return query<SynaptoCount>(
    `SELECT s.class, s.subclass, COUNT(*) AS n
		 FROM synaptogenesis s
		 WHERE s.wormbase_gene IN (${match.sql}) AND s.class IS NOT NULL
		 GROUP BY s.class, s.subclass
		 ORDER BY s.class, s.subclass`,
    match.params,
  );
}

export interface SynaptoGene {
  wormbase_gene: string;
  gene_name: string | null;
  notes: string | null;
  refs?: string | null;
  concise_description: string | null;
}

export async function getSynaptogenesisGenes(
  term: string,
  klass: string,
  subclass?: string | null,
): Promise<SynaptoGene[]> {
  const match = matchedGenesSubquery(term);
  const conds = ['s.class = ?'];
  const params: unknown[] = [];
  if (match) {
    conds.unshift(`s.wormbase_gene IN (${match.sql})`);
    params.push(...match.params);
  }
  params.push(klass);
  if (subclass !== undefined) {
    if (subclass === null) conds.push('s.subclass IS NULL');
    else {
      conds.push('s.subclass = ?');
      params.push(subclass);
    }
  }
  return query<SynaptoGene>(
    `SELECT s.*, a.gene_name, a.concise_description
		 FROM synaptogenesis s
		 LEFT JOIN annotations a ON a.wormbase_gene = s.wormbase_gene
		 WHERE ${conds.join(' AND ')}
		 ORDER BY a.gene_name`,
    params,
  );
}

// ---- Neuronal tree ----

export interface NeuronalCount {
  supercategory: string;
  category: string | null;
  n: number;
}

export async function getNeuronalTree(term: string): Promise<NeuronalCount[]> {
  const match = matchedGenesSubquery(term);
  if (!match) {
    return query<NeuronalCount>(
      `SELECT supercategory, category, COUNT(DISTINCT wormbase_gene) AS n
			 FROM neuronal
			 WHERE supercategory IS NOT NULL
			 GROUP BY supercategory, category
			 ORDER BY supercategory, category`,
    );
  }
  return query<NeuronalCount>(
    `SELECT n.supercategory, n.category, COUNT(DISTINCT n.wormbase_gene) AS n
		 FROM neuronal n
		 WHERE n.wormbase_gene IN (${match.sql}) AND n.supercategory IS NOT NULL
		 GROUP BY n.supercategory, n.category
		 ORDER BY n.supercategory, n.category`,
    match.params,
  );
}

// ---- GO browsing ----

export type GoNamespace = 'BP' | 'MF' | 'CC';

export const GO_NAMESPACE_ROOTS: Record<GoNamespace, string> = {
  BP: 'GO:0008150', // biological_process
  MF: 'GO:0003674', // molecular_function
  CC: 'GO:0005575', // cellular_component
};

export const GO_NAMESPACE_LABEL: Record<GoNamespace, string> = {
  BP: 'Biological process',
  MF: 'Molecular function',
  CC: 'Cellular component',
};

export interface GoNode {
  go_id: string;
  name: string;
  namespace: string;
  n_children: number;
  n_parents: number;
  n_direct_genes: number;
}

export type GoEdgeType =
  | 'is_a'
  | 'part_of'
  | 'regulates'
  | 'positively_regulates'
  | 'negatively_regulates';

export const DEFAULT_EDGE_TYPES: GoEdgeType[] = [
  'is_a',
  'part_of',
  'regulates',
  'positively_regulates',
  'negatively_regulates',
];

export async function getGoChildren(parent_id: string): Promise<GoNode[]> {
  return query<GoNode>(
    `SELECT t.go_id, t.name, t.namespace,
		        (SELECT COUNT(*) FROM go_relations cr
		           WHERE cr.parent_id = t.go_id AND cr.rel_type = 'is_a') AS n_children,
		        (SELECT COUNT(*) FROM go_relations pr
		           WHERE pr.child_id = t.go_id AND pr.rel_type = 'is_a') AS n_parents,
		        (SELECT COUNT(DISTINCT gg.wormbase_gene) FROM gene_go gg
		           WHERE gg.go_id = t.go_id) AS n_direct_genes
		 FROM go_terms t
		 JOIN go_relations r ON r.child_id = t.go_id
		 WHERE r.parent_id = ? AND r.rel_type = 'is_a' AND t.is_obsolete = 0
		 ORDER BY t.name`,
    [parent_id],
  );
}

export interface GoEdge {
  go_id: string;
  name: string;
  namespace: string;
  rel_type: GoEdgeType;
  n_children: number;
  n_parents: number;
  n_direct_genes: number;
}

// All edges from `go_id` in the given direction. 'parents' = incoming edges; 'children' = outgoing edges.
export async function getGoEdges(
  go_id: string,
  direction: 'parents' | 'children',
  edgeTypes: GoEdgeType[] = DEFAULT_EDGE_TYPES,
): Promise<GoEdge[]> {
  if (edgeTypes.length === 0) return [];
  const placeholders = edgeTypes.map(() => '?').join(',');
  const selfCol = direction === 'parents' ? 'child_id' : 'parent_id';
  const otherCol = direction === 'parents' ? 'parent_id' : 'child_id';
  return query<GoEdge>(
    `SELECT t.go_id, t.name, t.namespace, r.rel_type,
		        (SELECT COUNT(*) FROM go_relations cr
		           WHERE cr.parent_id = t.go_id AND cr.rel_type = 'is_a') AS n_children,
		        (SELECT COUNT(*) FROM go_relations pr
		           WHERE pr.child_id = t.go_id AND pr.rel_type = 'is_a') AS n_parents,
		        (SELECT COUNT(DISTINCT gg.wormbase_gene) FROM gene_go gg
		           WHERE gg.go_id = t.go_id) AS n_direct_genes
		 FROM go_terms t
		 JOIN go_relations r ON r.${otherCol} = t.go_id
		 WHERE r.${selfCol} = ? AND r.rel_type IN (${placeholders}) AND t.is_obsolete = 0
		 ORDER BY r.rel_type, t.name`,
    [go_id, ...edgeTypes],
  );
}

export interface GoParentRef {
  go_id: string;
  name: string;
}

export async function getGoOtherParents(
  child_id: string,
  exclude_parent_id: string,
): Promise<GoParentRef[]> {
  return query<GoParentRef>(
    `SELECT t.go_id, t.name FROM go_relations r
		 JOIN go_terms t ON t.go_id = r.parent_id
		 WHERE r.child_id = ? AND r.rel_type = 'is_a' AND r.parent_id != ?
		 ORDER BY t.name`,
    [child_id, exclude_parent_id],
  );
}

export interface GoTermMatch {
  go_id: string;
  name: string;
  namespace: string;
  n_direct_genes: number;
}

export async function searchGoTerms(term: string, limit = 100): Promise<GoTermMatch[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];
  const fts = escapeFts(trimmed.split(/\s+/));
  return query<GoTermMatch>(
    `SELECT t.go_id, t.name, t.namespace,
		        (SELECT COUNT(DISTINCT gg.wormbase_gene) FROM gene_go gg WHERE gg.go_id = t.go_id) AS n_direct_genes
		 FROM go_fts f
		 JOIN go_terms t ON t.go_id = f.go_id
		 WHERE go_fts MATCH ? AND t.is_obsolete = 0
		 ORDER BY bm25(go_fts)
		 LIMIT ?`,
    [fts, limit],
  );
}

export interface GoGene {
  wormbase_gene: string;
  gene_name: string | null;
  evidence_code: string;
  qualifier: string | null;
}

export interface GoTermDetail {
  go_id: string;
  name: string;
  namespace: string;
  definition: string | null;
}

export async function getGoTerm(go_id: string): Promise<GoTermDetail | null> {
  let rows = await query<GoTermDetail>(
    `SELECT go_id, name, namespace, definition FROM go_terms WHERE go_id = ? AND is_obsolete = 0`,
    [go_id],
  );
  if (rows.length === 0) {
    // Follow alt_id redirect.
    const alt = await query<{ go_id: string }>(`SELECT go_id FROM go_alt_ids WHERE alt_id = ?`, [
      go_id,
    ]);
    if (alt[0]) {
      rows = await query<GoTermDetail>(
        `SELECT go_id, name, namespace, definition FROM go_terms WHERE go_id = ?`,
        [alt[0].go_id],
      );
    }
  }
  return rows[0] ?? null;
}

export interface GoNeighborhood {
  center: GoTermDetail;
  parents: GoNode[];
  children: GoNode[];
}

export async function getGoNeighborhood(go_id: string): Promise<GoNeighborhood | null> {
  const center = await getGoTerm(go_id);
  if (!center) return null;

  const parents = await query<GoNode>(
    `SELECT t.go_id, t.name, t.namespace,
		        (SELECT COUNT(*) FROM go_relations cr
		           WHERE cr.parent_id = t.go_id AND cr.rel_type = 'is_a') AS n_children,
		        (SELECT COUNT(*) FROM go_relations pr
		           WHERE pr.child_id = t.go_id AND pr.rel_type = 'is_a') AS n_parents,
		        (SELECT COUNT(DISTINCT gg.wormbase_gene) FROM gene_go gg
		           WHERE gg.go_id = t.go_id) AS n_direct_genes
		 FROM go_terms t
		 JOIN go_relations r ON r.parent_id = t.go_id
		 WHERE r.child_id = ? AND r.rel_type = 'is_a' AND t.is_obsolete = 0
		 ORDER BY t.name`,
    [center.go_id],
  );

  const children = await getGoChildren(center.go_id);

  return { center, parents, children };
}

export async function getGoTransitiveGeneCount(go_id: string): Promise<number> {
  const rows = await query<{ n: number }>(
    `WITH RECURSIVE descendants(id) AS (
			SELECT ?
			UNION
			SELECT r.child_id FROM go_relations r
			JOIN descendants d ON r.parent_id = d.id
			WHERE r.rel_type = 'is_a'
		 )
		 SELECT COUNT(DISTINCT gg.wormbase_gene) AS n
		 FROM gene_go gg
		 WHERE gg.go_id IN descendants`,
    [go_id],
  );
  return rows[0]?.n ?? 0;
}

// ---- Orthologs (Alliance multi-species) ----

export interface Ortholog {
  species: string;
  taxon_id: string;
  ortholog_id: string;
  ortholog_symbol: string;
  algorithms: string | null;
  algorithms_match: number | null;
  out_of_algorithms: number | null;
  is_best_score: number;
  is_best_rev_score: number;
}

export async function getOrthologs(wormbase_gene: string): Promise<Ortholog[]> {
  return query<Ortholog>(
    `SELECT species, taxon_id, ortholog_id, ortholog_symbol, algorithms,
		        algorithms_match, out_of_algorithms, is_best_score, is_best_rev_score
		 FROM orthologs
		 WHERE wormbase_gene = ?
		 ORDER BY is_best_score DESC, algorithms_match DESC, species, ortholog_symbol`,
    [wormbase_gene],
  );
}

// Helper for compact display: best (or tied-best) human ortholog symbols.
export async function getHumanOrthologSymbols(wormbase_gene: string): Promise<string[]> {
  const rows = await query<{ ortholog_symbol: string }>(
    `SELECT ortholog_symbol FROM orthologs
		 WHERE wormbase_gene = ? AND species = 'Homo sapiens'
		 ORDER BY is_best_score DESC, algorithms_match DESC, ortholog_symbol`,
    [wormbase_gene],
  );
  return rows.map((r) => r.ortholog_symbol);
}

// ---- Interactions ----

export interface Interaction {
  partner: string;
  partner_name: string | null;
  partner_symbol: string | null;
  experimental_system: string | null;
  experimental_type: string | null; // 'physical' | 'genetic'
  author: string | null;
  pmid: string | null;
  throughput: string | null;
  score: number | null;
}

export interface StringInteraction {
  partner: string;
  partner_name: string | null;
  combined_score: number;
  neighborhood: number;
  fusion: number;
  cooccurrence: number;
  coexpression: number;
  experimental: number;
  database: number;
  textmining: number;
}

export async function getStringInteractionsFor(
  wormbase_gene: string,
): Promise<StringInteraction[]> {
  try {
    return await query<StringInteraction>(
      `SELECT
         CASE WHEN s.gene_a = ?1 THEN s.gene_b ELSE s.gene_a END AS partner,
         (SELECT a.gene_name FROM annotations a
            WHERE a.wormbase_gene = CASE WHEN s.gene_a = ?1 THEN s.gene_b ELSE s.gene_a END) AS partner_name,
         s.combined_score, s.neighborhood, s.fusion, s.cooccurrence,
         s.coexpression, s.experimental, s.database, s.textmining
       FROM string_interactions s
       WHERE s.gene_a = ?1 OR s.gene_b = ?1
       ORDER BY s.combined_score DESC`,
      [wormbase_gene],
    );
  } catch {
    return [];
  }
}

export interface InteractionNeighbor {
  partner: string;
  partner_name: string | null;
  partner_symbol: string | null;
  physical_count: number;
  genetic_count: number;
  other_count: number;
  total: number;
}

export async function getInteractionNeighbors(
  wormbase_gene: string,
): Promise<InteractionNeighbor[]> {
  return query<InteractionNeighbor>(
    `WITH pairs AS (
		   SELECT
		     CASE WHEN gene_a = ? THEN gene_b ELSE gene_a END AS partner,
		     CASE WHEN gene_a = ? THEN symbol_b ELSE symbol_a END AS partner_symbol,
		     experimental_type
		   FROM interactions
		   WHERE gene_a = ? OR gene_b = ?
		 )
		 SELECT p.partner,
		        MAX(p.partner_symbol) AS partner_symbol,
		        (SELECT a.gene_name FROM annotations a WHERE a.wormbase_gene = p.partner) AS partner_name,
		        SUM(CASE WHEN LOWER(p.experimental_type)='physical' THEN 1 ELSE 0 END) AS physical_count,
		        SUM(CASE WHEN LOWER(p.experimental_type)='genetic'  THEN 1 ELSE 0 END) AS genetic_count,
		        SUM(CASE WHEN LOWER(p.experimental_type) NOT IN ('physical','genetic') THEN 1 ELSE 0 END) AS other_count,
		        COUNT(*) AS total
		 FROM pairs p
		 GROUP BY p.partner
		 ORDER BY total DESC, partner_name`,
    [wormbase_gene, wormbase_gene, wormbase_gene, wormbase_gene],
  );
}

export async function getInteractionsFor(wormbase_gene: string): Promise<Interaction[]> {
  return query<Interaction>(
    `SELECT
		   CASE WHEN i.gene_a = ? THEN i.gene_b ELSE i.gene_a END AS partner,
		   CASE WHEN i.gene_a = ? THEN i.symbol_b ELSE i.symbol_a END AS partner_symbol,
		   (SELECT a.gene_name FROM annotations a
		      WHERE a.wormbase_gene = CASE WHEN i.gene_a = ? THEN i.gene_b ELSE i.gene_a END) AS partner_name,
		   i.experimental_system, i.experimental_type, i.author, i.pmid, i.throughput, i.score
		 FROM interactions i
		 WHERE i.gene_a = ? OR i.gene_b = ?
		 ORDER BY i.experimental_type, i.experimental_system, partner_name`,
    [wormbase_gene, wormbase_gene, wormbase_gene, wormbase_gene, wormbase_gene],
  );
}

// ---- Multi-hop network expansion helpers ----

// One hop of partners for a seed set (BFS helper). Distinct edge types preserved for the page filter.
export interface InteractionEdge {
  source: string;
  target: string;
  source_name: string | null;
  target_name: string | null;
  experimental_type: string | null;
}
export async function getInteractionsBatch(
  seeds: string[],
  opts: { types?: ('physical' | 'genetic' | 'other')[] } = {},
): Promise<InteractionEdge[]> {
  if (seeds.length === 0) return [];
  const wantPhysical = !opts.types || opts.types.includes('physical');
  const wantGenetic = !opts.types || opts.types.includes('genetic');
  const wantOther = !opts.types || opts.types.includes('other');
  // UNION ALL of two indexed scans instead of (gene_a IN ... OR gene_b IN ...): SQLite can't OR
  // two different-column index scans cleanly. experimental_type stored lowercase, so '=' is safe.
  // Caller chunks frontier at 250 so each scan covers a bounded indexed range.
  const typeConds: string[] = [];
  if (wantPhysical) typeConds.push("i.experimental_type = 'physical'");
  if (wantGenetic) typeConds.push("i.experimental_type = 'genetic'");
  if (wantOther)
    typeConds.push(
      "(i.experimental_type IS NULL OR i.experimental_type NOT IN ('physical','genetic'))",
    );
  if (typeConds.length === 0) return [];
  const typeClause = `(${typeConds.join(' OR ')})`;
  return query<InteractionEdge>(
    `WITH inputs(g) AS (SELECT value FROM json_each(?))
		 SELECT i.gene_a AS source, i.gene_b AS target,
		        i.symbol_a AS source_name, i.symbol_b AS target_name,
		        i.experimental_type
		 FROM interactions i
		 WHERE i.gene_a IN (SELECT g FROM inputs) AND ${typeClause}
		 UNION
		 SELECT i.gene_a AS source, i.gene_b AS target,
		        i.symbol_a AS source_name, i.symbol_b AS target_name,
		        i.experimental_type
		 FROM interactions i
		 WHERE i.gene_b IN (SELECT g FROM inputs) AND ${typeClause}`,
    [JSON.stringify(seeds)],
  );
}

// All neuronal-classified WBGenes (~3-5k rows).
export async function getNeuronalGeneSet(): Promise<string[]> {
  const rows = await query<{ wormbase_gene: string }>(
    'SELECT DISTINCT wormbase_gene FROM neuronal',
  );
  return rows.map((r) => r.wormbase_gene);
}

// WormCat top-level categories (category_1) with gene counts; used by the filter dropdown on /network/[id].
export interface WormcatCategoryRow {
  category_1: string;
  n_genes: number;
}
export async function getWormcatCategories(): Promise<WormcatCategoryRow[]> {
  return query<WormcatCategoryRow>(
    `SELECT category_1, COUNT(DISTINCT wormbase_gene) AS n_genes
		 FROM wormcat
		 WHERE category_1 IS NOT NULL AND category_1 <> ''
		 GROUP BY category_1
		 ORDER BY n_genes DESC`,
  );
}

export async function getWormcatGeneSet(category_1: string): Promise<string[]> {
  const rows = await query<{ wormbase_gene: string }>(
    'SELECT DISTINCT wormbase_gene FROM wormcat WHERE category_1 = ?',
    [category_1],
  );
  return rows.map((r) => r.wormbase_gene);
}

// ---- Find similar ----

export interface SharedTerm {
  go_id: string;
  name: string;
}

export interface SimilarGene {
  wormbase_gene: string;
  gene_name: string | null;
  concise_description: string | null;
  shared_go: number;
  shared_go_score: number; // IDF-weighted
  shared_wormcat: number;
  shared_neuronal: number;
  shared_partners: number;
  score: number;
  top_shared: SharedTerm[];
}

export async function getSimilarGenes(wormbase_gene: string, limit = 16): Promise<SimilarGene[]> {
  const wb = wormbase_gene;
  // Single query: GO ancestor closure (depth<=4, IDF-weighted), WormCat/neuronal overlap,
  // shared interaction partners, and top-3 distinguishing shared GO terms per candidate.
  type Row = {
    wormbase_gene: string;
    gene_name: string | null;
    concise_description: string | null;
    shared_go: number;
    shared_go_score: number;
    shared_wormcat: number;
    shared_neuronal: number;
    shared_partners: number;
    score: number;
    top_shared_json: string | null;
  };
  // IDF-weighted like the GO half where the build provides the frequencies;
  // older builds fall back to the flat per-level weight.
  const wcIdf = await hasTable('wormcat_term_freq');
  const wcMatchCte = wcIdf
    ? `wc_match AS (
		    SELECT w.wormbase_gene,
		           (CASE WHEN w.category_1 IN src_wc THEN 1 ELSE 0 END
		          + CASE WHEN w.category_2 IN src_wc THEN 1 ELSE 0 END
		          + CASE WHEN w.category_3 IN src_wc THEN 1 ELSE 0 END) AS n,
		           (CASE WHEN w.category_1 IN src_wc THEN COALESCE(f1.idf, 0) ELSE 0 END
		          + CASE WHEN w.category_2 IN src_wc THEN COALESCE(f2.idf, 0) ELSE 0 END
		          + CASE WHEN w.category_3 IN src_wc THEN COALESCE(f3.idf, 0) ELSE 0 END) AS wsc
		    FROM wormcat w
		    LEFT JOIN wormcat_term_freq f1 ON f1.level = 1 AND f1.category = w.category_1
		    LEFT JOIN wormcat_term_freq f2 ON f2.level = 2 AND f2.category = w.category_2
		    LEFT JOIN wormcat_term_freq f3 ON f3.level = 3 AND f3.category = w.category_3
		    WHERE w.wormbase_gene != ?
		  )`
    : `wc_match AS (
		    SELECT w.wormbase_gene,
		           (CASE WHEN w.category_1 IN src_wc THEN 1 ELSE 0 END
		          + CASE WHEN w.category_2 IN src_wc THEN 1 ELSE 0 END
		          + CASE WHEN w.category_3 IN src_wc THEN 1 ELSE 0 END) AS n,
		           (CASE WHEN w.category_1 IN src_wc THEN 3.0 ELSE 0 END
		          + CASE WHEN w.category_2 IN src_wc THEN 3.0 ELSE 0 END
		          + CASE WHEN w.category_3 IN src_wc THEN 3.0 ELSE 0 END) AS wsc
		    FROM wormcat w
		    WHERE w.wormbase_gene != ?
		  )`;

  const rows = await query<Row>(
    `WITH RECURSIVE
		  src_go_direct AS (SELECT DISTINCT go_id FROM gene_go WHERE wormbase_gene = ? AND evidence_code != 'IEA-PROP'),
		  src_go_closure(go_id, hop) AS (
		    SELECT go_id, 0 FROM src_go_direct
		    UNION
		    SELECT r.parent_id, sc.hop + 1
		    FROM go_relations r
		    JOIN src_go_closure sc ON r.child_id = sc.go_id
		    WHERE r.rel_type = 'is_a' AND sc.hop < 4
		  ),
		  src_wc(c) AS (
		    SELECT category_1 FROM wormcat WHERE wormbase_gene = ? AND category_1 IS NOT NULL
		    UNION SELECT category_2 FROM wormcat WHERE wormbase_gene = ? AND category_2 IS NOT NULL
		    UNION SELECT category_3 FROM wormcat WHERE wormbase_gene = ? AND category_3 IS NOT NULL
		  ),
		  src_neu AS (SELECT DISTINCT category FROM neuronal WHERE wormbase_gene = ? AND category IS NOT NULL),
		  src_partners AS (
		    SELECT DISTINCT CASE WHEN gene_a = ? THEN gene_b ELSE gene_a END AS partner
		    FROM interactions WHERE gene_a = ? OR gene_b = ?
		  ),

		  go_match AS (
		    SELECT gg.wormbase_gene,
		           COUNT(*) AS n,
		           SUM(COALESCE(f.idf, 1.0) * CASE WHEN gg.go_id IN src_go_direct THEN 1.0 ELSE 0.4 END) AS w
		    FROM (SELECT DISTINCT wormbase_gene, go_id FROM gene_go WHERE evidence_code != 'IEA-PROP') gg
		    LEFT JOIN go_term_freq f ON f.go_id = gg.go_id
		    WHERE gg.go_id IN (SELECT go_id FROM src_go_closure)
		      AND gg.wormbase_gene != ?
		    GROUP BY gg.wormbase_gene
		  ),

		  -- Top-3 shared GO terms per candidate by IDF. Collapse to distinct (gene, term) pairs
		  -- first because gene_go has multiple rows per pair for different evidence codes.
		  go_match_pairs AS (
		    SELECT DISTINCT gg.wormbase_gene, gg.go_id
		    FROM gene_go gg
		    WHERE gg.go_id IN src_go_direct AND gg.wormbase_gene != ?
		      AND gg.evidence_code != 'IEA-PROP'
		  ),
		  go_match_ranked AS (
		    SELECT p.wormbase_gene,
		           p.go_id,
		           t.name,
		           COALESCE(f.idf, 0) AS idf,
		           ROW_NUMBER() OVER (PARTITION BY p.wormbase_gene ORDER BY COALESCE(f.idf, 0) DESC, t.name) AS rk
		    FROM go_match_pairs p
		    JOIN go_terms t ON t.go_id = p.go_id
		    LEFT JOIN go_term_freq f ON f.go_id = p.go_id
		  ),
		  top_shared AS (
		    SELECT wormbase_gene,
		           json_group_array(json_object('go_id', go_id, 'name', name)) AS top_shared_json
		    FROM go_match_ranked
		    WHERE rk <= 3
		    GROUP BY wormbase_gene
		  ),

		  ${wcMatchCte},

		  neu_match AS (
		    SELECT n.wormbase_gene, COUNT(DISTINCT n.category) AS n
		    FROM neuronal n
		    WHERE n.wormbase_gene != ?
		      AND n.category IN (SELECT category FROM src_neu)
		    GROUP BY n.wormbase_gene
		  ),

		  ix_match AS (
		    SELECT cand AS wormbase_gene, COUNT(DISTINCT shared_partner) AS n
		    FROM (
		      SELECT
		        CASE WHEN i.gene_a IN (SELECT partner FROM src_partners) THEN i.gene_b ELSE i.gene_a END AS cand,
		        CASE WHEN i.gene_a IN (SELECT partner FROM src_partners) THEN i.gene_a ELSE i.gene_b END AS shared_partner
		      FROM interactions i
		      WHERE (i.gene_a IN (SELECT partner FROM src_partners) OR i.gene_b IN (SELECT partner FROM src_partners))
		    )
		    WHERE cand != ?
		    GROUP BY cand
		  ),

		  candidates AS (
		    SELECT wormbase_gene FROM go_match
		    UNION SELECT wormbase_gene FROM wc_match WHERE n > 0
		    UNION SELECT wormbase_gene FROM neu_match
		    UNION SELECT wormbase_gene FROM ix_match
		  )

		 SELECT c.wormbase_gene,
		        a.gene_name,
		        a.concise_description,
		        COALESCE(g.n, 0) AS shared_go,
		        COALESCE(g.w, 0) AS shared_go_score,
		        COALESCE(w.n, 0) AS shared_wormcat,
		        COALESCE(neu.n, 0) AS shared_neuronal,
		        COALESCE(ix.n, 0) AS shared_partners,
		        (COALESCE(g.w, 0)
		         + COALESCE(w.wsc, 0)
		         + COALESCE(neu.n, 0) * 2.0
		         + COALESCE(ix.n, 0) * 2.0) AS score,
		        ts.top_shared_json
		 FROM candidates c
		 LEFT JOIN go_match g ON g.wormbase_gene = c.wormbase_gene
		 LEFT JOIN wc_match w ON w.wormbase_gene = c.wormbase_gene
		 LEFT JOIN neu_match neu ON neu.wormbase_gene = c.wormbase_gene
		 LEFT JOIN ix_match ix ON ix.wormbase_gene = c.wormbase_gene
		 LEFT JOIN top_shared ts ON ts.wormbase_gene = c.wormbase_gene
		 LEFT JOIN annotations a ON a.wormbase_gene = c.wormbase_gene
		 WHERE score > 0
		 ORDER BY score DESC
		 LIMIT ?`,
    [wb, wb, wb, wb, wb, wb, wb, wb, wb, wb, wb, wb, wb, limit],
  );

  return rows.map((r) => ({
    wormbase_gene: r.wormbase_gene,
    gene_name: r.gene_name,
    concise_description: r.concise_description,
    shared_go: r.shared_go,
    shared_go_score: r.shared_go_score,
    shared_wormcat: r.shared_wormcat,
    shared_neuronal: r.shared_neuronal,
    shared_partners: r.shared_partners,
    score: r.score,
    top_shared: r.top_shared_json ? (JSON.parse(r.top_shared_json) as SharedTerm[]) : [],
  }));
}

export async function getGenesForGoTerm(go_id: string): Promise<GoGene[]> {
  return query<GoGene>(
    `SELECT DISTINCT gg.wormbase_gene, a.gene_name, gg.evidence_code, gg.qualifier
		 FROM gene_go gg
		 LEFT JOIN annotations a ON a.wormbase_gene = gg.wormbase_gene
		 WHERE gg.go_id = ?
		 ORDER BY a.gene_name`,
    [go_id],
  );
}

export async function getNeuronalGenes(
  term: string,
  supercat: string,
  cat?: string | null,
): Promise<CatGene[]> {
  const match = matchedGenesSubquery(term);
  const conds = ['n.supercategory = ?'];
  const params: unknown[] = [];
  if (match) {
    conds.unshift(`n.wormbase_gene IN (${match.sql})`);
    params.push(...match.params);
  }
  params.push(supercat);
  if (cat !== undefined) {
    if (cat === null) conds.push('n.category IS NULL');
    else {
      conds.push('n.category = ?');
      params.push(cat);
    }
  }
  return query<CatGene>(
    `SELECT DISTINCT n.wormbase_gene, a.gene_name, a.concise_description
		 FROM neuronal n
		 LEFT JOIN annotations a ON a.wormbase_gene = n.wormbase_gene
		 WHERE ${conds.join(' AND ')}
		 ORDER BY a.gene_name`,
    params,
  );
}

/**
 * Every annotation set of one kind, as gene-set input for ssGSEA or custom GSEA.
 * Sets outside [minSize, maxSize] are dropped: tiny ones score noisily and huge
 * ones say little about any individual sample.
 */
export async function getTermSets(
  kind: EnrichmentKind,
  opts: { minSize?: number; maxSize?: number } = {},
): Promise<{ term_id: string; name: string; genes: string[] }[]> {
  const minSize = opts.minSize ?? 15;
  const maxSize = opts.maxSize ?? 500;
  // Same membership rules as over-representation and ranked-list enrichment use.
  const SQL: Record<Exclude<EnrichmentKind, 'wormcat'>, { sql: string; table: string }> = {
    go: {
      table: 'gene_go',
      sql: `SELECT gg.go_id AS term_id, COALESCE(t.name, gg.go_id) AS name, gg.wormbase_gene AS gene
         FROM gene_go gg LEFT JOIN go_terms t ON t.go_id = gg.go_id
         WHERE COALESCE(t.is_obsolete, 0) = 0 AND ${GO_POSITIVE}`,
    },
    phenotype: {
      table: 'gene_phenotype',
      sql: `SELECT gp.term_id, COALESCE(pt.name, gp.term_id) AS name, gp.wormbase_gene AS gene
         FROM gene_phenotype gp LEFT JOIN phenotype_terms pt ON pt.term_id = gp.term_id`,
    },
    neuronal: {
      table: 'neuronal',
      sql: `SELECT category AS term_id, category AS name, wormbase_gene AS gene
         FROM neuronal WHERE category IS NOT NULL`,
    },
    tissue: {
      table: 'gene_anatomy',
      sql: `SELECT ga.term_id, COALESCE(at.name, ga.term_id) AS name, ga.wormbase_gene AS gene
         FROM gene_anatomy ga LEFT JOIN anatomy_terms at ON at.term_id = ga.term_id`,
    },
    disease: {
      table: 'gene_disease',
      sql: `SELECT do_id AS term_id, COALESCE(do_name, do_id) AS name, wormbase_gene AS gene
         FROM gene_disease`,
    },
    domain: {
      table: 'gene_domain',
      sql: `SELECT accession AS term_id, COALESCE(name, accession) AS name, wormbase_gene AS gene
         FROM gene_domain WHERE source = 'InterPro'`,
    },
    'cell-type': {
      table: 'cengen_calls',
      sql: `SELECT neuron_type AS term_id, neuron_type AS name, wormbase_gene AS gene
         FROM cengen_calls WHERE max_threshold >= ${CENGEN_MIN_THRESHOLD}`,
    },
    synaptogenesis: {
      table: 'synaptogenesis',
      sql: `SELECT class AS term_id, class AS name, wormbase_gene AS gene
         FROM synaptogenesis WHERE class IS NOT NULL`,
    },
    pathway: {
      table: 'gene_kegg_pathway',
      sql: `SELECT gkp.pathway_id AS term_id, COALESCE(p.name, gkp.pathway_id) AS name,
                gkp.wormbase_gene AS gene
         FROM gene_kegg_pathway gkp LEFT JOIN kegg_pathway p ON p.pathway_id = gkp.pathway_id`,
    },
  };
  const byTerm = new Map<string, { term_id: string; name: string; genes: Set<string> }>();
  if (kind === 'wormcat') {
    const terms = buildWormcatTerms(await query<WormcatLevelRow>(WORMCAT_LEVEL_ROWS_SQL));
    for (const [term_id, genes] of terms) byTerm.set(term_id, { term_id, name: term_id, genes });
  } else {
    const { sql, table } = SQL[kind];
    // Optional tables (KEGG, synaptogenesis) are absent from some builds.
    if (!(await hasTable(table))) return [];
    for (const r of await query<{ term_id: string; name: string; gene: string }>(sql)) {
      if (!r.term_id || !r.gene) continue;
      let e = byTerm.get(r.term_id);
      if (!e) byTerm.set(r.term_id, (e = { term_id: r.term_id, name: r.name, genes: new Set() }));
      e.genes.add(r.gene);
    }
  }
  const out: { term_id: string; name: string; genes: string[] }[] = [];
  for (const e of byTerm.values()) {
    if (e.genes.size < minSize || e.genes.size > maxSize) continue;
    out.push({ term_id: e.term_id, name: e.name, genes: [...e.genes] });
  }
  return out.sort((a, b) => b.genes.length - a.genes.length);
}

// ---- Browsable ontologies: phenotype tree, anatomy (tissue) tree, disease list ----

// One node of a lazily loaded ontology tree.
export interface OntologyNode {
  id: string;
  name: string;
  n_children: number;
  // Genes annotated directly to this term, not to its descendants.
  n_genes: number;
  // Set for anatomy children: 'part_of' when the only edge from the parent is part_of.
  rel_type?: string;
}

const PHENO_NODE_SELECT = `t.term_id AS id, t.name,
	        (SELECT COUNT(*) FROM phenotype_relations cr
	           JOIN phenotype_terms ct ON ct.term_id = cr.child_id
	           WHERE cr.parent_id = t.term_id AND COALESCE(ct.is_obsolete, 0) = 0) AS n_children,
	        (SELECT COUNT(DISTINCT gp.wormbase_gene) FROM gene_phenotype gp
	           WHERE gp.term_id = t.term_id) AS n_genes`;

export async function getPhenotypeRoots(): Promise<OntologyNode[]> {
  return query<OntologyNode>(
    `SELECT ${PHENO_NODE_SELECT}
		 FROM phenotype_terms t
		 WHERE COALESCE(t.is_obsolete, 0) = 0
		   AND NOT EXISTS (SELECT 1 FROM phenotype_relations r WHERE r.child_id = t.term_id)
		 ORDER BY t.name`,
  );
}

export async function getPhenotypeChildren(parent_id: string): Promise<OntologyNode[]> {
  return query<OntologyNode>(
    `SELECT ${PHENO_NODE_SELECT}
		 FROM phenotype_terms t
		 JOIN phenotype_relations r ON r.child_id = t.term_id
		 WHERE r.parent_id = ? AND COALESCE(t.is_obsolete, 0) = 0
		 ORDER BY t.name`,
    [parent_id],
  );
}

function likePattern(term: string): string {
  return `%${term.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function searchPhenotypeTerms(term: string, limit = 100): Promise<OntologyNode[]> {
  if (!term.trim()) return [];
  const pat = likePattern(term);
  return query<OntologyNode>(
    `SELECT ${PHENO_NODE_SELECT}
		 FROM phenotype_terms t
		 WHERE COALESCE(t.is_obsolete, 0) = 0
		   AND (t.name LIKE ? ESCAPE '\\'
		        OR EXISTS (SELECT 1 FROM phenotype_synonyms s
		                   WHERE s.term_id = t.term_id AND s.synonym LIKE ? ESCAPE '\\'))
		 ORDER BY t.name
		 LIMIT ?`,
    [pat, pat, limit],
  );
}

const ANAT_NODE_SELECT = `t.term_id AS id, t.name,
	        (SELECT COUNT(DISTINCT cr.child_id) FROM anatomy_relations cr
	           WHERE cr.parent_id = t.term_id) AS n_children,
	        (SELECT COUNT(DISTINCT ga.wormbase_gene) FROM gene_anatomy ga
	           WHERE ga.term_id = t.term_id) AS n_genes`;

// True when the loaded DB has the anatomy hierarchy; older builds only have the flat tissue list.
export function hasAnatomyTree(): Promise<boolean> {
  return hasTable('anatomy_relations');
}

export async function getAnatomyRoots(): Promise<OntologyNode[]> {
  if (!(await hasTable('anatomy_relations'))) return [];
  return query<OntologyNode>(
    `SELECT ${ANAT_NODE_SELECT}
		 FROM anatomy_terms t
		 WHERE COALESCE(t.is_obsolete, 0) = 0
		   AND NOT EXISTS (SELECT 1 FROM anatomy_relations r WHERE r.child_id = t.term_id)
		   AND EXISTS (SELECT 1 FROM anatomy_relations r WHERE r.parent_id = t.term_id)
		 ORDER BY t.name`,
  );
}

// Children over both is_a and part_of. A child with both edge types to the same parent is listed once as is_a.
export async function getAnatomyChildren(parent_id: string): Promise<OntologyNode[]> {
  if (!(await hasTable('anatomy_relations'))) return [];
  return query<OntologyNode>(
    `SELECT ${ANAT_NODE_SELECT}, MIN(r.rel_type) AS rel_type
		 FROM anatomy_terms t
		 JOIN anatomy_relations r ON r.child_id = t.term_id
		 WHERE r.parent_id = ? AND COALESCE(t.is_obsolete, 0) = 0
		 GROUP BY t.term_id
		 ORDER BY t.name`,
    [parent_id],
  );
}

export async function searchAnatomyTerms(term: string, limit = 100): Promise<OntologyNode[]> {
  if (!term.trim()) return [];
  const pat = likePattern(term);
  const tree = await hasTable('anatomy_relations');
  const nChildren = tree
    ? `(SELECT COUNT(DISTINCT cr.child_id) FROM anatomy_relations cr WHERE cr.parent_id = t.term_id)`
    : '0';
  return query<OntologyNode>(
    `SELECT t.term_id AS id, t.name, ${nChildren} AS n_children,
		        (SELECT COUNT(DISTINCT ga.wormbase_gene) FROM gene_anatomy ga
		           WHERE ga.term_id = t.term_id) AS n_genes
		 FROM anatomy_terms t
		 WHERE COALESCE(t.is_obsolete, 0) = 0
		   AND (t.name LIKE ? ESCAPE '\\'
		        OR EXISTS (SELECT 1 FROM anatomy_synonyms s
		                   WHERE s.term_id = t.term_id AND s.synonym LIKE ? ESCAPE '\\'))
		 ORDER BY t.name
		 LIMIT ?`,
    [pat, pat, limit],
  );
}

// Flat fallback for a DB without anatomy_relations: every tissue that has genes.
export async function getAnatomyTermsWithGenes(): Promise<OntologyNode[]> {
  try {
    return await query<OntologyNode>(
      `SELECT t.term_id AS id, t.name, 0 AS n_children,
			        COUNT(DISTINCT ga.wormbase_gene) AS n_genes
			 FROM gene_anatomy ga
			 JOIN anatomy_terms t ON t.term_id = ga.term_id
			 WHERE COALESCE(t.is_obsolete, 0) = 0
			 GROUP BY t.term_id
			 ORDER BY n_genes DESC, t.name`,
    );
  } catch {
    return [];
  }
}

export interface AnatomyTermDetail {
  term_id: string;
  name: string;
  definition: string | null;
  synonyms: string[];
  n_genes: number;
}

export async function getAnatomyTermDetail(term_id: string): Promise<AnatomyTermDetail | null> {
  try {
    const rows = await query<Omit<AnatomyTermDetail, 'synonyms'>>(
      `SELECT t.term_id, t.name, t.definition,
			        (SELECT COUNT(DISTINCT wormbase_gene) FROM gene_anatomy WHERE term_id = t.term_id) AS n_genes
			 FROM anatomy_terms t
			 WHERE t.term_id = ? AND COALESCE(t.is_obsolete, 0) = 0`,
      [term_id],
    );
    if (!rows[0]) return null;
    const syn = await query<{ synonym: string }>(
      `SELECT DISTINCT synonym FROM anatomy_synonyms WHERE term_id = ? ORDER BY synonym`,
      [term_id],
    ).catch(() => []);
    return { ...rows[0], synonyms: syn.map((s) => s.synonym) };
  } catch {
    return null;
  }
}

export interface AnatomyNeighbor {
  term_id: string;
  name: string;
  rel_type: string;
  n_genes: number;
}

export async function getAnatomyNeighbors(
  term_id: string,
  direction: 'parents' | 'children',
): Promise<AnatomyNeighbor[]> {
  if (!(await hasTable('anatomy_relations'))) return [];
  const selfCol = direction === 'parents' ? 'child_id' : 'parent_id';
  const otherCol = direction === 'parents' ? 'parent_id' : 'child_id';
  return query<AnatomyNeighbor>(
    `SELECT t.term_id, t.name, MIN(r.rel_type) AS rel_type,
		        (SELECT COUNT(DISTINCT wormbase_gene) FROM gene_anatomy WHERE term_id = t.term_id) AS n_genes
		 FROM anatomy_relations r
		 JOIN anatomy_terms t ON t.term_id = r.${otherCol}
		 WHERE r.${selfCol} = ? AND COALESCE(t.is_obsolete, 0) = 0
		 GROUP BY t.term_id
		 ORDER BY t.name`,
    [term_id],
  );
}

export interface AnatomyGeneRow {
  wormbase_gene: string;
  gene_name: string | null;
  sequence_name: string | null;
  concise_description: string | null;
}

// Genes annotated directly to the term; the total is n_genes from getAnatomyTermDetail.
export async function getGenesForAnatomy(term_id: string, limit = 200): Promise<AnatomyGeneRow[]> {
  return query<AnatomyGeneRow>(
    `SELECT a.wormbase_gene, a.gene_name, a.sequence_name, a.concise_description
		 FROM (SELECT DISTINCT wormbase_gene FROM gene_anatomy WHERE term_id = ?) ga
		 JOIN annotations a ON a.wormbase_gene = ga.wormbase_gene
		 ORDER BY a.gene_name IS NULL, a.gene_name, a.wormbase_gene
		 LIMIT ?`,
    [term_id, limit],
  );
}

export interface DiseaseSummary {
  do_id: string;
  do_name: string;
  n_genes: number;
}

export async function getDiseaseList(): Promise<DiseaseSummary[]> {
  return query<DiseaseSummary>(
    `SELECT do_id, do_name, COUNT(DISTINCT wormbase_gene) AS n_genes
		 FROM gene_disease
		 GROUP BY do_id, do_name
		 ORDER BY n_genes DESC, do_name`,
  );
}
