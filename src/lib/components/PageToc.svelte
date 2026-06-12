<script lang="ts">
  import { onMount } from 'svelte';
  import { cn } from '$lib/utils';

  // Flat leaf or group of children. Groups are purely organizational (no anchor)
  // and are hidden when all children are absent.
  export interface TocLeaf {
    id: string;
    label: string;
  }
  export interface TocGroup {
    label: string;
    children: TocLeaf[];
  }
  export type TocEntry = TocLeaf | TocGroup;

  let { entries }: { entries: TocEntry[] } = $props();

  let activeId = $state<string | null>(null);

  function isGroup(e: TocEntry): e is TocGroup {
    return 'children' in e;
  }

  // Flatten to leaves only; group headers have no anchor and are irrelevant for scroll tracking.
  const flatEntries = $derived.by<TocLeaf[]>(() => {
    const out: TocLeaf[] = [];
    for (const e of entries) {
      if (isGroup(e)) out.push(...e.children);
      else out.push(e);
    }
    return out;
  });

  // Active section: scrollY + 120px threshold (not IntersectionObserver).
  // At document bottom, forces the last entry active so the TOC doesn't get stuck.
  function recompute() {
    const y = window.scrollY + 120;
    let current: string | null = flatEntries[0]?.id ?? null;
    for (const e of flatEntries) {
      const el = document.getElementById(e.id);
      if (!el) continue;
      const top = el.getBoundingClientRect().top + window.scrollY;
      if (top <= y) current = e.id;
      else break;
    }
    const atBottom =
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (atBottom && flatEntries.length > 0) {
      current = flatEntries[flatEntries.length - 1].id;
    }
    activeId = current;
  }

  onMount(() => {
    recompute();
    const onScroll = () => requestAnimationFrame(recompute);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  });

  // Re-run when entries change (e.g., navigation to a different gene).
  $effect(() => {
    void entries;
    recompute();
  });

  function jump(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 72;
    window.scrollTo({ top, behavior: 'smooth' });
  }
</script>

<!-- Sticky sidebar; parent renders this aside on xl+ only. -->
<nav class="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto" aria-label="Page sections">
  <div class="mb-2 px-2 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">
    On this page
  </div>
  <ul class="space-y-0.5">
    {#each entries as e, i (i)}
      {#if !isGroup(e)}
        <li>
          <button
            type="button"
            onclick={() => jump(e.id)}
            class={cn(
              'block w-full rounded px-2 py-1 text-left text-xs transition-colors',
              activeId === e.id
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
            )}
          >
            {e.label}
          </button>
        </li>
      {:else if e.children.length > 0}
        <li class="pt-2 first:pt-0">
          <div
            class="px-2 py-1 text-[0.55rem] font-semibold uppercase tracking-wider text-muted-foreground/70"
          >
            {e.label}
          </div>
          <ul class="space-y-0.5">
            {#each e.children as c (c.id)}
              <li>
                <button
                  type="button"
                  onclick={() => jump(c.id)}
                  class={cn(
                    'block w-full rounded py-1 pl-4 pr-2 text-left text-xs transition-colors',
                    activeId === c.id
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
                  )}
                >
                  {c.label}
                </button>
              </li>
            {/each}
          </ul>
        </li>
      {/if}
    {/each}
  </ul>
</nav>
