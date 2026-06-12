// Thin wrapper that delegates enrichment to the SQLite worker.
// Math + SQL + caching all run there; main thread only marshals the call.
export { runEnrichment, type EnrichmentKind, type EnrichmentResult } from '$lib/db/client';
