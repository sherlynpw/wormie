<script lang="ts">
  import { page } from '$app/state';
  import { cn } from '$lib/utils';
  import type { Facets } from '$lib/queries';
  import { density } from '$lib/stores/density.svelte';
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { SvelteURL } from 'svelte/reactivity';

  // 'end' packs the whole bar to the right so it can sit above a panel without
  // pushing the page title down.
  let {
    facets,
    elapsedMs,
    align = 'between',
  }: { facets: Facets | null; elapsedMs: number; align?: 'between' | 'end' } = $props();
  onMount(() => density.init());

  const q = $derived(page.url.searchParams.get('q') ?? '');
  const currentView = $derived(page.url.searchParams.get('view') ?? 'cards');
  const currentStatus = $derived(page.url.searchParams.get('status') ?? 'live');
  const isGeneList = $derived(currentView === 'cards' || currentView === 'table');

  const HOME_PARAMS = new Set(['q', 'fields', 'view', 'status', 'page']);

  function urlWith(params: Record<string, string>): string {
    const url = new SvelteURL(page.url);
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

  const STATUSES = [
    { key: 'live', label: 'live' },
    { key: 'dead', label: 'dead' },
    { key: 'all', label: 'all' },
  ];
</script>

<div class={cn('flex flex-wrap items-center gap-2 text-xs', align === 'end' && 'justify-end')}>
  {#if facets}
    <span class="text-muted-foreground">{q ? 'Found' : 'Showing'}</span>
    <span class="font-semibold tabular-nums text-foreground">
      {(facets.n_genes ?? 0).toLocaleString()}
    </span>
    <span class="text-muted-foreground">genes</span>
    <span class={cn('font-mono text-muted-foreground', align === 'between' && 'ml-auto')}>
      {elapsedMs.toFixed(0)} ms
    </span>

    <div
      class="inline-flex overflow-hidden rounded border"
      title="Live genes are the current WormBase entries. Dead ones were merged into another gene or withdrawn but keep their old IDs so an older gene list still resolves."
    >
      {#each STATUSES as st (st.key)}
        <a
          href={resolve(urlWith({ status: st.key }) as '/')}
          class={cn(
            'px-1.5 py-0.5 text-[0.7rem] transition-colors',
            currentStatus === st.key
              ? 'bg-accent text-accent-foreground'
              : 'bg-card text-muted-foreground hover:bg-accent/50',
          )}
        >
          {st.label}
        </a>
      {/each}
    </div>

    {#if isGeneList}
      <div class="inline-flex overflow-hidden rounded border">
        {#each [{ key: 'cards', label: 'cards' }, { key: 'table', label: 'table' }] as v (v.key)}
          <a
            href={resolve(urlWith({ view: v.key }) as '/')}
            class={cn(
              'px-1.5 py-0.5 text-[0.7rem] transition-colors',
              currentView === v.key
                ? 'bg-accent text-accent-foreground'
                : 'bg-card text-muted-foreground hover:bg-accent/50',
            )}
          >
            {v.label}
          </a>
        {/each}
      </div>
    {/if}
    {#if isGeneList}
      <div class="inline-flex overflow-hidden rounded border" title="Row density">
        {#each [{ key: 'comfy', label: 'comfy' }, { key: 'compact', label: 'compact' }] as d (d.key)}
          <button
            type="button"
            onclick={() => {
              if (density.value !== d.key) density.toggle();
            }}
            class={cn(
              'px-1.5 py-0.5 text-[0.7rem] transition-colors',
              density.value === d.key
                ? 'bg-accent text-accent-foreground'
                : 'bg-card text-muted-foreground hover:bg-accent/50',
            )}
          >
            {d.label}
          </button>
        {/each}
      </div>
    {/if}
  {:else}
    <span class="text-muted-foreground">Loading facets...</span>
  {/if}
</div>
