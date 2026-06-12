<script lang="ts">
  // UpSet plot (N >= 3). Encodes each item as a bitmask over sets, groups by mask,
  // sorts columns by count desc. Bar = group size; dot matrix = set membership.

  interface GeneSets {
    name: string;
    ids: string[];
  }

  import PlotExportMenu from './PlotExportMenu.svelte';

  let {
    sets,
    title,
    maxGroups = 18,
    exportName,
  }: {
    sets: GeneSets[];
    title: string;
    maxGroups?: number;
    exportName?: string;
  } = $props();

  let svgEl: SVGSVGElement | null = $state(null);
  export function getSvg() {
    return svgEl;
  }

  const N = $derived(sets.length);

  // Bitmask-encode each item's set membership, tally by mask, sort desc.
  const groups = $derived.by(() => {
    if (N < 2) return [] as { mask: number; count: number }[];
    /* eslint-disable svelte/prefer-svelte-reactivity */
    const itemMask = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const seen = new Set<string>();
      for (const id of sets[i].ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        itemMask.set(id, (itemMask.get(id) ?? 0) | (1 << i));
      }
    }
    const tally = new Map<number, number>();
    for (const mask of itemMask.values()) tally.set(mask, (tally.get(mask) ?? 0) + 1);
    /* eslint-enable svelte/prefer-svelte-reactivity */
    const arr = [...tally.entries()].map(([mask, count]) => ({ mask, count }));
    arr.sort((a, b) => b.count - a.count);
    return arr.slice(0, maxGroups);
  });

  const totalItems = $derived(groups.reduce((s, g) => s + g.count, 0));
  const maxCount = $derived(groups.reduce((m, g) => Math.max(m, g.count), 1));

  // Layout constants as module-level vars (Svelte 5 {@const} only works inside control-flow).
  const colW = 32;
  const labelW = 120;
  const barAreaTop = 20;
  const barAreaH = 120;
  const dotAreaTop = barAreaTop + barAreaH + 12;
  const rowH = 20;
  const svgW = $derived(Math.max(360, groups.length * colW + labelW + 16));
  const svgH = $derived(180 + N * rowH);
</script>

<div>
  <div class="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
    {title}
  </div>
  {#if N < 3}
    <div class="text-xs italic text-muted-foreground">
      UpSet shines at N ≥ 3. With only {N} gene{N === 1 ? '' : 's'}, use the pairwise overlap card.
    </div>
  {:else if groups.length === 0}
    <div class="text-xs italic text-muted-foreground">No items to plot.</div>
  {:else}
    <div class="relative overflow-x-auto">
      {#if exportName}
        <div class="absolute right-1 top-1 z-10">
          <PlotExportMenu getSvg={() => svgEl} baseName={exportName} />
        </div>
      {/if}
      <svg
        bind:this={svgEl}
        viewBox="0 0 {svgW} {svgH}"
        class="w-full"
        style="min-width: {svgW}px; max-width: 100%;"
        role="img"
        aria-label="UpSet plot"
      >
        <!-- Group size bars -->
        {#each groups as g, ci (g.mask)}
          {@const x = labelW + ci * colW + colW / 2}
          {@const h = (g.count / maxCount) * barAreaH}
          <rect
            x={x - 9}
            y={barAreaTop + (barAreaH - h)}
            width="18"
            height={h}
            fill="hsl(var(--accent))"
            opacity="0.9"
          />
          <text
            {x}
            y={barAreaTop + (barAreaH - h) - 4}
            text-anchor="middle"
            class="fill-foreground"
            style="font-size: 9px; font-family: monospace;"
          >
            {g.count}
          </text>
        {/each}

        <!-- Set labels and lane separators -->
        {#each sets as s, ri (ri)}
          {@const y = dotAreaTop + ri * rowH + rowH / 2}
          <line
            x1={labelW - 4}
            x2={labelW + groups.length * colW}
            y1={y}
            y2={y}
            stroke="hsl(var(--border))"
            stroke-dasharray="2 3"
            stroke-width="0.5"
          />
          <text
            x={labelW - 8}
            y={y + 3}
            text-anchor="end"
            class="fill-foreground"
            style="font-size: 10px;"
          >
            {s.name}
          </text>
        {/each}

        <!-- Dot matrix -->
        {#each groups as g, ci (g.mask)}
          {@const cx = labelW + ci * colW + colW / 2}
          {@const indices = sets.map((_, idx) => idx).filter((idx) => g.mask & (1 << idx))}
          {#if indices.length > 1}
            <line
              x1={cx}
              y1={dotAreaTop + Math.min(...indices) * rowH + rowH / 2}
              x2={cx}
              y2={dotAreaTop + Math.max(...indices) * rowH + rowH / 2}
              stroke="hsl(var(--accent))"
              stroke-width="2"
              opacity="0.7"
            />
          {/if}
          {#each sets as _, ri (ri)}
            {@const filled = !!(g.mask & (1 << ri))}
            <circle
              {cx}
              cy={dotAreaTop + ri * rowH + rowH / 2}
              r="5"
              fill={filled ? 'hsl(var(--accent))' : 'transparent'}
              stroke={filled ? 'hsl(var(--accent))' : 'hsl(var(--border))'}
              stroke-width="1"
            />
          {/each}
        {/each}
      </svg>
    </div>
    <div class="mt-1 text-[0.6rem] text-muted-foreground">
      {groups.length} intersection group{groups.length === 1 ? '' : 's'} shown, covering {totalItems}
      unique items. Bars = group size; connected dots = which genes share that group.
    </div>
  {/if}
</div>
