<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import ChevronUp from 'lucide-svelte/icons/chevron-up';
  import ChevronDown from 'lucide-svelte/icons/chevron-down';
  import ChevronsUpDown from 'lucide-svelte/icons/chevrons-up-down';
  import { cn } from '$lib/utils';
  import { untrack } from 'svelte';
  import type { DESeq2Row } from '$lib/deseq2/types';
  import { normalizeBiotype } from '$lib/queries';

  type GeneNameMap = Map<
    string,
    {
      wormbase_gene: string;
      gene_name: string | null;
      sequence_name: string | null;
      gene_type: string | null;
    }
  >;
  function displayName(id: string, m: GeneNameMap | null): string {
    if (!m) return id;
    const e = m.get(id);
    return e?.gene_name || e?.sequence_name || id;
  }

  type SortKey = 'name' | 'baseMean' | 'log2FoldChange' | 'lfcSE' | 'stat' | 'pvalue' | 'padj';
  type Col = { key: SortKey; label: string; align?: 'left' | 'right'; w: string };

  let {
    rows,
    geneMeta,
    selected = $bindable<string | null>(null),
  }: {
    rows: DESeq2Row[];
    geneMeta: GeneNameMap | null;
    selected?: string | null;
  } = $props();

  const COLS: Col[] = [
    { key: 'name', label: 'Gene', align: 'left', w: '1.3fr' },
    { key: 'baseMean', label: 'baseMean', align: 'right', w: '0.9fr' },
    { key: 'log2FoldChange', label: 'log2FC', align: 'right', w: '0.9fr' },
    { key: 'lfcSE', label: 'lfcSE', align: 'right', w: '0.8fr' },
    { key: 'stat', label: 'stat', align: 'right', w: '0.9fr' },
    { key: 'pvalue', label: 'pvalue', align: 'right', w: '0.9fr' },
    { key: 'padj', label: 'padj', align: 'right', w: '0.9fr' },
  ];
  const GRID = `grid-template-columns: ${COLS.map((c) => c.w).join(' ')};`;

  let filter = $state('');
  let filterDebounced = $state('');
  let filterTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const q = filter;
    if (filterTimer) clearTimeout(filterTimer);
    if (q === '') {
      filterDebounced = '';
      return;
    }
    filterTimer = setTimeout(() => (filterDebounced = q), 120);
    return () => {
      if (filterTimer) clearTimeout(filterTimer);
    };
  });
  let baseMeanMin = $state(0);
  let baseMeanMinDebounced = $state(0);
  let baseMeanTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const v = baseMeanMin;
    if (baseMeanTimer) clearTimeout(baseMeanTimer);
    baseMeanTimer = setTimeout(() => (baseMeanMinDebounced = v), 120);
    return () => {
      if (baseMeanTimer) clearTimeout(baseMeanTimer);
    };
  });
  let proteinCodingOnly = $state(false);

  let sortCol = $state<SortKey>('stat');
  let sortAsc = $state(false);

  function toggleSort(k: SortKey) {
    if (sortCol === k) sortAsc = !sortAsc;
    else {
      sortCol = k;
      sortAsc = k === 'pvalue' || k === 'padj';
    }
  }

  const display = $derived((id: string) => displayName(id, geneMeta));
  const filtered = $derived.by(() => {
    const q = filterDebounced.trim().toLowerCase();
    const minBase = Number.isFinite(baseMeanMinDebounced) ? baseMeanMinDebounced : 0;
    if (!q && minBase <= 0 && !proteinCodingOnly) return rows;
    return rows.filter((r) => {
      if (minBase > 0 && !(r.baseMean >= minBase)) return false;
      const meta = geneMeta?.get(r.gene);
      if (
        proteinCodingOnly &&
        geneMeta &&
        normalizeBiotype(meta?.gene_type ?? '') !== 'protein coding'
      )
        return false;
      if (!q) return true;
      if (r.gene.toLowerCase().includes(q)) return true;
      if (meta?.gene_name?.toLowerCase().includes(q)) return true;
      if (meta?.sequence_name?.toLowerCase().includes(q)) return true;
      return false;
    });
  });

  // Sort by index into a precomputed Float64Array of keys (cache-friendly,
  // avoids per-comparison object access). ~2-3x faster than row-object sort on 30k rows.
  const sorted = $derived.by(() => {
    const arr = filtered;
    const n = arr.length;
    const col = sortCol;
    const dir = sortAsc ? 1 : -1;
    if (n === 0) return arr;

    const indices = new Int32Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;

    if (col === 'name') {
      const keys = new Array<string>(n);
      for (let i = 0; i < n; i++) keys[i] = display(arr[i].gene).toLowerCase();
      const indicesArr = Array.from(indices);
      indicesArr.sort((a, b) => {
        const va = keys[a],
          vb = keys[b];
        return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
      });
      const out = new Array<DESeq2Row>(n);
      for (let i = 0; i < n; i++) out[i] = arr[indicesArr[i]];
      return out;
    }

    const keys = new Float64Array(n);
    const naFill = sortAsc ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    if (col === 'stat') {
      for (let i = 0; i < n; i++) {
        const v = arr[i].stat;
        keys[i] = v === v ? Math.abs(v) : Number.NEGATIVE_INFINITY;
      }
    } else {
      for (let i = 0; i < n; i++) {
        const v = arr[i][col];
        keys[i] = v === v && Number.isFinite(v) ? v : naFill;
      }
    }
    const indicesArr = Array.from(indices);
    indicesArr.sort((a, b) => (keys[a] - keys[b]) * dir);
    const out = new Array<DESeq2Row>(n);
    for (let i = 0; i < n; i++) out[i] = arr[indicesArr[i]];
    return out;
  });

  const ROW_HEIGHT = 32;
  let container: HTMLDivElement | null = $state(null);
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => container,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  });
  $effect(() => {
    const count = sorted.length;
    const el = container;
    untrack(() => {
      $virtualizer.setOptions({
        count,
        getScrollElement: () => el,
        estimateSize: () => ROW_HEIGHT,
        overscan: 6,
      });
    });
  });

  const fmt = (n: number, p = 3) => (Number.isFinite(n) ? n.toFixed(p) : 'NA');
  const fmtP = (n: number) => {
    if (!Number.isFinite(n)) return 'NA';
    if (n === 0) return '0';
    if (n < 1e-3) return n.toExponential(2);
    return n.toFixed(3);
  };
