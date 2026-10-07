<script lang="ts">
  import { rangeColor, rangeTextColor } from '$lib/plot-colors';
  // Sample × sample distance heatmap. Lower distance = more similar samples.

  let {
    samples,
    matrix,
    title,
    cellSize = 36,
  }: {
    samples: string[];
    matrix: number[][];
    title?: string;
    cellSize?: number;
  } = $props();

  // Column labels sit at -45 degrees, so their rise and their overhang past the last
  // column both scale with the longest name (0.6rem monospace advances ~5.8px/char).
  const labelRise = $derived(
    Math.ceil(Math.max(0, ...samples.map((s) => s.length)) * 5.8 * Math.SQRT1_2),
  );
  const headerHeight = $derived(labelRise + 16);

  const N = $derived(samples.length);
  const maxVal = $derived.by(() => {
    let m = 0;
    for (const row of matrix) for (const v of row) if (Number.isFinite(v) && v > m) m = v;
    return m;
  });

  // Scaled over the off-diagonal values so the closest and the farthest pair use both ends.
  const minVal = $derived.by(() => {
    let m = Infinity;
    matrix.forEach((row, i) =>
      row.forEach((v, j) => {
        if (i !== j && Number.isFinite(v) && v < m) m = v;
      }),
    );
    return Number.isFinite(m) ? m : 0;
  });
  function scaled(v: number): number {
    return maxVal > minVal ? (v - minVal) / (maxVal - minVal) : 0;
  }

  function fmt(v: number): string {
    if (!Number.isFinite(v)) return 'NA';
    if (v === 0) return '0';
    if (v < 0.1) return v.toExponential(1);
    if (v < 100) return v.toFixed(1);
    return Math.round(v).toLocaleString();
  }
</script>

<div class="overflow-x-auto rounded-lg border bg-card p-3">
  {#if title}
    <div class="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
      {title}
    </div>
  {/if}
  {#if N < 2}
    <div class="text-xs italic text-muted-foreground">Need at least 2 samples.</div>
  {:else}
    <div class="inline-block" style="padding-right: {labelRise}px;">
      <table class="border-collapse text-xs">
        <thead>
          <tr>
            <th class="px-2 py-1"></th>
            {#each samples as s, i (i)}
              <th
                class="px-0 align-bottom font-mono text-[0.6rem] text-muted-foreground"
                style="min-width: {cellSize}px; height: {headerHeight}px; vertical-align: bottom;"
              >
                <div class="relative" style="width: {cellSize}px; height: {headerHeight}px;">
                  <div
                    class="absolute origin-bottom-left -rotate-45 whitespace-nowrap"
                    style="bottom: 0; left: 50%;"
                    title={s}
                  >
                    {s}
                  </div>
                </div>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each matrix as row, i (i)}
            <tr>
              <th class="px-2 py-1 text-right font-mono text-[0.6rem] text-muted-foreground">
                <div class="whitespace-nowrap">{samples[i]}</div>
              </th>
              {#each row as v, j (j)}
                <td
                  class="border border-border/30 text-center font-mono text-[0.55rem] tabular-nums"
                  style="background: {i === j
                    ? 'transparent'
                    : Number.isFinite(v)
                      ? rangeColor(scaled(v))
                      : 'hsl(0 0% 90%)'}; color: {rangeTextColor(
                    scaled(v),
                  )}; min-width: {cellSize}px; height: {cellSize}px;"
                  title={`${samples[i]} ↔ ${samples[j]}: ${fmt(v)}`}
                >
                  {i === j ? '' : fmt(v)}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
