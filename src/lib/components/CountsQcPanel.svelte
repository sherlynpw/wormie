<script lang="ts">
  import { niceTicks } from '$lib/nice-ticks';
  import { DOWN_COLOR } from '$lib/plot-colors';
  import { librarySizes, log2cpm, pca2, sampleCorrelation } from '$lib/qc';
  import type { CountsMatrix } from '$lib/qc';
  import PCAScatter from './PCAScatter.svelte';
  import SampleDistanceHeatmap from './SampleDistanceHeatmap.svelte';

  type Props = {
    matrix: CountsMatrix;
    conditions?: string[];
    // Replicate label per sample, drawn beside its PCA point.
    replicates?: string[];
    reference?: string | null;
    topVar?: number;
  };
  let { matrix, conditions, replicates, reference, topVar = 500 }: Props = $props();

  const libs = $derived(librarySizes(matrix));
  const logCpm = $derived(log2cpm(matrix, libs));
  const corr = $derived(sampleCorrelation(logCpm, matrix.genes.length, matrix.samples.length));
  const dist = $derived(corr.map((row) => row.map((c) => 1 - c)));
  const pca = $derived(pca2(logCpm, matrix.genes.length, matrix.samples.length, topVar));

  // One colour until the caller supplies conditions; sample names are too irregular to guess from.
  const hasDesign = $derived(!!conditions && conditions.some((c) => c));
  const groups = $derived(hasDesign ? conditions!.map((c) => c || '?') : null);

  const points = $derived(
    matrix.samples.map((s, i) => ({
      sample: s,
      x: pca.scores[i].x,
      y: pca.scores[i].y,
      group: groups?.[i] ?? 'all',
      label: replicates?.[i] || null,
    })),
  );

  const maxLib = $derived(libs.length ? Math.max(...libs) : 1);
  const libStep = $derived(niceTicks(0, maxLib, 5, 1).step);
  // Extend the axis to the next round value so the tallest bar sits under a labelled tick.
  const libTop = $derived(Math.ceil(maxLib / libStep) * libStep || 1);
  const libTicks = $derived(niceTicks(0, libTop, 5, 1).values);
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

  const barW = 32;
  const barMax = 200;
  const PAD_T = 10;
  const LABEL_ANGLE = 60;
  // 10px monospace advances ~6px per character.
  const labelPx = $derived(Math.max(0, ...matrix.samples.map((s) => s.length)) * 6.1);
  const rad = (LABEL_ANGLE * Math.PI) / 180;
  // Rotated labels hang down and to the left of their bar, so both margins grow with the longest name.
  const padL = $derived(Math.max(64, Math.ceil(labelPx * Math.cos(rad)) - barW / 2 + 8));
  const padB = $derived(Math.ceil(labelPx * Math.sin(rad)) + 24);
  function yFor(v: number): number {
    return PAD_T + barMax - (v / libTop) * barMax;
  }
</script>

<div class="space-y-6">
  <section>
    <h3 class="mb-2 text-sm font-semibold">Library sizes (total mapped reads)</h3>
    <div class="overflow-x-auto">
      <svg
        width={padL + matrix.samples.length * barW + 12}
        height={PAD_T + barMax + padB}
        class="block font-mono text-[10px]"
        role="img"
        aria-label="Library sizes"
      >
        <line x1={padL} x2={padL} y1={PAD_T} y2={PAD_T + barMax} stroke="hsl(var(--border))" />
        <line
          x1={padL}
          x2={padL + matrix.samples.length * barW}
          y1={PAD_T + barMax}
          y2={PAD_T + barMax}
          stroke="hsl(var(--border))"
        />
        {#each libTicks as t (t)}
          {@const y = yFor(t)}
          <line x1={padL - 3} x2={padL} y1={y} y2={y} stroke="hsl(var(--muted-foreground))" />
          <text
            x={padL - 5}
            y={y + 3}
            font-size="9"
            text-anchor="end"
            fill="hsl(var(--muted-foreground))">{compact.format(t)}</text
          >
        {/each}
        <text
          x={12}
          y={PAD_T + barMax / 2}
          transform={`rotate(-90 12 ${PAD_T + barMax / 2})`}
          text-anchor="middle"
          fill="hsl(var(--muted-foreground))">mapped reads</text
        >
        {#each libs as v, i (matrix.samples[i])}
          {@const cx = padL + 2 + i * barW + (barW - 4) / 2}
          <rect
            x={padL + 2 + i * barW}
            y={yFor(v)}
            width={barW - 4}
            height={(v / libTop) * barMax}
            fill={DOWN_COLOR}
          >
            <title>{matrix.samples[i]}: {v.toLocaleString()}</title>
          </rect>
          <text
            x={cx}
            y={PAD_T + barMax + 12}
            text-anchor="end"
            transform={`rotate(-${LABEL_ANGLE} ${cx} ${PAD_T + barMax + 12})`}
            fill="currentColor"
          >
            {matrix.samples[i]}
          </text>
        {/each}
      </svg>
    </div>
  </section>

  <section>
    <h3 class="mb-2 text-sm font-semibold">
      Sample distance (1 minus correlation, on log2 counts per million (CPM))
    </h3>
    <SampleDistanceHeatmap samples={matrix.samples} matrix={dist} />
  </section>

  <section>
    <h3 class="mb-2 text-sm font-semibold">
      Principal component analysis (PCA) · top {topVar} most variable genes (log2 counts per million (CPM))
    </h3>
    <PCAScatter
      {points}
      {reference}
      xLabel={`PC1 (${(pca.varExp[0] * 100).toFixed(1)}%)`}
      yLabel={`PC2 (${(pca.varExp[1] * 100).toFixed(1)}%)`}
    />
  </section>
</div>
