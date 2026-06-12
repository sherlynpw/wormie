<script lang="ts">
  import GeneCard from '$lib/components/GeneCard.svelte';
  import type { GeneRow } from '$lib/queries';

  let {
    rows,
    highlight = null,
    activeIdx = -1,
  }: { rows: GeneRow[]; highlight?: RegExp | null; activeIdx?: number } = $props();
</script>

<div class="space-y-2">
  {#each rows as g, i (g.wormbase_gene)}
    <div
      data-row-idx={i}
      class={i === activeIdx ? 'rounded-md ring-2 ring-primary ring-offset-1' : ''}
    >
      <GeneCard gene={g} {highlight} />
    </div>
  {/each}
  {#if rows.length === 0}
    <div class="py-12 text-center text-sm text-muted-foreground">No results.</div>
  {/if}
</div>
