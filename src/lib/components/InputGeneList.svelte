<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { untrack } from 'svelte';
  import GenePill from '$lib/components/GenePill.svelte';
  import type { GeneRow } from '$lib/queries';
  import { resolve } from '$app/paths';

  let { genes, pillThreshold = 100 }: { genes: GeneRow[]; pillThreshold?: number } = $props();

  let container: HTMLDivElement | null = $state(null);
  let viewMode = $state<'auto' | 'pills' | 'table'>('auto');

  const effectiveMode = $derived(
    viewMode === 'auto' ? (genes.length > pillThreshold ? 'table' : 'pills') : viewMode,
  );

  const ROW_HEIGHT = 32;
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => container,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  $effect(() => {
    const count = effectiveMode === 'table' ? genes.length : 0;
    const el = container;
    untrack(() => {
      $virtualizer.setOptions({
        count,
        getScrollElement: () => el,
        estimateSize: () => ROW_HEIGHT,
        overscan: 8,
      });
    });
  });

  const items = $derived(effectiveMode === 'table' ? $virtualizer.getVirtualItems() : []);
  const totalSize = $derived(effectiveMode === 'table' ? $virtualizer.getTotalSize() : 0);
</script>

{#if genes.length === 0}
  <div class="text-sm text-muted-foreground">No input genes.</div>
{:else if effectiveMode === 'pills'}
  <div class="flex flex-wrap gap-1">
    {#each genes as g (g.wormbase_gene)}
      <GenePill id={g.wormbase_gene} name={g.gene_name} />
    {/each}
  </div>
{:else}
  <div class="mb-2 flex items-center justify-between">
    <div class="text-xs text-muted-foreground">
      Showing {genes.length.toLocaleString()} genes (virtualized).
    </div>
    <button
      type="button"
      onclick={() => (viewMode = viewMode === 'pills' ? 'auto' : 'pills')}
      class="text-xs text-primary hover:underline"
    >
      {viewMode === 'pills' ? 'Switch to table' : 'View as pills (slow)'}
    </button>
  </div>
  <div bind:this={container} class="h-72 overflow-auto rounded-md border bg-card">
    <div style="height: {totalSize}px; position: relative;">
      {#each items as v (v.index)}
        {@const g = genes[v.index]}
        <div
          style="position:absolute; top:0; left:0; right:0; transform: translateY({v.start}px); height: {ROW_HEIGHT}px;"
          class="flex items-center gap-3 border-b px-3 text-sm tabular-nums"
        >
          <a
            href={resolve(`/gene/${g.wormbase_gene}`)}
            class="w-[140px] shrink-0 font-mono text-[0.7rem] text-primary hover:underline"
          >
            {g.wormbase_gene}
          </a>
          <a
            href={resolve(`/gene/${g.wormbase_gene}`)}
            class="w-[140px] shrink-0 truncate font-semibold hover:underline"
            title={g.gene_name ?? ''}
          >
            {g.gene_name ?? '-'}
          </a>
          {#if g.sequence_name}
            <span class="w-[120px] shrink-0 truncate font-mono text-xs text-muted-foreground">
              {g.sequence_name}
            </span>
          {/if}
          <span class="flex-1 truncate text-xs text-muted-foreground">
            {g.concise_description ?? ''}
          </span>
        </div>
      {/each}
    </div>
  </div>
{/if}
