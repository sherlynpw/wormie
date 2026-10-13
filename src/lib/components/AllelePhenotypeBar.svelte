<script lang="ts">
  // Horizontal bar per allele showing phenotype count with hover tooltip.
  // No positional metadata (aa position / genomic coord) yet, so a lollipop
  // chart is not possible; this is the closest informative view from current data.
  import type { AlleleRow } from '$lib/queries';

  let { alleles, limit = 30 }: { alleles: AlleleRow[]; limit?: number } = $props();

  const maxN = $derived(Math.max(1, ...alleles.map((a) => a.n_phenotypes)));
  let expanded = $state(false);
  const visible = $derived(expanded ? alleles : alleles.slice(0, limit));
</script>

{#if alleles.length > 0}
  <div class="space-y-0.5">
    {#each visible as a (a.allele_id)}
      <div class="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs">
        <a
          href="https://wormbase.org/species/c_elegans/variation/{a.allele_id}"
          target="_blank"
          rel="noopener"
          class="w-20 truncate font-mono text-[0.7rem] text-primary hover:underline"
          title={a.name === a.allele_id ? a.allele_id : `${a.name} (${a.allele_id})`}
        >
          {a.name}
        </a>
        <div
          class="h-3.5 cursor-help rounded-sm bg-primary/70 transition-colors hover:bg-primary"
          style="width: {(a.n_phenotypes / maxN) * 100}%"
          title={a.phenotype_names.replace(/,/g, ', ')}
        ></div>
        <span class="font-mono tabular-nums text-muted-foreground">{a.n_phenotypes}</span>
      </div>
    {/each}
    {#if alleles.length > limit}
      <button
        type="button"
        onclick={() => (expanded = !expanded)}
        class="mt-1 rounded border border-dashed px-1.5 py-0.5 text-[0.65rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {expanded ? 'show top only' : `+${alleles.length - limit} more alleles`}
      </button>
    {/if}
  </div>
{/if}
