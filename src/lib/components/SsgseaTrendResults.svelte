<script lang="ts">
  import type { TrendResult } from '$lib/ssgsea-trend';

  let { result }: { result: TrendResult } = $props();

  let topN = $state(50);
  let onlySignificant = $state(false);

  const shown = $derived(
    (onlySignificant ? result.rows.filter((r) => r.adjP < 0.05) : result.rows).slice(0, topN),
  );
  const nSig = $derived(result.rows.filter((r) => r.adjP < 0.05).length);
  const linear = $derived(result.model === 'linear');
  // limma gives a single coefficient (difference, t) for a two-level factor and an F-test above that.
  const twoLevel = $derived(result.model === 'factor' && result.levels.length === 2);
  const single = $derived(linear || twoLevel);
  const estimateLabel = $derived(
    linear
      ? `Slope per unit ${result.variable}`
      : twoLevel
        ? `Difference (${result.levels[1]} vs ${result.levels[0]})`
        : 'F',
  );

  const fmtP = (p: number) => (p < 1e-4 ? p.toExponential(2) : p.toFixed(4));

  function exportTsv() {
    const head = [
      'term_id',
      'name',
      'size',
      linear ? 'slope' : twoLevel ? 'difference' : 'F',
      single ? 't' : 'F',
      'p',
      'adj_p',
    ].join('\t');
    const rows = result.rows.map((r) =>
      [r.term_id, r.name, r.size, r.estimate, r.stat, r.p, r.adjP].join('\t'),
    );
    const blob = new Blob([head + '\n' + rows.join('\n') + '\n'], {
      type: 'text/tab-separated-values',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ssgsea-trend-${result.variable}.tsv`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="space-y-3">
  <div class="flex flex-wrap items-center gap-3 text-sm">
    <span>
      {result.rows.length} sets tested · {nSig} with adjusted p &lt; 0.05 · {result.residualDf} residual
      df · limma {result.limmaVersion}
    </span>
    <label class="inline-flex items-center gap-1">
      <input type="checkbox" bind:checked={onlySignificant} /> significant only
    </label>
    <label>
      Top
      <input
        type="number"
        class="ml-1 w-16 rounded border bg-background px-1 py-0.5"
        bind:value={topN}
        min="5"
        max="5000"
      />
    </label>
    <button class="rounded border px-2 py-0.5 text-xs hover:bg-accent" onclick={exportTsv}
      >Export TSV</button
    >
  </div>

  <div class="overflow-x-auto">
    <table class="w-full text-xs">
      <thead class="text-left text-muted-foreground">
        <tr>
          <th class="py-1 pr-3">Set</th>
          <th class="py-1 pr-3">Genes</th>
          <th class="py-1 pr-3 text-right">{estimateLabel}</th>
          {#if single}<th class="py-1 pr-3 text-right">t</th>{/if}
          <th class="py-1 pr-3 text-right">p</th>
          <th class="py-1 pr-3 text-right">adj. p</th>
        </tr>
      </thead>
      <tbody>
        {#each shown as r (r.term_id)}
          <tr class="border-t" class:font-medium={r.adjP < 0.05}>
            <td class="py-1 pr-3">
              <span class="font-mono">{r.term_id}</span>
              {#if r.name && r.name !== r.term_id}
                <span class="ml-1 text-muted-foreground">{r.name}</span>
              {/if}
            </td>
            <td class="py-1 pr-3 tabular-nums">{r.size}</td>
            <td class="py-1 pr-3 text-right tabular-nums">{r.estimate.toFixed(4)}</td>
            {#if single}<td class="py-1 pr-3 text-right tabular-nums">{r.stat.toFixed(2)}</td>{/if}
            <td class="py-1 pr-3 text-right tabular-nums">{fmtP(r.p)}</td>
            <td class="py-1 pr-3 text-right tabular-nums">{fmtP(r.adjP)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
