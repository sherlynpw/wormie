// Installing the OPFS-SAH pool while another worker still holds its access
// handles fails on every file, and sqlite logs each failure. The previous
// page's worker (on a reload or a typed URL) and the one-shot import worker
// both release their handles asynchronously after they end, so the install
// waits until every pool file opens quietly, then retries as a backstop.

async function poolFiles(poolName: string): Promise<FileSystemFileHandle[]> {
  const files: FileSystemFileHandle[] = [];
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('.' + poolName);
    // sqlite keeps the pool files under an opaque subdirectory.
    const collect = async (d: FileSystemDirectoryHandle, depth: number) => {
      for await (const [, h] of d as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (h.kind === 'file') files.push(h as FileSystemFileHandle);
        else if (depth > 0) await collect(h as FileSystemDirectoryHandle, depth - 1);
      }
    };
    await collect(dir, 2);
  } catch {
    /* no pool yet */
  }
  return files;
}

// Handles are released one file at a time, so every file has to open.
async function tryOpenAll(files: FileSystemFileHandle[]): Promise<boolean> {
  try {
    for (const f of files) (await f.createSyncAccessHandle()).close();
    return true;
  } catch (err) {
    if (isLockError(err)) return false;
    throw err;
  }
}

/** True while another worker holds the pool's access handles. */
export async function poolLocked(poolName: string): Promise<boolean> {
  const files = await poolFiles(poolName);
  if (files.length === 0) return false;
  try {
    return !(await tryOpenAll(files));
  } catch {
    return false;
  }
}

/** Resolves true once every pool file opens, false if they stay locked for maxMs. */
export async function poolFreeWithin(poolName: string, maxMs: number): Promise<boolean> {
  const files = await poolFiles(poolName);
  if (files.length === 0) return true;
  const t0 = Date.now();
  for (;;) {
    try {
      if (await tryOpenAll(files)) return true;
    } catch {
      return true;
    }
    if (Date.now() - t0 > maxMs) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

export function isLockError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /NoModificationAllowed|Access Handle/i.test(msg);
}

export async function installPool(
  sqlite3: any,
  poolName: string,
  who: string,
  { waitMs = 10_000, attempts = 5, delayMs = 200 } = {},
): Promise<any> {
  const t0 = Date.now();
  await poolFreeWithin(poolName, waitMs);
  for (let i = 1; ; i++) {
    try {
      const util = await sqlite3.installOpfsSAHPoolVfs({ name: poolName });
      // sqlite-wasm hands back the same util for a name already installed, still
      // paused if a caller paused it to let the import worker take the lock.
      if (util.isPaused?.()) await util.unpauseVfs();
      return util;
    } catch (err) {
      if (i >= attempts || !isLockError(err)) throw err;
      console.warn(`[opfs-pool] ${who}: pool still locked after ${Date.now() - t0}ms, retry ${i}`);
      await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
}
