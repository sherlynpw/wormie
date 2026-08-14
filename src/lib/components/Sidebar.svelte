<script lang="ts">
  let { mobile = false }: { mobile?: boolean } = $props();
  import { page } from '$app/state';
  import { db } from '$lib/stores/db.svelte';
  import { recents } from '$lib/stores/recents.svelte';
  import { getStatusCounts, type StatusCounts } from '$lib/queries';
  import { Separator } from '$lib/components/ui/separator';
  import { cn } from '$lib/utils';
  import LayoutGrid from 'lucide-svelte/icons/layout-grid';
  import Table from 'lucide-svelte/icons/table';
  import FolderTree from 'lucide-svelte/icons/folder-tree';
  import Network from 'lucide-svelte/icons/network';
  import Brain from 'lucide-svelte/icons/brain';
  import Cable from 'lucide-svelte/icons/cable';
  import FileSearch from 'lucide-svelte/icons/file-search';
  import BarChart from 'lucide-svelte/icons/bar-chart-3';
  import TrendingUp from 'lucide-svelte/icons/trending-up';
  import Sigma from 'lucide-svelte/icons/sigma';
  import Clock from 'lucide-svelte/icons/clock';
  import Star from 'lucide-svelte/icons/star';
  import { bookmarks } from '$lib/stores/bookmarks.svelte';
  import { onMount } from 'svelte';
  onMount(() => bookmarks.init());
  import GeneHover from '$lib/components/GeneHover.svelte';
  import { resolve } from '$app/paths';
  import { SvelteURL } from 'svelte/reactivity';

  let statusCounts = $state<StatusCounts | null>(null);
  $effect(() => {
    if (db.phase !== 'ready') return;
    getStatusCounts()
      .then((c) => (statusCounts = c))
      .catch(() => {});
  });

  const viewedGenes = $derived(recents.items.filter((r) => r.kind === 'gene').slice(0, 6));

  function fmt(n: number | undefined): string {
    if (n === undefined || n === null) return '';
    return n.toLocaleString();
  }

  type ViewKey = 'cards' | 'table' | 'wormcat' | 'go' | 'neuronal' | 'synaptogenesis';
  // lucide-svelte v1: legacy class component types; widened to any.

  type IconComponent = any;

  const VIEWS: { key: ViewKey; label: string; icon: IconComponent }[] = [
    { key: 'cards', label: 'Cards', icon: LayoutGrid },
    { key: 'table', label: 'Table', icon: Table },
    { key: 'wormcat', label: 'WormCat', icon: FolderTree },
    { key: 'go', label: 'GO Terms', icon: Network },
    { key: 'neuronal', label: 'Neuronal', icon: Brain },
    { key: 'synaptogenesis', label: 'Synaptogenesis', icon: Cable },
  ];

  type ToolLink = { href: string; match: string; label: string; icon: IconComponent };

  const LOOKUP: ToolLink[] = [
    { href: resolve('/lookup'), match: '/lookup', label: 'Bulk lookup', icon: FileSearch },
  ];

  const TOOL_GROUPS: { heading: string; items: ToolLink[] }[] = [
    {
      heading: 'From reads to results',
      items: [
        { href: resolve('/counts'), match: '/counts', label: 'Read counting', icon: Sigma },
        { href: resolve('/de'), match: '/de', label: 'Differential expression', icon: TrendingUp },
        {
          href: resolve('/de/diff'),
          match: '/de/diff',
          label: 'Compare contrasts',
          icon: TrendingUp,
        },
        { href: resolve('/gsea'), match: '/gsea', label: 'Preranked GSEA', icon: TrendingUp },
      ],
    },
    {
      heading: 'Analyses on a gene list',
      items: [
        {
          href: resolve('/ssgsea'),
          match: '/ssgsea',
          label: 'Single-sample GSEA',
          icon: TrendingUp,
        },
        {
          href: resolve('/enrichment'),
          match: '/enrichment',
          label: 'Over-representation',
          icon: BarChart,
        },
        { href: resolve('/gmt'), match: '/gmt', label: 'Custom gene sets', icon: TrendingUp },
        { href: resolve('/nta'), match: '/nta', label: 'Network connectivity', icon: Network },
      ],
    },
  ];

  const MANAGE: ToolLink[] = [
    { href: resolve('/datasets'), match: '/datasets', label: 'Datasets', icon: FolderTree },
  ];

  const STATUSES = [
    { key: 'live', label: 'Live' },
    { key: 'dead', label: 'Dead' },
    { key: 'all', label: 'All' },
  ] as const;

  const currentView = $derived((page.url.searchParams.get('view') ?? 'cards') as ViewKey);
  // Default 'live' hides dead genes; ?status=all opts in.
  const currentStatus = $derived(page.url.searchParams.get('status') ?? 'live');
  // View tabs only active on /; tool pages (/gsea etc.) must not highlight them.
  const onHome = $derived(page.url.pathname === '/');

  // Allowlist of params the home page uses; others (ids, gz, ...) are stripped when navigating to /.
  const HOME_PARAMS = new Set(['q', 'fields', 'view', 'status', 'page']);

  function buildUrl(params: Record<string, string>): string {
    const url = new SvelteURL(page.url);
    // Drop non-home params so tool-page state (ids/gz from /enrichment, /compare, etc.) doesn't leak.
    const stale: string[] = [];
    for (const k of url.searchParams.keys()) {
      if (!HOME_PARAMS.has(k)) stale.push(k);
    }
    for (const k of stale) url.searchParams.delete(k);
    url.pathname = '/';
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    }
    return url.pathname + url.search;
  }
