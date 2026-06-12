<script lang="ts">
  // Star + note popover for a gene. Note panel floats below the trigger (not constrained
  // by the parent flex row); saved note renders below buttons when not editing.
  import { onMount } from 'svelte';
  import { bookmarks } from '$lib/stores/bookmarks.svelte';
  import Star from 'lucide-svelte/icons/star';
  import StickyNote from 'lucide-svelte/icons/sticky-note';

  type Props = {
    wormbase_gene: string;
    gene_name: string | null;
  };

  let { wormbase_gene, gene_name }: Props = $props();

  let popoverOpen = $state(false);
  let popoverRef: HTMLDivElement | null = $state(null);
  let noteValue = $state('');
  let tagsValue = $state('');
  let textareaEl: HTMLTextAreaElement | null = $state(null);

  onMount(() => {
    bookmarks.init();
    const b = bookmarks.get(wormbase_gene);
    noteValue = b?.note ?? '';
    tagsValue = (b?.tags ?? []).join(', ');
  });

  const isStarred = $derived(bookmarks.has(wormbase_gene));
  const currentNote = $derived(bookmarks.get(wormbase_gene)?.note ?? '');

  function toggleStar() {
    bookmarks.toggle(wormbase_gene, gene_name);
    noteValue = bookmarks.get(wormbase_gene)?.note ?? '';
    if (!bookmarks.has(wormbase_gene)) popoverOpen = false;
  }

  function openPopover() {
    const b = bookmarks.get(wormbase_gene);
    noteValue = b?.note ?? '';
    tagsValue = (b?.tags ?? []).join(', ');
    popoverOpen = true;
    setTimeout(() => textareaEl?.focus(), 0);
  }

  function saveNote() {
    bookmarks.setNote(wormbase_gene, gene_name, noteValue.trim());
    const tags = tagsValue
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    bookmarks.setTags(wormbase_gene, gene_name, tags);
    popoverOpen = false;
  }

  function cancelEdit() {
    const b = bookmarks.get(wormbase_gene);
    noteValue = b?.note ?? '';
    tagsValue = (b?.tags ?? []).join(', ');
    popoverOpen = false;
  }

  $effect(() => {
    if (!popoverOpen) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef && !popoverRef.contains(e.target as Node)) cancelEdit();
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      saveNote();
    }
  }
</script>

<div bind:this={popoverRef} class="relative inline-flex items-center gap-1">
  <button
    type="button"
    onclick={toggleStar}
    class="inline-flex items-center gap-1 rounded border bg-card px-2 py-1 text-xs transition-colors hover:bg-accent"
    title={isStarred ? 'Remove bookmark' : 'Bookmark this gene'}
  >
    <Star class={isStarred ? 'h-3.5 w-3.5 fill-amber-400 text-amber-500' : 'h-3.5 w-3.5'} />
    {isStarred ? 'Saved' : 'Save'}
  </button>
  {#if isStarred}
    <button
      type="button"
      onclick={openPopover}
      class="inline-flex items-center gap-1 rounded border bg-card px-2 py-1 text-xs transition-colors hover:bg-accent"
      title="Add or edit a note (saved locally)"
    >
      <StickyNote class="h-3.5 w-3.5" />
      {currentNote ? 'Edit note' : 'Add note'}
    </button>
  {/if}

  {#if popoverOpen}
    <div
      class="absolute right-0 top-full z-30 mt-1 w-80 space-y-2 rounded-lg border bg-popover p-3 shadow-xl"
      role="dialog"
    >
      <div
        class="flex items-baseline justify-between text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        <span>Note for {gene_name ?? wormbase_gene}</span>
        <span class="font-mono normal-case">{noteValue.length} chars</span>
      </div>
      <textarea
        bind:this={textareaEl}
        bind:value={noteValue}
        onkeydown={onKey}
        rows="4"
        placeholder="Personal note (private, browser-only). ⌘+Enter saves, Esc cancels."
        class="w-full resize-y rounded border bg-background px-2 py-1.5 text-sm"
      ></textarea>
      <div class="space-y-1">
        <div class="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Tags (comma-separated, lowercase)
        </div>
        <input
          bind:value={tagsValue}
          onkeydown={onKey}
          placeholder="pathway, iis, dauer"
          class="w-full rounded border bg-background px-2 py-1 text-xs"
        />
      </div>
      <div class="flex items-center justify-end gap-2">
        <button
          type="button"
          onclick={cancelEdit}
          class="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={saveNote}
          class="rounded border bg-accent px-2 py-1 text-xs text-accent-foreground transition-colors hover:bg-accent/80"
        >
          Save note
        </button>
      </div>
    </div>
  {/if}
</div>
