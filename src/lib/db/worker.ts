/// <reference lib="webworker" />
import { installPool, isLockError, poolFreeWithin, poolLocked } from './opfs-pool';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import ImportWorker from './import-worker?worker';
import {
  runEnrichmentSync,
  runCustomEnrichmentSync,
  type EnrichmentKind,
  type CustomSet as CustomEnrichmentSet,
} from './enrichment-worker';
import { runGseaSync, type GseaKind, type GseaInput, type CustomGseaSet } from './gsea-worker';
import { execAll } from './sql';
import { fetchAndDecompress } from './fetch-stream';
import {
  ANY_HOST,
  CHANNEL_NAME,
  HELLO_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  delay,
  genId,
  type ChannelMsg,
} from './proxy-channel';

// One worker per tab. First tab to acquire the OPFS-SAH-Pool VFS becomes the
// "host" (~30 MB working set); other tabs are "guests" that proxy queries over
// BroadcastChannel (~10 MB each). Guests re-elect when the host heartbeat is lost.

type InitReq = {
  id: number;
  type: 'init';
  dbUrl: string;
  version: string;
};
type QueryReq = { id: number; type: 'query'; sql: string; params?: unknown[] };
type EnrichReq = {
  id: number;
  type: 'enrichment';
  ids: string[];
  kind: EnrichmentKind;
  opts?: { minK?: number; maxQ?: number; background?: string[] };
};
type GseaReq = {
  id: number;
  type: 'gsea';
  ranked: GseaInput[];
  kind: GseaKind;
  opts?: {
    minSize?: number;
    maxSize?: number;
    weight?: number;
    nperm?: number;
    seed?: number;
    multilevel?: boolean;
    multilevelM?: number;
    multilevelMhSteps?: number;
  };
};
type CustomEnrichReq = {
  id: number;
  type: 'customEnrichment';
  ids: string[];
  sets: CustomEnrichmentSet[];
  opts?: { minK?: number; maxQ?: number };
};
type CustomGseaReq = {
  id: number;
  type: 'customGsea';
  ranked: GseaInput[];
  sets: CustomGseaSet[];
  opts?: {
    minSize?: number;
    maxSize?: number;
    weight?: number;
    nperm?: number;
    seed?: number;
    multilevel?: boolean;
    multilevelM?: number;
    multilevelMhSteps?: number;
  };
};
type CustomSsgseaReq = {
  id: number;
  type: 'customSsgsea';
  expr: { genes: string[]; samples: string[]; matrix: Float64Array };
  sets: { term_id: string; name: string; genes: string[] }[];
  opts?: { alpha?: number; normalize?: boolean; minSize?: number; maxSize?: number };
};
type Req =
  | InitReq
  | QueryReq
  | EnrichReq
  | GseaReq
  | CustomEnrichReq
  | CustomGseaReq
  | CustomSsgseaReq;

const POOL_NAME = 'wormie-pool';
const dbFileFor = (version: string) => `/wormie-${version}.sqlite`;

// --- Host/guest coordination ---------------------------------------------

const MY_ID = genId();
let mode: 'unknown' | 'host' | 'guest' = 'unknown';
let hostId: string | null = null;
let channel: BroadcastChannel | null = null;
let lastHeartbeatAt = 0; // guest: ms timestamp of most recent host heartbeat
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let guestWatchdog: ReturnType<typeof setInterval> | null = null;

