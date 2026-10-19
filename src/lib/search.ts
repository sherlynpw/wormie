// Query parser. One input field, three modes:
//   - gene-list mode: 2+ tokens that look like gene/WBGene IDs
//   - typed-prefix mode: tokens like "go:apoptosis", "cat:cell cycle", "status:live"
//   - free-text mode: anything else, fed to FTS5
//
// FTS5 features users can use directly:
//   - prefix wildcard: daf*
//   - exact phrase:    "insulin signaling"
//   - boolean / NEAR:  kinase AND NOT phosphatase, NEAR(insulin signaling, 5)
//
// `:` ops route through FTS (column-scoped) or table joins (go:, cat:, ...).
// `~` ops route through SQL LIKE on annotations, with * → %, ? → _.

export type OpMode = 'fts' | 'like';
export type Op = { key: OpKey; value: string; mode: OpMode };
export type OpKey =
  | 'go'
  | 'cat'
  | 'neuronal'
  | 'syn'
  | 'status'
  | 'type'
  | 'pheno'
  | 'tissue'
  | 'ortho'
  | 'allele'
  | 'name'
  | 'desc'
  | 'seq'
  | 'wb'
  | 'expressed'
  | 'pathway';
export const OP_KEYS: OpKey[] = [
  'go',
  'cat',
  'neuronal',
  'syn',
  'status',
  'type',
  'pheno',
  'tissue',
  'ortho',
  'allele',
  'name',
  'desc',
  'seq',
  'wb',
  'expressed',
  'pathway',
];

// Ops that map to FTS5 column-scoped queries on `genes_fts` rather than
// separate INTERSECT subqueries. Used by runSearch and to decide whether
// snippet() should be requested for match-reason display.
export const FTS_OP_COLUMNS: Partial<Record<OpKey, readonly FtsField[]>> = {
  pheno: ['phenotypes'],
  tissue: ['tissues'],
  ortho: ['orthologs'],
  allele: ['alleles'],
  name: ['gene_name', 'sequence_name', 'other_names'],
  desc: ['gene_class_description', 'concise_description', 'legacy_description'],
  seq: ['sequence_name'],
  pathway: ['pathways'],
};

// Keys that accept `:` syntax. `go`, `cat`, `neuronal`, `syn`, `status`, `type`,
// `wb` and `expressed` go through table subqueries rather than genes_fts.
export const FTS_OP_KEYS: OpKey[] = [
  'go',
  'cat',
  'neuronal',
  'syn',
  'status',
  'type',
  'wb',
  'pheno',
  'tissue',
  'ortho',
  'allele',
  'name',
  'desc',
  'seq',
  'expressed',
  'pathway',
];

// Keys that accept `~` (LIKE) syntax. Glob: * matches any chars, ? matches one.
export const LIKE_OP_KEYS: OpKey[] = ['name', 'seq', 'wb', 'desc'];

export type SeqItem =
  | { kind: 'free'; token: string }
  | { kind: 'op'; op: Op }
  | { kind: 'conn'; conn: 'AND' | 'OR' | 'NOT' };

export interface ParsedQuery {
  mode: 'empty' | 'genelist' | 'search';
  raw: string;
  freeText: string;
  freeTextTokens: string[];
  ops: Op[];
  ids: string[];
  // Source-ordered items for buildFtsExpression. Connectors are only emitted
  // when the user wrote a bare AND / OR / NOT between other parts; otherwise
  // adjacent parts are joined with AND (the default).
  sequence: SeqItem[];
}

const BOOL_RE = /^(AND|OR|NOT)$/i;

// Recognizes three WormBase ID shapes for gene-list mode (exact lookup via wormbase_gene/gene_name/sequence_name):
//   WBGene00001444 | flp-1, daf-16, eef-1A.1 | B0252.8, Y43F8A.1 (cosmid.n)
// Anything else falls through to FTS.
const WBGENE_RE = /^WBGene\d{8,}$/i;
const GENE_SYMBOL_RE = /^[A-Za-z]{1,5}-\d+[A-Za-z]?(?:\.\d+)?$/;
const SEQUENCE_NAME_RE = /^[A-Z]+\d+[A-Z]*\d*[A-Z]?\.\d+[a-z]?$/;

