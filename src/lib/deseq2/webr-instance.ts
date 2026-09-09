// The WebR runtime is mirrored into R2 by scripts/wasm-build/sync-webr-runtime.sh
// and served same-origin, so nothing here reaches webr.r-wasm.org at runtime.
// Same-origin also lets the service worker cache it, which is what makes /de
// and /counts work offline.
const WEBR_BASE_URL = '/wasm-cran/webr-pthread/v0.5.9/';
const WEBR_URL = `${WEBR_BASE_URL}webr.mjs`;
const BUNDLE_BASE = '/wasm-cran/';
// Fallback for bundles baked before the manifest existed; the live key is the
// manifest's bundleVersion, so a rebake invalidates OPFS on its own.
const BUNDLE_VERSION_FALLBACK = 'v2-simd';
const OPFS_DIR = 'wasm-cran-cache';
const MANIFEST_KEY = 'deseq2-bundle.manifest.json';

export interface BundlePackage {
  name: string;
  version: string;
  repo: string;
}

export interface BundleManifest {
  bundleVersion: string;
  baked: string;
  rVersion: string;
  /** Size of deseq2-bundle.data, so the UI never hardcodes a download size. */
  dataBytes?: number;
  packages: BundlePackage[];
}

let manifestCache: Promise<BundleManifest | null> | null = null;

/** Versions of the R packages baked into the deployed bundle, for Methods text. */
export function getBundleManifest(): Promise<BundleManifest | null> {
  if (!manifestCache) {
    manifestCache = (async () => {
      const dir = await opfsHandle();
      try {
        const r = await fetch(`${BUNDLE_BASE}deseq2-bundle.manifest.json`);
        if (!r.ok) throw new Error(String(r.status));
        const text = await r.text();
        const m = JSON.parse(text) as BundleManifest;
        if (!m?.bundleVersion || !Array.isArray(m.packages)) return null;
        if (dir) void opfsWriteAll(dir, MANIFEST_KEY, text);
        return m;
      } catch {
        // Offline: the cached bundle is keyed by this hash, so without the
        // stored copy the entry would be missed and a download attempted.
        if (!dir) return null;
        try {
          const blob = await opfsReadAll(dir, MANIFEST_KEY);
          if (!blob) return null;
          const m = JSON.parse(await blob.text()) as BundleManifest;
          return m?.bundleVersion && Array.isArray(m.packages) ? m : null;
        } catch {
          return null;
        }
      }
    })();
  }
  return manifestCache;
}

/** Version of a single baked package, or null when the manifest is unavailable. */
export async function getPackageVersion(name: string): Promise<string | null> {
  const m = await getBundleManifest();
  return m?.packages.find((p) => p.name === name)?.version ?? null;
}

export interface WebRInstance {
  init(): Promise<void>;
  close(): void;
  evalR(
    code: string,
    opts?: { captureStreams?: boolean; captureConditions?: boolean },
  ): Promise<RObject>;
  evalRVoid(code: string): Promise<void>;
  read(): Promise<{ type: string; data?: string }>;
  FS: {
    mkdir(path: string): Promise<void>;
    mount(
      type: 'WORKERFS' | 'IDBFS' | 'NODEFS',
      opts: { packages?: { blob: Blob; metadata: object }[] },
      path: string,
    ): Promise<void>;
    writeFile(path: string, data: Uint8Array): Promise<void>;
    readFile(path: string): Promise<Uint8Array>;
  };
}

export interface RObject {
  toJs(): Promise<{ values: unknown[] }>;
  toString(): Promise<string>;
}

type WebRCtor = new (opts: { interactive?: boolean; baseUrl?: string }) => WebRInstance;

async function opfsHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
  try {
    void navigator.storage.persist?.().catch(() => {});
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(OPFS_DIR, { create: true });
  } catch {
    return null;
  }
}

export async function clearBundleCache(): Promise<void> {
  const dir = await opfsHandle();
  if (!dir) return;
  for await (const name of (dir as unknown as { keys(): AsyncIterableIterator<string> }).keys()) {
    try {
      await dir.removeEntry(name);
    } catch {
      /* ignore */
    }
  }
  bundleCache = null;
}

async function opfsReadAll(dir: FileSystemDirectoryHandle, name: string): Promise<Blob | null> {
  try {
    const fh = await dir.getFileHandle(name);
    return await fh.getFile();
  } catch {
    return null;
  }
}

async function opfsWriteAll(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: ArrayBuffer | string,
): Promise<boolean> {
  try {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(typeof data === 'string' ? data : new Uint8Array(data));
    await w.close();
    return true;
  } catch {
    return false;
  }
}

