<script lang="ts">
  // Item list shown under UpSet / Jaccard plots for the hovered or pinned group.

  let {
    heading,
    ids,
    labels,
    href,
    pinned = false,
    onclose,
  }: {
    heading: string;
    ids: string[];
    labels?: ReadonlyMap<string, string>;
    href?: (id: string) => string | null;
    pinned?: boolean;
    onclose?: () => void;
  } = $props();

  const items = $derived(
    ids
      .map((id) => ({ id, label: labels?.get(id) ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );
</script>

<div class="mt-2 rounded-md border bg-muted/30 p-2 text-xs">
  <div class="mb-1 flex items-start justify-between gap-2">
    <div class="font-medium">
      {heading}
      <span class="font-normal text-muted-foreground">
        ({ids.length} item{ids.length === 1 ? '' : 's'})
      </span>
    </div>
    {#if pinned && onclose}
      <button
        type="button"
        class="shrink-0 text-muted-foreground hover:text-foreground"
        onclick={onclose}
        aria-label="Close item list"
      >
        ✕
      </button>
    {/if}
  </div>
  {#if items.length === 0}
    <div class="italic text-muted-foreground">No items.</div>
  {:else}
    <ul class="max-h-48 space-y-0.5 overflow-y-auto pr-1">
      {#each items as it (it.id)}
        {@const link = href?.(it.id) ?? null}
        <li class="flex items-baseline gap-2">
          {#if link}
            <a
              href={link}
              class="hover:underline"
              target={link.startsWith('http') ? '_blank' : undefined}
              rel={link.startsWith('http') ? 'noopener' : undefined}>{it.label}</a
            >
          {:else}
            <span>{it.label}</span>
          {/if}
          {#if it.label !== it.id}
            <span class="font-mono text-[0.6rem] text-muted-foreground">{it.id}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
