<script lang="ts">
  import { rangeColor, rangeTextColor } from '$lib/plot-colors';
  import OverlapItemsPanel from './OverlapItemsPanel.svelte';
  // Symmetric N x N Jaccard matrix (|A ∩ B| / |A ∪ B|) for the /compare page (N ≥ 2 genes).

  interface GeneSets {
    name: string; // display label
    ids: string[]; // member ids (deduped internally)
  }

  let {
    sets,
    title,
    labels,
    href,
  }: {
    sets: GeneSets[];
    title: string;
    /** Display names for item ids, used when listing a cell's shared items. */
    labels?: ReadonlyMap<string, string>;
    href?: (id: string) => string | null;
  } = $props();

  const N = $derived(sets.length);

  const matrix = $derived.by(() => {
    const deduped = sets.map((s) => new Set(s.ids));
    const m: number[][] = [];
    for (let i = 0; i < N; i++) {
      const row: number[] = [];
      for (let j = 0; j < N; j++) {
        if (i === j) {
          row.push(1);
          continue;
        }
        const a = deduped[i];
        const b = deduped[j];
        if (a.size === 0 && b.size === 0) {
          row.push(0);
          continue;
        }
        let inter = 0;
        for (const x of a) if (b.has(x)) inter++;
        const union = a.size + b.size - inter;
        row.push(union === 0 ? 0 : inter / union);
      }
      m.push(row);
    }
    return m;
  });

  const dedupedSizes = $derived(sets.map((s) => new Set(s.ids).size));

  type Cell = { i: number; j: number };
  let hoverCell = $state<Cell | null>(null);
  let pinnedCell = $state<Cell | null>(null);
  const activeCell = $derived(hoverCell ?? pinnedCell);

  function sharedIds(i: number, j: number): string[] {
    const b = new Set(sets[j].ids);
    return [...new Set(sets[i].ids)].filter((x) => b.has(x));
  }

  const activeShared = $derived(activeCell ? sharedIds(activeCell.i, activeCell.j) : []);

  function sameCell(a: Cell | null, i: number, j: number) {
    return !!a && ((a.i === i && a.j === j) || (a.i === j && a.j === i));
  }

  function togglePin(i: number, j: number) {
    pinnedCell = sameCell(pinnedCell, i, j) ? null : { i, j };
  }

  const shade = rangeColor;

  // Past a handful of genes, horizontal column labels force wide columns; rotate them instead.
  const vertical = $derived(N > 5);
  const cellW = $derived(vertical ? 34 : 56);

  function fmt(v: number): string {
    if (v === 1) return '1';
    if (v === 0) return '0';
    return v.toFixed(2);
  }
</script>

<div class="min-w-0">
  <div class="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
    {title}
  </div>
  {#if N < 2}
    <div class="text-xs italic text-muted-foreground">Need at least 2 sets to compare.</div>
  {:else}
    <div class="max-w-full overflow-x-auto">
      <table class="border-collapse text-xs">
        <thead>
          <tr>
            <th class="px-2 py-1"></th>
            {#each sets as s, i (i)}
              <th
                class="px-1 py-1 align-bottom font-mono text-[0.65rem] text-muted-foreground"
                style="min-width: {cellW}px;"
              >
                {#if vertical}
                  <div
                    class="mx-auto max-h-[88px] truncate [transform:rotate(180deg)] [writing-mode:vertical-rl]"
                    title="{s.name} ({dedupedSizes[i]})"
                  >
                    {s.name}
                    <span class="font-normal text-muted-foreground/60">({dedupedSizes[i]})</span>
                  </div>
                {:else}
                  <div class="max-w-[80px] truncate" title={s.name}>{s.name}</div>
                  <div class="font-normal text-muted-foreground/60">({dedupedSizes[i]})</div>
                {/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each matrix as row, i (i)}
            <tr>
              <th class="px-2 py-1 text-right font-mono text-[0.65rem] text-muted-foreground">
                <div class="max-w-[80px] truncate" title={sets[i].name}>{sets[i].name}</div>
              </th>
              {#each row as v, j (j)}
                {#if i === j}
                  <td
                    class="border border-border/40"
                    style="background: {shade(v)}; min-width: {cellW}px; height: 28px;"
                  ></td>
                {:else}
                  <td
                    class="cursor-pointer border border-border/40 text-center font-mono text-[0.65rem] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring {sameCell(
                      activeCell,
                      i,
                      j,
                    )
                      ? 'ring-2 ring-inset ring-foreground/60'
                      : ''}"
                    style="background: {shade(v)}; color: {rangeTextColor(
                      v,
                    )}; min-width: {cellW}px; height: 28px;"
                    title={`${sets[i].name} ∩ ${sets[j].name}: ${fmt(v)}`}
                    tabindex="0"
                    aria-pressed={sameCell(pinnedCell, i, j)}
                    onmouseenter={() => (hoverCell = { i, j })}
                    onmouseleave={() => (hoverCell = null)}
                    onfocus={() => (hoverCell = { i, j })}
                    onblur={() => (hoverCell = null)}
                    onclick={() => togglePin(i, j)}
                    onkeydown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        togglePin(i, j);
                      }
                    }}
                  >
                    {fmt(v)}
                  </td>
                {/if}
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="mt-1 text-[0.6rem] text-muted-foreground">
      Jaccard index = items in both lists / items in either list (1 means identical, 0 means nothing
      shared). Numbers in parentheses are list sizes. Hover or click a cell to list the shared
      items.
    </div>
    {#if activeCell}
      <OverlapItemsPanel
        heading="{sets[activeCell.i].name} ∩ {sets[activeCell.j].name}"
        ids={activeShared}
        {labels}
        {href}
        pinned={hoverCell === null && pinnedCell !== null}
        onclose={() => (pinnedCell = null)}
      />
    {/if}
  {/if}
</div>
