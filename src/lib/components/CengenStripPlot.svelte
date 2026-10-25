<script lang="ts">
  // CeNGEN L4 expression per neuron type (128 types).
  // Column 1: 4-dot call (FACS-calibrated thresholds 1=liberal..4=stringent; default view = threshold 2, the CeNGEN app default).
  // Column 2: bulk expression bar (log10(value+1), available for 52 of 128 types).
  import { resolve } from '$app/paths';
  import type { CengenExpressionRow } from '$lib/queries';
  import ExternalLink from 'lucide-svelte/icons/external-link';
  import { rangeColor, fmtExpression } from '$lib/plot-colors';
  import { CENGEN_TRANSGENE_GENES, CENGEN_TRANSGENE_NOTE } from '$lib/cengen-caveats';

  type Props = {
    gene: string;
    geneName?: string | null;
    rows: CengenExpressionRow[];
  };

  let { gene, geneName, rows }: Props = $props();

  let minThreshold = $state<number>(2); // 0 = all (incl. TMM-only rows), 1..4 = called at >= this level
  let limit = $state<'top10' | 'top25' | 'all'>('all');

  const filtered = $derived.by(() => {
    if (minThreshold === 0) return rows;
    return rows.filter((r) => (r.max_threshold ?? 0) >= minThreshold);
  });
  const display = $derived(
    limit === 'top10'
      ? filtered.slice(0, 10)
      : limit === 'top25'
        ? filtered.slice(0, 25)
        : filtered,
  );
  // Scale over every neuron with a value, not only those passing the threshold filter, so the
  // bars and legend keep their meaning when the filter changes.
  const tmmRows = $derived(rows.filter((r) => r.tmm !== null));
  const maxTmm = $derived(tmmRows.length > 0 ? Math.max(...tmmRows.map((r) => r.tmm ?? 0)) : 1);
  const logMax = $derived(Math.log10(maxTmm + 1) || 1);

  function tmmColor(tmm: number): string {
    return rangeColor(Math.log10(tmm + 1) / logMax);
  }

  const cengenUrl = $derived(
    `https://cengen.shinyapps.io/CengenApp/?gene=${encodeURIComponent(geneName ?? gene)}`,
  );

  const THRESHOLD_LABEL = ['none', 'liberal', 'medium', 'conservative', 'stringent'];

  // Counts at each threshold level for the picker labels.
  const counts = $derived.by(() => {
    const out = { all: rows.length, t1: 0, t2: 0, t3: 0, t4: 0 };
    for (const r of rows) {
      const t = r.max_threshold ?? 0;
      if (t >= 1) out.t1++;
      if (t >= 2) out.t2++;
      if (t >= 3) out.t3++;
      if (t >= 4) out.t4++;
    }
    return out;
  });
</script>