// Pending forwarded requests. Resolved on 'res'; onProgress bridges channel progress events.
type Pending = {
  resolve: (data: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (phase: string, current?: number, total?: number) => void;
};
const pendingByReqId = new Map<string, Pending>();

function postChannel(m: ChannelMsg) {
  channel?.postMessage(m);
}

function onChannelMessage(e: MessageEvent<ChannelMsg>) {
  const m = e.data;
  if (!m || typeof m !== 'object') return;
  if (m.from === MY_ID) return; // ignore our own loopback (shouldn't happen, BC doesn't echo)
  switch (m.kind) {
    case 'hello':
      // Host announces itself to newcomers.
      if (mode === 'host') postChannel({ kind: 'hello-ack', from: MY_ID });
      return;
    case 'hello-ack':
      // Consumed by the election waiter (see runElection).
      hostId = m.from;
      lastHeartbeatAt = Date.now();
      return;
    case 'heartbeat':
      if (mode === 'guest') {
        // Adopt new host if it changed.
        if (hostId !== m.from) hostId = m.from;
        lastHeartbeatAt = Date.now();
      }
      return;
    case 'req':
      if (mode === 'host' && (m.to === MY_ID || m.to === ANY_HOST)) handleHostedRequest(m);
      return;
    case 'res': {
      if (m.to !== MY_ID) return;
      if (mode === 'guest' && !hostId) hostId = m.from;
      const p = pendingByReqId.get(m.reqId);
      if (!p) return;
      pendingByReqId.delete(m.reqId);
      if (m.ok) p.resolve(m.data);
      else p.reject(new Error(m.error ?? 'host error'));
      return;
    }
    case 'progress': {
      if (m.to !== MY_ID) return;
      const p = pendingByReqId.get(m.reqId);
      p?.onProgress?.(m.phase, m.current, m.total);
      return;
    }
  }
}

function startHostHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    postChannel({ kind: 'heartbeat', from: MY_ID });
  }, HEARTBEAT_INTERVAL_MS);
}

function startGuestWatchdog() {
  if (guestWatchdog) return;
  lastHeartbeatAt = Date.now();
  let checking = false;
  guestWatchdog = setInterval(() => {
    if (mode !== 'guest' || checking) return;
    if (Date.now() - lastHeartbeatAt <= HEARTBEAT_TIMEOUT_MS) return;
    checking = true;
    void (async () => {
      try {
        // A host busy with a long query cannot beat, but it still holds the pool.
        if (await poolLocked(POOL_NAME)) {
          lastHeartbeatAt = Date.now();
          return;
        }
        promoteFromGuest();
      } finally {
        checking = false;
      }
    })();
  }, HEARTBEAT_INTERVAL_MS);
}

// Host vanished: stop watchdog, reject in-flight requests (clients retry once),
// and clear init state so the next request triggers re-election.
function promoteFromGuest() {
  console.warn('[wb-db] host gone, attempting promotion');
  stopGuestWatchdog();
  hostId = null;
  mode = 'unknown';
  for (const p of pendingByReqId.values()) {
    p.reject(new Error('Host disappeared mid-request; retry'));
  }
  pendingByReqId.clear();
  dbInitPromise = null;
}

function stopGuestWatchdog() {
  if (guestWatchdog) {
    clearInterval(guestWatchdog);
    guestWatchdog = null;
  }
}

// Sends `hello`, waits HELLO_TIMEOUT_MS for `hello-ack`. Returns true if a host replied (become guest), false if we should become host.
async function runElection(): Promise<boolean> {
  hostId = null;
  postChannel({ kind: 'hello', from: MY_ID });
  await delay(HELLO_TIMEOUT_MS);
  return hostId !== null;
}

// Forwards a request to the host over BroadcastChannel; rejects on host error or disconnect.
function proxyToHost(payload: unknown, onProgress?: Pending['onProgress']): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reqId = genId();
    pendingByReqId.set(reqId, { resolve, reject, onProgress });
    postChannel({ kind: 'req', from: MY_ID, to: hostId ?? ANY_HOST, reqId, payload });
  });
}

let pool: any = null;
let db: any = null;
// Tracks the version in `db`; a different version on init triggers a teardown and reload.
let loadedVersion: string | null = null;

// Posts progress/status back to the single owning tab.
function broadcast(msg: object) {
  (self as DedicatedWorkerGlobalScope).postMessage(msg);
}

