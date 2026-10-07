<script lang="ts">
  // SVG heatmap of CeNGEN L4 expression. Rows = genes with bulk TMM data, columns = neuron types,
  // cells = log1p(TMM). Sort: 'name' = alphabetical; 'cluster' = dominant-neuron-type then peak
  // TMM (cheap proxy for UPGMA; proper hierarchical clustering is overkill for <100 genes and SVG
  // is the bottleneck anyway).
  import { onMount } from 'svelte';
  import { query } from '$lib/db/client';
  import { resolve } from '$app/paths';

  import PlotExportMenu from './PlotExportMenu.svelte';
  import { rangeColor } from '$lib/plot-colors';
  import { CENGEN_TRANSGENE_GENES, CENGEN_TRANSGENE_NOTE } from '$lib/cengen-caveats';

  type Props = {
    ids: string[];
    title?: string;
    exportName?: string;
  };
  let { ids, title, exportName }: Props = $props();

  let svgEl: SVGSVGElement | null = $state(null);
  export function getSvg() {
    return svgEl;
  }

  type Row = {
    wormbase_gene: string;
    gene_name: string | null;
    values: number[]; // TMM values in `neuronOrder` order
  };

  let loading = $state(false);
  // Source rows from DB; sorted display order is derived, not mutated in place.
  let sourceRows = $state<Row[]>([]);
  let neuronOrder = $state<string[]>([]);
  let maxLog = $state(1);
  let sortMode = $state<'cluster' | 'name'>('cluster');
  const rows = $derived(sortRows(sourceRows, sortMode));

  const CELL_W = 14;
  const CELL_H = 14;
  const LEFT_PAD = 110;
  // TOP_PAD must fit the longest rotated neuron-type label (-90 deg, font-size 9). CeNGEN names
  // are up to 5 chars ("ASELr"), ~25 px tall after rotation; 110 is deliberately generous.
  const TOP_PAD = 110;

  async function load() {
    if (ids.length === 0) {
      sourceRows = [];
      neuronOrder = [];
      return;
    }
    loading = true;
    try {
      const placeholders = ids.map(() => '?').join(',');
      const names = await query<{ wormbase_gene: string; gene_name: string | null }>(
        `SELECT wormbase_gene, gene_name FROM annotations WHERE wormbase_gene IN (${placeholders})`,
        ids,
      );
      const nameMap = new Map(names.map((r) => [r.wormbase_gene, r.gene_name]));
      const exprRows = await query<{ wormbase_gene: string; neuron_type: string; tmm: number }>(
        `SELECT wormbase_gene, neuron_type, tmm FROM cengen_expression
				 WHERE wormbase_gene IN (${placeholders})`,
        ids,
      );
      /* eslint-disable svelte/prefer-svelte-reactivity */
      const perGene = new Map<string, Map<string, number>>();
      const allNeurons = new Set<string>();
      for (const r of exprRows) {
        let m = perGene.get(r.wormbase_gene);
        if (!m) {
          m = new Map();
          perGene.set(r.wormbase_gene, m);
        }
        m.set(r.neuron_type, r.tmm);
        allNeurons.add(r.neuron_type);
      }
      /* eslint-enable svelte/prefer-svelte-reactivity */
      // Stable alphabetical column order: swapping sort modes reorders rows only, not columns.
      neuronOrder = [...allNeurons].sort();

      let initialRows: Row[] = ids
        .filter((id) => perGene.has(id))
        .map((id) => {
          const m = perGene.get(id)!;
          return {
            wormbase_gene: id,
            gene_name: nameMap.get(id) ?? null,
            values: neuronOrder.map((nt) => m.get(nt) ?? 0),
          };
        });

      let maxVal = 0;
      for (const r of initialRows) {
        for (const v of r.values) {
          const lg = Math.log1p(v);
          if (lg > maxVal) maxVal = lg;
        }
      }
      maxLog = Math.max(1, maxVal);
      sourceRows = initialRows;
    } finally {
      loading = false;
    }
  }

  function sortRows(arr: Row[], mode: 'cluster' | 'name'): Row[] {
    if (mode === 'name') {
      return [...arr].sort((a, b) =>
        (a.gene_name ?? a.wormbase_gene).localeCompare(b.gene_name ?? b.wormbase_gene),
      );
    }
    // Cluster: sort by dominant-neuron index then descending peak TMM; groups co-active genes.
    return [...arr].sort((a, b) => {
      let aMax = 0,
        aIdx = 0;
      for (let i = 0; i < a.values.length; i++)
        if (a.values[i] > aMax) {
          aMax = a.values[i];
          aIdx = i;
        }
      let bMax = 0,
        bIdx = 0;
      for (let i = 0; i < b.values.length; i++)
        if (b.values[i] > bMax) {
          bMax = b.values[i];
          bIdx = i;
        }
      if (aIdx !== bIdx) return aIdx - bIdx;
      return bMax - aMax;
    });
  }

  onMount(load);
  $effect(() => {
    void ids;
    void load();
  });

  // Shared range scale on log(1 + TMM); zero stays off-white so absence reads as empty.
  function cellColor(v: number): string {
    if (v <= 0) return 'hsl(60 20% 96%)';
    return rangeColor(Math.min(1, Math.log1p(v) / maxLog));
  }

  const width = $derived(LEFT_PAD + neuronOrder.length * CELL_W);
  const height = $derived(TOP_PAD + rows.length * CELL_H);
