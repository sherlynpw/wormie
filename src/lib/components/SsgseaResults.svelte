<script lang="ts">
  import type { SsgseaScores } from '$lib/db/client';

  type Props = {
    results: SsgseaScores[];
    sampleNames: string[];
  };
  let { results, sampleNames }: Props = $props();

  type SortKey = 'term' | 'var';
  let sortKey = $state<SortKey>('var');
  let topN = $state(50);

  const variance = (xs: number[]) => {
    if (xs.length < 2) return 0;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  };

  const sorted = $derived(() => {
    const tagged = results.map((r) => ({ ...r, _var: variance(r.scores) }));
    if (sortKey === 'var') tagged.sort((a, b) => b._var - a._var);
    else tagged.sort((a, b) => a.term_id.localeCompare(b.term_id));
    return tagged.slice(0, topN);
  });

  const lo = $derived(() => {
    let v = Infinity;
    for (const r of sorted()) for (const s of r.scores) if (s < v) v = s;
    return v === Infinity ? -1 : v;
  });
  const hi = $derived(() => {
    let v = -Infinity;
    for (const r of sorted()) for (const s of r.scores) if (s > v) v = s;
    return v === -Infinity ? 1 : v;
  });
  const range = $derived(() => Math.max(Math.abs(lo()), Math.abs(hi())) || 1);

  function color(v: number): string {
    const t = Math.max(-1, Math.min(1, v / range()));
    if (t >= 0) {
      const a = Math.round(255 * (1 - t));
      return `rgb(${a},${a},255)`;
    } else {
      const a = Math.round(255 * (1 + t));
      return `rgb(255,${a},${a})`;
    }
  }

  const cellW = 32;
  const cellH = 14;
  const labelW = 240;
  const headerH = 80;

  function exportTsv() {
    const head = ['term_id', 'name', 'size', ...sampleNames].join('\t');
    const rows = results.map((r) =>
      [r.term_id, r.name, r.size, ...r.scores.map((s) => s.toFixed(6))].join('\t'),
    );
    const blob = new Blob([head + '\n' + rows.join('\n') + '\n'], {
      type: 'text/tab-separated-values',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ssgsea.tsv';
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="space-y-3">
  <div class="flex flex-wrap items-center gap-3 text-sm">
    <span>{results.length} sets · {sampleNames.length} samples</span>
    <label>
      Sort
      <select class="ml-1 rounded border bg-background px-1 py-0.5" bind:value={sortKey}>
        <option value="var">variance ↓</option>
        <option value="term">term_id</option>
      </select>
    </label>
    <label>
      Top
      <input
        type="number"
        class="ml-1 w-16 rounded border bg-background px-1 py-0.5"
        bind:value={topN}
        min="5"
        max="500"
      />
    </label>
    <button class="rounded border px-2 py-0.5 text-xs hover:bg-accent" onclick={exportTsv}
      >Export TSV</button
    >
    <span class="text-muted-foreground">colormap: red ↔ 0 ↔ blue</span>
  </div>

  <div class="overflow-x-auto">
    <svg
      width={labelW + sampleNames.length * cellW}
      height={headerH + sorted().length * cellH}
      class="font-mono text-[10px]"
    >
      {#each sampleNames as s, j (s)}
        <text
          x={labelW + j * cellW + cellW / 2}
          y={headerH - 4}
          text-anchor="end"
          transform={`rotate(-60 ${labelW + j * cellW + cellW / 2} ${headerH - 4})`}
          fill="currentColor">{s}</text
        >
      {/each}
      {#each sorted() as row, i (row.term_id)}
        <text
          x={labelW - 6}
          y={headerH + i * cellH + cellH * 0.75}
          text-anchor="end"
          fill="currentColor"
        >
          {row.term_id}
        </text>
        {#each row.scores as v, j (j)}
          <rect
            x={labelW + j * cellW}
            y={headerH + i * cellH}
            width={cellW - 1}
            height={cellH - 1}
            fill={color(v)}
          >
            <title>{row.term_id} · {sampleNames[j]} = {v.toFixed(4)}</title>
          </rect>
        {/each}
      {/each}
    </svg>
  </div>
</div>