// Applied to every DB handle (OPFS or memory): 32 MB page cache + memory temp store for enrichment/GSEA throughput.
function applyRuntimePragmas(handle: any) {
  handle.exec('PRAGMA cache_size = -32000;');
  handle.exec('PRAGMA temp_store = MEMORY;');
}

async function loadIntoMemory(sqlite3: any, dbUrl: string) {
  broadcast({
    type: 'status',
    message: 'Downloading gene database (memory mode)...',
  });
  const bytes = await fetchAndDecompress(dbUrl, (received, total) => {
    broadcast({ type: 'progress', received, total });
  });
  broadcast({
    type: 'status',
    message: 'Loading into memory...',
  });

  // Validate magic header early: sqlite_deserialize failure mode is opaque (download corruption, encoding mismatch, etc.).
  const headerStr = String.fromCharCode(...bytes.slice(0, 15));
  if (headerStr !== 'SQLite format 3' || bytes[15] !== 0) {
    throw new Error(
      `Downloaded bytes are not a SQLite file. First 16 bytes: ${Array.from(bytes.slice(0, 16))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ')}`,
    );
  }

  // memdb is the only VFS where sqlite3_deserialize actually attaches the buffer.
  // With the default :memory: VFS, deserialize reports rc=0 but queries return SQLITE_CANTOPEN.
  type Ctor = () => unknown;
  const attempts: { label: string; make: Ctor }[] = [
    { label: 'memdb uri', make: () => new sqlite3.oo1.DB('file:wb?vfs=memdb', 'c') },
    { label: ':memory: + memdb', make: () => new sqlite3.oo1.DB(':memory:', 'c', 'memdb') },
  ];

  let inMem: any = null;
  let lastErr: unknown = null;
  for (const { label, make } of attempts) {
    let candidate: any = null;
    try {
      candidate = make();
      if (!candidate) continue;
      const ptr = sqlite3.wasm.allocFromTypedArray(bytes);
      if (!ptr) throw new Error(`alloc failed (${bytes.length} bytes)`);
      // sqlite3_deserialize requires BigInt for the int64 size; a plain Number silently truncates, producing an empty buffer.
      const sz = BigInt(bytes.length);
      const rc = sqlite3.capi.sqlite3_deserialize(
        candidate.pointer,
        'main',
        ptr,
        sz,
        sz,
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
      );
      if (rc !== 0) throw new Error(`sqlite3_deserialize rc=${rc}`);
      // Smoke test: non-memdb VFS reports rc=0 but errors on first real query.
      candidate.exec('SELECT name FROM sqlite_master LIMIT 1');
      void label;
      inMem = candidate;
      break;
    } catch (e) {
      lastErr = e;
      // Close broken candidate. FREEONCLOSE lets sqlite free the buffer; otherwise it may leak.
      try {
        if (candidate && typeof candidate.close === 'function') candidate.close();
      } catch {
        // ignore
      }
    }
  }
  if (!inMem) {
    throw new Error(
      'Could not open an in-memory SQLite database. ' +
        (lastErr instanceof Error ? lastErr.message : String(lastErr)),
    );
  }

  // One-time sanitation for pre-fix DB builds: NULL out WormBase placeholder strings
  // ("none available" etc.) so ORDER BY can use a cheap IS NOT NULL check instead of
  // per-row LOWER/TRIM/IN, which is the difference between ~50 ms and several seconds on 50k rows in WASM SQLite.
  try {
    inMem.exec(`
			UPDATE annotations
			SET concise_description = NULL
			WHERE concise_description IS NOT NULL
			  AND LOWER(TRIM(concise_description)) IN
			      ('none available','not available','no description available','unavailable','n/a','na');
			UPDATE annotations
			SET legacy_description = NULL
			WHERE legacy_description IS NOT NULL
			  AND LOWER(TRIM(legacy_description)) IN
			      ('none available','not available','no description available','unavailable','n/a','na');
			UPDATE annotations
			SET gene_class_description = NULL
			WHERE gene_class_description IS NOT NULL
			  AND LOWER(TRIM(gene_class_description)) IN
			      ('none available','not available','no description available','unavailable','n/a','na');
		`);
    // Older builds used automated descriptions as a fallback in concise_description.
    // Move them to legacy so curated genes sort first. Automated descriptions follow
    // stable patterns ("Is affected by...", "...based on RNA-seq studies.") covered by these LIKEs.
    inMem.exec(`
			UPDATE annotations
			SET legacy_description = COALESCE(legacy_description, concise_description),
			    concise_description = NULL
			WHERE concise_description IS NOT NULL
			  AND (
			    concise_description LIKE 'Is affected by%'
			    OR concise_description LIKE 'Is enriched in%'
			    OR concise_description LIKE 'Is predicted to%'
			    OR concise_description LIKE 'Exhibits %based on%studies%'
			    OR concise_description LIKE '%based on RNA-seq studies%'
			    OR concise_description LIKE '%based on microarray studies%'
			    OR concise_description LIKE '%based on tiling array studies%'
			    OR concise_description LIKE '%based on proteomic studies%'
			  );
		`);
  } catch (e) {
    console.warn('Description placeholder sweep failed:', e);
  }

  applyRuntimePragmas(inMem);
  return inMem;
}

