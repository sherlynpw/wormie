<script lang="ts" module>
  // Per-control info icon backed by the unified `hints` store.
  import { hints } from '$lib/stores/hints.svelte';
  export function resetControlHints() {
    hints.resetAll();
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import Info from 'lucide-svelte/icons/info';
  import { HoverCard, HoverCardTrigger, HoverCardContent } from '$lib/components/ui/hover-card';

  type Props = {
    id: string;
    title?: string;
    children: import('svelte').Snippet;
    side?: 'top' | 'bottom' | 'left' | 'right';
  };

  let { id, title, children, side = 'top' }: Props = $props();

  let open = $state(false);

  onMount(() => hints.init());

  // `seen` is derived: anything dismissed, or any hint when allOff is true,
  // is considered seen and won't pulse. Trigger remains hoverable forever.
  const seen = $derived(!hints.shouldShow(id));

  function onTriggerClick() {
    if (!seen) hints.dismiss(id);
    open = !open;
  }

  function onDismiss() {
    open = false;
    hints.dismiss(id);
  }
</script>

<HoverCard bind:open openDelay={150} closeDelay={100}>
  <HoverCardTrigger>
    {#snippet child({ props }: { props: Record<string, unknown> })}
      <button
        type="button"
        onclick={onTriggerClick}
        class="relative inline-flex h-4 w-4 items-center justify-center rounded-full align-middle
					{seen ? 'text-muted-foreground/60 hover:text-foreground' : 'text-primary'}
					transition-colors"
        aria-label={title ?? 'Hint'}
        {...props}
      >
        <Info class="h-3.5 w-3.5" />
        {#if !seen}
          <span
            class="pointer-events-none absolute inset-0 animate-ping rounded-full ring-2 ring-primary/40"
          ></span>
        {/if}
      </button>
    {/snippet}
  </HoverCardTrigger>
  <HoverCardContent {side} class="max-w-xs space-y-1.5 text-xs">
    {#if title}
      <div class="font-semibold">{title}</div>
    {/if}
    <div class="leading-relaxed text-foreground/90">{@render children()}</div>
    {#if !seen}
      <div class="pt-1 text-right">
        <button
          type="button"
          onclick={onDismiss}
          class="text-[0.65rem] text-muted-foreground hover:text-foreground"
        >
          Got it
        </button>
      </div>
    {/if}
  </HoverCardContent>
</HoverCard>
