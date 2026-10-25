import { initDb, query } from '$lib/db/client';
import { detectSearchSchema } from '$lib/queries';

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
// An older pinned build may only be cached under the gzip name.
async function pinnedBuildCached(urls: string[]): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    for (const url of urls) {
      if (await caches.match(url)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// null means the live version could not be resolved, which must stay
// distinguishable from a real build id.
async function fetchLatestVersion(): Promise<{
  version: string;
  gzSize: number;
  zstFile: string;
  zstSize: number;
} | null> {
  try {
    const res = await fetch('/data/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const v = (await res.json()) as {
      version?: string;
      gz_size?: number;
      zst_file?: string;
      zst_size?: number;
    };
    if (!v?.version) return null;
    return {
      version: v.version,
      gzSize: typeof v.gz_size === 'number' ? v.gz_size : 0,
      zstFile: typeof v.zst_file === 'string' ? v.zst_file : '',
      zstSize: typeof v.zst_size === 'number' ? v.zst_size : 0,
    };
  } catch {
    return null;
  }
}

class DbStore {
  phase = $state<Phase>('idle');
  status = $state<string>('Starting up...');
  progress = $state<number>(0); // compressed bytes downloaded
  /** Content-Length of the download in bytes, 0 when the server sent none. */
  progressTotal = $state<number>(0);
  error = $state<string>('');
  totalGenes = $state<number>(0);
  totalGO = $state<number>(0);
  totalWormCat = $state<number>(0);
  totalNeuronal = $state<number>(0);
  /** Build actually loaded. */
  version = $state<string>('');
  /** Download size of the newest published build in bytes, 0 until version.json has been read. */
  downloadSize = $state<number>(0);
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

  /**
   * `fallbackVersion` is only a placeholder for naming the request when the live
   * version cannot be resolved; the worker corrects it from the build on disk.
   */
  async ensure(dbUrl: string, fallbackVersion: string): Promise<void> {
    if (this.phase === 'ready') return;
    if (this.phase === 'loading') return; // dedup: init promise is memoized in client
    this.phase = 'loading';

    // Best-effort storage persistence (iOS only grants this to installed PWAs).
    void navigator.storage?.persist?.().catch(() => {});

    const pinned = readPin();
    const published = await fetchLatestVersion();
    const latest = published?.version ?? null;

    // Prefer the zstd copy when published; offline, ask for it anyway because the
    // fetch layer falls back to the gzip name a gz-only cache holds.
    const zstUrl = published?.zstFile ? `/data/${published.zstFile}` : null;
    const downloadUrl = zstUrl ?? (published ? dbUrl : dbUrl.replace(/\.gz$/, '.zst'));
    this.downloadSize = zstUrl ? published!.zstSize : (published?.gzSize ?? 0);

    let version: string;
    if (latest) {
      // Stay on the loaded build so an analysis in progress isn't re-based; the
      // newer one is offered instead of applied.
      version = latest;
      if (pinned && pinned !== latest) {
        if (
          await pinnedBuildCached(
            [downloadUrl, dbUrl, dbUrl.replace(/\.gz$/, '.zst')].map(
              (u) => `${u}?v=${encodeURIComponent(pinned)}`,
            ),
          )
        ) {
          version = pinned;
          this.updateAvailable = latest;
        } else {
          // The probe only sees the service worker cache; the durable copy lives in
          // OPFS keyed by version. A cache eviction is therefore not proof the build
          // is gone, so the pin is left in place to recover on a later load.
          this.pinExpired = pinned;
        }
      }
    } else {
      // Offline, or version.json is unreachable. Keep whatever this device
      // already has: a build we could not resolve is not evidence that a newer
      // one exists, so no update is offered and no pin is written from the
      // placeholder, which would otherwise outlive the outage.
      version = pinned ?? fallbackVersion;
    }
    this.version = version;

    // Cache-bust via version query param: avoids stale bytes after a pipeline
    // rebuild given the long edge TTL set in src/worker.ts.
    const versionedUrl = `${downloadUrl}?v=${encodeURIComponent(version)}`;
    try {
      const opened = await initDb({
        dbUrl: versionedUrl,
        version,
        onStatus: (m) => (this.status = m),
        onProgress: (r, t) => {
          this.progress = r;
          this.progressTotal = t;
        },
      });
      // The worker falls back to any cached build when the requested one is
      // missing, so label what actually loaded rather than what was asked for.
      if (opened?.version) this.version = opened.version;
      await detectSearchSchema();
      if (!pinned) writePin(this.version);
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