function ensureChannelOpen() {
  if (channel) return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener('message', onChannelMessage);
}

async function ensureDb(dbUrl: string, version: string) {
  ensureChannelOpen();

  // If a host replies, become a guest (no local DB load needed).
  const hostFound = await runElection();
  if (hostFound) {
    mode = 'guest';
    startGuestWatchdog();
    broadcast({ type: 'status', message: 'Connected to another tab (guest mode)' });
    return;
  }

  // No reply, but a host busy with a query cannot reply either; it still holds
  // the pool, so a lock that outlasts a dying worker's release means join it.
  if (!(await poolFreeWithin(POOL_NAME, 2000))) {
    mode = 'guest';
    startGuestWatchdog();
    broadcast({ type: 'status', message: 'Connected to another tab (guest mode)' });
    return;
  }

  // No host found, attempt to become one.
  const sqlite3 = await sqlite3InitModule({
    print: (m: string) => console.log('[sqlite]', m),
    printErr: (m: string) => console.error('[sqlite]', m),
  });

  try {
    await ensureDbOpfs(sqlite3, dbUrl, version);
    mode = 'host';
    startHostHeartbeat();
    postChannel({ kind: 'hello-ack', from: MY_ID });
  } catch (err) {
    // Lost the OPFS lock to another tab: either its hello-ack had not arrived
    // yet, or it is busy with a query and cannot answer. The lock itself says
    // it is alive, so join it as a guest; the host id arrives with its reply.
    console.warn('[sqlite] OPFS path failed, retrying election:', err);
    const secondCheck =
      (await runElection()) || (isLockError(err) && (await poolLocked(POOL_NAME)));
    if (secondCheck) {
      mode = 'guest';
      startGuestWatchdog();
      broadcast({
        type: 'status',
        message: 'Connected to another tab (guest mode)',
      });
      return;
    }
    broadcast({
      type: 'status',
      message: 'Offline storage unavailable. Loading in memory...',
    });
    db = await loadIntoMemory(sqlite3, dbUrl);
    mode = 'host'; // sole tab; still serves channel for completeness
    startHostHeartbeat();
    postChannel({ kind: 'hello-ack', from: MY_ID });
  }
}

