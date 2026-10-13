// Thin wrapper that delegates enrichment to the SQLite worker.
// Math + SQL + caching all run there; main thread only marshals the call.
import type { EnrichmentKind } from '$lib/db/client';
import { KEGG_ENABLED } from '$lib/config';

export { runEnrichment, type EnrichmentKind, type EnrichmentResult } from '$lib/db/client';

export const ALL_ENRICHMENT_KINDS: { key: EnrichmentKind; label: string }[] = [
  { key: 'go', label: 'Gene Ontology' },
  { key: 'phenotype', label: 'Phenotypes' },
  { key: 'disease', label: 'Diseases' },
  { key: 'wormcat', label: 'WormCat' },
  { key: 'neuronal', label: 'Neuronal class' },
  { key: 'tissue', label: 'Tissues' },
  { key: 'cell-type', label: 'Neurons (CeNGEN)' },
  { key: 'synaptogenesis', label: 'Synaptogenesis' },
  { key: 'pathway', label: 'KEGG' },
];

// KEGG excluded from the build drops the pathway category (license).
export const ENRICHMENT_KINDS = ALL_ENRICHMENT_KINDS.filter(
  (k) => KEGG_ENABLED || k.key !== 'pathway',
);