</script>

<aside
  class={mobile
    ? 'flex h-full min-h-0 w-full flex-col overflow-y-auto px-3 py-4'
    : 'sticky top-12 hidden h-[calc(100vh-3rem)] w-56 shrink-0 flex-col self-start overflow-y-auto border-r bg-card px-3 py-4 md:flex'}
>
  <div class="mb-4">
    <div
      class="mb-1.5 px-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
    >
      View
    </div>
    <nav class="flex flex-col gap-0.5">
      {#each VIEWS as v (v.key)}
        {@const active = onHome && currentView === v.key}
        {@const Icon = v.icon}
        <a
          href={resolve(buildUrl({ view: v.key }) as '/')}
          class={cn(
            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
            active
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <Icon class="h-4 w-4" />
          {v.label}
        </a>
      {/each}
    </nav>
  </div>

  <Separator />

  <div class="my-4">
    <div
      class="mb-1.5 px-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
    >
      Tools
    </div>
    <nav class="flex flex-col gap-0.5">
      {#each LOOKUP as t (t.match)}
        {@const Icon = t.icon}
        <a
          href={t.href}
          class={cn(
            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
            page.url.pathname === t.match
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <Icon class="h-4 w-4" />
          {t.label}
        </a>
      {/each}
    </nav>

    {#each TOOL_GROUPS as g (g.heading)}
      <div
        class="mb-1 mt-3 px-2 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground/70"
      >
        {g.heading}
      </div>
      <nav class="flex flex-col gap-0.5">
        {#each g.items as t (t.match)}
          {@const Icon = t.icon}
          <a
            href={t.href}
            class={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
              page.url.pathname === t.match
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <Icon class="h-4 w-4" />
            {t.label}
          </a>
        {/each}
      </nav>
    {/each}

    <nav class="mt-3 flex flex-col gap-0.5">
      {#each MANAGE as t (t.match)}
        {@const Icon = t.icon}
        <a
          href={t.href}
          class={cn(
            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
            page.url.pathname === t.match
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <Icon class="h-4 w-4" />
          {t.label}
        </a>
      {/each}
      <a
        href={resolve('/bookmarks')}
        class={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
          page.url.pathname === '/bookmarks'
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        )}
      >
        <Star class="h-4 w-4" />
        Bookmarks
        {#if bookmarks.initialized && bookmarks.count() > 0}
          <span class="ml-auto font-mono text-[0.65rem] tabular-nums text-muted-foreground">
            {bookmarks.count()}
          </span>
        {/if}
      </a>
    </nav>
  </div>

  <Separator />

  <div class="my-4">
    <div
      class="mb-1.5 px-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
    >
      Status
    </div>
    <nav class="flex flex-col gap-0.5">
      {#each STATUSES as s (s.key)}
        {@const active = onHome && currentStatus === s.key}
        {@const count =
          s.key === 'live'
            ? statusCounts?.live
            : s.key === 'dead'
              ? statusCounts?.dead
              : statusCounts?.all}
        <a
          href={resolve(buildUrl({ status: s.key }) as '/')}
          class={cn(
            'flex items-baseline justify-between gap-2 rounded-md px-2 py-1 text-sm transition-colors',
            active
              ? 'bg-accent/40 font-medium text-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <span>{s.label}</span>
          <span class="font-mono text-[0.65rem] tabular-nums text-muted-foreground"
            >{fmt(count)}</span
          >
        </a>
      {/each}
    </nav>
  </div>

  {#if viewedGenes.length > 0}
    <Separator />
    <div class="my-4">
      <div
        class="mb-1.5 flex items-center gap-1.5 px-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        <Clock class="h-3 w-3" />
        Recently viewed
      </div>
      <nav class="flex flex-col gap-0.5">
        {#each viewedGenes as r (r.value)}
          <GeneHover id={r.value}>
            <a
              href={resolve(`/gene/${r.value}`)}
              class={cn(
                'block truncate rounded-md px-2 py-1 text-sm transition-colors',
                page.url.pathname === `/gene/${r.value}`
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
              title={r.label}
            >
              {r.label}
            </a>
          </GeneHover>
        {/each}
      </nav>
    </div>
  {/if}

  {#if db.phase === 'ready'}
    <div class="mt-auto pt-4">
      <Separator class="mb-3" />
      <div
        class="mb-1.5 px-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Database
      </div>
      <dl class="mb-2 space-y-0.5 px-2 font-mono text-xs text-muted-foreground">
        <div class="flex justify-between">
          <dt>Genes</dt>
          <dd>{db.totalGenes.toLocaleString()}</dd>
        </div>
        <div class="flex justify-between">
          <dt>GO terms</dt>
          <dd>{db.totalGO.toLocaleString()}</dd>
        </div>
        <div class="flex justify-between">
          <dt>WormCat</dt>
          <dd>{db.totalWormCat.toLocaleString()}</dd>
        </div>
        <div class="flex justify-between">
          <dt>Neuronal</dt>
          <dd>{db.totalNeuronal.toLocaleString()}</dd>
        </div>
        {#if db.version}
          <div class="flex justify-between gap-2">
            <dt>Build</dt>
            <dd class="truncate" title={db.version}>{db.version}</dd>
          </div>
        {/if}
      </dl>
      {#if db.updateAvailable}
        <div class="mb-2 rounded border border-dashed px-2 py-1.5 text-[0.65rem] leading-snug">
          <div class="text-muted-foreground">
            A newer database build is available ({db.updateAvailable}). You are on
            {db.version} so results stay comparable.
          </div>
          <button
            type="button"
            onclick={() => db.adoptLatest()}
            class="mt-1 rounded border px-1.5 py-0.5 transition-colors hover:bg-accent"
          >
            Update and reload
          </button>
        </div>
      {:else if db.pinExpired}
        <div class="mb-2 rounded border border-dashed px-2 py-1.5 text-[0.65rem] leading-snug">
          <div class="text-muted-foreground">
            Build {db.pinExpired} is no longer available offline, so {db.version} was loaded.
          </div>
          <button
            type="button"
            onclick={() => db.dismissPinExpired()}
            class="mt-1 rounded border px-1.5 py-0.5 transition-colors hover:bg-accent"
          >
            Dismiss
          </button>
        </div>
      {/if}
      <a
        href={resolve('/about')}
        class={cn(
          'block rounded px-2 py-1 text-xs transition-colors',
          page.url.pathname === '/about'
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        )}
      >
        Data sources &amp; credits →
      </a>
      <a
        href={resolve('/changelog')}
        class={cn(
          'block rounded px-2 py-1 text-xs transition-colors',
          page.url.pathname === '/changelog'
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        )}
      >
        Changelog →
      </a>
    </div>
  {/if}
</aside>