// Executes a guest-proxied request locally and replies over the channel with result/progress.
function handleHostedRequest(m: Extract<ChannelMsg, { kind: 'req' }>) {
  const reply = (ok: boolean, data?: unknown, error?: string) => {
    postChannel({
      kind: 'res',
      from: MY_ID,
      to: m.from,
      reqId: m.reqId,
      ok,
      data,
      error,
    });
  };
  const progress = (phase: string, current?: number, total?: number) => {
    postChannel({
      kind: 'progress',
      from: MY_ID,
      to: m.from,
      reqId: m.reqId,
      phase,
      current,
      total,
    });
  };
  executeRequest(m.payload as Req, progress)
    .then((data) => reply(true, data))
    .catch((err) => reply(false, undefined, err instanceof Error ? err.message : String(err)));
}

// Runs the gzip-stream OPFS import in a one-shot worker so that peak WASM heap (~512 MB)
// is reclaimed on termination rather than persisting for the tab's lifetime.
function runImportWorker(
  dbUrl: string,
  version: string,
  poolName: string,
  dbFile: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = new ImportWorker();
    let settled = false;
    const cleanup = () => {
      try {
        w.terminate();
      } catch {
        // ignore
      }
    };
    w.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'progress') {
        broadcast({ type: 'progress', received: m.received, total: m.total });
      } else if (m.type === 'status') {
        broadcast({ type: 'status', message: m.message });
      } else if (m.type === 'skipped' || m.type === 'done') {
        if (!settled) {
          settled = true;
          cleanup();
          resolve();
        }
      } else if (m.type === 'error') {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(m.message || 'import worker error'));
        }
      }
    };
    w.onerror = (e: ErrorEvent) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(e.message || 'import worker errored'));
      }
    };
    w.postMessage({ type: 'run', dbUrl, version, poolName, dbFile });
  });
}

// Returns any valid cached OPFS DB (any version), for offline fallback when the requested version is missing.
// The version is reported back so the UI can label the build it actually got.
async function openAnyCachedOpfs(sqlite3: any): Promise<{ db: any; version: string } | null> {
  try {
    if (!pool) pool = await installPool(sqlite3, POOL_NAME, 'main');
    const files = (pool.getFileNames() as string[]).filter((f) => /\/wormie-.*\.sqlite$/.test(f));
    for (const f of files) {
      try {
        const cand = new pool.OpfsSAHPoolDb(f);
        cand.exec('SELECT 1');
        const ok = execAll(
          cand,
          "SELECT name FROM sqlite_master WHERE type='table' AND name='annotations' LIMIT 1",
        );
        if (ok.length > 0) return { db: cand, version: f.replace(/^\/wormie-|\.sqlite$/g, '') };
        cand.close?.();
      } catch {
        // try the next cached file
      }
    }
  } catch {
    // pool unavailable (e.g. lock contention); caller falls back to memory
  }
  return null;
}

