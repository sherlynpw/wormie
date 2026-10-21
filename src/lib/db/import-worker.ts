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
    releaseHandles(pool);
    post({ type: 'skipped' });
    return;
  }

  const stale = names.filter((f) => f.startsWith('/wormie-') && f.endsWith('.sqlite'));

  // Stale versions are reclaimed only AFTER the new one lands. Unlinking first
  // is cheaper on disk but destroys the user's working database whenever the
  // import cannot finish, which is exactly the offline case the whole OPFS
  // copy exists to serve.
  if (pool.getCapacity() - pool.getFileCount() < 1) pool.addCapacity(1);

  post({ type: 'status', message: 'Downloading gene database...' });

  try {
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
  } catch (err) {
    // A half-written slot would be indistinguishable from a good one on the
    // next boot, so drop it and leave the previous version in place.
    try {
      pool.unlink(req.dbFile);
    } catch {
      // ignore
    }
    throw err;
  }

  for (const f of stale) {
    try {
      pool.unlink(f);
    } catch {
      // ignore
    }
  }

  releaseHandles(pool);
  post({ type: 'done' });
}

// The main worker installs the same pool as soon as it hears back, and the
// browser releases a terminated worker's access handles asynchronously, so
// closing them here keeps that install from failing with
// NoModificationAllowedError and dropping the tab into memory mode. Never
// removeVfs(): that deletes the whole `.wormie-pool` directory.
function releaseHandles(pool: any) {
  try {
    pool.pauseVfs();
  } catch {
    // Handles close with the worker anyway; the parent retries the install.
  }
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
