<script lang="ts">
  // Per-sample box plot of log10(count + 1). One box per sample, side-by-side.

  export interface SampleBox {
    sample: string;
    min: number;
    q1: number;
    median: number;
    q3: number;
    max: number;
    condition?: string | null;
  }

  const PALETTE = CONDITION_PALETTE;

  import PlotExportMenu from './PlotExportMenu.svelte';
  import { niceTicks } from '$lib/nice-ticks';
  import { CONDITION_PALETTE, DOWN_COLOR, downAlpha, referenceFirst } from '$lib/plot-colors';

  let {
    boxes,
    title,
    yLabel = 'log10(count + 1)',
    height = 320,
    exportName,
    reference,
  }: {
    boxes: SampleBox[];
    title?: string;
    yLabel?: string;
    height?: number;
    exportName?: string;
    /** Reference condition; drawn in the first palette colour. */
    reference?: string | null;
  } = $props();

  const LABEL_ANGLE = 55;
  // 9px sans advances ~5.2px per character; rotated labels hang down-left of their box,
  // so both margins grow with the longest sample name.
  const labelPx = $derived(Math.max(0, ...boxes.map((b) => b.sample.length)) * 5.2);
  const rad = (LABEL_ANGLE * Math.PI) / 180;
  const PAD_L = $derived(Math.max(52, Math.ceil(labelPx * Math.cos(rad)) - 4));
  const PAD_R = 14;
  const PAD_T = 14;
  const PAD_B = $derived(Math.max(40, Math.ceil(labelPx * Math.sin(rad)) + 20));
  // `height` budgets 96px for labels; longer names extend the SVG instead of squeezing the plot.
  const svgH = $derived(height - 96 + PAD_B);
  const BOX_GAP = 12;
  const BOX_MIN_W = 18;

  const conditions = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const seen = new Set<string>();
    const out: string[] = [];
    for (const b of boxes) {
      const c = b.condition;
      if (c && !seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return referenceFirst(out, reference);
  });
  function fillFor(b: SampleBox): string {
    if (!b.condition || conditions.length === 0) return downAlpha(0.55);
    const i = conditions.indexOf(b.condition);
    const hue = PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
    return hue.replace(/\)$/, ' / 0.55)');
  }
  function strokeFor(b: SampleBox): string {
    if (!b.condition || conditions.length === 0) return DOWN_COLOR;
    const i = conditions.indexOf(b.condition);
    return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
  }

  const width = $derived(Math.max(320, PAD_L + PAD_R + boxes.length * (BOX_MIN_W + BOX_GAP) + 8));

  const yRange = $derived.by<[number, number]>(() => {
    if (boxes.length === 0) return [0, 1];
    let lo = Infinity,
      hi = -Infinity;
    for (const b of boxes) {
      if (b.min < lo) lo = b.min;
      if (b.max > hi) hi = b.max;
    }
    const pad = (hi - lo) * 0.05 || 0.5;
    return [Math.max(0, lo - pad), hi + pad];
  });

  const innerW = $derived(width - PAD_L - PAD_R);
  const innerH = $derived(svgH - PAD_T - PAD_B);
  function yFor(v: number): number {
    return PAD_T + ((yRange[1] - v) / Math.max(1e-9, yRange[1] - yRange[0])) * innerH;
  }
  const boxW = $derived(boxes.length > 0 ? innerW / boxes.length - BOX_GAP : BOX_MIN_W);

  const yTicks = $derived(niceTicks(yRange[0], yRange[1]));

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
    viewBox="0 0 {width} {svgH}"
    {width}
    height={svgH}
    class="block"
    role="img"
    aria-label="Counts boxplot"
  >
    <line
      x1={PAD_L}
      x2={width - PAD_R}
      y1={svgH - PAD_B}
      y2={svgH - PAD_B}
      stroke="hsl(var(--border))"
    />
    <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={svgH - PAD_B} stroke="hsl(var(--border))" />

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
      x={12}
      y={PAD_T + innerH / 2}
      font-size="10"
      transform="rotate(-90 12 {PAD_T + innerH / 2})"
      text-anchor="middle"
      fill="hsl(var(--muted-foreground))">{yLabel}</text
    >

    {#each boxes as b, i (b.sample)}
      {@const xMid = PAD_L + i * (boxW + BOX_GAP) + boxW / 2 + BOX_GAP / 2}
      {@const xLeft = xMid - boxW / 2}
      <line
        x1={xMid}
        x2={xMid}
        y1={yFor(b.max)}
        y2={yFor(b.min)}
        stroke="hsl(var(--foreground))"
        stroke-width="0.8"
      />
      <line
        x1={xMid - boxW / 4}
        x2={xMid + boxW / 4}
        y1={yFor(b.max)}
        y2={yFor(b.max)}
        stroke="hsl(var(--foreground))"
        stroke-width="0.8"
      />
      <line
        x1={xMid - boxW / 4}
        x2={xMid + boxW / 4}
        y1={yFor(b.min)}
        y2={yFor(b.min)}
        stroke="hsl(var(--foreground))"
        stroke-width="0.8"
      />
      <rect
        x={xLeft}
        y={yFor(b.q3)}
        width={boxW}
        height={Math.max(1, yFor(b.q1) - yFor(b.q3))}
        fill={fillFor(b)}
        stroke={strokeFor(b)}
        stroke-width="0.8"
      />
      <line
        x1={xLeft}
        x2={xLeft + boxW}
        y1={yFor(b.median)}
        y2={yFor(b.median)}
        stroke="hsl(0 0% 10%)"
        stroke-width="1.2"
      />
      <text
        x={xMid}
        y={svgH - PAD_B + 12}
        font-size="9"
        text-anchor="end"
        transform="rotate(-{LABEL_ANGLE} {xMid} {svgH - PAD_B + 12})"
        fill="hsl(var(--muted-foreground))">{b.sample}</text
      >
    {/each}
  </svg>
  {#if conditions.length > 0}
    <div class="mt-2 flex flex-wrap items-center gap-3 text-[0.65rem] text-muted-foreground">
      {#each conditions as c, i (c)}
        <span class="inline-flex items-center gap-1">
          <span
            class="inline-block h-2 w-2 rounded-full"
            style="background: {PALETTE[i % PALETTE.length]}"
          ></span>
          {c}
        </span>
      {/each}
    </div>
  {/if}
</div>
