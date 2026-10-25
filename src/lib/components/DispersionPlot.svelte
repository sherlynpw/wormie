<script lang="ts">
  // DESeq2 dispersion plot. Black: gene-wise estimates. Red: final
  // (shrunken) dispersions. Blue line: fitted mean-dispersion curve.

  export interface DispersionRow {
    gene: string;
    baseMean: number;
    dispGeneEst: number;
    dispFit: number;
    dispersion: number;
  }

  import PlotExportMenu from './PlotExportMenu.svelte';
  import { UP_COLOR, DOWN_COLOR, downAlpha } from '$lib/plot-colors';

  let {
    rows,
    title,
    width = 720,
    height = 360,
    exportName,
  }: {
    rows: DispersionRow[];
    title?: string;
    width?: number;
    height?: number;
    exportName?: string;
  } = $props();

  const PAD_L = 56;
  const PAD_R = 14;
  const PAD_T = 14;
  const PAD_B = 36;

  const valid = $derived(
    rows.filter(
      (r) =>
        Number.isFinite(r.baseMean) &&
        r.baseMean > 0 &&
        (Number.isFinite(r.dispGeneEst) || Number.isFinite(r.dispersion)),
    ),
  );

  const xRange = $derived.by<[number, number]>(() => {
    if (valid.length === 0) return [0, 5];
    let lo = Infinity,
      hi = -Infinity;
    for (const r of valid) {
      const v = Math.log10(r.baseMean);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return [lo - 0.1, hi + 0.1];
  });
  const yRange = $derived.by<[number, number]>(() => {
    if (valid.length === 0) return [-5, 2];
    let lo = Infinity,
      hi = -Infinity;
    for (const r of valid) {
      for (const v of [r.dispGeneEst, r.dispFit, r.dispersion]) {
        if (!Number.isFinite(v) || v <= 0) continue;
        const lv = Math.log10(v);
        if (lv < lo) lo = lv;
        if (lv > hi) hi = lv;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [-5, 2];
    return [lo - 0.2, hi + 0.2];
  });

  const innerW = $derived(width - PAD_L - PAD_R);
  const innerH = $derived(height - PAD_T - PAD_B);
  function xFor(mean: number): number {
    const v = Math.log10(mean);
    return PAD_L + ((v - xRange[0]) / Math.max(1e-9, xRange[1] - xRange[0])) * innerW;
  }
  function yFor(disp: number): number {
    const v = Math.log10(disp);
    return PAD_T + ((yRange[1] - v) / Math.max(1e-9, yRange[1] - yRange[0])) * innerH;
  }

  function logTicks(lo: number, hi: number): number[] {
    const out: number[] = [];
    for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) out.push(e);
    return out;
  }
  const xTicks = $derived(logTicks(xRange[0], xRange[1]));
  const yTicks = $derived(logTicks(yRange[0], yRange[1]));

  const fitLine = $derived.by(() => {
    const pts = valid
      .filter((r) => Number.isFinite(r.dispFit) && r.dispFit > 0)
      .map((r) => ({ x: Math.log10(r.baseMean), y: Math.log10(r.dispFit) }))
      .sort((a, b) => a.x - b.x);
    return pts;
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
    aria-label="Dispersion plot"
  >
    <line
      x1={PAD_L}
      x2={width - PAD_R}
      y1={height - PAD_B}
      y2={height - PAD_B}
      stroke="hsl(var(--border))"
    />
    <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={height - PAD_B} stroke="hsl(var(--border))" />

    {#each xTicks as t (t)}
      {@const x = PAD_L + ((t - xRange[0]) / Math.max(1e-9, xRange[1] - xRange[0])) * innerW}
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
        fill="hsl(var(--muted-foreground))">10^{t}</text
      >
    {/each}
    {#each yTicks as t (t)}
      {@const y = PAD_T + ((yRange[1] - t) / Math.max(1e-9, yRange[1] - yRange[0])) * innerH}
      <line x1={PAD_L - 3} x2={PAD_L} y1={y} y2={y} stroke="hsl(var(--muted-foreground))" />
      <text
        x={PAD_L - 5}
        y={y + 3}
        font-size="9"
        text-anchor="end"
        fill="hsl(var(--muted-foreground))">10^{t}</text
      >
    {/each}

    <text
      x={PAD_L + innerW / 2}
      y={height - 6}
      font-size="10"
      text-anchor="middle"
      fill="hsl(var(--muted-foreground))">mean of normalized counts</text
    >
    <text
      x={12}
      y={PAD_T + innerH / 2}
      font-size="10"
      transform="rotate(-90 12 {PAD_T + innerH / 2})"
      text-anchor="middle"
      fill="hsl(var(--muted-foreground))">dispersion</text
    >

    {#each valid as r (r.gene)}
      {#if Number.isFinite(r.dispGeneEst) && r.dispGeneEst > 0}
        <circle
          cx={xFor(r.baseMean)}
          cy={yFor(r.dispGeneEst)}
          r={1.2}
          fill="hsl(0 0% 35% / 0.55)"
        />
      {/if}
    {/each}
    {#each valid as r (r.gene + '_f')}
      {#if Number.isFinite(r.dispersion) && r.dispersion > 0}
        <circle cx={xFor(r.baseMean)} cy={yFor(r.dispersion)} r={1.4} fill={downAlpha(0.7)} />
      {/if}
    {/each}
    {#if fitLine.length > 1}
      <path
        d={fitLine
          .map((p, i) => {
            const x = PAD_L + ((p.x - xRange[0]) / Math.max(1e-9, xRange[1] - xRange[0])) * innerW;
            const y = PAD_T + ((yRange[1] - p.y) / Math.max(1e-9, yRange[1] - yRange[0])) * innerH;
            return `${i === 0 ? 'M' : 'L'}${x},${y}`;
          })
          .join(' ')}
        fill="none"
        stroke={UP_COLOR}
        stroke-width="1.5"
      />
    {/if}
  </svg>
  <div class="mt-2 flex flex-wrap items-center gap-3 text-[0.65rem] text-muted-foreground">
    <span class="inline-flex items-center gap-1">
      <span class="inline-block h-2 w-2 rounded-full" style="background: hsl(0 0% 35%)"></span>
      gene-wise estimate (each gene fitted on its own)
    </span>
    <span class="inline-flex items-center gap-1">
      <span class="inline-block h-2 w-2 rounded-full" style="background: {DOWN_COLOR}"></span>
      final estimate (used in the test)
    </span>
    <span class="inline-flex items-center gap-1">
      <span class="inline-block h-[2px] w-4" style="background: {UP_COLOR}"></span>
      fitted trend across genes
    </span>
    <span class="ml-auto font-mono">{valid.length.toLocaleString()} genes</span>
  </div>
</div>
