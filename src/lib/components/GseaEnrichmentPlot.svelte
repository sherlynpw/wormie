<script lang="ts">
  // fgsea-style enrichment plot: running ES curve, hit hash strip, ranked-stat colorbar.
  // ES walk computed client-side: O(k log k) to sort hits, O(N) for the walk.
  // Subsampling not needed: worm gene sets are well below the 50k threshold.

  type Ranked = { gene: string; score: number };

  import PlotExportMenu from './PlotExportMenu.svelte';
  import { niceTicks } from '$lib/nice-ticks';
  import { UP_COLOR, DOWN_COLOR } from '$lib/plot-colors';

  let {
    ranked,
    geneSet,
    leadingEdge,
    es: _es,
    nes,
    p,
    q,
    title,
    exportName,
  }: {
    ranked: Ranked[];
    geneSet: string[];
    leadingEdge: string[];
    es: number;
    nes: number;
    p: number;
    q: number;
    title?: string;
    exportName?: string;
  } = $props();

  let svgEl: SVGSVGElement | null = $state(null);
  export function getSvg() {
    return svgEl;
  }

  const W = 720;
  const H = 220;
  const PAD_L = 44;
  const PAD_R = 12;
  const PAD_T = 8;
  const ES_H = 130;
  const HIT_H = 12;
  const BAR_H = 14;

  const plot = $derived.by(() => {
    if (ranked.length < 2 || geneSet.length === 0) return null;

    // Input `ranked` order is arbitrary; sort to match the worker or the curve will not
    // match the reported ES/NES.
    const sorted = [...ranked].sort((a, b) => b.score - a.score);
    const N = sorted.length;

    // Plain Map (not SvelteMap): throwaway index inside derived; 20k SvelteMap.set calls
    // add reactive-scheduling overhead that was a real GSEA expand bottleneck.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const pos = new Map<string, number>();
    for (let i = 0; i < N; i++) pos.set(sorted[i].gene, i);
    const hits: number[] = [];
    for (const g of geneSet) {
      const i = pos.get(g);
      if (i !== undefined) hits.push(i);
    }
    hits.sort((a, b) => a - b);
    const k = hits.length;
    if (k === 0) return null;

    // Weighted ES walk (weight exponent p=1) mirroring the worker, so the curve peaks at the reported ES.
    const weights = sorted.map((r) => Math.abs(r.score));
    let totalPos = 0;
    for (const i of hits) totalPos += weights[i];
    if (totalPos === 0) return null;
    const miss = 1 / (N - k);

    // Trace ES at every rank for a smooth curve.
    const xs = new Float32Array(N + 1);
    const ys = new Float32Array(N + 1);
    let cur = 0;
    let nextHit = 0;
    for (let i = 0; i < N; i++) {
      if (nextHit < k && hits[nextHit] === i) {
        cur += weights[i] / totalPos;
        nextHit++;
      } else {
        cur -= miss;
      }
      xs[i + 1] = i + 1;
      ys[i + 1] = cur;
    }

    let minES = 0;
    let maxES = 0;
    let argMax = 0;
    for (let i = 1; i <= N; i++) {
      if (ys[i] > maxES) {
        maxES = ys[i];
      }
      if (ys[i] < minES) {
        minES = ys[i];
      }
      if (Math.abs(ys[i]) > Math.abs(ys[argMax])) argMax = i;
    }

    // Pre-compute score range for colorbar normalisation.
    let scoreMin = Infinity;
    let scoreMax = -Infinity;
    for (const r of sorted) {
      if (r.score < scoreMin) scoreMin = r.score;
      if (r.score > scoreMax) scoreMax = r.score;
    }
    const absScore = Math.max(Math.abs(scoreMin), Math.abs(scoreMax));

    const plotW = W - PAD_L - PAD_R;
    const xScale = (i: number) => PAD_L + (i / N) * plotW;
    const yRange = Math.max(maxES, -minES, 0.05);
    const yScale = (y: number) => PAD_T + ES_H / 2 - (y / yRange) * (ES_H / 2 - 4);

    // Subsample to at most plotW points for a lightweight path.
    const stride = Math.max(1, Math.floor(N / plotW));
    const pathParts: string[] = [];
    pathParts.push(`M ${xScale(0)} ${yScale(0)}`);
    // The stride can skip the peak, so the curve is anchored at it and at the end.
    for (let i = 1; i <= N; i += stride) {
      if (i > argMax && i - stride < argMax) {
        pathParts.push(`L ${xScale(argMax).toFixed(1)} ${yScale(ys[argMax]).toFixed(2)}`);
      }
      pathParts.push(`L ${xScale(i).toFixed(1)} ${yScale(ys[i]).toFixed(2)}`);
    }
    pathParts.push(`L ${xScale(N).toFixed(1)} ${yScale(ys[N]).toFixed(2)}`);

    const leadingSet = new Set(leadingEdge);
    const hitLines = hits.map((i) => ({
      x: xScale(i + 0.5),
      leading: leadingSet.has(sorted[i].gene),
    }));

    // Rank index where stat crosses zero (for the vertical guide on the colorbar).
    let crossingIdx = -1;
    for (let i = 1; i < N; i++) {
      if (sorted[i - 1].score >= 0 && sorted[i].score < 0) {
        crossingIdx = i;
        break;
      }
    }

    return {
      N,
      k,
      es: ys[argMax],
      argMax,
      maxES,
      minES,
      pathD: pathParts.join(' '),
      xScale,
      yScale,
      hitLines,
      yRange,
      crossingIdx,
      scoreMin,
      scoreMax,
      absScore,
      plotW,
    };
  });

  function fmtP(v: number): string {
    if (!Number.isFinite(v)) return '-';
    if (v === 0) return '< 1e-300';
    if (v < 0.001) return v.toExponential(1);
    return v.toFixed(3);
  }
