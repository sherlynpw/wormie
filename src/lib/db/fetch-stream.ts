// Shared fetch+decompress streaming primitive for the main DB worker (in-memory
// fallback) and import worker (OPFS-SAH-Pool chunked importDb).
// Auto-detects gzip or zstd via magic bytes: in dev Vite/browser may transparently
// decompress (Content-Encoding: gzip), but in prod (Cloudflare Workers + R2)
// the file is served as-is and we decompress here. DecompressionStream has no
// zstd, so zstd goes through fzstd.

import { Decompress } from 'fzstd';

export type DbCompression = 'gzip' | 'zstd' | 'none';

export interface DbReader {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  totalCompressed: number; // Content-Length of compressed body; 0 if absent
  compression: DbCompression; // what was detected and decoded
}

const ZSTD_URL = '.sqlite.zst';
const GZIP_URL = '.sqlite.gz';

// fzstd emits freshly allocated blocks (it copies them into its own window), so
// they are safe to enqueue without a defensive copy.
function zstdTransform(): TransformStream<Uint8Array, Uint8Array> {
  let dec: Decompress;
  return new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      dec = new Decompress((chunk) => {
        if (chunk.length) controller.enqueue(chunk);
      });
    },
    transform(chunk) {
      dec.push(chunk);
    },
    flush() {
      dec.push(new Uint8Array(0), true);
    },
  });
}

async function tryFetch(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${url} failed: ${res.status}`);
  // A static host with an SPA fallback answers a missing file with index.html and 200.
  if ((res.headers.get('content-type') ?? '').startsWith('text/html')) {
    throw new Error(`Fetch ${url} returned HTML`);
  }
  return res;
}

async function fetchDb(url: string): Promise<Response> {
  try {
    return await tryFetch(url);
  } catch (err) {
    // A client can hold a version.json that advertises the zstd copy before the
    // file is reachable (partial deploy, gz-only cache); the gzip sibling always exists.
    if (!url.includes(ZSTD_URL)) throw err;
    return await tryFetch(url.replace(ZSTD_URL, GZIP_URL));
  }
}

// `onCompressed` fires per network chunk with cumulative raw (pre-decompress) bytes.
export async function openDbReader(
  url: string,
  onCompressed?: (received: number) => void,
): Promise<DbReader> {
  const res = await fetchDb(url);
  const totalCompressed = Number(res.headers.get('content-length')) || 0;

  const baseReader = res.body!.getReader();
  const firstChunk = await baseReader.read();
  if (firstChunk.done || !firstChunk.value) throw new Error('Empty response body');

  const head = firstChunk.value;
  const compression: DbCompression =
    head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b
      ? 'gzip'
      : head.length >= 4 &&
          head[0] === 0x28 &&
          head[1] === 0xb5 &&
          head[2] === 0x2f &&
          head[3] === 0xfd
        ? 'zstd'
        : 'none';

  let rawReceived = firstChunk.value.length;
  onCompressed?.(rawReceived);
  const rebuilt = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(firstChunk.value);
      while (true) {
        const { done, value } = await baseReader.read();
        if (done) break;
        if (value) {
          rawReceived += value.length;
          onCompressed?.(rawReceived);
          controller.enqueue(value);
        }
      }
      controller.close();
    },
  });

  const stream =
    compression === 'gzip'
      ? rebuilt.pipeThrough(
          new DecompressionStream('gzip') as unknown as ReadableWritablePair<
            Uint8Array,
            Uint8Array
          >,
        )
      : compression === 'zstd'
        ? rebuilt.pipeThrough(zstdTransform())
        : rebuilt;
  return { reader: stream.getReader(), totalCompressed, compression };
}

// Consume a compressed stream into a single Uint8Array (in-memory fallback path only).
// `onProgress` fires per network chunk with cumulative compressed bytes.
// Import worker uses openDbReader directly to avoid materializing the full DB.
export async function fetchAndDecompress(
  url: string,
  onProgress?: (received: number, total: number) => void,
): Promise<Uint8Array> {
  let totalCompressed = 0;
  const { reader, totalCompressed: total } = await openDbReader(url, (r) =>
    onProgress?.(r, totalCompressed),
  );
  totalCompressed = total;
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
