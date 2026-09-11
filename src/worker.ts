/// <reference types="@cloudflare/workers-types" />
// Edge worker: serves static assets via ASSETS binding; proxies /data/* and /wasm-cran/* from R2
// (DB_BUCKET) because the gzip DB exceeds the 25 MiB per-asset limit.

export interface Env {
  DB_BUCKET: R2Bucket;
  ASSETS: Fetcher;
}

const DATA_PREFIX = '/data/';
// Mirrors the dev vite middleware (wasmCranStatic) and CI upload layout; same URL prefix in dev + prod.
const WASM_PREFIX = '/wasm-cran/';

// COOP+COEP headers enable SharedArrayBuffer (required by sqlite-wasm OPFS-SAH-Pool VFS);
// without them sqlite-wasm silently falls back to a 512 MB in-RAM store. CORP covers R2-proxied paths.
function applyIsolationHeaders(res: Response, isData: boolean): Response {
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', isData ? 'same-origin' : 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // /data/* and /wasm-cran/* both come from DB_BUCKET; key is the path minus the leading /data/ prefix (wasm-cran keeps its prefix verbatim).
    const isData = url.pathname.startsWith(DATA_PREFIX);
    const isWasm = url.pathname.startsWith(WASM_PREFIX);
    if (isData || isWasm) {
      const key = isData ? url.pathname.slice(DATA_PREFIX.length) : url.pathname.slice(1); // keep `wasm-cran/...` so R2 layout matches
      if (!key || key.includes('..')) return new Response('Bad request', { status: 400 });

      // version.json: short TTL (60 s) so clients notice new releases. DB+WASM are content-addressed, so long TTL (browser 3600 s, edge 86400 s).
      // Pointer files are small and describe a much larger object: version.json names the
      // database build, deseq2-bundle.manifest.json names the bundle and supplies the
      // bundleVersion used as the OPFS cache key. They are separate cache entries from the
      // payloads they describe, so a long edge TTL lets a rebuilt payload be served alongside
      // a stale descriptor: the client then caches new data under an old key and reports the
      // wrong package versions. Keep them short so that window is minutes, not a day.
      const isPointer = key === 'version.json' || key.endsWith('.manifest.json');
      const browserMaxAge = isPointer ? 60 : 3600;
      const edgeMaxAge = isPointer ? 60 : 86400;

      // caches.default is a Workers-runtime extension not in lib.dom's CacheStorage; cast required.
      const cache = (caches as unknown as { default: Cache }).default;
      const cached = await cache.match(request);
      if (cached) return applyIsolationHeaders(cached, true);

      const ifNoneMatch = request.headers.get('If-None-Match') ?? undefined;
      const obj = await env.DB_BUCKET.get(key, { onlyIf: { etagDoesNotMatch: ifNoneMatch } });

      const cacheControl = `public, max-age=${browserMaxAge}, s-maxage=${edgeMaxAge}, must-revalidate`;

      if (!obj) {
        // obj is null: key missing or etag matched (onlyIf conditional hit)
        const head = await env.DB_BUCKET.head(key);
        if (head) {
          const headers = new Headers();
          head.writeHttpMetadata(headers);
          headers.set('etag', head.httpEtag);
          headers.set('cache-control', cacheControl);
          return applyIsolationHeaders(new Response(null, { status: 304, headers }), true);
        }
        return applyIsolationHeaders(new Response('Not found', { status: 404 }), true);
      }

      // onlyIf returns an R2Object without a body when the conditional matches (304 path).
      if (!('body' in obj)) {
        const headers = new Headers();
        obj.writeHttpMetadata(headers);
        headers.set('etag', obj.httpEtag);
        headers.set('cache-control', cacheControl);
        return applyIsolationHeaders(new Response(null, { status: 304, headers }), true);
      }

      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      headers.set('cache-control', cacheControl);
      const response = new Response(obj.body, { headers });

      // Populate edge cache so subsequent requests in this PoP skip R2.
      ctx.waitUntil(cache.put(request, response.clone()));
      return applyIsolationHeaders(response, true);
    }

    // All other paths: served from ASSETS binding (HTML, JS, CSS, fonts, etc.)
    const assetRes = await env.ASSETS.fetch(request);
    return applyIsolationHeaders(assetRes, false);
  },
} satisfies ExportedHandler<Env>;
