<script lang="ts">
  import type { GseaResult } from '$lib/db/client';
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

  type SortBy = 'nes' | 'q' | 'size';

  let {
    results,
    max = 25,
    linkFor,
    sortBy = 'nes',
    svgEl = $bindable(null),
  }: {
    results: GseaResult[];
    max?: number;
    linkFor?: (r: GseaResult) => string | null;
    sortBy?: SortBy;
    svgEl?: SVGSVGElement | null;
  } = $props();

  const top = $derived.by(() => {
    // Pick top by |NES| so up- and down-regulated both have a shot.
    const pool = [...results].sort((a, b) => Math.abs(b.nes) - Math.abs(a.nes)).slice(0, max);
    if (sortBy === 'q') pool.sort((a, b) => a.q - b.q || a.p - b.p);
    else if (sortBy === 'size') pool.sort((a, b) => b.size - a.size);
    else pool.sort((a, b) => b.nes - a.nes); // nes: up on top, down on bottom
    return pool;
  });

  // Tall enough for a term name wrapped onto two lines.
  const ROW = 26;
  const LABEL_CHARS = 42;
  const MARGIN_LEFT = 280;
  const MARGIN_RIGHT = 100;
  const MARGIN_TOP = 30;
  const MARGIN_BOTTOM = 36;
  const WIDTH = 780;

  const innerW = $derived(WIDTH - MARGIN_LEFT - MARGIN_RIGHT);
  const innerH = $derived(top.length * ROW);

  const nesAbsMax = $derived(Math.max(1.5, ...top.map((r) => Math.abs(r.nes))));
  const sizeMax = $derived(Math.max(1, ...top.map((r) => r.size)));
  const logQMax = $derived(Math.max(1, ...top.map((r) => (r.q > 0 ? -Math.log10(r.q) : 30))));
  // Colour spans the terms actually plotted unless the user fixed the scale, so a page of strong
  // hits still uses the whole range and plots from different lists can share one legend.
  const dataQMin = $derived(
    Math.min(logQMax, ...top.map((r) => (r.q > 0 ? -Math.log10(r.q) : 30))),
  );
  const scaleMin = $derived(qScale.fixed ? qScale.min! : Math.floor(dataQMin * 2) / 2);
  const scaleMax = $derived(qScale.fixed ? qScale.max! : Math.ceil(logQMax * 2) / 2);
  const scaleGroup = 'qscale-gsea';
  onMount(() => qScale.init());

  function xFor(nes: number): number {
    const cx = MARGIN_LEFT + innerW / 2;
    const t = nes / nesAbsMax;
    return cx + t * (innerW / 2);
  }

  function rFor(size: number): number {
    const tMin = 4;
    const tMax = 11;
    const t = Math.sqrt(size / Math.max(1, sizeMax));
    return tMin + t * (tMax - tMin);
  }

  // Both scales are derived from the plotted terms, so panels side by side share
  // neither ramp nor radius meaning.
  const legendStops = $derived(
    niceTicks(scaleMin, scaleMax, 5).values.map((value) => ({
      value,
      color: colorFor(Math.pow(10, -value)),
    })),
  );
  const sizeLegendY = $derived(MARGIN_TOP + legendStops.length * 12 + 24);
  const sizeLegendSizes = $derived([
    Math.max(1, Math.round(sizeMax / 4)),
    Math.max(2, Math.round(sizeMax / 2)),
    sizeMax,
  ]);

  // The legend column can outrun a short plot.
  const legendBottom = $derived(sizeLegendY + 14 + sizeLegendSizes.length * 24 + 14);
  const height = $derived(
    Math.max(MARGIN_TOP + innerH + MARGIN_BOTTOM, legendBottom + MARGIN_BOTTOM),
  );

  function colorFor(q: number): string {
    const v = q > 0 ? -Math.log10(q) : logQMax;
    return rangeColor(scaleMax > scaleMin ? (v - scaleMin) / (scaleMax - scaleMin) : 1);
  }

  const ticks = $derived(niceTicks(-nesAbsMax, nesAbsMax, 4));
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
        title="Dot color shows -log10 of the q-value (false discovery rate, FDR). Larger means more significant."
        >color scale -log10(q)</span
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
        title="Lowest -log10(q) on the color scale"
      />
      <span>to</span>
      <input
        type="number"
        step="0.5"
        min="0"
        value={scaleMax}
        onchange={(e) => qScale.set(qScale.min ?? scaleMin, Number(e.currentTarget.value))}
        class="w-14 rounded border bg-card px-1 py-0.5 font-mono"
        title="Highest -log10(q) on the color scale. Terms at or above this value take the end color."
      />
    </div>
    <div class="overflow-x-auto">
      <svg
        bind:this={svgEl}
        viewBox="0 0 {WIDTH} {height}"
        class="w-full"
        style="min-width: 640px; max-width: 940px;"
        role="img"
        aria-label="GSEA dot plot"
      >
        {#each ticks.values as t (t)}
          <line
            x1={xFor(t)}
            x2={xFor(t)}
            y1={MARGIN_TOP - 4}
            y2={MARGIN_TOP + innerH}
            stroke="hsl(var(--border))"
            stroke-dasharray={t === 0 ? '0' : '2 3'}
            stroke-width={t === 0 ? '1' : '0.5'}
            opacity={t === 0 ? 0.8 : 1}
          />
        {/each}

        {#each ticks.values as t (t)}
          <text
            x={xFor(t)}
            y={MARGIN_TOP + innerH + 14}
            text-anchor="middle"
            class="fill-muted-foreground"
            style="font-size: 10px;"
          >
            {ticks.format(t)}
          </text>
        {/each}
        <text
          x={MARGIN_LEFT + innerW / 2}
          y={MARGIN_TOP + innerH + 30}
          text-anchor="middle"
          class="fill-foreground"
          style="font-size: 11px; font-weight: 500;"
        >
          NES (normalized enrichment score)
        </text>

        {#each top as r, i (r.term_id + ':' + i)}
          {@const cy = MARGIN_TOP + i * ROW + ROW / 2}
          {@const cx = xFor(r.nes)}
          {@const rad = rFor(r.size)}
          {@const fill = colorFor(r.q)}
          {@const link = linkFor ? linkFor(r) : null}

          <line
            x1={MARGIN_LEFT}
            x2={MARGIN_LEFT + innerW}
            y1={cy}
            y2={cy}
            stroke="hsl(var(--border))"
            stroke-width="0.5"
            opacity="0.5"
          />

          {#if link}
            <a href={resolve(link as '/')} class="hover:underline">
              {@render termLabel(r.name, cy)}
            </a>
          {:else}
            {@render termLabel(r.name, cy)}
          {/if}

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
                  <span class="text-muted-foreground" title="Normalized enrichment score">NES</span>
                  <span class="font-mono tabular-nums">{r.nes.toFixed(3)}</span>
                  <span class="text-muted-foreground" title="Enrichment score">ES</span>
                  <span class="font-mono tabular-nums">{r.es.toFixed(3)}</span>
                  <span class="text-muted-foreground">size</span>
                  <span class="font-mono tabular-nums">{r.size}</span>
                  <span class="text-muted-foreground">p</span>
                  <span class="font-mono tabular-nums">
                    {r.p === 0 ? '< 1e-300' : r.p < 0.01 ? r.p.toExponential(2) : r.p.toFixed(3)}
                  </span>
                  <span class="text-muted-foreground" title="False discovery rate (FDR)">q</span>
                  <span class="font-mono tabular-nums">
                    {r.q === 0 ? '< 1e-300' : r.q < 0.01 ? r.q.toExponential(2) : r.q.toFixed(3)}
                  </span>
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        {/each}

        {#each legendStops as st, i (i)}
          <rect
            x={WIDTH - MARGIN_RIGHT + 12}
            y={MARGIN_TOP + i * 12}
            width="14"
            height="12"
            fill={st.color}
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
        {#each legendStops as st, i (i)}
          <text
            x={WIDTH - MARGIN_RIGHT + 30}
            y={MARGIN_TOP + i * 12 + 9}
            class="fill-muted-foreground"
            style="font-size: 10px;"
          >
            {st.value}
          </text>
        {/each}

        <text
          x={WIDTH - MARGIN_RIGHT + 12}
          y={sizeLegendY}
          class="fill-foreground"
          style="font-size: 10px; font-weight: 500;"
        >
          set size
        </text>
        {#each sizeLegendSizes as sz, i (i)}
          {@const lx = WIDTH - MARGIN_RIGHT + 22}
          {@const ly = sizeLegendY + 14 + i * 24}
          <circle cx={lx} cy={ly} r={rFor(sz)} fill="hsl(var(--muted-foreground))" opacity="0.6" />
          <text x={lx + 18} y={ly + 3} class="fill-muted-foreground" style="font-size: 10px;">
            {sz}
          </text>
        {/each}

        <text
          x={WIDTH - MARGIN_RIGHT + 12}
          y={sizeLegendY + 14 + sizeLegendSizes.length * 24 + 10}
          class="fill-muted-foreground"
          style="font-size: 9px; font-style: italic;"
        >
          scaled per plot
        </text>
      </svg>
    </div>
  </TooltipProvider>
{/if}
