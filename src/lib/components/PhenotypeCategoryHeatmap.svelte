<script lang="ts">
  // Single-row heatmap of top-level WBPhenotype categories. Bar intensity = evidence count;
  // numbers = distinct child terms / total evidence. Summarises the phenotype chip wall.

  import { resolve } from '$app/paths';
  import type { PhenotypeCategoryRoll } from '$lib/queries';

  let { categories }: { categories: PhenotypeCategoryRoll[] } = $props();

  const maxEv = $derived(Math.max(1, ...categories.map((c) => c.n_evidence)));
</script>

{#if categories.length > 0}
  <div class="space-y-1.5">
    <div class="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">
      Top-level WBPhenotype categories ({categories.length})
    </div>
    <div class="flex flex-wrap gap-1">
      {#each categories as c (c.top_id)}
        {@const intensity = c.n_evidence / maxEv}
        <a
          href={resolve(`/phenotype/${c.top_id}`)}
          class="group inline-flex min-w-[120px] flex-col gap-0.5 rounded-md border bg-card px-2 py-1.5 transition-colors hover:bg-accent"
          title={`${c.top_id} · ${c.n_evidence} evidence row${c.n_evidence === 1 ? '' : 's'} across ${c.n_terms} term${c.n_terms === 1 ? '' : 's'}`}
        >
          <div class="relative h-1.5 w-full overflow-hidden rounded bg-muted">
            <div
              class="absolute inset-y-0 left-0 bg-accent transition-[width]"
              style="width: {(intensity * 100).toFixed(1)}%"
            ></div>
          </div>
          <div class="flex items-baseline justify-between gap-2">
            <span class="truncate text-xs">{c.top_name}</span>
            <span class="shrink-0 font-mono text-[0.6rem] tabular-nums text-muted-foreground"
              >{c.n_terms}/{c.n_evidence}</span
            >
          </div>
        </a>
      {/each}
    </div>
    <div class="text-[0.6rem] text-muted-foreground">
      Bar = relative evidence count vs the largest category. Numbers: distinct child terms / total
      evidence rows.
    </div>
  </div>
{/if}
