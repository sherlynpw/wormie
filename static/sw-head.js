// Loaded into the generated service worker (vite.config.ts, workbox.importScripts).
// WebR's lazy files ask for their size with a HEAD request, and Workbox only
// serves GET from its runtime cache, so offline the R session aborted on the
// first such file. Answer a HEAD from the cached GET when the network fails.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'HEAD' || !new URL(req.url).pathname.startsWith('/wasm-cran/')) return;
  event.respondWith(
    (async () => {
      try {
        const live = await fetch(req);
        if (live.ok) return live;
      } catch {
        /* offline; fall through to the cache */
      }
      const cached = await caches.match(new Request(req.url, { method: 'GET' }));
      if (cached) return new Response(null, { status: 200, headers: cached.headers });
      return new Response(null, { status: 504 });
    })(),
  );
});
