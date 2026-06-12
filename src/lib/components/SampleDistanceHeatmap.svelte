<script lang="ts">
  // Sample × sample distance heatmap. Lower distance = more similar samples.

  let {
    samples,
    matrix,
    title,
    cellSize = 36,
    labelMaxChars = 18,
    headerHeight = 110,
  }: {
    samples: string[];
    matrix: number[][];
    title?: string;
    cellSize?: number;
    labelMaxChars?: number;
    headerHeight?: number;
  } = $props();

  function shorten(s: string): string {
    return s.length > labelMaxChars ? s.slice(0, labelMaxChars - 1) + '…' : s;
  }

  const N = $derived(samples.length);
  const maxVal = $derived.by(() => {
    let m = 0;
    for (const row of matrix) for (const v of row) if (Number.isFinite(v) && v > m) m = v;
    return m;
  });

  function shade(v: number): string {
    if (!Number.isFinite(v)) return 'hsl(0 0% 90%)';
    const t = maxVal > 0 ? Math.max(0, Math.min(1, v / maxVal)) : 0;
    const r = Math.round(255 - t * (255 - 14));
    const g = Math.round(255 - t * (255 - 64));
    const b = Math.round(255 - t * (255 - 122));
    return `rgb(${r} ${g} ${b})`;
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
    <div class="inline-block">
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
                    {shorten(s)}
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
                <div class="max-w-[180px] truncate" title={samples[i]}>{shorten(samples[i])}</div>
              </th>
              {#each row as v, j (j)}
                <td
                  class="border border-border/30 text-center font-mono text-[0.55rem] tabular-nums"
                  style="background: {shade(v)}; color: {Number.isFinite(v) &&
                  maxVal > 0 &&
                  v / maxVal > 0.5
                    ? 'rgb(245 245 250)'
                    : 'rgb(20 20 30)'}; min-width: {cellSize}px; height: {cellSize}px;"
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
