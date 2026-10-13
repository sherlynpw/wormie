// Parser for clusterProfiler-style enrichment output (CSV or TSV).
// Expected columns: ID, Description, GeneRatio, BgRatio, pvalue, p.adjust, qvalue, geneID, Count, ontology.

import type { EnrichmentKind, EnrichmentResult } from '$lib/db/client';

export interface ImportedEnrichment {
  results: Partial<Record<EnrichmentKind, EnrichmentResult[]>>;
  dropped: number;
  totalRows: number;
}

export interface DeseqExtract {
  // All rows with padj/lfc when present, so the caller can apply DE thresholds.
  rows: {
    gene: string;
    padj: number | null;
    log2fc: number | null;
    stat: number | null;
  }[];
  stats: { gene: string; score: number }[] | null;
  // Where the ranking score came from: a stat column's header, or 'signed -log10(p)'.
  statSource: string | null;
  hasPadj: boolean;
  hasLog2fc: boolean;
}

function splitRow(line: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        buf += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        buf += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',' || c === '\t') {
      out.push(buf);
      buf = '';
    } else {
      buf += c;
    }
  }
  out.push(buf);
  return out.map((s) => s.trim());
}

// Detect DESeq2/per-gene DE output: extract gene IDs and Wald stat (for /gsea handoff).
/**
 * Column signatures of single-cell marker tables (Seurat FindMarkers, scanpy
 * rank_genes_groups). Detected only so the caller can explain why they are not
 * accepted as a per-gene DE table.
 */
export function looksLikeSingleCellMarkers(text: string): boolean {
  const first = text.split(/\r?\n/).find((l) => l.trim().length > 0);
  if (!first) return false;
  const header = first.toLowerCase();
  return (
    header.includes('avg_log2fc') ||
    header.includes('avg_logfc') ||
    header.includes('p_val_adj') ||
    (header.includes('logfoldchanges') && header.includes('pvals_adj'))
  );
}

export function detectDeseqTable(text: string): DeseqExtract | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\uFEFF/g, ''))
    .filter((l) => l.trim().length > 0 && !l.startsWith('#'));
  if (lines.length < 2) return null;
  const header = splitRow(lines[0]).map((h) => h.toLowerCase().replace(/^"+|"+$/g, ''));
  // R's write.table() leaves the row-name column out of the header (edgeR topTags,
  // limma topTable), so the header is one field short of the data rows.
  if (header.length === splitRow(lines[1]).length - 1) header.unshift('');
  const idCandidates = [
    'gene_id',
    'wormbase_gene',
    'wbgene',
    'gene',
    'genes',
    'id',
    'gene_name',
    'symbol',
  ];
  let gi = -1;
  for (const cand of idCandidates) {
    gi = header.indexOf(cand);
    if (gi >= 0) break;
  }
  // First column is often the unnamed rownames column in R exports (edgeR topTags,
  // limma topTable written with write.csv).
  if (gi < 0 && (header[0] === '' || header[0] === 'x' || header[0] === 'row.names')) gi = 0;

  const firstOf = (...names: string[]) => {
    for (const n of names) {
      const ix = header.indexOf(n);
      if (ix >= 0) return ix;
    }
    return -1;
  };

  // Column synonyms across the three per-gene DE tables users paste.
  //   DESeq2/PyDESeq2  log2FoldChange / padj      / stat
  //   edgeR            logFC          / FDR       / LR or F
  //   limma            logFC          / adj.P.Val / t
  const lfcCol = firstOf('log2foldchange', 'log2fc', 'logfc');
  const padjCol = firstOf('padj', 'fdr', 'adj.p.val', 'adj.pval');
  // limma's B is a log-odds of differential expression, unsigned and not a test
  // statistic, so a table without t ranks by signed -log10(p) instead.
  const statCol = firstOf('stat', 't', 'lr', 'f');
  const pvalCol = firstOf('pvalue', 'p.value', 'p_value', 'pval');

  // Term-level output (clusterProfiler and friends) is handled by the other
  // parser; those tables carry these columns and must not be claimed here.
  const termLevel =
    header.includes('generatio') ||
    header.includes('bgratio') ||
    header.includes('description') ||
    header.includes('p.adjust');
  const looksDe =
    lfcCol >= 0 || padjCol >= 0 || header.includes('basemean') || header.includes('lfcse');
  if (gi < 0 || !looksDe || termLevel) return null;
  const rows: DeseqExtract['rows'] = [];
  const stats: { gene: string; score: number }[] = [];
  let usedPval = false;
  const num = (s: string): number | null => {
    if (s === '' || s === 'NA' || s === 'NaN' || s === 'null') return null;
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : null;
  };
  for (let i = 1; i < lines.length; i++) {
    const parts = splitRow(lines[i]).map((s) => s.replace(/^"+|"+$/g, ''));
    const g = parts[gi];
    if (!g) continue;
    const padj = padjCol >= 0 ? num(parts[padjCol]) : null;
    const log2fc = lfcCol >= 0 ? num(parts[lfcCol]) : null;
    let stat = statCol >= 0 ? num(parts[statCol]) : null;
    // edgeR's LR and F are unsigned; carry the fold-change sign so a ranked list
    // built from them still separates up from down.
    if (stat !== null && log2fc !== null && (header[statCol] === 'lr' || header[statCol] === 'f')) {
      stat = Math.abs(stat) * (log2fc < 0 ? -1 : 1);
    }
    if (stat === null && pvalCol >= 0 && log2fc !== null) {
      const p = num(parts[pvalCol]);
      if (p !== null && p > 0) {
        stat = -Math.log10(p) * (log2fc < 0 ? -1 : 1);
        usedPval = true;
      }
    }
    rows.push({ gene: g, padj, log2fc, stat });
    if (stat !== null) stats.push({ gene: g, score: stat });
  }
  return {
    rows,
    stats: stats.length > 0 ? stats : null,
    statSource:
      stats.length === 0
        ? null
        : statCol >= 0 && !usedPval
          ? header[statCol]
          : statCol >= 0
            ? `${header[statCol]}, else signed -log10(p)`
            : 'signed -log10(p)',
    hasPadj: padjCol >= 0,
    hasLog2fc: lfcCol >= 0,
  };
}

