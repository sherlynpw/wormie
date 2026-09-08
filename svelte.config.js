import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      precompress: false,
      strict: false,
    }),
    // The service worker precaches the prerendered `/` document and serves it
    // as the SPA navigation fallback. Relative asset paths in that document
    // resolve against the requested URL, so a two-segment route like
    // /gene/<id> would request /gene/_app/... and render a blank page.
    paths: { relative: false },
    prerender: {
      handleUnseenRoutes: 'ignore',
    },
  },
};
