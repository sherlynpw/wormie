<script lang="ts">
  import type { EnrichmentResult } from '$lib/db/client';
  import {
    Tooltip,
    TooltipTrigger,
    TooltipContent,
    TooltipProvider,
  } from '$lib/components/ui/tooltip';
  import { resolve } from '$app/paths';
  import { niceTicks } from '$lib/nice-ticks';
  import { wrapLabel } from '$lib/wrap-label';
  import { rangeColor } from '$lib/plot-colors';
  import { qScale } from '$lib/stores/plot-scale.svelte';
  import { onMount } from 'svelte';

  type SortBy = 'q' | 'fold' | 'k';

  let {
    results,
    max = 25,
    linkFor,
    sortBy = 'q',
    svgEl = $bindable(null),
  }: {
    results: EnrichmentResult[];
    max?: number;
    linkFor?: (r: EnrichmentResult) => string | null;
    sortBy?: SortBy;
    svgEl?: SVGSVGElement | null;
  } = $props();

  // Pick top `max` in the table's order (p, then q), then reorder within that pool by
  // sortBy. GO's q is corrected per aspect, so q order can differ from p order across aspects.
  const top = $derived.by(() => {
    const pool = [...results].sort((a, b) => a.p - b.p || a.q - b.q).slice(0, max);
    if (sortBy === 'fold') pool.sort((a, b) => b.fold - a.fold);
    else if (sortBy === 'k') pool.sort((a, b) => b.k - a.k);
    else pool.sort((a, b) => a.p - b.p || a.q - b.q);
    return pool;
  });

  // Layout
  // Tall enough for a term name wrapped onto two lines.
  const ROW = 26;
  const LABEL_CHARS = 42;
  const MARGIN_LEFT = 280;
  const MARGIN_RIGHT = 90;
  const MARGIN_TOP = 30;
  const MARGIN_BOTTOM = 36;
  const WIDTH = 760;

  const innerW = $derived(WIDTH - MARGIN_LEFT - MARGIN_RIGHT);
  const innerH = $derived(top.length * ROW);

  // Scales
  const foldMax = $derived(Math.max(2, ...top.map((r) => r.fold)));
  const kMax = $derived(Math.max(1, ...top.map((r) => r.k)));
  const logQMax = $derived(Math.max(1, ...top.map((r) => (r.q > 0 ? -Math.log10(r.q) : 30))));
  // Colour spans the terms actually plotted unless the user fixed the scale, so a page of strong
  // hits still uses the whole range and plots from different lists can share one legend.
  const dataQMin = $derived(
    Math.min(logQMax, ...top.map((r) => (r.q > 0 ? -Math.log10(r.q) : 30))),
  );
  const scaleMin = $derived(qScale.fixed ? qScale.min! : Math.floor(dataQMin * 2) / 2);
  const scaleMax = $derived(qScale.fixed ? qScale.max! : Math.ceil(logQMax * 2) / 2);
  const scaleGroup = 'qscale-ora';
  onMount(() => qScale.init());

  function xFor(fold: number): number {
    // Linear scale clamped to [0, foldMax].
    const clamped = Math.min(Math.max(fold, 0), foldMax);
    return MARGIN_LEFT + (clamped / foldMax) * innerW;
  }

  function rFor(k: number): number {
    const tMin = 4;
    const tMax = 11;
    const t = Math.sqrt(k / Math.max(1, kMax));
    return tMin + t * (tMax - tMin);
  }

  function colorFor(q: number): string {
    const v = q > 0 ? -Math.log10(q) : logQMax;
    return rangeColor(scaleMax > scaleMin ? (v - scaleMin) / (scaleMax - scaleMin) : 1);
  }

  const foldTicks = $derived(niceTicks(0, foldMax, 4));

  // Right-side legends: colour = -log10(q), size = gene count k.
  const legendStops = $derived(
    niceTicks(scaleMin, scaleMax, 5).values.map((value) => ({
      value,
      color: colorFor(Math.pow(10, -value)),
    })),
  );

  const sizeLegendY = $derived(MARGIN_TOP + legendStops.length * 12 + 24);
  const sizeLegendKs = $derived([
    Math.max(1, Math.round(kMax / 4)),
    Math.max(2, Math.round(kMax / 2)),
    kMax,
  ]);

  // The legend column can outrun a short plot.
  const legendBottom = $derived(sizeLegendY + 14 + sizeLegendKs.length * 24 + 4);
  const height = $derived(
    Math.max(MARGIN_TOP + innerH + MARGIN_BOTTOM, legendBottom + MARGIN_BOTTOM),
  );
