<script lang="ts">
  import { page as pageStore } from '$app/state';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Button } from '$lib/components/ui/button';
  import ChevronLeft from 'lucide-svelte/icons/chevron-left';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';

  let { current, total }: { current: number; total: number } = $props();

  function urlFor(p: number): string {
    const url = new URL(pageStore.url);
    if (p <= 1) url.searchParams.delete('page');
    else url.searchParams.set('page', String(p));
    return url.pathname + url.search;
  }

  function go(p: number) {
    goto(resolve(urlFor(p) as '/'), { noScroll: false, keepFocus: false });
  }

  // Compact page-number set: first, last, current ± 1, with ellipses
  const pages = $derived.by<(number | 'ellipsis')[]>(() => {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const s = new Set<number>([1, 2, total - 1, total, current - 1, current, current + 1]);
    const sorted = [...s].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
    const out: (number | 'ellipsis')[] = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('ellipsis');
      out.push(sorted[i]);
    }
    return out;
  });
</script>

{#if total > 1}
  <nav class="inline-flex items-center gap-1" aria-label="Pagination">
    <Button
      variant="outline"
      size="sm"
      disabled={current <= 1}
      onclick={() => go(current - 1)}
      aria-label="Previous page"
    >
      <ChevronLeft class="h-3 w-3" />
      Prev
    </Button>
    {#each pages as p, i (i)}
      {#if p === 'ellipsis'}
        <span class="px-2 text-sm text-muted-foreground">...</span>
      {:else}
        <Button
          variant={p === current ? 'default' : 'outline'}
          size="sm"
          onclick={() => go(p)}
          class="min-w-9 tabular-nums"
          aria-current={p === current ? 'page' : undefined}
        >
          {p}
        </Button>
      {/if}
    {/each}
    <Button
      variant="outline"
      size="sm"
      disabled={current >= total}
      onclick={() => go(current + 1)}
      aria-label="Next page"
    >
      Next
      <ChevronRight class="h-3 w-3" />
    </Button>
  </nav>
{/if}