export function looksLikeGeneId(token: string): boolean {
  return WBGENE_RE.test(token) || GENE_SYMBOL_RE.test(token) || SEQUENCE_NAME_RE.test(token);
}
// Top-level split on whitespace only; comma/semicolon/pipe/slash subdivide free-text tokens later.
// Op values (e.g. expressed:AVA,AVB@medium) must stay intact, so subdivision is deferred.
const SPLIT_RE = /\s/;
const SUBSPLIT_RE = /[,;|/]+/;
const OP_PREFIX_RE = /^[a-z]+[:~]/i;

// Quote-aware tokenizer. Keeps "quoted phrases" as a single token so users can
// search for exact strings; everything else splits on whitespace only.
function tokenize(raw: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && SPLIT_RE.test(raw[i])) i++;
    if (i >= raw.length) break;
    if (raw[i] === '"') {
      const end = raw.indexOf('"', i + 1);
      if (end === -1) {
        out.push(raw.slice(i));
        break;
      }
      out.push(raw.slice(i, end + 1));
      i = end + 1;
    } else {
      let j = i;
      while (j < raw.length && !SPLIT_RE.test(raw[j])) j++;
      out.push(raw.slice(i, j));
      i = j;
    }
  }
  return out;
}

export function parseQuery(input: string): ParsedQuery {
  const raw = input.trim();
  if (!raw) {
    return { mode: 'empty', raw, freeText: '', freeTextTokens: [], ops: [], ids: [], sequence: [] };
  }

  const rawTokens = tokenize(raw);
  // Subdivide free-text on comma/semicolon/pipe/slash (e.g. "daf-2, daf-16; daf-18" -> three IDs).
  // Op tokens (key:value) and quoted phrases are kept whole.
  const tokens: string[] = [];
  for (const t of rawTokens) {
    if (OP_PREFIX_RE.test(t) || t.startsWith('"')) {
      tokens.push(t);
    } else {
      for (const sub of t.split(SUBSPLIT_RE)) {
        if (sub) tokens.push(sub);
      }
    }
  }
  const ops: Op[] = [];
  const free: string[] = [];
  const sequence: SeqItem[] = [];

  // Op syntax: key:value | key~value. ':' is FTS-scoped, '~' is LIKE.
  const opMatch = /^([a-z]+)([:~])(.+)$/i;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const m = opMatch.exec(t);
    const key = m?.[1].toLowerCase() as OpKey | undefined;
    const sep = m?.[2];
    const mode: OpMode = sep === '~' ? 'like' : 'fts';
    const validKey =
      !!m &&
      !!key &&
      ((mode === 'fts' && FTS_OP_KEYS.includes(key)) ||
        (mode === 'like' && LIKE_OP_KEYS.includes(key)));
    if (validKey) {
      let value = m![3];
      if (value.startsWith('"') && !value.endsWith('"')) {
        const buf = [value.slice(1)];
        i++;
        while (i < tokens.length) {
          const next = tokens[i];
          if (next.endsWith('"')) {
            buf.push(next.slice(0, -1));
            i++;
            break;
          }
          buf.push(next);
          i++;
        }
        value = buf.join(' ');
      } else if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
        i++;
      } else {
        i++;
      }
      const op: Op = { key: key as OpKey, value, mode };
      ops.push(op);
      sequence.push({ kind: 'op', op });
    } else if (BOOL_RE.test(t)) {
      sequence.push({ kind: 'conn', conn: t.toUpperCase() as 'AND' | 'OR' | 'NOT' });
      i++;
    } else {
      free.push(t);
      sequence.push({ kind: 'free', token: t });
      i++;
    }
  }

  // Gene-list mode: all free tokens are ID-shaped and no ops present.
  // A single ID (e.g. rab-3) is also routed here: FTS5's unicode61 tokenizer would split it
  // into `rab AND 3`, and bm25 doesn't reliably rank the actual gene first.
  const idTokens = free.filter((t) => looksLikeGeneId(t));
  const nonIdFree = free.filter((t) => !looksLikeGeneId(t));
  const singleId = free.length === 1 && looksLikeGeneId(free[0]);
  const isList =
    ops.length === 0 && idTokens.length === free.length && (idTokens.length >= 2 || singleId);
  if (isList) {
    return {
      mode: 'genelist',
      raw,
      freeText: '',
      freeTextTokens: [],
      ops: [],
      ids: idTokens,
      sequence: [],
    };
  }

  // Hybrid: IDs alongside ops or free-text. IDs become a gene-set pre-filter; ops/free-text filter
  // within that set. Without this, WBGenes would land in the FTS MATCH expression, but each FTS
  // row is one gene so ANDing multiple gene IDs always returns nothing.
  if (idTokens.length > 0 && (ops.length > 0 || nonIdFree.length > 0)) {
    // Strip ID tokens from sequence so the FTS expression builder doesn't AND them into MATCH.
    const filteredSequence = sequence.filter(
      (it) => !(it.kind === 'free' && looksLikeGeneId(it.token)),
    );
    return {
      mode: 'search',
      raw,
      freeText: nonIdFree.join(' '),
      freeTextTokens: nonIdFree,
      ops,
      ids: idTokens,
      sequence: filteredSequence,
    };
  }

  return {
    mode: 'search',
    raw,
    freeText: free.join(' '),
    freeTextTokens: free,
    ops,
    ids: [],
    sequence,
  };
}

