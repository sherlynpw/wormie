// Serialize in-memory EnrichmentResult/GseaResult back to clusterProfiler-style CSV
// and wormie.rs.ht GSEA TSV for the UpSet routes. Round-tripping through text keeps the
// existing parse path unchanged (session blobs -> textarea input).

import type { EnrichmentResult } from '$lib/db/client';
import type { GseaResult } from '$lib/db/client';

// RFC 4180 CSV quoting: wrap if value contains comma, quote, or newline; double internal quotes.
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Map enrichment kinds to `ontology` column values. The overlap route doesn't filter by
// ontology so the exact label doesn't affect UpSet math; values are chosen for human readability.
function ontologyLabel(kind: string): string {
  if (kind === 'go') return 'BP';
  return kind;
}

export function enrichmentResultsToCsv(
  byKind: Partial<Record<string, EnrichmentResult[]>>,
): string {
  const header = [
    'ID',
    'Description',
    'GeneRatio',
    'BgRatio',
    'pvalue',
    'p.adjust',
    'Count',
    'ontology',
    'geneID',
  ];
  const lines: string[] = [header.join(',')];
  for (const [kind, results] of Object.entries(byKind)) {
    if (!results) continue;
    const ont = ontologyLabel(kind);
    for (const r of results) {
      lines.push(
        [
          csvCell(r.term_id),
          csvCell(r.name),
          csvCell(`${r.k}/${r.n || r.k}`),
          csvCell(`${r.K}/${r.N || r.K}`),
          csvCell(r.p.toExponential(3)),
          csvCell(r.q.toExponential(3)),
          csvCell(r.k),
          csvCell(ont),
          csvCell((r.overlap ?? []).join('/')),
        ].join(','),
      );
    }
  }
  return lines.join('\n');
}

export function gseaResultsToTsv(byKind: Partial<Record<string, GseaResult[]>>): string {
  const header = ['term_id', 'name', 'namespace', 'size', 'es', 'nes', 'p', 'q', 'leading_edge'];
  const lines: string[] = [header.join('\t')];
  for (const results of Object.values(byKind)) {
    if (!results) continue;
    for (const r of results) {
      lines.push(
        [
          r.term_id,
          r.name,
          r.namespace ?? '',
          String(r.size),
          r.es.toFixed(4),
          r.nes.toFixed(4),
          r.p.toExponential(3),
          r.q.toExponential(3),
          (r.leading_edge ?? []).join('|'),
        ].join('\t'),
      );
    }
  }
  return lines.join('\n');
}
