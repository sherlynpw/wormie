import { initDb, query } from '$lib/db/client';

type Phase = 'idle' | 'loading' | 'ready' | 'error';

class DbStore {
  phase = $state<Phase>('idle');
  status = $state<string>('Starting up...');
  progress = $state<number>(0); // bytes decompressed
  error = $state<string>('');
  totalGenes = $state<number>(0);
  totalGO = $state<number>(0);
  totalWormCat = $state<number>(0);
  totalNeuronal = $state<number>(0);

  async ensure(dbUrl: string, fallbackVersion: string): Promise<void> {
    if (this.phase === 'ready') return;
    if (this.phase === 'loading') return; // dedup: init promise is memoized in client
    this.phase = 'loading';

    // Best-effort storage persistence (iOS only grants this to installed PWAs).
    void navigator.storage?.persist?.().catch(() => {});

    // Resolve live DB version from /data/version.json so pipeline rebuilds
    // trigger a worker-side refetch without code changes.
    let version = fallbackVersion;
    try {
      const res = await fetch('/data/version.json', { cache: 'no-store' });
      if (res.ok) {
        const v = (await res.json()) as { version?: string };
        if (v?.version) version = v.version;
      }
    } catch {
      // noop: fall back to the hardcoded version
    }

    // Cache-bust via version query param: avoids stale bytes after a pipeline
    // rebuild given the long edge TTL set in src/worker.ts.
    const versionedUrl = `${dbUrl}?v=${encodeURIComponent(version)}`;
    try {
      await initDb({
        dbUrl: versionedUrl,
        version,
        onStatus: (m) => (this.status = m),
        onProgress: (r) => (this.progress = r),
      });
      const stats = await query<{
        n_genes: number;
        n_go: number;
        n_wc: number;
        n_neu: number;
      }>(
        `SELECT
					(SELECT COUNT(*) FROM annotations)  AS n_genes,
					(SELECT COUNT(*) FROM go_terms WHERE is_obsolete=0) AS n_go,
					(SELECT COUNT(*) FROM wormcat)      AS n_wc,
					(SELECT COUNT(*) FROM neuronal)     AS n_neu`,
      );
      this.totalGenes = stats[0].n_genes;
      this.totalGO = stats[0].n_go;
      this.totalWormCat = stats[0].n_wc;
      this.totalNeuronal = stats[0].n_neu;
      this.phase = 'ready';
    } catch (e) {
      console.error('[db] init failed:', e);
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      this.error = offline
        ? "You're offline and the database isn't fully cached on this device yet. Reconnect once to finish caching, then it works offline."
        : e instanceof Error
          ? e.message
          : String(e);
      this.phase = 'error';
    }
  }
}

export const db = new DbStore();
