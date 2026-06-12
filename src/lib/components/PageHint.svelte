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
  import X from 'lucide-svelte/icons/x';
  import { onMount } from 'svelte';

  type Props = {
    id: string;
    title: string;
    children: import('svelte').Snippet;
  };

  let { id, title, children }: Props = $props();

  onMount(() => hints.init());

  const visible = $derived(hints.initialized && hints.shouldShow(id));
</script>

{#if visible}
  <div
    class="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-50/50 px-3 py-2 text-xs dark:bg-amber-950/30"
  >
    <Lightbulb class="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-700 dark:text-amber-400" />
    <div class="min-w-0 flex-1 space-y-1">
      <div class="font-semibold text-amber-900 dark:text-amber-200">{title}</div>
      <div class="leading-relaxed text-foreground/90">{@render children()}</div>
    </div>
    <div class="flex flex-shrink-0 items-center gap-2">
      <button
        type="button"
        onclick={() => hints.hideAll()}
        class="hidden text-[0.65rem] text-muted-foreground transition-colors hover:text-foreground sm:inline"
        title="Hide every hint across the site"
      >
        hide all
      </button>
      <button
        type="button"
        onclick={() => hints.dismiss(id)}
        class="text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Dismiss hint"
        title="Dismiss this hint"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
{/if}
