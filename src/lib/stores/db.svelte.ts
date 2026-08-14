import { initDb, query } from '$lib/db/client';

type Phase = 'idle' | 'loading' | 'ready' | 'error';

const PIN_KEY = 'wormie:db-version';

function readPin(): string | null {
  try {
    return localStorage.getItem(PIN_KEY);
  } catch {
    return null;
  }
}

function writePin(v: string): void {
  try {
    localStorage.setItem(PIN_KEY, v);
  } catch {
    /* private mode: fall through to always-latest */
  }
}

// Each deploy overwrites the single R2 artifact, so an older build survives only
// as the service worker's cache entry. Without this check the request would be
// served the newest bytes under the old label.
async function pinnedBuildCached(url: string): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    return !!(await caches.match(url));
  } catch {
    return false;
  }
}

class DbStore {
  phase = $state<Phase>('idle');
  status = $state<string>('Starting up...');
  progress = $state<number>(0); // bytes decompressed
  error = $state<string>('');
  totalGenes = $state<number>(0);
  totalGO = $state<number>(0);
  totalWormCat = $state<number>(0);
  totalNeuronal = $state<number>(0);
  /** Build actually loaded. */
  version = $state<string>('');
  /** Newest published build, when it differs from the one loaded. */
  updateAvailable = $state<string>('');
  /** Set when a pinned build could not be confirmed and the newest was loaded. */
  pinExpired = $state<string>('');

  /** Adopt the newest published build and reload; the worker holds the old one open. */
  adoptLatest(): void {
    if (!this.updateAvailable) return;
    writePin(this.updateAvailable);
    location.reload();
  }

  dismissPinExpired(): void {
    this.pinExpired = '';
  }

  async ensure(dbUrl: string, fallbackVersion: string): Promise<void> {
    if (this.phase === 'ready') return;
    if (this.phase === 'loading') return; // dedup: init promise is memoized in client
    this.phase = 'loading';

    // Best-effort storage persistence (iOS only grants this to installed PWAs).
    void navigator.storage?.persist?.().catch(() => {});

    // Resolve live DB version from /data/version.json so pipeline rebuilds
    // trigger a worker-side refetch without code changes.
    let latest = fallbackVersion;
    try {
      const res = await fetch('/data/version.json', { cache: 'no-store' });
      if (res.ok) {
        const v = (await res.json()) as { version?: string };
        if (v?.version) latest = v.version;
      }
    } catch {
      // noop: fall back to the hardcoded version
    }

    // Stay on the loaded build so an analysis in progress isn't re-based; the
    // newer one is offered instead of applied.
    let version = latest;
    const pinned = readPin();
    if (pinned && pinned !== latest) {
      if (await pinnedBuildCached(`${dbUrl}?v=${encodeURIComponent(pinned)}`)) {
        version = pinned;
        this.updateAvailable = latest;
      } else {
        // The probe only sees the service worker cache; the durable copy lives in
        // OPFS keyed by version. A cache eviction is therefore not proof the build
        // is gone, so the pin is left in place to recover on a later load.
        this.pinExpired = pinned;
      }
    } else if (!pinned) {
      writePin(latest);
    }
    this.version = version;

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
