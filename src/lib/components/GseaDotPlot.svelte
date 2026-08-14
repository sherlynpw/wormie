<script lang="ts">
  import type { GseaResult } from '$lib/db/client';
  import {
    Tooltip,
    TooltipTrigger,
    TooltipContent,
    TooltipProvider,
  } from '$lib/components/ui/tooltip';
  import { resolve } from '$app/paths';

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

  const ROW = 20;
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
    Array.from({ length: 6 }, (_, i) => {
      const t = i / 5;
      return { value: t * logQMax, color: colorFor(Math.pow(10, -t * logQMax)) };
    }),
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
    const v = Math.min(1, q > 0 ? -Math.log10(q) / logQMax : 1);
    const stops: [number, [number, number, number]][] = [
      [0.0, [68, 1, 84]],
      [0.25, [59, 82, 139]],
      [0.5, [33, 145, 140]],
      [0.75, [94, 201, 98]],
      [1.0, [253, 231, 37]],
    ];
    for (let i = 0; i < stops.length - 1; i++) {
      const [a, ca] = stops[i];
      const [b, cb] = stops[i + 1];
      if (v >= a && v <= b) {
        const t = b === a ? 0 : (v - a) / (b - a);
        const r = Math.round(ca[0] + t * (cb[0] - ca[0]));
        const g = Math.round(ca[1] + t * (cb[1] - ca[1]));
        const bl = Math.round(ca[2] + t * (cb[2] - ca[2]));
        return `rgb(${r}, ${g}, ${bl})`;
      }
    }
    return 'rgb(253,231,37)';
  }

  function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  const ticks = $derived([-nesAbsMax, -nesAbsMax / 2, 0, nesAbsMax / 2, nesAbsMax]);
</script>

{#if top.length === 0}
  <div class="py-10 text-center text-sm text-muted-foreground">No enriched terms to plot.</div>
{:else}
  <TooltipProvider delayDuration={120}>
    <div class="overflow-x-auto">
      <svg
        bind:this={svgEl}
        viewBox="0 0 {WIDTH} {height}"
        class="w-full"
        style="min-width: 640px; max-width: 940px;"
        role="img"
        aria-label="GSEA dot plot"
      >
        {#each ticks as t (t)}
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

        {#each ticks as t (t)}
          <text
            x={xFor(t)}
            y={MARGIN_TOP + innerH + 14}
            text-anchor="middle"
            class="fill-muted-foreground"
            style="font-size: 10px;"
          >
            {t.toFixed(1)}
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
              <text
                x={MARGIN_LEFT - 8}
                y={cy + 4}
                text-anchor="end"
                class="fill-foreground"
                style="font-size: 11px;"
              >
                {truncate(r.name, 38)}
              </text>
            </a>
          {:else}
            <text
              x={MARGIN_LEFT - 8}
              y={cy + 4}
              text-anchor="end"
              class="fill-foreground"
              style="font-size: 11px;"
            >
              {truncate(r.name, 38)}
            </text>
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
                  <span class="text-muted-foreground">NES</span>
                  <span class="font-mono tabular-nums">{r.nes.toFixed(3)}</span>
                  <span class="text-muted-foreground">ES</span>
                  <span class="font-mono tabular-nums">{r.es.toFixed(3)}</span>
                  <span class="text-muted-foreground">size</span>
                  <span class="font-mono tabular-nums">{r.size}</span>
                  <span class="text-muted-foreground">p</span>
                  <span class="font-mono tabular-nums">
                    {r.p === 0 ? '< 1e-300' : r.p < 0.01 ? r.p.toExponential(2) : r.p.toFixed(3)}
                  </span>
                  <span class="text-muted-foreground">q</span>
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
            {st.value.toFixed(1)}
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
