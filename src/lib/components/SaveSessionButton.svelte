<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import BookmarkPlus from 'lucide-svelte/icons/bookmark-plus';
  import { toast } from 'svelte-sonner';
  import { saveSession, sessionToolLabel, type Session } from '$lib/session';

  let {
    build,
    getResults,
    disabled = false,
    defaultName,
    variant = 'outline',
    size = 'sm',
    label = 'Save session',
  }: {
    // Lazy thunk: captures input/param state at click time, not at render time.
    build: () => Session | null;
    // Optional thunk for computed results; if non-null and "Include results" is on,
    // results are embedded so the session reopens without re-running.
    getResults?: () => Record<string, unknown> | null;
    disabled?: boolean;
    defaultName?: string;

    variant?: any;

    size?: any;
    label?: string;
  } = $props();

  let popoverOpen = $state(false);
  let nameInput = $state('');
  let includeResults = $state(true);
  let popoverRef: HTMLDivElement | null = $state(null);
  // Estimated result blob size (bytes), computed once on popover open for the toggle label.
  let resultsSize = $state<number | null>(null);

  $effect(() => {
    if (!popoverOpen) return;
    const built = build();
    const toolLabel = built ? sessionToolLabel(built.tool) : 'Analysis';
    nameInput = defaultName ?? `${toolLabel} ${new Date().toLocaleDateString()}`;
    // Measure blob size via JSON.stringify (same path as save) once on open, not every render.
    if (getResults) {
      try {
        const r = getResults();
        resultsSize = r ? new Blob([JSON.stringify(r)]).size : 0;
      } catch {
        resultsSize = null;
      }
    } else {
      resultsSize = null;
    }
    const onClick = (e: MouseEvent) => {
      if (popoverRef && !popoverRef.contains(e.target as Node)) popoverOpen = false;
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  });

  function fmtSize(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }

  async function save() {
    const session = build();
    if (!session) {
      toast.error('Nothing to save', { description: 'Provide inputs first.' });
      return;
    }
    if (!nameInput.trim()) {
      toast.error('Name required');
      return;
    }
    if (includeResults && getResults) {
      const r = getResults();
      if (r) session.results = r;
    }
    try {
      const ds = await saveSession(nameInput.trim(), session);
      popoverOpen = false;
      toast.success('Session saved', { description: ds.name });
    } catch (e) {
      toast.error('Save failed', { description: String(e) });
    }
  }
</script>

<div bind:this={popoverRef} class="relative inline-block">
  <Button {variant} {size} {disabled} onclick={() => (popoverOpen = !popoverOpen)}>
    <BookmarkPlus class="h-3 w-3" />
    {label}
  </Button>
  {#if popoverOpen}
    <div
      role="menu"
      class="absolute right-0 z-50 mt-1 w-64 space-y-2 rounded-md border bg-popover p-2 shadow-md"
    >
      <div class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        Save analysis session
      </div>
      <input
        bind:value={nameInput}
        placeholder="session name"
        class="w-full rounded border bg-background px-2 py-1 text-sm"
        onkeydown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') popoverOpen = false;
        }}
      />
      <div class="text-[0.65rem] text-muted-foreground">
        Captures current inputs + parameters. Re-open later from Datasets.
      </div>
      {#if getResults && resultsSize !== null && resultsSize > 0}
        <label class="flex items-center gap-2 text-xs">
          <input type="checkbox" bind:checked={includeResults} class="rounded" />
          <span>Include results (+{fmtSize(resultsSize)})</span>
        </label>
      {/if}
      <div class="flex justify-end gap-1">
        <Button variant="ghost" size="sm" onclick={() => (popoverOpen = false)}>Cancel</Button>
        <Button size="sm" onclick={save}>Save</Button>
      </div>
    </div>
  {/if}
</div>
