<script lang="ts">
  import type { AlleleRow, PhenotypeRow } from '$lib/queries';

  let {
    alleles,
    phenotypes,
    maxAlleles = 30,
    maxPhenotypes = 30,
  }: {
    alleles: AlleleRow[];
    phenotypes: PhenotypeRow[];
    maxAlleles?: number;
    maxPhenotypes?: number;
  } = $props();

  // Index alleleId -> Set<termId> from the GROUP_CONCAT strings.
  const matrix = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const m = new Map<string, Set<string>>();
    for (const a of alleles) {
      const set = new Set(
        (a.phenotype_term_ids ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
      m.set(a.allele_id, set);
    }
    return m;
  });

  // Cap to top-N by support; "show all" button removes the cap (cell size adapts to keep the grid usable).
  let expanded = $state(false);
  const topAlleles = $derived(expanded ? alleles : alleles.slice(0, maxAlleles));
  const topPhenotypes = $derived(expanded ? phenotypes : phenotypes.slice(0, maxPhenotypes));

  function isAssoc(alleleId: string, termId: string): boolean {
    return matrix.get(alleleId)?.has(termId) ?? false;
  }

  function alleleNumericName(id: string): string {
    // Strip "WBVar" prefix and leading zeros for compact column headers.
    const m = id.match(/^WBVar0*(\d+)$/);
    return m ? `Var${m[1]}` : id;
  }

  function truncName(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  // Cell size (px): 44 for n<=8, 32 for <=16, 24 for <=40, 18 for <=80, 14 otherwise.
  const cell = $derived.by(() => {
    const n = Math.max(topAlleles.length, topPhenotypes.length);
    if (n <= 8) return 44;
    if (n <= 16) return 32;
    if (n <= 40) return 24;
    if (n <= 80) return 18;
    return 14;
  });
  const headerH = $derived(cell * 4 + 24);
</script>

{#if topAlleles.length === 0 || topPhenotypes.length === 0}
  <div class="py-4 text-sm text-muted-foreground">No allele-phenotype data for this gene.</div>
{:else}
  <div class="overflow-x-auto">
    <div
      class="inline-grid gap-px"
      style="grid-template-columns: minmax(220px, 1fr) repeat({topAlleles.length}, {cell}px);"
    >
      <div></div>
      {#each topAlleles as a (a.allele_id)}
        <a
          href="https://wormbase.org/species/c_elegans/variation/{a.allele_id}"
          target="_blank"
          rel="noopener"
          class="flex items-end justify-center font-mono text-sm text-muted-foreground hover:text-primary"
          style="writing-mode: vertical-rl; transform: rotate(180deg); height: {headerH}px; width: {cell}px;"
          title={a.name === a.allele_id ? a.allele_id : `${a.name} (${a.allele_id})`}
        >
          {a.name === a.allele_id ? alleleNumericName(a.allele_id) : a.name}
        </a>
      {/each}

      {#each topPhenotypes as p (p.term_id)}
        <a
          href="https://wormbase.org/species/all/phenotype/{p.term_id}"
          target="_blank"
          rel="noopener"
          class="truncate pr-2 text-xs hover:text-primary"
          style="line-height: {cell}px;"
          title={p.name}
        >
          {truncName(p.name, 38)}
          <span class="font-mono text-[0.6rem] text-muted-foreground">({p.n_alleles})</span>
        </a>
        {#each topAlleles as a (a.allele_id)}
          {@const on = isAssoc(a.allele_id, p.term_id)}
          <div
            class="border border-border/40"
            style="width: {cell}px; height: {cell}px; background: {on
              ? 'hsl(var(--accent))'
              : 'transparent'};"
            title={on ? `${a.name} → ${p.name}` : ''}
          ></div>
        {/each}
      {/each}
    </div>

    {#if alleles.length > maxAlleles || phenotypes.length > maxPhenotypes}
      <div class="mt-2 flex flex-wrap items-center gap-2 text-[0.65rem] text-muted-foreground">
        {#if expanded}
          Showing all {alleles.length} alleles × {phenotypes.length} phenotypes.
        {:else}
          Showing top {Math.min(maxAlleles, alleles.length)} alleles ×
          {Math.min(maxPhenotypes, phenotypes.length)} phenotypes by support count. Total:
          {alleles.length} alleles, {phenotypes.length} phenotypes.
        {/if}
        <button
          type="button"
          onclick={() => (expanded = !expanded)}
          class="rounded border border-dashed px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
        >
          {expanded ? 'show top only' : 'show all'}
        </button>
      </div>
    {/if}
  </div>
{/if}
