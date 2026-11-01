/// <reference types="@cloudflare/workers-types" />
// Moves wormie.rs.ht to wormie.bio. Every path gets a permanent redirect, except
// /sw.js: an installed PWA serves pages from its precache and never sees a
// redirect, and browsers refuse a redirected service worker update, so old
// clients would stay on the old app forever. A replacement worker drops them.

const TARGET = 'https://wormie.bio';

// Skips the waiting phase because the old app only activates updates on a click.
const KILL_SWITCH_SW = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    await Promise.all(windows.map((c) => c.navigate(c.url).catch(() => {})));
  })());
});
`;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/sw.js') {
      return new Response(KILL_SWITCH_SW, {
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }
    return Response.redirect(TARGET + url.pathname + url.search, 301);
  },
} satisfies ExportedHandler;
