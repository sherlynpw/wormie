<script lang="ts">
  // UpSet plot (N >= 3). Encodes each item as a bitmask over sets, groups by mask,
  // sorts columns by count desc. Bar = group size; dot matrix = set membership.

  interface GeneSets {
    name: string;
    ids: string[];
  }

  import PlotExportMenu from './PlotExportMenu.svelte';
  import OverlapItemsPanel from './OverlapItemsPanel.svelte';
  import { downloadTsv } from '$lib/download';

  let {
    sets,
    title,
    maxGroups = 18,
    exportName,
    labels,
    href,
    setNoun = 'gene',
  }: {
    sets: GeneSets[];
    title: string;
    maxGroups?: number;
    exportName?: string;
    /** Display names for item ids (e.g. GO id -> term name), used in the item list and TSV. */
    labels?: ReadonlyMap<string, string>;
    href?: (id: string) => string | null;
    /** What each set is (gene, list, contrast); used in the fewer-than-three message. */
    setNoun?: string;
  } = $props();

  let svgEl: SVGSVGElement | null = $state(null);
  export function getSvg() {
    return svgEl;
  }

  const N = $derived(sets.length);

  type Group = { mask: number; count: number; members: string[] };

  // Bitmask-encode each item's set membership, group by mask, sort desc.
  const allGroups = $derived.by(() => {
    if (N < 2) return [] as Group[];
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
    const byMask = new Map<number, string[]>();
    for (const [id, mask] of itemMask) {
      const list = byMask.get(mask);
      if (list) list.push(id);
      else byMask.set(mask, [id]);
    }
    /* eslint-enable svelte/prefer-svelte-reactivity */
    const arr = [...byMask.entries()].map(([mask, members]) => ({
      mask,
      count: members.length,
      members,
    }));
    arr.sort((a, b) => b.count - a.count);
    return arr;
  });
  const groups = $derived(allGroups.slice(0, maxGroups));

  let hoverMask = $state<number | null>(null);
  let pinnedMask = $state<number | null>(null);
  const activeGroup = $derived(groups.find((g) => g.mask === (hoverMask ?? pinnedMask)) ?? null);

  function setNames(mask: number): string[] {
    return sets.filter((_, i) => mask & (1 << i)).map((s) => s.name);
  }

  function groupHeading(mask: number): string {
    const names = setNames(mask);
    return names.length === 1 ? `${names[0]} only` : `Shared by ${names.join(' + ')} only`;
  }

  function togglePin(mask: number) {
    pinnedMask = pinnedMask === mask ? null : mask;
  }

  // One row per item across every group (not just the plotted top N), so nothing is lost.
  function exportItems() {
    const rows = allGroups.flatMap((g) => {
      const names = setNames(g.mask);
      return g.members.map((id) => ({ names, size: g.count, id }));
    });
    downloadTsv(
      `${exportName ?? 'upset'}-items.tsv`,
      [
        { header: 'sets', get: (r) => r.names.join(';') },
        { header: 'n_sets', get: (r) => r.names.length },
        { header: 'group_size', get: (r) => r.size },
        { header: 'item_id', get: (r) => r.id },
        { header: 'item_label', get: (r) => labels?.get(r.id) ?? '' },
      ],
      rows,
    );
  }

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
  <div class="mb-2 flex items-center justify-between gap-2">
    <div class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
      {title}
    </div>
    {#if exportName && N >= 3 && groups.length > 0}
      <PlotExportMenu
        getSvg={() => svgEl}
        baseName={exportName}
        extra={[
          {
            label: 'Items (TSV)',
            title: 'Every intersection group with its member items',
            run: exportItems,
          },
        ]}
      />
    {/if}
  </div>
  {#if N < 3}
    <div class="text-xs italic text-muted-foreground">
      {#if setNoun === 'gene'}
        An UpSet plot (a bar chart of which sets share which items) needs 3 or more genes. With only
        {N} gene{N === 1 ? '' : 's'}, use the pairwise overlap card.
      {:else}
        UpSet needs 3 or more {setNoun}s (an UpSet plot is a bar chart of which sets share which
        items). With {N}, the table of shared items below shows the same groups.
      {/if}
    </div>
  {:else if groups.length === 0}
    <div class="text-xs italic text-muted-foreground">No items to plot.</div>
  {:else}
    <div class="overflow-x-auto">
      <svg
        bind:this={svgEl}
        viewBox="0 0 {svgW} {svgH}"
        class="w-full"
        style="min-width: {svgW}px; max-width: 100%;"
        role="img"
        aria-label="UpSet plot"
      >
        {#if activeGroup}
          {@const ai = groups.indexOf(activeGroup)}
          <rect
            data-export-skip
            x={labelW + ai * colW + 2}
            y={barAreaTop - 14}
            width={colW - 4}
            height={dotAreaTop + N * rowH - barAreaTop + 18}
            rx="3"
            fill="hsl(var(--muted))"
          />
        {/if}

        <!-- Group size bars -->
        {#each groups as g, ci (g.mask)}
          {@const x = labelW + ci * colW + colW / 2}
          {@const h = (g.count / maxCount) * barAreaH}
          <rect
            x={x - 9}
            y={barAreaTop + (barAreaH - h)}
            width="18"
            height={h}
            fill="hsl(var(--primary))"
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
              stroke="hsl(var(--primary))"
              stroke-width="2"
            />
          {/if}
          {#each sets as _, ri (ri)}
            {@const filled = !!(g.mask & (1 << ri))}
            <circle
              {cx}
              cy={dotAreaTop + ri * rowH + rowH / 2}
              r="5"
              fill={filled ? 'hsl(var(--primary))' : 'transparent'}
              stroke={filled ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
              stroke-width="1"
            />
          {/each}
        {/each}

        <!-- Hit areas: hover previews a group's items, click pins the list -->
        {#each groups as g, ci (g.mask)}
          <rect
            data-export-skip
            x={labelW + ci * colW}
            y={0}
            width={colW}
            height={dotAreaTop + N * rowH + 4}
            fill="transparent"
            class="cursor-pointer outline-none"
            role="button"
            tabindex="0"
            aria-label="{groupHeading(g.mask)}: {g.count} items"
            aria-pressed={pinnedMask === g.mask}
            onmouseenter={() => (hoverMask = g.mask)}
            onmouseleave={() => (hoverMask = null)}
            onfocus={() => (hoverMask = g.mask)}
            onblur={() => (hoverMask = null)}
            onclick={() => togglePin(g.mask)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                togglePin(g.mask);
              }
            }}
          />
        {/each}
      </svg>
    </div>
    <div class="mt-1 text-[0.6rem] text-muted-foreground">
      {groups.length} group{groups.length === 1 ? '' : 's'} of shared items shown, covering {totalItems}
      unique items. Bar length is the number of items in the group. Connected dots show which genes share
      the group. Hover over or click a column to list its items.
    </div>
    {#if activeGroup}
      <OverlapItemsPanel
        heading={groupHeading(activeGroup.mask)}
        ids={activeGroup.members}
        {labels}
        {href}
        pinned={hoverMask === null && pinnedMask !== null}
        onclose={() => (pinnedMask = null)}
      />
    {/if}
  {/if}
</div>
