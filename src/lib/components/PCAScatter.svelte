<script lang="ts">
  // Generic 2-D PCA / sample scatter. Color encodes a primary category
  // (e.g. condition); optional shape encodes a secondary one (e.g. batch).

  export interface PCAPoint {
    sample: string;
    x: number;
    y: number;
    group: string;
    shape?: string | null;
    /** Short text drawn beside the point, e.g. a replicate number. */
    label?: string | null;
  }

  import PlotExportMenu from './PlotExportMenu.svelte';
  import { niceTicks } from '$lib/nice-ticks';
  import { CONDITION_PALETTE, referenceFirst } from '$lib/plot-colors';

  let {
    points,
    xLabel,
    yLabel,
    title,
    width = 520,
    height = 360,
    exportName,
    reference,
  }: {
    points: PCAPoint[];
    xLabel: string;
    yLabel: string;
    title?: string;
    width?: number;
    height?: number;
    exportName?: string;
    /** Reference condition; drawn in the first palette colour. */
    reference?: string | null;
  } = $props();

  const PAD_L = 52;
  const PAD_R = 14;
  const PAD_T = 14;
  const PAD_B = 36;

  const groups = $derived(
    referenceFirst(Array.from(new Set(points.map((p) => p.group))), reference),
  );
  const shapes = $derived(
    Array.from(new Set(points.map((p) => p.shape).filter((s): s is string => !!s))),
  );

  const PALETTE = CONDITION_PALETTE;
  const SHAPES = ['circle', 'square', 'triangle', 'diamond'];

  function colorFor(g: string): string {
    const i = groups.indexOf(g);
    return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
  }
  function shapeFor(s: string | null | undefined): string {
    if (!s) return 'circle';
    const i = shapes.indexOf(s);
    return SHAPES[((i % SHAPES.length) + SHAPES.length) % SHAPES.length];
  }

  const xRange = $derived.by(() => {
    if (points.length === 0) return [-1, 1];
    let lo = Infinity,
      hi = -Infinity;
    for (const p of points) {
      if (p.x < lo) lo = p.x;
      if (p.x > hi) hi = p.x;
    }
    const pad = (hi - lo) * 0.1 || 1;
    return [lo - pad, hi + pad];
  });
  const yRange = $derived.by(() => {
    if (points.length === 0) return [-1, 1];
    let lo = Infinity,
      hi = -Infinity;
    for (const p of points) {
      if (p.y < lo) lo = p.y;
      if (p.y > hi) hi = p.y;
    }
    const pad = (hi - lo) * 0.1 || 1;
    return [lo - pad, hi + pad];
  });

  const innerW = $derived(width - PAD_L - PAD_R);
  const innerH = $derived(height - PAD_T - PAD_B);
  function xFor(v: number): number {
    return PAD_L + ((v - xRange[0]) / Math.max(1e-9, xRange[1] - xRange[0])) * innerW;
  }
  function yFor(v: number): number {
    return PAD_T + ((yRange[1] - v) / Math.max(1e-9, yRange[1] - yRange[0])) * innerH;
  }

  const xTicks = $derived(niceTicks(xRange[0], xRange[1]));
  const yTicks = $derived(niceTicks(yRange[0], yRange[1]));

  function shapePath(kind: string, cx: number, cy: number, r: number): string {
    if (kind === 'square') return `M${cx - r},${cy - r} h${r * 2} v${r * 2} h${-r * 2} Z`;
    if (kind === 'triangle') return `M${cx},${cy - r} L${cx + r},${cy + r} L${cx - r},${cy + r} Z`;
    if (kind === 'diamond')
      return `M${cx},${cy - r} L${cx + r},${cy} L${cx},${cy + r} L${cx - r},${cy} Z`;
    return '';
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
  <svg
    bind:this={svgEl}
    viewBox="0 0 {width} {height}"
    {width}
    {height}
    class="block"
    role="img"
    aria-label="PCA scatter"
  >
    <line
      x1={PAD_L}
      x2={width - PAD_R}
      y1={height - PAD_B}
      y2={height - PAD_B}
      stroke="hsl(var(--border))"
    />
    <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={height - PAD_B} stroke="hsl(var(--border))" />

    {#each xTicks.values as t (t)}
      {@const x = xFor(t)}
      <line
        x1={x}
        x2={x}
        y1={height - PAD_B}
        y2={height - PAD_B + 3}
        stroke="hsl(var(--muted-foreground))"
      />
      <text
        {x}
        y={height - PAD_B + 14}
        font-size="9"
        text-anchor="middle"
        fill="hsl(var(--muted-foreground))">{xTicks.format(t)}</text
      >
    {/each}
    {#each yTicks.values as t (t)}
      {@const y = yFor(t)}
      <line x1={PAD_L - 3} x2={PAD_L} y1={y} y2={y} stroke="hsl(var(--muted-foreground))" />
      <text
        x={PAD_L - 5}
        y={y + 3}
        font-size="9"
        text-anchor="end"
        fill="hsl(var(--muted-foreground))">{yTicks.format(t)}</text
      >
    {/each}

    <text
      x={PAD_L + innerW / 2}
      y={height - 6}
      font-size="10"
      text-anchor="middle"
      fill="hsl(var(--muted-foreground))">{xLabel}</text
    >
    <text
      x={12}
      y={PAD_T + innerH / 2}
      font-size="10"
      transform="rotate(-90 12 {PAD_T + innerH / 2})"
      text-anchor="middle"
      fill="hsl(var(--muted-foreground))">{yLabel}</text
    >

    {#each points as p (p.sample)}
      {@const cx = xFor(p.x)}
      {@const cy = yFor(p.y)}
      {@const c = colorFor(p.group)}
      {@const sh = shapeFor(p.shape)}
      {#if p.label}
        <text x={cx + 8} y={cy + 3} font-size="9" fill="hsl(var(--muted-foreground))"
          >{p.label}</text
        >
      {/if}
      {#if sh === 'circle'}
        <circle {cx} {cy} r={5} fill={c} stroke="white" stroke-width="0.6">
          <title>{p.sample} · {p.group}{p.shape ? ' · ' + p.shape : ''}</title>
        </circle>
      {:else}
        <path d={shapePath(sh, cx, cy, 5)} fill={c} stroke="white" stroke-width="0.6">
          <title>{p.sample} · {p.group}{p.shape ? ' · ' + p.shape : ''}</title>
        </path>
      {/if}
    {/each}
  </svg>
  <div class="mt-2 flex flex-wrap items-center gap-3 text-[0.65rem] text-muted-foreground">
    {#each groups as g (g)}
      <span class="inline-flex items-center gap-1">
        <span class="inline-block h-2 w-2 rounded-full" style="background: {colorFor(g)}"></span>
        {g}
      </span>
    {/each}
    {#if shapes.length > 0}
      <span class="ml-2 inline-flex items-center gap-2">
        {#each shapes as s (s)}
          <span class="inline-flex items-center gap-1">
            <svg width="10" height="10" viewBox="-6 -6 12 12">
              {#if shapeFor(s) === 'circle'}
                <circle cx="0" cy="0" r="4" fill="currentColor" />
              {:else}
                <path d={shapePath(shapeFor(s), 0, 0, 4)} fill="currentColor" />
              {/if}
            </svg>
            {s}
          </span>
        {/each}
      </span>
    {/if}
    <span class="ml-auto font-mono">{points.length} samples</span>
  </div>
</div>
