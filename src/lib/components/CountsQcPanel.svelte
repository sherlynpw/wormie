<script lang="ts">
  import { librarySizes, log2cpm, pca2, sampleCorrelation } from '$lib/qc';
  import type { CountsMatrix } from '$lib/qc';
  import PCAScatter from './PCAScatter.svelte';
  import SampleDistanceHeatmap from './SampleDistanceHeatmap.svelte';

  type Props = { matrix: CountsMatrix; conditions?: string[]; topVar?: number };
  let { matrix, conditions, topVar = 500 }: Props = $props();

  const libs = $derived(librarySizes(matrix));
  const logCpm = $derived(log2cpm(matrix, libs));
  const corr = $derived(sampleCorrelation(logCpm, matrix.genes.length, matrix.samples.length));
  const dist = $derived(corr.map((row) => row.map((c) => 1 - c)));
  const pca = $derived(pca2(logCpm, matrix.genes.length, matrix.samples.length, topVar));

  const points = $derived(
    matrix.samples.map((s, i) => ({
      sample: s,
      x: pca.scores[i].x,
      y: pca.scores[i].y,
      group: conditions?.[i] ?? 'all',
    })),
  );

  const maxLib = $derived(libs.length ? Math.max(...libs) : 1);
  const barW = 32;
  const barMax = 200;
</script>

<div class="space-y-6">
  <section>
    <h3 class="mb-2 text-sm font-semibold">Library sizes (total mapped reads)</h3>
    <svg
      width={matrix.samples.length * barW + 60}
      height={barMax + 50}
      class="font-mono text-[10px]"
    >
      {#each libs as v, i (matrix.samples[i])}
        <rect
          x={30 + i * barW}
          y={barMax - (v / maxLib) * barMax + 10}
          width={barW - 4}
          height={(v / maxLib) * barMax}
          fill="hsl(220 70% 55%)"
        >
          <title>{matrix.samples[i]}: {v.toLocaleString()}</title>
        </rect>
        <text
          x={30 + i * barW + (barW - 4) / 2}
          y={barMax + 24}
          text-anchor="end"
          transform={`rotate(-60 ${30 + i * barW + (barW - 4) / 2} ${barMax + 24})`}
          fill="currentColor"
        >
          {matrix.samples[i]}
        </text>
      {/each}
    </svg>
  </section>

  <section>
    <h3 class="mb-2 text-sm font-semibold">Sample correlation (1 − cor on log2-CPM)</h3>
    <SampleDistanceHeatmap samples={matrix.samples} matrix={dist} />
  </section>

  <section>
    <h3 class="mb-2 text-sm font-semibold">PCA · top {topVar} variable genes (log2-CPM)</h3>
    <PCAScatter
      {points}
      xLabel={`PC1 (${(pca.varExp[0] * 100).toFixed(1)}%)`}
      yLabel={`PC2 (${(pca.varExp[1] * 100).toFixed(1)}%)`}
    />
  </section>
</div>