async function ensureDbOpfs(sqlite3: any, dbUrl: string, version: string) {
  const dbFile = dbFileFor(version);
  openedVersion = version;

  // Step 1: one-shot import worker streams gzip to OPFS (if missing), then releases the VFS.
  // Bounding peak WASM heap to the import window instead of the tab lifetime.
  try {
    await runImportWorker(dbUrl, version, POOL_NAME, dbFile);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Import failed (often offline with no versioned cache). Try any cached OPFS DB before memory fallback.
    const cached = await openAnyCachedOpfs(sqlite3);
    if (cached) {
      db = cached.db;
      openedVersion = cached.version;
      broadcast({ type: 'status', message: 'Offline: opened the cached local database.' });
      applyRuntimePragmas(db);
      return;
    }
    if (isLockError(err) || msg.includes('Failed to acquire')) throw err;
    broadcast({
      type: 'status',
      message: `Offline storage unavailable (${msg}). Loading in memory...`,
    });
    db = await loadIntoMemory(sqlite3, dbUrl);
    return;
  }

  // Step 2: install the main pool. The import worker closed its handles before
  // reporting, but a terminated worker's handles can linger for a moment, so a
  // lock error gets a few retries before the tab gives up on OPFS.
  try {
    pool = await installPool(sqlite3, POOL_NAME, 'main');
  } catch (err) {
    if (isLockError(err)) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    broadcast({
      type: 'status',
      message: `Offline storage unavailable (${msg}). Loading in memory...`,
    });
    db = await loadIntoMemory(sqlite3, dbUrl);
    return;
  }

  // Step 3: verify the file is visible in the pool. If removeVfs() didn't flush slot metadata
  // before termination, OpfsSAHPoolDb allocates a fresh empty slot, causing "no such table: annotations".
  // Re-import if missing.
  let installedFiles = pool.getFileNames() as string[];
  if (!installedFiles.includes(dbFile)) {
    console.warn(
      `[sqlite] Imported file ${dbFile} not visible after pool install (saw ${JSON.stringify(installedFiles)}). Re-importing.`,
    );
    // pauseVfs() releases SAHs without deleting the OPFS directory (removeVfs would wipe .wormie-pool/).
    try {
      pool.pauseVfs();
    } catch {
      // ignore
    }
    pool = null;
    await runImportWorker(dbUrl, version, POOL_NAME, dbFile);
    pool = await installPool(sqlite3, POOL_NAME, 'main');
    installedFiles = pool.getFileNames() as string[];
    if (!installedFiles.includes(dbFile)) {
      broadcast({
        type: 'status',
        message: 'Local database import did not persist. Falling back to memory mode...',
      });
      db = await loadIntoMemory(sqlite3, dbUrl);
      return;
    }
  }

  // Step 4: open the populated file with a smoke test (SAH-Pool errors can surface lazily;
  // also checks for the annotations table since an empty slot passes SELECT 1).
  try {
    db = new pool.OpfsSAHPoolDb(dbFile);
    db.exec('SELECT 1');
    const tableCheck = execAll(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='annotations' LIMIT 1",
    );
    if (tableCheck.length === 0) {
      throw new Error('Opened OPFS slot has no "annotations" table; slot appears empty');
    }
  } catch (err) {
    console.warn('[sqlite] Failed to open OPFS DB, clearing and falling back to memory:', err);
    try {
      pool.unlink(dbFile);
    } catch {
      // ignore
    }
    broadcast({
      type: 'status',
      message: 'Local database was unreadable. Falling back to memory mode...',
    });
    db = await loadIntoMemory(sqlite3, dbUrl);
  }

  applyRuntimePragmas(db);
}

function runQuery(sql: string, params: unknown[] = []) {
  return execAll<Record<string, unknown>>(db, sql, params);
}

// Build actually opened, which differs from the requested one when the offline
// fallback picks up a cached DB under another version.
let openedVersion = '';
let lastInit: { dbUrl: string; version: string } | null = null;

// Shared in-flight init promise; subsequent calls coalesce onto it (or resolve immediately if already loaded).
let dbInitPromise: Promise<void> | null = null;
function ensureDbOnce(dbUrl: string, version: string): Promise<void> {
  if (db && loadedVersion === version) return Promise.resolve();
  if (db && loadedVersion !== version) {
    try {
      db.close?.();
    } catch {
      // ignore
    }
    db = null;
    dbInitPromise = null;
  }
  if (!dbInitPromise) {
    dbInitPromise = ensureDb(dbUrl, version)
      .then(() => {
        loadedVersion = version;
      })
      .catch((err) => {
        dbInitPromise = null;
        throw err;
      });
  }
  return dbInitPromise;
}