</script>

{#if loading}
  <div class="text-sm text-muted-foreground">Loading CeNGEN expression…</div>
{:else if rows.length === 0}
  <div class="text-sm italic text-muted-foreground">
    None of the {ids.length} input genes have CeNGEN bulk TMM data.
  </div>
{:else}
  <div class="space-y-2">
    <div class="flex items-baseline gap-3 text-xs text-muted-foreground">
      {#if title}
        <span class="font-semibold text-foreground">{title}</span>
      {/if}
      <span>
        <span class="font-semibold tabular-nums text-foreground">{rows.length}</span> of
        {ids.length} genes × {neuronOrder.length} neuron types
      </span>
      <span class="inline-flex items-center gap-1" title="log(1 + TMM), low to high">
        <span class="font-mono">0</span>
        <span
          class="inline-block h-2 w-16 rounded-sm"
          style="background: linear-gradient(to right, {rangeColor(0)}, {rangeColor(
            0.5,
          )}, {rangeColor(1)})"
        ></span>
        <span class="font-mono">{Math.round(Math.expm1(maxLog)).toLocaleString()} TMM</span>
      </span>
      <div class="ml-auto inline-flex overflow-hidden rounded-md border text-[0.65rem]">
        {#each [{ k: 'cluster', label: 'Cluster' }, { k: 'name', label: 'Alphabetical' }] as opt (opt.k)}
          <button
            type="button"
            onclick={() => (sortMode = opt.k as 'cluster' | 'name')}
            class="px-2 py-0.5 transition-colors {sortMode === opt.k
              ? 'bg-accent text-accent-foreground'
              : 'bg-card hover:bg-muted/50'}"
          >
            {opt.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="relative overflow-x-auto" style="overflow-y: visible;">
      {#if exportName}
        <div class="absolute right-1 top-1 z-10">
          <PlotExportMenu getSvg={() => svgEl} baseName={exportName} />
        </div>
      {/if}
      <svg
        bind:this={svgEl}
        viewBox="0 0 {width} {height}"
        {width}
        {height}
        class="font-sans"
        style="overflow: visible;"
      >
        <!-- Column labels rotated 90° (bottom-to-top); prevents horizontal collision at any CELL_W. -->
        {#each neuronOrder as nt, j (nt)}
          {@const x = LEFT_PAD + j * CELL_W + CELL_W / 2}
          {@const y = TOP_PAD - 4}
          <text
            {x}
            {y}
            font-size="9"
            text-anchor="start"
            transform={`rotate(-90 ${x} ${y})`}
            fill="hsl(var(--muted-foreground))"
          >
            {nt}
          </text>
        {/each}

        {#each rows as r, i (r.wormbase_gene)}
          {@const y = TOP_PAD + i * CELL_H}
          <a href={resolve(`/gene/${r.wormbase_gene}`)}>
            <text
              x={LEFT_PAD - 6}
              y={y + CELL_H * 0.7}
              font-size="9"
              text-anchor="end"
              fill="hsl(var(--foreground))"
            >
              {r.gene_name ?? r.wormbase_gene}{CENGEN_TRANSGENE_GENES.has(r.wormbase_gene)
                ? ' *'
                : ''}
              {#if CENGEN_TRANSGENE_GENES.has(r.wormbase_gene)}<title>{CENGEN_TRANSGENE_NOTE}</title
                >{/if}
            </text>
          </a>
          {#each r.values as v, j (j)}
            <rect
              x={LEFT_PAD + j * CELL_W}
              {y}
              width={CELL_W}
              height={CELL_H}
              fill={cellColor(v)}
              stroke="hsl(var(--background))"
              stroke-width="0.5"
            >
              <title>{r.gene_name ?? r.wormbase_gene} × {neuronOrder[j]}: TMM {v.toFixed(1)}</title>
            </rect>
          {/each}
        {/each}
      </svg>
    </div>

    {#if rows.some((r) => CENGEN_TRANSGENE_GENES.has(r.wormbase_gene))}
      <div class="text-[0.65rem] text-amber-900 dark:text-amber-200">* {CENGEN_TRANSGENE_NOTE}</div>
    {/if}
    <div class="text-[0.65rem] text-muted-foreground">
      Cell color: log<sub>10</sub>(TMM + 1) on the same scale as the per-gene strip plot. Cluster
      sort = ranked by each gene's dominant neuron type, then by peak intensity.
    </div>
  </div>
{/if}
