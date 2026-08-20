<script lang="ts" module>
  // Top-of-page hint strip. State lives in the unified `hints` store so
  // "show all hints again" affects every hint type at once.
  import { hints } from '$lib/stores/hints.svelte';
  export function resetAllHints() {
    hints.resetAll();
    if (typeof location !== 'undefined') location.reload();
  }
</script>

<script lang="ts">
  import Lightbulb from 'lucide-svelte/icons/lightbulb';
  import { onMount } from 'svelte';

  type Props = {
    id: string;
    title: string;
    children: import('svelte').Snippet;
  };

  let { id, title, children }: Props = $props();

  onMount(() => hints.init());

  const visible = $derived(hints.initialized && hints.shouldShow(id));
  // Hidden hints collapse to a one-line strip rather than vanishing, so there is
  // always a way back; "hide all" previously left no visible route to restore.
  const collapsed = $derived(hints.initialized && !visible);
</script>

{#if visible}
  <div
    class="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-50/50 px-3 py-2 text-xs dark:bg-amber-950/30"
  >
    <Lightbulb class="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-700 dark:text-amber-400" />
    <div class="min-w-0 flex-1 space-y-1">
      <div class="font-semibold text-amber-900 dark:text-amber-200">{title}</div>
      <div class="leading-relaxed text-foreground/90">{@render children()}</div>
      <div class="flex justify-end">
        <button
          type="button"
          onclick={() => hints.dismiss(id)}
          class="text-[0.7rem] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          title="Collapse this hint; it stays on the page as a line you can click"
        >
          hide
        </button>
      </div>
    </div>
  </div>
{:else if collapsed}
  <button
    type="button"
    onclick={() => hints.restore(id)}
    class="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-[0.7rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    title="Show this hint again"
  >
    <Lightbulb class="h-3 w-3" />
    {title}
  </button>
{/if}
