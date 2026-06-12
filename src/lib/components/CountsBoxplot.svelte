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

  const PALETTE = [
    'hsl(220 70% 60%)',
    'hsl(0 72% 55%)',
    'hsl(140 60% 45%)',
    'hsl(280 60% 55%)',
    'hsl(35 90% 55%)',
    'hsl(180 60% 45%)',
    'hsl(320 60% 55%)',
    'hsl(60 70% 50%)',
  ];

  import PlotExportMenu from './PlotExportMenu.svelte';

  let {
    boxes,
    title,
    yLabel = 'log10(count + 1)',
    height = 320,
    labelMaxChars = 16,
    exportName,
  }: {
    boxes: SampleBox[];
    title?: string;
    yLabel?: string;
    height?: number;
    labelMaxChars?: number;
    exportName?: string;
  } = $props();

  const PAD_L = 52;
  const PAD_R = 14;
  const PAD_T = 14;
  const PAD_B = 96;
  const BOX_GAP = 12;
  const BOX_MIN_W = 18;

  function shorten(s: string): string {
    return s.length > labelMaxChars ? s.slice(0, labelMaxChars - 1) + '…' : s;
  }

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
    return out;
  });
  function fillFor(b: SampleBox): string {
    if (!b.condition || conditions.length === 0) return 'hsl(220 70% 60% / 0.55)';
    const i = conditions.indexOf(b.condition);
    const hue = PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
    return hue.replace(/\)$/, ' / 0.55)');
  }
  function strokeFor(b: SampleBox): string {
    if (!b.condition || conditions.length === 0) return 'hsl(220 70% 35%)';
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
  const innerH = $derived(height - PAD_T - PAD_B);
  function yFor(v: number): number {
    return PAD_T + ((yRange[1] - v) / Math.max(1e-9, yRange[1] - yRange[0])) * innerH;
  }
  const boxW = $derived(boxes.length > 0 ? innerW / boxes.length - BOX_GAP : BOX_MIN_W);

  const yTicks = $derived.by(() => {
    const lo = yRange[0],
      hi = yRange[1];
    return Array.from({ length: 5 }, (_, i) => lo + (i / 4) * (hi - lo));
  });

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
    aria-label="Counts boxplot"
  >
    <line
      x1={PAD_L}
      x2={width - PAD_R}
      y1={height - PAD_B}
      y2={height - PAD_B}
      stroke="hsl(var(--border))"
    />
    <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={height - PAD_B} stroke="hsl(var(--border))" />

    {#each yTicks as t (t)}
      {@const y = yFor(t)}
      <line x1={PAD_L - 3} x2={PAD_L} {y} y2={y} stroke="hsl(var(--muted-foreground))" />
      <text
        x={PAD_L - 5}
        y={y + 3}
        font-size="9"
        text-anchor="end"
        fill="hsl(var(--muted-foreground))">{t.toFixed(1)}</text
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
        y={height - PAD_B + 12}
        font-size="9"
        text-anchor="end"
        transform="rotate(-55 {xMid} {height - PAD_B + 12})"
        fill="hsl(var(--muted-foreground))">{shorten(b.sample)}<title>{b.sample}</title></text
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
