<script lang="ts">
  import type { GeneRow } from '$lib/queries';
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { Badge } from '$lib/components/ui/badge';
  import { cn } from '$lib/utils';
  import ChevronUp from 'lucide-svelte/icons/chevron-up';
  import ChevronDown from 'lucide-svelte/icons/chevron-down';
  import ChevronsUpDown from 'lucide-svelte/icons/chevrons-up-down';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import Highlight from '$lib/components/Highlight.svelte';
  import SelectToggle from '$lib/components/SelectToggle.svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import GeneHover from '$lib/components/GeneHover.svelte';
  import { toast } from 'svelte-sonner';
  import { untrack } from 'svelte';
  import { resolve } from '$app/paths';

  let {
    rows,
    highlight = null,
    activeIdx = -1,
  }: { rows: GeneRow[]; highlight?: RegExp | null; activeIdx?: number } = $props();

  type SortKey = keyof GeneRow;
  let sortCol = $state<SortKey | null>(null);
  let sortAsc = $state(true);
  let expanded = $state<Record<string, boolean>>({});

  const ROW_HEIGHT = 40;
  const EXPANDED_HEIGHT = 220;

  const sorted = $derived.by(() => {
    if (!sortCol) return rows;
    const col = sortCol;
    const dir = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = String((a[col] ?? '') as unknown).toLowerCase();
      const vb = String((b[col] ?? '') as unknown).toLowerCase();
      return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
    });
  });

  function toggleSort(col: SortKey) {
    if (sortCol === col) sortAsc = !sortAsc;
    else {
      sortCol = col;
      sortAsc = true;
    }
  }

  function toggleExpanded(wb: string) {
    expanded = { ...expanded, [wb]: !expanded[wb] };
    // Force the virtualizer to remeasure heights
    untrack(() => $virtualizer.measure());
  }

  async function copyText(text: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied', {
        description: text.length > 60 ? text.slice(0, 60) + '...' : text,
        duration: 1200,
      });
    } catch {
      // ignore
    }
  }

  function copyCell(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('a, button, [role="button"]')) return;
    const cell = e.currentTarget as HTMLElement;
    copyText(cell.textContent?.trim() ?? '');
  }

  function onCellKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const cell = e.currentTarget as HTMLElement;
      copyText(cell.textContent?.trim() ?? '');
    }
  }

  type Col = { key: SortKey; label: string };
  const COLS: Col[] = [
    { key: 'wormbase_gene', label: 'WBGene' },
    { key: 'gene_name', label: 'Name' },
    { key: 'entrez_id', label: 'Entrez' },
    { key: 'sequence_name', label: 'Sequence' },
    { key: 'chromosome', label: 'Map' },
    { key: 'gene_type', label: 'Type' },
    { key: 'gene_class_description', label: 'Class' },
    { key: 'concise_description', label: 'Description' },
    { key: 'status', label: 'Status' },
  ];

  const GRID =
    'grid-cols-[28px_36px_140px_140px_90px_120px_80px_100px_minmax(160px,1fr)_minmax(220px,2fr)_70px]';

  let container: HTMLDivElement | null = $state(null);

  function estimateSize(index: number): number {
    const g = sorted[index];
    if (!g) return ROW_HEIGHT;
    return expanded[g.wormbase_gene] ? ROW_HEIGHT + EXPANDED_HEIGHT : ROW_HEIGHT;
  }

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => container,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  });

  $effect(() => {
    const count = sorted.length;
    const el = container;
    // Re-run when expanded changes so virtualizer recomputes sizes
    void expanded;
    untrack(() => {
      $virtualizer.setOptions({
        count,
        getScrollElement: () => el,
        estimateSize,
        overscan: 6,
      });
    });
  });
</script>

