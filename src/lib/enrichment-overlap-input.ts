// Enrichment overlap slot input: either a finished enrichment result table or a plain
// gene list, which is resolved and run through over-representation here.

import { parseClusterProfilerCsv } from '$lib/import-enrichment';
import { parseGeneList } from '$lib/gene-parse';
import { bulkLookup } from '$lib/queries';
import { runEnrichment, type EnrichmentKind, type EnrichmentResult } from '$lib/enrichment';

export type SlotSource =
  | {
      kind: 'table';
      rows: EnrichmentResult[];
      total: number;
      // Rows per annotation kind, so a table holding a different kind can say so.
      byKind: Partial<Record<EnrichmentKind, number>>;
    }
  | {
      kind: 'genes';
      rows: EnrichmentResult[];
      total: number;
      nGenes: number;
      misses: string[];
    };

const TABLE_HEADERS = new Set([
  'id',
  'term',
  'term_id',
  'description',
  'p.adjust',
  'padj',
  'qvalue',
  'generatio',
]);

// A result table has a recognizable header row; a gene list is bare identifiers.
export function looksLikeResultsTable(text: string): boolean {
  const first = text.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#'));
  if (!first || !/[\t,]/.test(first)) return false;
  return first
    .replace(/\uFEFF/g, '')
    .split(/[\t,]/)
    .some((c) =>
      TABLE_HEADERS.has(
        c
          .trim()
          .replace(/^"+|"+$/g, '')
          .toLowerCase(),
      ),
    );
}

export function parseTableSlot(text: string, kind: EnrichmentKind): SlotSource {
  const { results } = parseClusterProfilerCsv(text);
  const rows = results[kind] ?? [];
  const byKind: Partial<Record<EnrichmentKind, number>> = {};
  for (const [k, v] of Object.entries(results))
    if (v?.length) byKind[k as EnrichmentKind] = v.length;
  return { kind: 'table', rows, total: rows.length, byKind };
}

// Genome-wide background, same defaults as the Over-representation page, so a list run here
// gives the same table it would there. Overlap genes come back as gene names to match tables.
export async function runGeneListSlot(text: string, kind: EnrichmentKind): Promise<SlotSource> {
  const tokens = parseGeneList(text);
  const { hits, misses } = await bulkLookup(tokens);
  const ids = [...new Set(hits.map((h) => h.wormbase_gene))];
  if (ids.length < 2) {
    throw new Error(
      `Only ${ids.length} gene${ids.length === 1 ? '' : 's'} recognized; over-representation needs at least 2.`,
    );
  }
  const names = new Map(hits.map((h) => [h.wormbase_gene, h.gene_name ?? h.wormbase_gene]));
  const { results } = await runEnrichment(ids, kind, { minK: 2, maxQ: 1 });
  const rows = results.map((r) => ({ ...r, overlap: r.overlap.map((g) => names.get(g) ?? g) }));
  return { kind: 'genes', rows, total: rows.length, nGenes: ids.length, misses };
}