{#if rows.length === 0}
  <div class="text-xs italic text-muted-foreground">
    Not detected in any of the 128 neuron types of CeNGEN (C. elegans Neuronal Gene Expression
    Network).
  </div>
{:else}
  <div class="space-y-2">
    {#if CENGEN_TRANSGENE_GENES.has(gene)}
      <div
        class="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
      >
        {CENGEN_TRANSGENE_NOTE}
      </div>
    {/if}
    <!-- Threshold picker and limit selector -->
    <div class="flex flex-wrap items-baseline gap-3 text-xs text-muted-foreground">
      <div class="inline-flex overflow-hidden rounded-md border text-[0.65rem]">
        {#each [{ k: 0, label: `all (${counts.all})` }, { k: 1, label: `≥ liberal (${counts.t1})` }, { k: 2, label: `≥ medium (${counts.t2})` }, { k: 3, label: `≥ conservative (${counts.t3})` }, { k: 4, label: `stringent (${counts.t4})` }] as opt (opt.k)}
          <button
            type="button"
            onclick={() => (minThreshold = opt.k)}
            class="px-1.5 py-0.5 transition-colors {minThreshold === opt.k
              ? 'bg-accent text-accent-foreground'
              : 'bg-card hover:bg-muted/50'}"
            title="Show neuron types where the gene is called expressed at this CeNGEN threshold or a stricter one"
          >
            {opt.label}
          </button>
        {/each}
      </div>
      <div class="ml-auto inline-flex overflow-hidden rounded-md border text-[0.65rem]">
        {#each [{ k: 'top10', label: 'Top 10' }, { k: 'top25', label: 'Top 25' }, { k: 'all', label: 'All' }] as opt (opt.k)}
          <button
            type="button"
            onclick={() => (limit = opt.k as typeof limit)}
            class="px-2 py-0.5 transition-colors {limit === opt.k
              ? 'bg-accent text-accent-foreground'
              : 'bg-card hover:bg-muted/50'}"
          >
            {opt.label}
          </button>
        {/each}
      </div>
    </div>

    <!-- Grid: neuron type | 4-dot call | TMM bar | TMM value -->
    <div class="grid grid-cols-[auto_auto_1fr_auto] items-center gap-x-2 gap-y-0.5 text-[0.7rem]">
      {#each display as r (r.neuron_type)}
        {@const lvl = r.max_threshold ?? 0}
        {#if r.has_binary}
          <a
            href={resolve(`/cell-type/${encodeURIComponent(r.neuron_type)}`)}
            class="text-right font-mono text-muted-foreground hover:text-primary hover:underline"
            >{r.neuron_type}</a
          >
        {:else}
          <span class="text-right font-mono text-muted-foreground">{r.neuron_type}</span>
        {/if}
        <span
          class="inline-flex items-center gap-0.5"
          title="Called expressed at: {lvl > 0
            ? THRESHOLD_LABEL[lvl]
            : 'not called (bulk expression only)'}"
        >
          {#each [1, 2, 3, 4] as L (L)}
            <span
              class="block h-2 w-2 rounded-full {lvl >= L
                ? 'bg-primary'
                : 'border border-muted-foreground/20 bg-muted'}"
            ></span>
          {/each}
        </span>
        {#if r.tmm !== null}
          <div
            class="h-3 rounded-sm"
            style="width: {Math.max(
              2,
              (Math.log10(r.tmm + 1) / logMax) * 100,
            )}%; background-color: {tmmColor(r.tmm)};"
            title="{r.neuron_type}: TMM {fmtExpression(
              r.tmm,
            )} ({r.n_replicates} replicate{r.n_replicates === 1 ? '' : 's'})"
          ></div>
          <span class="font-mono tabular-nums text-muted-foreground">{fmtExpression(r.tmm)}</span>
        {:else}
          <span class="text-[0.6rem] italic text-muted-foreground">no bulk data</span>
          <span class="font-mono tabular-nums text-muted-foreground">-</span>
        {/if}
      {/each}
    </div>

    <div
      class="mt-3 flex items-center justify-between gap-3 border-t pt-2 text-[0.65rem] text-muted-foreground"
    >
      <span
        class="inline-flex flex-shrink-0 items-center gap-1"
        title="log10(1 + TMM), low to high. TMM is the trimmed mean of M-values, a normalized expression value."
      >
        <span class="font-mono">0</span>
        <span
          class="inline-block h-2 w-16 rounded-sm"
          style="background: linear-gradient(to right, {rangeColor(0)}, {rangeColor(
            0.5,
          )}, {rangeColor(1)})"
        ></span>
        <span class="font-mono">{fmtExpression(maxTmm)} TMM</span>
      </span>
      <span class="flex flex-col gap-0.5">
        <span
          >Dots: threshold level of the expressed call. 1=liberal, 2=medium (default in the CeNGEN
          app), 3=conservative, 4=stringent.</span
        >
        <span
          >Bars: log<sub>10</sub>(TMM+1), from a table that combines bulk and single-cell RNA
          sequencing.</span
        >
      </span>
      <!-- eslint-disable svelte/no-navigation-without-resolve -->
      <a
        href={cengenUrl}
        target="_blank"
        rel="noopener"
        class="inline-flex flex-shrink-0 items-center gap-0.5 hover:text-primary"
      >
        CengenApp
        <ExternalLink class="h-2.5 w-2.5" />
      </a>
      <!-- eslint-enable svelte/no-navigation-without-resolve -->
    </div>
  </div>
{/if}
