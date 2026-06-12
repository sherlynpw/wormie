/// <reference lib="webworker" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { openGzipReader } from './fetch-stream';

// One-shot worker: installs OPFS-SAH-Pool VFS, streams the gzipped DB into
// OPFS via the chunked-import callback (no 512 MB array materialized in JS/WASM
// memory). The parent terminates this worker after 'done', reclaiming WASM
// heap growth; the main worker then reopens the file with a fresh small heap.

type Req = { type: 'run'; dbUrl: string; version: string; poolName: string; dbFile: string };
type Msg =
  | { type: 'status'; message: string }
  | { type: 'progress'; received: number; total: number }
  | { type: 'done' }
  | { type: 'skipped' }
  | { type: 'error'; message: string };

const ctx = self as DedicatedWorkerGlobalScope;
const post = (m: Msg) => ctx.postMessage(m);

async function run(req: Req) {
  const sqlite3: any = await sqlite3InitModule({
    print: (m: string) => console.log('[sqlite-import]', m),
    printErr: (m: string) => console.error('[sqlite-import]', m),
  });

  const pool: any = await sqlite3.installOpfsSAHPoolVfs({ name: req.poolName });

  const names = pool.getFileNames() as string[];
  if (names.includes(req.dbFile)) {
    // CAUTION: do NOT call pool.removeVfs(); it deletes the entire `.wormie-pool`
    // OPFS directory. Parent termination releases SAHs at OS level; slot files
    // persist for the main worker to pick up.
    post({ type: 'skipped' });
    return;
  }

  // Stale versions occupy SAH slots; reclaim them before importing.
  for (const f of names) {
    if (f.startsWith('/wormie-') && f.endsWith('.sqlite')) {
      try {
        pool.unlink(f);
      } catch {
        // ignore
      }
    }
  }

  post({ type: 'status', message: 'Downloading gene database...' });
  const { reader, totalCompressed } = await openGzipReader(req.dbUrl);

  let received = 0;
  // importDb uses importDbChunked when passed a callback (returns Uint8Array or
  // undefined when done). Forwarding chunks one at a time keeps peak WASM growth
  // at ~64 KB per chunk rather than 512 MB.
  let chunkSeen = 0;
  await pool.importDb(req.dbFile, async () => {
    const { done, value } = await reader.read();
    if (done) return undefined;
    received += value.length;
    chunkSeen++;
    if (chunkSeen % 16 === 0) {
      post({
        type: 'progress',
        received,
        total: totalCompressed > 0 ? totalCompressed * 6 : 0,
      });
    }
    return value;
  });

  // Same caveat: no removeVfs(). Parent terminates; SAHs released at OS level,
  // slot file remains in `.wormie-pool/` for the main worker.
  post({ type: 'done' });
}

ctx.onmessage = async (e: MessageEvent<Req>) => {
  try {
    if (e.data?.type === 'run') {
      await run(e.data);
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