export const ALL_FTS_FIELDS = [
  'gene_name',
  'wb_id',
  'entrez_id',
  'sequence_name',
  'other_names',
  'gene_class_description',
  'concise_description',
  'legacy_description',
  'phenotypes',
  'alleles',
  'tissues',
  'go_terms',
  'wormcat',
  'neuronal',
  'orthologs',
  'synaptogenesis',
  'pathways',
] as const;
export type FtsField = (typeof ALL_FTS_FIELDS)[number];

// Default fields: name + WBGene/Entrez IDs (pipelines emit these; paste-to-find works).
// sequence_name is off by default (toggleable) as it is a less common lookup path.
export const DEFAULT_FTS_FIELDS: readonly FtsField[] = [
  'gene_name',
  'wb_id',
  'entrez_id',
  // 'concise_description',
  // 'legacy_description'
];

// Encode one token for FTS5: "phrase" passes through, prefix* -> "prefix"*, else -> "token".
function encodeFtsToken(t: string): string {
  if (!t) return '';
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    // already a phrase; sanitize internal quotes
    return '"' + t.slice(1, -1).replace(/"/g, '') + '"';
  }
  if (t.endsWith('*') && t.length > 1) {
    const stem = t.slice(0, -1).replace(/"/g, '');
    return stem ? `"${stem}"*` : '';
  }
  return `"${t.replace(/"/g, '')}"`;
}

export function escapeFts(tokens: string[], fields?: readonly FtsField[]): string {
  const encoded = tokens.map(encodeFtsToken).filter(Boolean);
  if (encoded.length === 0) return '';
  const expr = encoded.join(' OR ');
  if (!fields || fields.length === 0 || fields.length === ALL_FTS_FIELDS.length) {
    return expr;
  }
  // No whitespace around the colon: FTS5 docs use the form {a b}:expr and
  // some parser paths reject extra spaces.
  return `{${fields.join(' ')}}:(${expr})`;
}

// Translate a user glob ("Y110A7A.*", "daf-?", "WBGene00001*") into a SQL
// LIKE pattern. Escapes SQL meta-chars, then maps * -> % and ? -> _.
// Pair with LIKE ? ESCAPE '\\' in SQL.
export function globToLike(pat: string): string {
  let out = '';
  for (const ch of pat) {
    if (ch === '%' || ch === '_' || ch === '\\') out += '\\' + ch;
    else if (ch === '*') out += '%';
    else if (ch === '?') out += '_';
    else out += ch;
  }
  return out;
}

// Build a regex for highlighting matches in rendered text.
export function highlightRegex(parsed: ParsedQuery): RegExp | null {
  // Strip wrapping quotes and trailing * from free-text tokens for the
  // highlighter, otherwise "insulin signaling" would never match.
  const cleanFree = parsed.freeTextTokens.map((t) => {
    let v = t;
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
    if (v.endsWith('*')) v = v.slice(0, -1);
    return v;
  });
  const terms = [...cleanFree, ...parsed.ops.map((o) => o.value), ...parsed.ids];
  if (terms.length === 0) return null;
  const escaped = terms
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter((t) => t.length >= 2);
  if (escaped.length === 0) return null;
  return new RegExp(`(${escaped.join('|')})`, 'gi');
}
