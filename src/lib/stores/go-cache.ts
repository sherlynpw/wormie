import { getGoTransitiveGeneCount } from '$lib/queries';

const CACHE_MAX = 500;
const cache = new Map<string, Promise<number>>();

export function preloadTransitiveCount(go_id: string): Promise<number> {
  const existing = cache.get(go_id);
  if (existing) {
    cache.delete(go_id);
    cache.set(go_id, existing);
    return existing;
  }
  const p = getGoTransitiveGeneCount(go_id);
  cache.set(go_id, p);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return p;
}