</script>

<div class="space-y-2">
  <div class="flex flex-wrap items-center gap-2">
    <input
      type="search"
      bind:value={filter}
      placeholder="filter by gene name, sequence name, or WBGene id..."
      class="h-8 w-full max-w-md rounded-md border border-input bg-background px-2 text-sm"
    />
    <label class="flex items-center gap-1 text-xs text-muted-foreground">
      baseMean &ge;
      <input
        type="number"
        min="0"
        step="1"
        bind:value={baseMeanMin}
        class="h-8 w-20 rounded-md border border-input bg-background px-2 text-right font-mono text-xs"
      />
    </label>
    <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
      <input
        type="checkbox"
        bind:checked={proteinCodingOnly}
        disabled={!geneMeta}
        class="h-3 w-3"
      />
      protein-coding only
    </label>
    <span class="text-xs text-muted-foreground">
      {sorted.length.toLocaleString()} / {rows.length.toLocaleString()} genes
    </span>
  </div>

  <div class="overflow-hidden rounded-lg border bg-card">
    <div class="sticky top-0 z-10 grid border-b bg-card" style={GRID}>
      {#each COLS as c (c.key)}
        <button
          type="button"
          onclick={() => toggleSort(c.key)}
          class={cn(
            'flex h-9 items-center gap-1 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted/50',
            c.align === 'right' && 'justify-end',
          )}
        >
          {c.label}
          {#if sortCol === c.key}
            {#if sortAsc}<ChevronUp class="h-3 w-3" />{:else}<ChevronDown class="h-3 w-3" />{/if}
          {:else}
            <ChevronsUpDown class="h-3 w-3 opacity-30" />
          {/if}
        </button>
      {/each}
    </div>

    <div
      bind:this={container}
      class="overflow-y-auto"
      style="max-height: 480px; min-height: 240px;"
    >
      {#if sorted.length === 0}
        <div class="py-10 text-center text-sm text-muted-foreground">No matches.</div>
      {:else}
        <div style="height: {$virtualizer.getTotalSize()}px; position: relative;">
          {#each $virtualizer.getVirtualItems() as item (item.key)}
            {@const r = sorted[item.index]}
            {#if r}
              <button
                type="button"
                onclick={() => (selected = r.gene)}
                class={cn(
                  'absolute left-0 right-0 grid items-center border-b text-left text-xs transition-colors hover:bg-muted/40',
                  selected === r.gene && 'bg-accent',
                )}
                style="top: {item.start}px; height: {ROW_HEIGHT}px; {GRID}"
              >
                <span class="px-3 font-mono">{display(r.gene)}</span>
                <span class="px-3 text-right font-mono">{fmt(r.baseMean, 1)}</span>
                <span class="px-3 text-right font-mono">{fmt(r.log2FoldChange)}</span>
                <span class="px-3 text-right font-mono">{fmt(r.lfcSE)}</span>
                <span class="px-3 text-right font-mono">{fmt(r.stat)}</span>
                <span class="px-3 text-right font-mono">{fmtP(r.pvalue)}</span>
                <span class="px-3 text-right font-mono">{fmtP(r.padj)}</span>
              </button>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
