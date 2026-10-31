// Thin wrapper that delegates enrichment to the SQLite worker.
// Math + SQL + caching all run there; main thread only marshals the call.
import type { EnrichmentKind } from '$lib/db/client';
import { KEGG_ENABLED } from '$lib/config';

export { runEnrichment, type EnrichmentKind, type EnrichmentResult } from '$lib/db/client';

export const ALL_ENRICHMENT_KINDS: { key: EnrichmentKind; label: string }[] = [
  { key: 'go', label: 'Gene Ontology' },
  { key: 'wormcat', label: 'WormCat' },
  { key: 'phenotype', label: 'Phenotypes' },
  { key: 'tissue', label: 'Tissues' },
  { key: 'disease', label: 'Human diseases' },
  { key: 'domain', label: 'Protein domains' },
  { key: 'cell-type', label: 'Neuron types' },
  { key: 'neuronal', label: 'Neuronal genes' },
  { key: 'synaptogenesis', label: 'Synaptic genes' },
  { key: 'pathway', label: 'KEGG' },
];

// KEGG excluded from the build drops the pathway category (license).
export const ENRICHMENT_KINDS = ALL_ENRICHMENT_KINDS.filter(
  (k) => KEGG_ENABLED || k.key !== 'pathway',
);