// Executes a request against the local `db` (used by both host paths). Returns the data payload without the outer `id`.
type ReportFn = (phase: string, current?: number, total?: number) => void;
async function executeRequest(msg: Req, report: ReportFn): Promise<unknown> {
  if (msg.type === 'init') {
    await ensureDbOnce(msg.dbUrl, msg.version);
    return { version: openedVersion || msg.version };
  }
  if (msg.type === 'query') {
    if (!db) throw new Error('Database not initialized');
    const rows = runQuery(msg.sql, msg.params ?? []);
    return { rows };
  }
  if (msg.type === 'enrichment') {
    if (!db) throw new Error('Database not initialized');
    const t0 = self.performance?.now?.() ?? 0;
    const results = await runEnrichmentSync(db, msg.ids, msg.kind, msg.opts ?? {}, report);
    const t1 = self.performance?.now?.() ?? 0;
    return { results, elapsedMs: t1 - t0 };
  }
  if (msg.type === 'gsea') {
    if (!db) throw new Error('Database not initialized');
    const t0 = self.performance?.now?.() ?? 0;
    const results = await runGseaSync(db, msg.ranked, msg.kind, msg.opts ?? {}, report);
    const t1 = self.performance?.now?.() ?? 0;
    return { results, elapsedMs: t1 - t0 };
  }
  if (msg.type === 'customEnrichment') {
    const t0 = self.performance?.now?.() ?? 0;
    const results = runCustomEnrichmentSync(msg.ids, msg.sets, msg.opts ?? {}, report);
    const t1 = self.performance?.now?.() ?? 0;
    return { results, elapsedMs: t1 - t0 };
  }
  if (msg.type === 'customGsea') {
    const t0 = self.performance?.now?.() ?? 0;
    const results = await runGseaSync(
      db,
      msg.ranked,
      'go',
      { ...(msg.opts ?? {}), customSets: msg.sets },
      report,
    );
    const t1 = self.performance?.now?.() ?? 0;
    return { results, elapsedMs: t1 - t0 };
  }
  if (msg.type === 'customSsgsea') {
    const { runSsgseaSync } = await import('./ssgsea-worker');
    const t0 = self.performance?.now?.() ?? 0;
    const { results, sampleNames } = runSsgseaSync(msg.expr, msg.sets, msg.opts ?? {}, report);
    const t1 = self.performance?.now?.() ?? 0;
    return { results, sampleNames, elapsedMs: t1 - t0 };
  }
  throw new Error(`Unknown request type: ${(msg as { type: string }).type}`);
}

// The page is going away. The browser releases a dead worker's OPFS access
// handles asynchronously, so the next page's worker would race them on a
// reload or a typed URL; closing here hands them over before the page dies.
function releaseForUnload() {
  try {
    db?.close?.();
  } catch {
    /* already closed */
  }
  db = null;
  dbInitPromise = null;
  try {
    pool?.pauseVfs();
  } catch {
    /* handles close with the worker anyway */
  }
}

function handleMessage(msg: Req) {
  if ((msg as { type: string }).type === 'release') {
    releaseForUnload();
    return;
  }
  const ctx = self as DedicatedWorkerGlobalScope;
  const send = (data: object) => ctx.postMessage({ id: msg.id, ...data });
  const report = (phase: string, current?: number, total?: number) =>
    ctx.postMessage({ type: 'taskProgress', id: msg.id, phase, current, total });
  (async () => {
    try {
      if (msg.type === 'init') {
        // Drives election + local-or-guest setup; sets `mode` for subsequent routing.
        // Deliberately bypasses executeRequest so a guest does not proxy its own init.
        lastInit = { dbUrl: msg.dbUrl, version: msg.version };
        await ensureDbOnce(msg.dbUrl, msg.version);
        send({ ok: true, version: openedVersion || msg.version });
        return;
      }
      // After a promotion the worker has no db and no host; redo the election first.
      if (mode === 'unknown' && lastInit) await ensureDbOnce(lastInit.dbUrl, lastInit.version);
      if (mode === 'guest') {
        const data = await proxyToHost(msg, report);
        send({ ok: true, ...(data as object) });
        return;
      }
      const data = await executeRequest(msg, report);
      send({ ok: true, ...(data as object) });
    } catch (err) {
      send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
}

self.onmessage = (e: MessageEvent<Req>) => handleMessage(e.data);
