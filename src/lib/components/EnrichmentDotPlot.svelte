<script lang="ts">
  import type { EnrichmentResult } from '$lib/db/client';
  import {
    Tooltip,
    TooltipTrigger,
    TooltipContent,
    TooltipProvider,
  } from '$lib/components/ui/tooltip';
  import { resolve } from '$app/paths';

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

  // Pick top `max` by q, then reorder within that pool by sortBy.
  const top = $derived.by(() => {
    const pool = [...results].sort((a, b) => a.q - b.q || a.p - b.p).slice(0, max);
    if (sortBy === 'fold') pool.sort((a, b) => b.fold - a.fold);
    else if (sortBy === 'k') pool.sort((a, b) => b.k - a.k);
    else pool.sort((a, b) => a.q - b.q || a.p - b.p);
    return pool;
  });

  // Layout
  const ROW = 20;
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

  // Viridis-ish 5-stop gradient (perceptually uniform, no external lib).
  function colorFor(q: number): string {
    const v = Math.min(1, q > 0 ? -Math.log10(q) / logQMax : 1);
    // Stops: deep purple -> blue -> teal -> green -> yellow
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

  function ticks(maxV: number, n: number): number[] {
    const step = maxV / n;
    const out: number[] = [];
    for (let i = 0; i <= n; i++) out.push(i * step);
    return out;
  }

  const fold_ticks = $derived(ticks(foldMax, 4));

  // Right-side legends: colour = -log10(q), size = gene count k.
  const legendStops = $derived(
    Array.from({ length: 6 }, (_, i) => {
      const t = i / 5;
      return { value: t * logQMax, color: colorFor(Math.pow(10, -t * logQMax)) };
    }),
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

{#if top.length === 0}
  <div class="py-10 text-center text-sm text-muted-foreground">No enriched terms to plot.</div>
{:else}
  <TooltipProvider delayDuration={120}>
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
        {#each fold_ticks as t (t)}
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
        {#each fold_ticks as t (t)}
          <text
            x={xFor(t)}
            y={MARGIN_TOP + innerH + 14}
            text-anchor="middle"
            class="fill-muted-foreground"
            style="font-size: 10px;"
          >
            {t.toFixed(t < 10 ? 1 : 0)}×
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
                  <span class="text-muted-foreground">fold</span>
                  <span class="font-mono tabular-nums">{r.fold.toFixed(2)}×</span>
                  <span class="text-muted-foreground">k / n</span>
                  <span class="font-mono tabular-nums">{r.k} / {r.n}</span>
                  <span class="text-muted-foreground">K / N</span>
                  <span class="font-mono tabular-nums">{r.K} / {r.N}</span>
                  <span class="text-muted-foreground">p</span>
                  <span class="font-mono tabular-nums"
                    >{r.p === 0
                      ? '< 1e-300'
                      : r.p < 0.01
                        ? r.p.toExponential(2)
                        : r.p.toFixed(3)}</span
                  >
                  <span class="text-muted-foreground">q</span>
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
            {s.value.toFixed(1)}
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