function parseRatio(s: string): { num: number; den: number } | null {
  if (!s) return null;
  const m = s.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  const den = parseInt(m[2], 10);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return { num, den };
}

const GO_NAMESPACE: Record<string, string> = {
  BP: 'biological_process',
  MF: 'molecular_function',
  CC: 'cellular_component',
};

function classifyKind(id: string, ontology: string | undefined): EnrichmentKind {
  if (id.startsWith('GO:')) return 'go';
  if (id.startsWith('WBPhenotype:') || id.startsWith('WBbt:')) return 'phenotype';
  if (ontology) {
    const o = ontology.toLowerCase();
    if (o === 'bp' || o === 'mf' || o === 'cc' || o === 'go') return 'go';
    if (o.includes('pheno')) return 'phenotype';
    if (o.includes('wormcat')) return 'wormcat';
    if (o.includes('neuro')) return 'neuronal';
  }
  // Fallback: WormCat-style IDs are often plain numbers / category strings.
  return 'wormcat';
}

const HEADER_ALIASES: Record<string, string> = {
  id: 'id',
  term: 'id',
  term_id: 'id',
  pathway: 'id',
  category: 'id',
  description: 'name',
  name: 'name',
  term_name: 'name',
  generatio: 'gene_ratio',
  gene_ratio: 'gene_ratio',
  bgratio: 'bg_ratio',
  bg_ratio: 'bg_ratio',
  pvalue: 'p',
  'p.value': 'p',
  p_value: 'p',
  pval: 'p',
  p: 'p',
  'p.adjust': 'q',
  padjust: 'q',
  p_adjust: 'q',
  padj: 'q',
  qvalue: 'q',
  q_value: 'q',
  fdr: 'q',
  q: 'q',
  geneid: 'gene_id',
  gene_id: 'gene_id',
  genes: 'gene_id',
  core_enrichment: 'gene_id',
  coreenrichment: 'gene_id',
  leadingedge: 'gene_id',
  leading_edge: 'gene_id',
  count: 'count',
  k: 'count',
  ontology: 'ontology',
  namespace: 'ontology',
  source: 'ontology',
  fold: 'fold',
  foldenrichment: 'fold',
  fold_enrichment: 'fold',
  enrichment: 'fold',
};

