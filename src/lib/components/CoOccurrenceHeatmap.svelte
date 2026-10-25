<script module lang="ts">
  // Binary genes x terms presence heatmap. Cell filled when the gene is in the term's member list.
  // Useful for spotting genes that drive multiple overlapping terms in enrichment/GSEA analysis.
  // Input: flat list of {term_id, name, genes, color?} where color is an optional row-tint
  // (e.g. one color per slot/contrast on /enrichment/overlap).

  export interface HeatmapTerm {
    term_id: string;
    name: string;
    genes: string[];
    color?: string; // CSS color for the cell tint
  }
</script>

<script lang="ts">
  import PlotExportMenu from './PlotExportMenu.svelte';

  let {
    terms,
    minGenesPerColumn = 1,
    minTermsPerRow = 2,
    maxRows = 80,
    maxCols = 60,
    exportName,
  }: {
    terms: HeatmapTerm[];
    minGenesPerColumn?: number;
    minTermsPerRow?: number;
    maxRows?: number;
    maxCols?: number;
    exportName?: string;
  } = $props();

  let svgEl: SVGSVGElement | null = $state(null);
  export function getSvg() {
    return svgEl;
  }

  // Build gene-to-terms and term-to-genes indexes for cheap degree-based filtering on both axes.
  const indexes = $derived.by(() => {
    /* eslint-disable svelte/prefer-svelte-reactivity */
    const geneToTerms = new Map<string, Set<string>>();
    const termToGenes = new Map<string, Set<string>>();
    const termMeta = new Map<string, { name: string; color: string | undefined }>();
    for (const t of terms) {
      termMeta.set(t.term_id, { name: t.name, color: t.color });
      let gs = termToGenes.get(t.term_id);
      if (!gs) {
        gs = new Set();
        termToGenes.set(t.term_id, gs);
      }
      for (const g of t.genes) {
        gs.add(g);
        let ts = geneToTerms.get(g);
        if (!ts) {
          ts = new Set();
          geneToTerms.set(g, ts);
        }
        ts.add(t.term_id);
      }
    }
    /* eslint-enable svelte/prefer-svelte-reactivity */
    return { geneToTerms, termToGenes, termMeta };
  });

  // Filter genes by minTermsPerRow, then terms by remaining gene count; sort both by degree desc.
  const layout = $derived.by(() => {
    const { geneToTerms, termToGenes, termMeta } = indexes;
    const keptGenes = [...geneToTerms.entries()]
      .filter(([, ts]) => ts.size >= minTermsPerRow)
      .sort((a, b) => b[1].size - a[1].size)
      .map(([g]) => g);

    /* eslint-disable svelte/prefer-svelte-reactivity */
    const keptGeneSet = new Set(keptGenes);
    const termCounts = new Map<string, number>();
    /* eslint-enable svelte/prefer-svelte-reactivity */
    for (const [t, gs] of termToGenes) {
      let n = 0;
      for (const g of gs) if (keptGeneSet.has(g)) n++;
      if (n >= minGenesPerColumn) termCounts.set(t, n);
    }
    const keptTerms = [...termCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);

    return {
      genes: keptGenes.slice(0, maxRows),
      termIds: keptTerms.slice(0, maxCols),
      hiddenGenes: Math.max(0, keptGenes.length - maxRows),
      hiddenTerms: Math.max(0, keptTerms.length - maxCols),
      termMeta,
      termToGenes,
    };
  });

  // Fixed SVG cell size; total dimensions scale with filtered axis lengths.
  const CELL = 14;
  const ROW_LABEL_W = 110;
  const COL_LABEL_H = 110;
  const PAD = 8;

  const matrixW = $derived(layout.termIds.length * CELL);
  const matrixH = $derived(layout.genes.length * CELL);
  const totalW = $derived(ROW_LABEL_W + matrixW + PAD);
  const totalH = $derived(COL_LABEL_H + matrixH + PAD);
</script>

{#if layout.genes.length === 0 || layout.termIds.length === 0}
  <div class="rounded-md border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
    No genes to show. Try a lower value for Min terms per gene.
  </div>
{:else}
  <div class="space-y-2">
    <div class="relative overflow-auto rounded-md border bg-card p-3">
      {#if exportName}
        <div class="absolute right-1 top-1 z-10">
          <PlotExportMenu getSvg={() => svgEl} baseName={exportName} />
        </div>
      {/if}
      <svg
        bind:this={svgEl}
        width={totalW}
        height={totalH}
        viewBox={`0 0 ${totalW} ${totalH}`}
        role="img"
        aria-label="Genes by terms co-occurrence heatmap"
      >
        <!-- Column labels (term names), rotated 45 degrees; names truncated at 27 chars -->
        {#each layout.termIds as termId, ci (termId)}
          {@const meta = layout.termMeta.get(termId)}
          {@const x = ROW_LABEL_W + ci * CELL + CELL / 2}
          {@const label =
            meta?.name && meta.name.length > 28
              ? meta.name.slice(0, 27) + '…'
              : (meta?.name ?? termId)}
          <text
            {x}
            y={COL_LABEL_H - 4}
            transform={`rotate(-45, ${x}, ${COL_LABEL_H - 4})`}
            text-anchor="start"
            class="fill-foreground"
            font-size="10"
          >
            {label}
          </text>
        {/each}

        <!-- Row labels (gene names); truncated at 15 chars -->
        {#each layout.genes as gene, ri (gene)}
          {@const y = COL_LABEL_H + ri * CELL + CELL / 2 + 3}
          <text x={ROW_LABEL_W - 4} {y} text-anchor="end" class="fill-foreground" font-size="10">
            {gene.length > 16 ? gene.slice(0, 15) + '…' : gene}
          </text>
        {/each}

        <!-- Cells (filled = gene in term, opacity 0.85; empty = muted, 0.25) -->
        {#each layout.termIds as termId, ci (termId)}
          {@const x = ROW_LABEL_W + ci * CELL}
          {@const genesInTerm = layout.termToGenes.get(termId)}
          {@const tint = layout.termMeta.get(termId)?.color ?? 'hsl(var(--foreground))'}
          {#each layout.genes as gene, ri (gene)}
            {@const y = COL_LABEL_H + ri * CELL}
            {@const filled = genesInTerm?.has(gene)}
            <rect
              {x}
              {y}
              width={CELL - 1}
              height={CELL - 1}
              fill={filled ? tint : 'hsl(var(--muted))'}
              opacity={filled ? 0.85 : 0.25}
              rx={1}
            >
              <title>{gene} × {layout.termMeta.get(termId)?.name ?? termId}</title>
            </rect>
          {/each}
        {/each}
      </svg>
    </div>
    {#if layout.hiddenGenes > 0 || layout.hiddenTerms > 0}
      <div class="text-[0.7rem] text-muted-foreground">
        Showing {layout.genes.length} genes × {layout.termIds.length} terms
        {#if layout.hiddenGenes > 0}({layout.hiddenGenes} more genes hidden){/if}
        {#if layout.hiddenTerms > 0}({layout.hiddenTerms} more terms hidden){/if}.
      </div>
    {/if}
  </div>
{/if}
