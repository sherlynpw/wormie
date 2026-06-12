<script lang="ts">
  import { page } from '$app/state';
  import { cn } from '$lib/utils';
  import type { Facets } from '$lib/queries';
  import { density } from '$lib/stores/density.svelte';
  import { onMount } from 'svelte';
  import Rows from 'lucide-svelte/icons/rows-3';
  import Square from 'lucide-svelte/icons/square';
  import { resolve } from '$app/paths';
  import { SvelteURL } from 'svelte/reactivity';

  let { facets, elapsedMs }: { facets: Facets | null; elapsedMs: number } = $props();
  onMount(() => density.init());

  const q = $derived(page.url.searchParams.get('q') ?? '');
  const currentView = $derived(page.url.searchParams.get('view') ?? 'cards');

  const HOME_PARAMS = new Set(['q', 'fields', 'view', 'status', 'page']);
  function urlForView(view: string): string {
    const url = new SvelteURL(page.url);
    const stale: string[] = [];
    for (const k of url.searchParams.keys()) {
      if (!HOME_PARAMS.has(k)) stale.push(k);
    }
    for (const k of stale) url.searchParams.delete(k);
    url.pathname = '/';
    url.searchParams.set('view', view);
    return url.pathname + url.search;
  }

  type FacetItem = { view: string; label: string; count: number };
  const items: FacetItem[] = $derived(
    facets
      ? [
          { view: 'cards', label: 'genes', count: facets.n_genes },
          { view: 'wormcat', label: 'wormcat', count: facets.n_wormcat_categories },
          { view: 'go', label: 'GO', count: facets.n_go_terms },
          { view: 'neuronal', label: 'neuronal', count: facets.n_neuronal_categories },
        ]
      : [],
  );
</script>

<div class="flex flex-wrap items-center gap-2 text-xs">
  {#if facets}
    <span class="text-muted-foreground">{q ? 'Found' : 'Showing'}</span>
    {#each items as it (it.view)}
      {@const active = currentView === it.view || (it.view === 'cards' && currentView === 'table')}
      <a
        href={resolve(urlForView(it.view) as '/')}
        class={cn(
          'inline-flex items-baseline gap-1 rounded-md px-2 py-0.5 transition-colors',
          active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
        )}
      >
        <span class="font-semibold tabular-nums text-foreground">
          {it.count.toLocaleString()}
        </span>
        <span>{it.label}</span>
      </a>
    {/each}
    <span class="ml-auto font-mono text-muted-foreground">{elapsedMs.toFixed(0)} ms</span>
    {#if currentView === 'cards' || currentView === 'table'}
      <button
        type="button"
        onclick={() => density.toggle()}
        class="inline-flex items-center gap-1 rounded border bg-card px-1.5 py-0.5 text-[0.7rem] transition-colors hover:bg-accent"
        title="Toggle row density (compact / comfortable)"
      >
        {#if density.value === 'compact'}
          <Square class="h-3 w-3" />
        {:else}
          <Rows class="h-3 w-3" />
        {/if}
        {density.value === 'compact' ? 'compact' : 'comfy'}
      </button>
    {/if}
  {:else}
    <span class="text-muted-foreground">Loading facets...</span>
  {/if}
</div>
