<script lang="ts">
  // Term x gene presence heatmap. Rows = top-N terms by q; columns = union of hit genes.
  // Cell colour: the shared purple-neutral-orange scale over -log10(q); orange rows are the most significant.
  // Generic: works for ORA (overlap) and GSEA (leading_edge/members); pure SVG for export.
  import PlotExportMenu from './PlotExportMenu.svelte';
  import { rangeColor } from '$lib/plot-colors';

  export interface TermRow {
    term_id: string;
    name?: string;
    q: number;
    overlap: string[];
  }

  let {
    results,
    geneLabel,
    title,
    topN = 25,
    cellSize = 14,
    onTermClick,
    exportName,
  }: {
    results: TermRow[];
    geneLabel: (id: string) => string;
    title?: string;
    topN?: number;
    cellSize?: number;
    onTermClick?: (term_id: string) => void;
    exportName?: string;
  } = $props();

  const rows = $derived.by(() => {
    const sig = results.slice().sort((a, b) => a.q - b.q);
    return sig.slice(0, topN);
  });

  const cols = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      for (const g of r.overlap) {
        if (!seen.has(g)) {
          seen.add(g);
          out.push(g);
        }
      }
    }
    return out;
  });

  const rowSets = $derived(rows.map((r) => new Set(r.overlap)));

  const maxNegLogQ = $derived.by(() => {
    let m = 0;
    for (const r of rows) {
      const v = r.q <= 0 ? 300 : -Math.log10(r.q);
      if (v > m) m = v;
    }
    return m;
  });

  const minNegLogQ = $derived.by(() => {
    let m = Infinity;
    for (const r of rows) {
      const v = r.q <= 0 ? 300 : -Math.log10(r.q);
      if (v < m) m = v;
    }
    return Number.isFinite(m) ? m : 0;
  });

  function shade(rowIdx: number, present: boolean): string {
    if (!present) return 'transparent';
    if (maxNegLogQ <= minNegLogQ) return rangeColor(1);
    const r = rows[rowIdx];
    const v = r.q <= 0 ? 300 : -Math.log10(r.q);
    return rangeColor((v - minNegLogQ) / (maxNegLogQ - minNegLogQ));
  }

  const LABEL_W = 220;
  const HEADER_H = 110;
  const ROW_LABEL_PAD = 8;
  const width = $derived(LABEL_W + cols.length * cellSize + 4);
  const height = $derived(HEADER_H + rows.length * cellSize + 4);

  function shortName(name: string, max = 36): string {
    return name.length > max ? name.slice(0, max - 1) + '…' : name;
  }

  let svgEl: SVGSVGElement | null = $state(null);
  export function getSvg() {
    return svgEl;
  }
</script>

<div class="overflow-x-auto rounded-lg border bg-card p-3">
  {#if title || exportName}
    <div class="mb-2 flex items-center justify-between gap-2">
      <div class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {title ?? ''}
      </div>
      {#if exportName}
        <PlotExportMenu getSvg={() => svgEl} baseName={exportName} />
      {/if}
    </div>
  {/if}
  {#if rows.length === 0 || cols.length === 0}
    <div class="py-4 text-center text-xs italic text-muted-foreground">
      No terms with overlap data.
    </div>
  {:else}
    <svg
      bind:this={svgEl}
      viewBox="0 0 {width} {height}"
      {width}
      {height}
      class="block"
      style="min-width: {width}px;"
      role="img"
      aria-label="Term by gene heatmap"
    >
      <!-- Column labels rotated -60 deg -->
      {#each cols as g, j (j)}
        {@const cx = LABEL_W + j * cellSize + cellSize / 2}
        {@const baseY = HEADER_H - 2}
        <g transform="rotate(-60 {cx} {baseY})">
          <text
            x={cx}
            y={baseY}
            font-size="9"
            text-anchor="start"
            fill="hsl(var(--muted-foreground))"
            font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {geneLabel(g)}<title>{g}</title>
          </text>
        </g>
      {/each}

      <!-- Row labels and cells -->
      {#each rows as r, i (r.term_id)}
        {@const ry = HEADER_H + i * cellSize}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <g
          class={onTermClick ? 'cursor-pointer' : ''}
          role={onTermClick ? 'button' : undefined}
          tabindex={onTermClick ? 0 : undefined}
          onclick={() => onTermClick?.(r.term_id)}
          onkeydown={(e) => {
            if (!onTermClick) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onTermClick(r.term_id);
            }
          }}
        >
          <text
            x={LABEL_W - ROW_LABEL_PAD}
            y={ry + cellSize - 4}
            text-anchor="end"
            font-size="9"
            fill="hsl(var(--muted-foreground))"
            font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {shortName(r.name || r.term_id)}<title
              >{r.term_id} · {r.name} · q={r.q.toExponential(1)}</title
            >
          </text>
        </g>
        {#each cols as g, j (j)}
          {@const present = rowSets[i].has(g)}
          <rect
            x={LABEL_W + j * cellSize + 0.5}
            y={ry + 0.5}
            width={cellSize - 1}
            height={cellSize - 1}
            fill={shade(i, present)}
            stroke="hsl(var(--border) / 0.4)"
            stroke-width="0.5"
          >
            <title
              >{present
                ? `${r.name || r.term_id} ∋ ${geneLabel(g)}`
                : `${geneLabel(g)} not in ${r.name || r.term_id}`}</title
            >
          </rect>
        {/each}
      {/each}
    </svg>
    <div class="mt-2 flex flex-wrap items-center gap-3 text-[0.6rem] text-muted-foreground">
      <span class="inline-flex items-center gap-1">
        <span class="inline-block h-2 w-4" style="background: {rangeColor(0)}"></span>
        weak (high q)
      </span>
      <span class="inline-flex items-center gap-1">
        <span class="inline-block h-2 w-4" style="background: {rangeColor(1)}"></span>
        strong (low q)
      </span>
      <span class="ml-auto font-mono">{rows.length} terms × {cols.length} genes</span>
    </div>
  {/if}
</div>
