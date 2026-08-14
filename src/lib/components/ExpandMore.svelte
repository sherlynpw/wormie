<script lang="ts">
  // "+N more / show fewer" toggle used inline at the tail of a long chip
  // cluster or table. Caller owns the expanded state and the onToggle handler;
  // this component just renders the affordance when something can be expanded.

  // With `step`, onToggle(true) reveals another block and (false) collapses.
  let {
    total,
    shown,
    expanded,
    onToggle,
    label = 'more',
    step,
  }: {
    total: number;
    shown: number;
    expanded: boolean;
    onToggle: (next: boolean) => void;
    label?: string;
    step?: number;
  } = $props();

  const remaining = $derived(Math.max(0, total - shown));
</script>

{#if step}
  <div class="flex gap-1.5">
    {#if remaining > 0}
      <button
        type="button"
        onclick={() => onToggle(true)}
        class="self-center rounded border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        +{Math.min(step, remaining)}
        {label}
      </button>
    {/if}
    {#if shown > step}
      <button
        type="button"
        onclick={() => onToggle(false)}
        class="self-center rounded border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        show fewer
      </button>
    {/if}
  </div>
{:else if total > shown}
  <button
    type="button"
    onclick={() => onToggle(!expanded)}
    class="self-center rounded border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
  >
    {expanded ? 'show fewer' : `+${total - shown} ${label}`}
  </button>
{/if}