</script>

{#snippet termLabel(name: string, cy: number)}
  {@const lines = wrapLabel(name, LABEL_CHARS)}
  <text
    x={MARGIN_LEFT - 8}
    y={lines.length > 1 ? cy - 2 : cy + 4}
    text-anchor="end"
    class="fill-foreground"
    style="font-size: 11px;"
  >
    {#each lines as line, li (li)}
      <tspan x={MARGIN_LEFT - 8} dy={li === 0 ? 0 : 11}>{line}</tspan>
    {/each}
    <title>{name}</title>
  </text>
{/snippet}

{#if top.length === 0}
  <div class="py-10 text-center text-sm text-muted-foreground">No enriched terms to plot.</div>
{:else}
  <TooltipProvider delayDuration={120}>
    <div
      class="mb-1 flex flex-wrap items-center justify-end gap-2 text-[0.65rem] text-muted-foreground"
    >
      <span
        title="q-value: the p-value corrected for testing many terms. -log10(q) is larger for smaller q-values."
        >colour scale -log10(q)</span
      >
      <label class="inline-flex items-center gap-1">
        <input
          type="radio"
          name={scaleGroup}
          checked={!qScale.fixed}
          onchange={() => qScale.set(null, null)}
        />
        fit to plot
      </label>
      <label class="inline-flex items-center gap-1">
        <input
          type="radio"
          name={scaleGroup}
          checked={qScale.fixed}
          onchange={() => qScale.set(scaleMin, scaleMax)}
        />
        fixed
      </label>
      <input
        type="number"
        step="0.5"
        min="0"
        value={scaleMin}
        onchange={(e) => qScale.set(Number(e.currentTarget.value), qScale.max ?? scaleMax)}
        class="w-14 rounded border bg-card px-1 py-0.5 font-mono"
        title="Lowest -log10(q) value on the colour scale"
      />
      <span>to</span>
      <input
        type="number"
        step="0.5"
        min="0"
        value={scaleMax}
        onchange={(e) => qScale.set(qScale.min ?? scaleMin, Number(e.currentTarget.value))}
        class="w-14 rounded border bg-card px-1 py-0.5 font-mono"
        title="Highest -log10(q) value on the colour scale. Terms with smaller q-values take the end colour."
      />
    </div>
    <div class="overflow-x-auto">
      <svg
        bind:this={svgEl}
        viewBox="0 0 {WIDTH} {height}"
        class="w-full"
        style="min-width: 640px; max-width: 920px;"
        role="img"
        aria-label="Enrichment dot plot"
      >
        <!-- X grid -->
        {#each foldTicks.values as t (t)}
          <line
            x1={xFor(t)}
            x2={xFor(t)}
            y1={MARGIN_TOP - 4}
            y2={MARGIN_TOP + innerH}
            stroke="hsl(var(--border))"
            stroke-dasharray="2 3"
            stroke-width="0.5"
          />
        {/each}

        <!-- X axis labels -->
        {#each foldTicks.values as t (t)}
          <text
            x={xFor(t)}
            y={MARGIN_TOP + innerH + 14}
            text-anchor="middle"
            class="fill-muted-foreground"
            style="font-size: 10px;"
          >
            {foldTicks.format(t)}×
          </text>
        {/each}
        <text
          x={MARGIN_LEFT + innerW / 2}
          y={MARGIN_TOP + innerH + 30}
          text-anchor="middle"
          class="fill-foreground"
          style="font-size: 11px; font-weight: 500;"
        >
          Fold enrichment
        </text>

        <!-- Rows -->
        {#each top as r, i (r.term_id + ':' + i)}
          {@const cy = MARGIN_TOP + i * ROW + ROW / 2}
          {@const cx = xFor(r.fold)}
          {@const rad = rFor(r.k)}
          {@const fill = colorFor(r.q)}
          {@const link = linkFor ? linkFor(r) : null}

          <!-- Horizontal guide line -->
          <line
            x1={MARGIN_LEFT}
            x2={MARGIN_LEFT + innerW}
            y1={cy}
            y2={cy}
            stroke="hsl(var(--border))"
            stroke-width="0.5"
            opacity="0.5"
          />

          <!-- Term label -->
          {#if link}
            <a href={resolve(link as '/')} class="hover:underline">
              {@render termLabel(r.name, cy)}
            </a>
          {:else}
            {@render termLabel(r.name, cy)}
          {/if}

          <!-- Dot -->
          <Tooltip>
            <TooltipTrigger>
              {#snippet child({ props }: { props: Record<string, unknown> })}
                <g {...props}>
                  <circle
                    {cx}
                    {cy}
                    r={rad}
                    {fill}
                    stroke="hsl(var(--background))"
                    stroke-width="1"
                    style="cursor: pointer;"
                  />
                </g>
              {/snippet}
            </TooltipTrigger>
            <TooltipContent>
              <div class="space-y-1">
                <div class="font-semibold">{r.name}</div>
                <div class="font-mono text-[0.65rem] text-muted-foreground">{r.term_id}</div>
                <div class="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-[0.7rem]">
                  <span
                    class="text-muted-foreground"
                    title="Fold enrichment: how many times more genes than expected">fold</span
                  >
                  <span class="font-mono tabular-nums">{r.fold.toFixed(2)}×</span>
                  <span
                    class="text-muted-foreground"
                    title="Genes in your list with this term / genes in your list">k / n</span
                  >
                  <span class="font-mono tabular-nums">{r.k} / {r.n}</span>
                  <span
                    class="text-muted-foreground"
                    title="Genes in the background with this term / genes in the background"
                    >K / N</span
                  >
                  <span class="font-mono tabular-nums">{r.K} / {r.N}</span>
                  <span class="text-muted-foreground" title="p-value from the hypergeometric test"
                    >p</span
                  >
                  <span class="font-mono tabular-nums"
                    >{r.p === 0
                      ? '< 1e-300'
                      : r.p < 0.01
                        ? r.p.toExponential(2)
                        : r.p.toFixed(3)}</span
                  >
                  <span
                    class="text-muted-foreground"
                    title="q-value: p-value corrected for testing many terms">q</span
                  >
                  <span class="font-mono tabular-nums"
                    >{r.q === 0
                      ? '< 1e-300'
                      : r.q < 0.01
                        ? r.q.toExponential(2)
                        : r.q.toFixed(3)}</span
                  >
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        {/each}

        <!-- Colour legend -->
        {#each legendStops as s, i (i)}
          <rect
            x={WIDTH - MARGIN_RIGHT + 12}
            y={MARGIN_TOP + i * 12}
            width="14"
            height="12"
            fill={s.color}
          />
        {/each}
        <text
          x={WIDTH - MARGIN_RIGHT + 12}
          y={MARGIN_TOP - 6}
          class="fill-foreground"
          style="font-size: 10px; font-weight: 500;"
        >
          -log10(q)
        </text>
        {#each legendStops as s, i (i)}
          <text
            x={WIDTH - MARGIN_RIGHT + 30}
            y={MARGIN_TOP + i * 12 + 9}
            class="fill-muted-foreground"
            style="font-size: 10px;"
          >
            {s.value}
          </text>
        {/each}

        <!-- Size legend -->
        <text
          x={WIDTH - MARGIN_RIGHT + 12}
          y={sizeLegendY}
          class="fill-foreground"
          style="font-size: 10px; font-weight: 500;"
        >
          genes (k)
        </text>
        {#each sizeLegendKs as k, i (i)}
          {@const lx = WIDTH - MARGIN_RIGHT + 22}
          {@const ly = sizeLegendY + 14 + i * 24}
          <circle cx={lx} cy={ly} r={rFor(k)} fill="hsl(var(--muted-foreground))" opacity="0.6" />
          <text x={lx + 18} y={ly + 3} class="fill-muted-foreground" style="font-size: 10px;">
            {k}
          </text>
        {/each}
      </svg>
    </div>
  </TooltipProvider>
{/if}
