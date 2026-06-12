// Build-time feature flags. `__KEGG_ENABLED__` is injected by Vite (see
// vite.config.ts) from the DISABLE_KEGG env var. When false, the bundled DB
// ships no KEGG data and all pathway UI is hidden (license: do not
// redistribute the KEGG dump). Defaults to enabled when the define is absent
// (e.g. type-checking), so typecheck/dev behave as if KEGG is on.
declare const __KEGG_ENABLED__: boolean;

export const KEGG_ENABLED: boolean =
  typeof __KEGG_ENABLED__ === 'boolean' ? __KEGG_ENABLED__ : true;
