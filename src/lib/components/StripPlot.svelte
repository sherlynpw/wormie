<script lang="ts">
  // Generic 1-D strip plot: dots on a categorical x-axis with horizontal jitter
  // and optional median tick per group. Reusable for per-gene counts, expression
  // levels across conditions, score distributions, etc.

  export interface StripPoint {
    id: string;
    group: string;
    value: number;
  }

  import PlotExportMenu from './PlotExportMenu.svelte';
  import { niceTicks } from '$lib/nice-ticks';
  import { CONDITION_PALETTE, referenceFirst } from '$lib/plot-colors';

  let {
    points,
    yLabel,
    title,
    logY = false,
    height = 280,
    width: widthOverride = null,
    showMedian = true,
    exportName,
    reference,
  }: {
    points: StripPoint[];
    yLabel: string;
    title?: string;
    logY?: boolean;
    height?: number;
    width?: number | null;
    showMedian?: boolean;
    exportName?: string;
    /** Reference condition; drawn in the first palette colour. */
    reference?: string | null;
  } = $props();

  const PAD_L = 56;
  const PAD_R = 14;
  const PAD_T = 14;
  const PAD_B = 36;
  const GROUP_MIN_W = 80;

  const groups = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of points) {
      if (!seen.has(p.group)) {
        seen.add(p.group);
        out.push(p.group);
      }
    }
    return referenceFirst(out, reference);
  });

  const transformed = $derived.by(() => {
    if (!logY) return points;
    return points.map((p) => ({
      ...p,
      value: p.value > 0 ? Math.log10(p.value + 1) : 0,
    }));
  });

  const width = $derived(
    widthOverride ?? Math.max(320, PAD_L + PAD_R + groups.length * GROUP_MIN_W + 8),
  );
  const innerW = $derived(width - PAD_L - PAD_R);
  const innerH = $derived(height - PAD_T - PAD_B);
  const groupW = $derived(groups.length > 0 ? innerW / groups.length : innerW);

  const yRange = $derived.by<[number, number]>(() => {
    if (transformed.length === 0) return [0, 1];
    let lo = Infinity,
      hi = -Infinity;
    for (const p of transformed) {
      if (!Number.isFinite(p.value)) continue;
      if (p.value < lo) lo = p.value;
      if (p.value > hi) hi = p.value;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
    const pad = (hi - lo) * 0.08 || Math.max(0.1, Math.abs(hi) * 0.1);
    const ylo = logY ? Math.max(0, lo - pad) : lo - pad;
    return [ylo, hi + pad];
  });

  function yFor(v: number): number {
    return PAD_T + ((yRange[1] - v) / Math.max(1e-9, yRange[1] - yRange[0])) * innerH;
  }
  function xCenter(g: string): number {
    const i = groups.indexOf(g);
    return PAD_L + i * groupW + groupW / 2;
  }

  // Deterministic per-id jitter (FNV-1a hash): same point always lands in the same spot.
  function jitter(id: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return ((h % 1000) / 1000 - 0.5) * Math.min(groupW * 0.6, 60);
  }

  const PALETTE = CONDITION_PALETTE;
  function colorFor(g: string): string {
    const i = groups.indexOf(g);
    return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
  }

  const medians = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const out = new Map<string, number>();
    for (const g of groups) {
      const vs = transformed
        .filter((p) => p.group === g && Number.isFinite(p.value))
        .map((p) => p.value)
        .sort((a, b) => a - b);
      if (vs.length === 0) continue;
      const mid = (vs.length - 1) / 2;
      const lo = Math.floor(mid),
        hi = Math.ceil(mid);
      out.set(g, lo === hi ? vs[lo] : (vs[lo] + vs[hi]) / 2);
    }
    return out;
  });

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
    viewBox="0 0 {width} {height}"
    {width}
    {height}
    class="block"
    role="img"
    aria-label="Strip plot"
  >
    <line
      x1={PAD_L}
      x2={width - PAD_R}
      y1={height - PAD_B}
      y2={height - PAD_B}
      stroke="hsl(var(--border))"
    />
    <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={height - PAD_B} stroke="hsl(var(--border))" />

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

    {#each groups as g (g)}
      {@const xc = xCenter(g)}
      <text
        x={xc}
        y={height - PAD_B + 14}
        font-size="10"
        text-anchor="middle"
        fill="hsl(var(--muted-foreground))">{g}</text
      >
      {#if showMedian && medians.has(g)}
        <line
          x1={xc - groupW / 3}
          x2={xc + groupW / 3}
          y1={yFor(medians.get(g) ?? 0)}
          y2={yFor(medians.get(g) ?? 0)}
          stroke={colorFor(g)}
          stroke-width="2"
          opacity="0.85"
        />
      {/if}
    {/each}

    {#each transformed as p (p.id)}
      {#if Number.isFinite(p.value)}
        <circle
          cx={xCenter(p.group) + jitter(p.id)}
          cy={yFor(p.value)}
          r={4}
          fill={colorFor(p.group)}
          fill-opacity="0.75"
          stroke="white"
          stroke-width="0.6"
        >
          <title>{p.id} · {p.group} · {p.value.toFixed(3)}</title>
        </circle>
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
    <span class="ml-auto font-mono">{transformed.length} points</span>
  </div>
</div>