<div class="overflow-hidden rounded-lg border bg-card">
  <div class={cn('sticky top-0 z-10 grid border-b bg-card', GRID)}>
    <div class="h-10"></div>
    <div class="h-10"></div>
    {#each COLS as c (c.key)}
      <button
        type="button"
        onclick={() => toggleSort(c.key)}
        class="flex h-10 items-center gap-1 px-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted/50"
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
    style="max-height: calc(100vh - 280px); min-height: 400px;"
  >
    {#if sorted.length === 0}
      <div class="py-10 text-center text-sm text-muted-foreground">No results.</div>
    {:else}
      <div style="height: {$virtualizer.getTotalSize()}px; position: relative;">
        {#each $virtualizer.getVirtualItems() as item (item.key)}
          {@const g = sorted[item.index]}
          {#if g}
            {@const isOpen = expanded[g.wormbase_gene]}
            <div
              data-row-idx={item.index}
              class={cn(
                'absolute left-0 right-0 border-b',
                item.index === activeIdx && 'z-10 ring-2 ring-primary ring-offset-1',
              )}
              style="top: {item.start}px;"
            >
              <div
                class={cn('grid transition-colors hover:bg-muted/30', GRID)}
                style="height: {ROW_HEIGHT}px;"
              >
                <button
                  type="button"
                  onclick={() => toggleExpanded(g.wormbase_gene)}
                  aria-label={isOpen ? 'Collapse row' : 'Expand row'}
                  aria-expanded={isOpen}
                  class="flex items-center justify-center text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  <ChevronRight
                    class={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-90')}
                  />
                </button>
                <div class="flex items-center px-3 py-2">
                  <SelectToggle id={g.wormbase_gene} />
                </div>
                <div
                  class="flex cursor-pointer items-center px-3 py-2 font-mono text-xs"
                  role="gridcell"
                  tabindex="-1"
                  onclick={copyCell}
                  onkeydown={onCellKey}
                >
                  <a class="truncate hover:text-primary" href={resolve(`/gene/${g.wormbase_gene}`)}>
                    <Highlight text={g.wormbase_gene} regex={highlight} />
                  </a>
                </div>
                <div
                  class="flex cursor-pointer items-center px-3 py-2 font-medium"
                  role="gridcell"
                  tabindex="-1"
                  onclick={copyCell}
                  onkeydown={onCellKey}
                >
                  <GeneHover id={g.wormbase_gene}>
                    <a
                      class="truncate hover:text-primary"
                      href={resolve(`/gene/${g.wormbase_gene}`)}
                    >
                      {#if g.gene_name}<Highlight
                          text={g.gene_name}
                          regex={highlight}
                        />{:else}-{/if}
                    </a>
                  </GeneHover>
                </div>
                <div
                  class="flex cursor-pointer items-center px-3 py-2 font-mono text-xs"
                  role="gridcell"
                  tabindex="-1"
                  onclick={copyCell}
                  onkeydown={onCellKey}
                >
                  {#if g.entrez_id}
                    <a
                      class="truncate hover:text-primary"
                      href="https://www.ncbi.nlm.nih.gov/gene/{g.entrez_id}"
                      target="_blank"
                      rel="noopener"
                    >
                      <Highlight text={g.entrez_id} regex={highlight} />
                    </a>
                  {/if}
                </div>
                <div
                  class="flex cursor-pointer items-center truncate px-3 py-2 font-mono text-xs"
                  role="gridcell"
                  tabindex="-1"
                  onclick={copyCell}
                  onkeydown={onCellKey}
                  title={g.sequence_name ?? ''}
                >
                  <Highlight text={g.sequence_name ?? ''} regex={highlight} />
                </div>
                <div
                  class="flex cursor-pointer items-center truncate px-3 py-2 font-mono text-xs"
                  role="gridcell"
                  tabindex="-1"
                  onclick={copyCell}
                  onkeydown={onCellKey}
                  title={g.chromosome && g.start_pos != null
                    ? `${g.chromosome}:${g.start_pos}-${g.end_pos}${g.strand ? ` (${g.strand})` : ''}`
                    : ''}
                >
                  {g.chromosome ?? ''}{g.cm != null ? `:${g.cm.toFixed(2)}` : ''}
                </div>
                <div
                  class="flex cursor-pointer items-center truncate px-3 py-2 text-xs"
                  role="gridcell"
                  tabindex="-1"
                  onclick={copyCell}
                  onkeydown={onCellKey}
                >
                  {g.gene_type ?? ''}
                </div>
                <div
                  class="flex cursor-pointer items-center truncate px-3 py-2 text-xs italic text-muted-foreground"
                  role="gridcell"
                  tabindex="-1"
                  onclick={copyCell}
                  onkeydown={onCellKey}
                  title={g.gene_class_description ?? ''}
                >
                  <Highlight text={g.gene_class_description ?? ''} regex={highlight} />
                </div>
                <div
                  class="flex cursor-pointer items-center truncate px-3 py-2 text-xs"
                  role="gridcell"
                  tabindex="-1"
                  onclick={copyCell}
                  onkeydown={onCellKey}
                  title={g.concise_description ?? ''}
                >
                  <Highlight text={g.concise_description ?? ''} regex={highlight} />
                </div>
                <div class="flex items-center px-3 py-2">
                  {#if g.status}
                    <Badge variant={g.status.toLowerCase() === 'live' ? 'success' : 'muted'}>
                      {g.status}
                    </Badge>
                  {/if}
                </div>
              </div>

              {#if isOpen}
                <div
                  class="grid grid-cols-1 gap-3 bg-muted/30 px-6 py-3 text-sm md:grid-cols-2"
                  style="height: {EXPANDED_HEIGHT}px; overflow: auto;"
                >
                  {#if g.concise_description}
                    <div>
                      <div
                        class="mb-1 flex items-center gap-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        Description
                        <CopyButton text={g.concise_description} />
                      </div>
                      <p class="leading-relaxed">{g.concise_description}</p>
                    </div>
                  {/if}
                  {#if g.legacy_description}
                    <div>
                      <div
                        class="mb-1 flex items-center gap-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        Legacy description
                        <CopyButton text={g.legacy_description} />
                      </div>
                      <p class="leading-relaxed text-muted-foreground">{g.legacy_description}</p>
                    </div>
                  {/if}
                  {#if g.gene_class_description}
                    <div>
                      <div
                        class="mb-1 flex items-center gap-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        Gene class
                        <CopyButton text={g.gene_class_description} />
                      </div>
                      <p class="italic">{g.gene_class_description}</p>
                    </div>
                  {/if}
                  {#if g.other_names}
                    <div>
                      <div
                        class="mb-1 flex items-center gap-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        Other names
                        <CopyButton text={g.other_names} />
                      </div>
                      <p class="font-mono text-xs">{g.other_names}</p>
                    </div>
                  {/if}
                  <div class="flex items-center gap-2 pt-1 md:col-span-2">
                    <a
                      href={resolve(`/gene/${g.wormbase_gene}`)}
                      class="text-xs text-primary hover:underline"
                    >
                      Open full detail →
                    </a>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
</div>