export function parseClusterProfilerCsv(text: string): ImportedEnrichment {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\uFEFF/g, '')) // strip BOM
    .filter((l) => l.trim().length > 0 && !l.startsWith('#'));
  if (lines.length === 0) {
    return { results: {}, dropped: 0, totalRows: 0 };
  }

  const splitDelim = (line: string) => splitRow(line);

  const headerRaw = splitDelim(lines[0]).map((h) => h.toLowerCase().replace(/^"+|"+$/g, ''));
  const header = headerRaw.map((h) => HEADER_ALIASES[h] ?? h);

  // Optional leading rowname column (clusterProfiler R writes row.names); safe to ignore if ID is downstream.
  const col = (name: string) => header.indexOf(name);

  const idCol = col('id');
  const nameCol = col('name');
  const grCol = col('gene_ratio');
  const bgCol = col('bg_ratio');
  const pCol = col('p');
  const qCol = col('q');
  const countCol = col('count');
  const ontCol = col('ontology');
  const foldCol = col('fold');
  const genesCol = col('gene_id');

  if (idCol < 0) {
    // Common mistake: pasting DESeq2 per-gene output here.
    const looksLikeDeseq =
      headerRaw.includes('gene_id') &&
      (headerRaw.includes('log2foldchange') ||
        headerRaw.includes('padj') ||
        headerRaw.includes('basemean'));
    if (looksLikeDeseq) {
      throw new Error(
        'This looks like DESeq2 per-gene output, not enrichment results. Use the /gsea page (paste mode) for ranked-list enrichment on the stat column.',
      );
    }
    throw new Error(
      'Could not detect ID column. Expected a term-level table with one of: ID, Term, term_id, pathway, category.',
    );
  }

  const buckets: Partial<Record<EnrichmentKind, EnrichmentResult[]>> = {};
  let dropped = 0;
  let total = 0;

  for (let i = 1; i < lines.length; i++) {
    total++;
    const parts = splitDelim(lines[i]).map((s) => s.replace(/^"+|"+$/g, ''));
    if (parts.length <= idCol) {
      dropped++;
      continue;
    }
    const id = parts[idCol];
    if (!id) {
      dropped++;
      continue;
    }
    const name = nameCol >= 0 ? parts[nameCol] : id;
    const ontology = ontCol >= 0 ? parts[ontCol] : undefined;
    const kind = classifyKind(id, ontology);

    const gr = grCol >= 0 ? parseRatio(parts[grCol]) : null;
    const bg = bgCol >= 0 ? parseRatio(parts[bgCol]) : null;

    // k, n, K, N from ratios when present; fallback to count column or 0.
    const k = gr ? gr.num : countCol >= 0 ? parseInt(parts[countCol], 10) || 0 : 0;
    const n = gr ? gr.den : 0;
    const K = bg ? bg.num : 0;
    const N = bg ? bg.den : 0;

    let fold = 0;
    if (foldCol >= 0) {
      const f = parseFloat(parts[foldCol]);
      if (Number.isFinite(f)) fold = f;
    }
    if (fold === 0 && n > 0 && K > 0 && N > 0) {
      fold = k / n / (K / N);
    }

    const p = pCol >= 0 ? parseFloat(parts[pCol]) : NaN;
    const q = qCol >= 0 ? parseFloat(parts[qCol]) : p;

    if (!Number.isFinite(p)) {
      dropped++;
      continue;
    }

    const namespace =
      kind === 'go' && ontology && GO_NAMESPACE[ontology.toUpperCase()]
        ? GO_NAMESPACE[ontology.toUpperCase()]
        : undefined;

    // Split gene IDs permissively (clusterProfiler uses "/", others use "," or ";").
    // Order is preserved to retain leading-edge ranking when present.
    const overlap =
      genesCol >= 0 && parts[genesCol]
        ? parts[genesCol]
            .split(/[\s/;,|]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

    const row: EnrichmentResult = {
      term_id: id,
      name: name || id,
      namespace,
      k,
      K,
      n,
      N,
      fold,
      p,
      q: Number.isFinite(q) ? q : p,
      overlap,
    };

    (buckets[kind] ??= []).push(row);
  }

  // Sort by q ascending, then p.
  for (const k of Object.keys(buckets) as EnrichmentKind[]) {
    buckets[k]!.sort((a, b) => a.q - b.q || a.p - b.p);
  }

  return { results: buckets, dropped, totalRows: total };
}
