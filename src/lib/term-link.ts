// Maps a term to its in-app detail URL. Returns null for kinds without
// per-term routes (wormcat, neuronal). A synapse panel class opens the
// panel view filtered to that class.

export type TermKind =
  | 'go'
  | 'phenotype'
  | 'wormcat'
  | 'neuronal'
  | 'tissue'
  | 'disease'
  | 'domain'
  | 'cell-type'
  | 'synaptogenesis'
  | 'pathway';

export function termHref(kind: TermKind, termId: string): string | null {
  if (kind === 'go') return `/go/${termId}`;
  if (kind === 'phenotype') return `/phenotype/${termId}`;
  if (kind === 'tissue') return `/tissue/${termId}`;
  if (kind === 'disease') return `/disease/${termId}`;
  if (kind === 'domain') return `/?q=${encodeURIComponent(`domain:${termId}`)}`;
  if (kind === 'cell-type') return `/cell-type/${encodeURIComponent(termId)}`;
  if (kind === 'synaptogenesis') return `/?view=synaptogenesis&q=${encodeURIComponent(termId)}`;
  if (kind === 'pathway') {
    // Strip "path:" prefix for human-friendly URLs; the route accepts both forms.
    const id = termId.replace(/^path:/, '');
    return `/pathway/${id}`;
  }
  return null;
}