let bundleCache: Promise<{ data: ArrayBuffer; metadata: object }> | null = null;
function loadBundle(onLine?: (s: string) => void) {
  if (!bundleCache) {
    bundleCache = (async () => {
      const log = (s: string) => onLine?.(`[cache] ${s}`);
      const manifest = await getBundleManifest();
      const version = manifest?.bundleVersion ?? BUNDLE_VERSION_FALLBACK;
      if (manifest) {
        const pkg = (n: string) => manifest.packages.find((p) => p.name === n)?.version ?? '?';
        log(
          `bundle ${version} (baked ${manifest.baked}, R ${manifest.rVersion}): ` +
            `DESeq2 ${pkg('DESeq2')}, apeglm ${pkg('apeglm')}, ashr ${pkg('ashr')}, Rsubread ${pkg('Rsubread')}`,
        );
      }
      const dataKey = `deseq2-bundle.${version}.data`;
      const metaKey = `deseq2-bundle.${version}.metadata.json`;
      const dir = await opfsHandle();

      if (dir) {
        const [cachedData, cachedMeta] = await Promise.all([
          opfsReadAll(dir, dataKey),
          opfsReadAll(dir, metaKey),
        ]);
        if (cachedData && cachedMeta && cachedData.size > 0 && cachedMeta.size > 0) {
          try {
            const [data, metaText] = await Promise.all([
              cachedData.arrayBuffer(),
              cachedMeta.text(),
            ]);
            log(`hit (${(data.byteLength / 1024 / 1024).toFixed(1)} MB from OPFS)`);
            return { data, metadata: JSON.parse(metaText) as object };
          } catch {
            // corrupted entry; fall through to refetch.
          }
        }
      }

      log('miss, downloading bundle...');
      const t0 = performance.now();
      const [d, m] = await Promise.all([
        fetch(`${BUNDLE_BASE}deseq2-bundle.data`),
        fetch(`${BUNDLE_BASE}deseq2-bundle.js.metadata`),
      ]);
      if (!d.ok || !m.ok) {
        throw new Error(`deseq2-bundle missing (data=${d.status}, meta=${m.status})`);
      }
      const dataBuf = await d.arrayBuffer();
      const metaText = await m.text();
      const metadata = JSON.parse(metaText) as object;
      log(
        `fetched ${(dataBuf.byteLength / 1024 / 1024).toFixed(1)} MB in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
      );

      if (dir) {
        const persisted = await opfsWriteAll(dir, dataKey, dataBuf);
        const persistedMeta = await opfsWriteAll(dir, metaKey, metaText);
        if (persisted && persistedMeta) log('written to OPFS for next visit');
      }

      return { data: dataBuf, metadata };
    })();
  }
  return bundleCache;
}

let webrModulePromise: Promise<{ WebR: WebRCtor }> | null = null;
function loadWebRModule() {
  if (!webrModulePromise) {
    webrModulePromise = import(/* @vite-ignore */ WEBR_URL) as Promise<{ WebR: WebRCtor }>;
  }
  return webrModulePromise;
}

export interface InstanceOptions {
  /** Surface lines from R's stdout/stderr stream. */
  onLine?: (s: string) => void;
  /** Skip library(DESeq2) preload (e.g. for instances that only do simple R ops). */
  skipLibrary?: boolean;
}

export async function createWebRInstance(opts: InstanceOptions = {}): Promise<WebRInstance> {
  opts.onLine?.('[webr] loading WebR module ...');
  const mod = await loadWebRModule();
  opts.onLine?.('[webr] starting WebR session ...');
  const webR = new mod.WebR({ interactive: false, baseUrl: WEBR_BASE_URL });
  await webR.init();

  // Stream R stdout/stderr to onLine for the worker's lifetime.
  if (opts.onLine) {
    const onLine = opts.onLine;
    void (async () => {
      for (;;) {
        try {
          const o = await webR.read();
          if ((o.type === 'stdout' || o.type === 'stderr') && o.data) onLine(`[R] ${o.data}`);
          else if (o.type === 'closed') break;
        } catch {
          break;
        }
      }
    })();
  }

  const bundle = await loadBundle(opts.onLine);
  opts.onLine?.('[webr] mounting bundle ...');
  await webR.FS.mkdir('/bundle');
  await webR.FS.mount(
    'WORKERFS',
    { packages: [{ blob: new Blob([bundle.data]), metadata: bundle.metadata }] },
    '/bundle',
  );
  await webR.evalRVoid(`.libPaths(c("/bundle/usr/lib/R/library", .libPaths()))`);

  if (!opts.skipLibrary) {
    opts.onLine?.('[webr] loading DESeq2 library (cold start 60-120s in WebR) ...');
    const t = performance.now();
    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) return;
      opts.onLine?.(
        `[webr] still loading DESeq2 ... ${((performance.now() - t) / 1000).toFixed(0)}s elapsed`,
      );
    }, 15_000);
    try {
      await webR.evalRVoid('suppressPackageStartupMessages(library(DESeq2))');
    } finally {
      alive = false;
      clearInterval(heartbeat);
    }
    opts.onLine?.(`[webr] DESeq2 loaded in ${((performance.now() - t) / 1000).toFixed(1)}s`);
  }
  return webR;
}
