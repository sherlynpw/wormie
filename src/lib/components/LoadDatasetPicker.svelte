<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { datasets, type Dataset, type DatasetType, labelFor } from '$lib/stores/datasets.svelte';
  import FolderOpen from 'lucide-svelte/icons/folder-open';
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';

  // Ensure the IndexedDB store is hydrated before the menu opens; layout-level init() may not have
  // landed yet on fresh navigations (datasets.init() is async).
  onMount(() => datasets.init());

  let {
    type,
    onload,
    disabled = false,
    variant = 'outline',
    size = 'sm',
    label = 'Load',
  }: {
    // Accept a single type or an array (e.g. DESeq2 tables are useful on both /enrichment and /gsea).
    type: DatasetType | DatasetType[];
    onload: (ds: Dataset) => void;
    disabled?: boolean;

    variant?: any;

    size?: any;
    label?: string;
  } = $props();

  let open = $state(false);
  let menuRef: HTMLDivElement | null = $state(null);

  const acceptedTypes = $derived(Array.isArray(type) ? type : [type]);
  const matching = $derived(datasets.items.filter((d) => acceptedTypes.includes(d.type)));
  function pluralize(label: string): string {
    const lower = label.toLowerCase();
    // Some labels already end in s/x/sh/ch ("DESeq2 results"), so skip naive +s to avoid "resultss".
    if (/(s|x|sh|ch)$/.test(lower)) return lower;
    return lower + 's';
  }
  const headerLabel = $derived(
    acceptedTypes.length === 1
      ? pluralize(labelFor(acceptedTypes[0]))
      : acceptedTypes.map((t) => labelFor(t).toLowerCase()).join(' + '),
  );

  $effect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef && !menuRef.contains(e.target as Node)) open = false;
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  });

  function pick(ds: Dataset) {
    onload(ds);
    open = false;
  }

  function fmtTime(ms: number): string {
    const d = new Date(ms);
    const now = Date.now();
    const diff = now - ms;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
    return d.toLocaleDateString();
  }
</script>

<div bind:this={menuRef} class="relative inline-block">
  <Button {variant} {size} {disabled} onclick={() => (open = !open)}>
    <FolderOpen class="h-3 w-3" />
    {label}
  </Button>
  {#if open}
    <div
      role="menu"
      class="absolute right-0 z-50 mt-1 max-h-96 w-72 overflow-auto rounded-md border bg-popover shadow-md"
    >
      <div
        class="border-b px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Saved {headerLabel}
      </div>
      {#if !datasets.loaded}
        <div class="px-3 py-3 text-xs text-muted-foreground">Loading...</div>
      {:else if matching.length === 0}
        <div class="px-3 py-3 text-xs text-muted-foreground">
          No saved {headerLabel} yet.
          {#if datasets.items.length > 0}
            You have {datasets.items.length} other dataset{datasets.items.length === 1 ? '' : 's'} of
            different types (<a href={resolve('/datasets')} class="text-primary hover:underline"
              >see all</a
            >).
          {:else}
            Use the Save button to add one.
          {/if}
        </div>
      {:else}
        {#each matching as ds (ds.id)}
          <button
            type="button"
            class="w-full border-b px-3 py-2 text-left last:border-b-0 hover:bg-accent"
            onclick={() => pick(ds)}
          >
            <div class="flex items-baseline justify-between gap-2">
              <div class="truncate text-sm font-medium">{ds.name}</div>
              <span
                class="shrink-0 text-[0.55rem] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {labelFor(ds.type)}
              </span>
            </div>
            <div class="text-[0.65rem] text-muted-foreground">
              {fmtTime(ds.createdAt)} · {(ds.body.length / 1024).toFixed(1)} KB
            </div>
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>
