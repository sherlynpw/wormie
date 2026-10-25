// Shared fetch+gunzip streaming primitive for the main DB worker (in-memory
// fallback) and import worker (OPFS-SAH-Pool chunked importDb).
// Auto-detects gzip via magic bytes: in dev Vite/browser may transparently
// decompress (Content-Encoding: gzip), but in prod (Cloudflare Workers + R2)
// the .gz is served as-is and we decompress here.

export interface GzipReader {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  totalCompressed: number; // Content-Length of compressed body; 0 if absent
  isGzip: boolean; // true if decompression was applied
}

// `onCompressed` fires per network chunk with cumulative raw (pre-gunzip) bytes.
export async function openGzipReader(
  url: string,
  onCompressed?: (received: number) => void,
): Promise<GzipReader> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${url} failed: ${res.status}`);
  const totalCompressed = Number(res.headers.get('content-length')) || 0;

  const baseReader = res.body!.getReader();
  const firstChunk = await baseReader.read();
  if (firstChunk.done || !firstChunk.value) throw new Error('Empty response body');

  const isGzip =
    firstChunk.value.length >= 2 && firstChunk.value[0] === 0x1f && firstChunk.value[1] === 0x8b;

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

  const stream = isGzip
    ? rebuilt.pipeThrough(
        new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
      )
    : rebuilt;
  return { reader: stream.getReader(), totalCompressed, isGzip };
}

// Consume a gzip stream into a single Uint8Array (in-memory fallback path only).
// `onProgress` fires per network chunk with cumulative compressed bytes.
// Import worker uses openGzipReader directly to avoid materializing the full DB.
export async function fetchAndDecompress(
  url: string,
  onProgress?: (received: number, total: number) => void,
): Promise<Uint8Array> {
  let totalCompressed = 0;
  const { reader, totalCompressed: total } = await openGzipReader(url, (r) =>
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