</script>

{#if plot}
  {@const yZero = plot.yScale(0)}
  {@const esTicks = niceTicks(-plot.yRange, plot.yRange, 4)}
  {@const peakX = plot.xScale(plot.argMax)}
  {@const peakY = plot.yScale(plot.es)}
  {@const hitY = PAD_T + ES_H + 4}
  {@const barY = hitY + HIT_H + 4}
  <div class="relative">
    {#if exportName}
      <div class="absolute right-1 top-1 z-10">
        <PlotExportMenu getSvg={() => svgEl} baseName={exportName} />
      </div>
    {/if}
    <svg
      bind:this={svgEl}
      viewBox="0 0 {W} {H}"
      class="h-auto w-full font-sans"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title ?? 'Enrichment plot'}
    >
      <!-- Background panel for the ES area -->
      <rect
        x={PAD_L}
        y={PAD_T}
        width={plot.plotW}
        height={ES_H}
        fill="hsl(var(--muted) / 0.25)"
        stroke="hsl(var(--border))"
        stroke-width="0.5"
      />
      <!-- Zero line -->
      <line
        x1={PAD_L}
        x2={W - PAD_R}
        y1={yZero}
        y2={yZero}
        stroke="hsl(var(--border))"
        stroke-width="0.5"
        stroke-dasharray="2,2"
      />
      <!-- Y axis labels -->
      {#each esTicks.values as t (t)}
        <text
          x={PAD_L - 6}
          y={plot.yScale(t) + 3}
          text-anchor="end"
          font-size="9"
          fill="hsl(var(--muted-foreground))"
        >
          {esTicks.format(t)}
        </text>
      {/each}
      <text
        x={PAD_L - 28}
        y={PAD_T + ES_H / 2}
        font-size="9"
        fill="hsl(var(--muted-foreground))"
        transform="rotate(-90 {PAD_L - 28} {PAD_T + ES_H / 2})"
        text-anchor="middle"
      >
        ES
      </text>

      <!-- Running ES curve -->
      <path
        d={plot.pathD}
        fill="none"
        stroke={plot.es >= 0 ? UP_COLOR : DOWN_COLOR}
        stroke-width="1.5"
      />

      <!-- Peak marker -->
      <line
        x1={peakX}
        x2={peakX}
        y1={yZero}
        y2={peakY}
        stroke="hsl(var(--foreground))"
        stroke-width="0.8"
        stroke-dasharray="2,2"
        opacity="0.5"
      />
      <circle cx={peakX} cy={peakY} r="2.5" fill="hsl(var(--foreground))" />
      <text
        x={peakX + 4}
        y={peakY - 4}
        font-size="9"
        fill="hsl(var(--foreground))"
        font-family="ui-monospace, monospace"
      >
        ES = {plot.es.toFixed(3)}
      </text>

      <!-- Hit hash strip -->
      {#each plot.hitLines as h, i (i)}
        <line
          x1={h.x}
          x2={h.x}
          y1={hitY}
          y2={hitY + HIT_H}
          stroke={h.leading ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground) / 0.5)'}
          stroke-width="0.6"
        />
      {/each}

      <!-- Stat colorbar (red = positive / up, blue = negative / down) -->
      <defs>
        <linearGradient id="statGrad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stop-color={UP_COLOR} />
          <stop offset="50%" stop-color="hsl(var(--muted))" />
          <stop offset="100%" stop-color={DOWN_COLOR} />
        </linearGradient>
      </defs>
      <rect
        x={PAD_L}
        y={barY}
        width={plot.plotW}
        height={BAR_H}
        fill="url(#statGrad)"
        stroke="hsl(var(--border))"
        stroke-width="0.5"
      />
      {#if plot.crossingIdx > 0}
        {@const cx = plot.xScale(plot.crossingIdx)}
        <line
          x1={cx}
          x2={cx}
          y1={barY}
          y2={barY + BAR_H}
          stroke="hsl(var(--foreground))"
          stroke-width="0.5"
        />
      {/if}

      <!-- X axis labels -->
      <text x={PAD_L} y={H - 4} font-size="9" fill="hsl(var(--muted-foreground))">
        rank 1 (top: {plot.scoreMax.toFixed(2)})
      </text>
      <text
        x={W - PAD_R}
        y={H - 4}
        text-anchor="end"
        font-size="9"
        fill="hsl(var(--muted-foreground))"
      >
        rank {plot.N.toLocaleString()} (bottom: {plot.scoreMin.toFixed(2)})
      </text>

      <!-- Header stats -->
      <text
        x={W - PAD_R}
        y={PAD_T + 4}
        text-anchor="end"
        font-size="10"
        font-family="ui-monospace, monospace"
        fill="hsl(var(--muted-foreground))"
      >
        NES {nes.toFixed(2)} · p {fmtP(p)} · q {fmtP(q)} · size {plot.k}
      </text>
    </svg>
  </div>
{:else}
  <div class="text-xs italic text-muted-foreground">
    Too few members of this gene set are in your ranked list to draw the plot.
  </div>
{/if}
