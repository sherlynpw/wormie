<script lang="ts">
  // Generic p-value histogram (0..1 binned). Pure SVG so it composes with
  // PlotExportMenu via the getSvg() accessor.

  import PlotExportMenu from './PlotExportMenu.svelte';

  let {
    values,
    bins = 40,
    title,
    height = 200,
    width = 720,
    exportName,
  }: {
    values: number[];
    bins?: number;
    title?: string;
    height?: number;
    width?: number;
    exportName?: string;
  } = $props();

  const PAD_L = 44;
  const PAD_R = 12;
  const PAD_T = 10;
  const PAD_B = 28;

  const counts = $derived.by(() => {
    const c = new Array<number>(bins).fill(0);
    for (const v of values) {
      if (!Number.isFinite(v)) continue;
      const p = Math.min(0.9999999, Math.max(0, v));
      c[Math.min(bins - 1, Math.floor(p * bins))]++;
    }
    return c;
  });

  const maxCount = $derived(counts.reduce((m, v) => (v > m ? v : m), 0));
  const innerW = $derived(width - PAD_L - PAD_R);
  const innerH = $derived(height - PAD_T - PAD_B);
  const barW = $derived(innerW / bins);

  function yFor(c: number): number {
    if (maxCount <= 0) return height - PAD_B;
    return PAD_T + innerH - (c / maxCount) * innerH;
  }

  const yTicks = $derived.by(() => {
    if (maxCount <= 0) return [0];
    const step = Math.pow(10, Math.floor(Math.log10(maxCount)));
    const out: number[] = [];
    for (let v = 0; v <= maxCount; v += step) out.push(v);
    if (out.length > 6) return [0, Math.round(maxCount / 2), maxCount];
    return out;
  });
  const xTicks = [0, 0.25, 0.5, 0.75, 1];

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
    aria-label="p-value histogram"
  >
    <line
      x1={PAD_L}
      x2={width - PAD_R}
      y1={height - PAD_B}
      y2={height - PAD_B}
      stroke="hsl(var(--border))"
    />
    <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={height - PAD_B} stroke="hsl(var(--border))" />

    {#each counts as c, i (i)}
      <rect
        x={PAD_L + i * barW + 0.5}
        y={yFor(c)}
        width={Math.max(0, barW - 1)}
        height={height - PAD_B - yFor(c)}
        fill="hsl(220 70% 50% / 0.7)"
      />
    {/each}

    {#each xTicks as t (t)}
      {@const x = PAD_L + t * innerW}
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
        fill="hsl(var(--muted-foreground))">{t}</text
      >
    {/each}
    {#each yTicks as t (t)}
      {@const y = yFor(t)}
      <line x1={PAD_L - 3} x2={PAD_L} {y} y2={y} stroke="hsl(var(--muted-foreground))" />
      <text
        x={PAD_L - 5}
        y={y + 3}
        font-size="9"
        text-anchor="end"
        fill="hsl(var(--muted-foreground))">{t}</text
      >
    {/each}
    <text
      x={PAD_L + innerW / 2}
      y={height - 4}
      font-size="10"
      text-anchor="middle"
      fill="hsl(var(--muted-foreground))">p-value</text
    >
    <text
      x={12}
      y={PAD_T + innerH / 2}
      font-size="10"
      text-anchor="middle"
      transform="rotate(-90 12 {PAD_T + innerH / 2})"
      fill="hsl(var(--muted-foreground))">count</text
    >
  </svg>
</div>
