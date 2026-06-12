<script lang="ts">
  import { selection } from '$lib/stores/selection.svelte';
  import { cn } from '$lib/utils';
  import Check from 'lucide-svelte/icons/check';
  import Plus from 'lucide-svelte/icons/plus';

  let {
    id,
    class: className,
    size = 'sm',
  }: { id: string; class?: string; size?: 'sm' | 'md' } = $props();

  const checked = $derived(selection.has(id));

  function toggle(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    selection.toggle(id);
  }

  const sizeClass = $derived(size === 'sm' ? 'w-4 h-4' : 'w-5 h-5');
</script>

<button
  type="button"
  onclick={toggle}
  aria-label={checked ? 'Remove from selection' : 'Add to selection'}
  aria-pressed={checked}
  title={checked ? 'Remove from selection' : 'Add to selection'}
  class={cn(
    'inline-flex shrink-0 items-center justify-center rounded border transition-colors',
    sizeClass,
    checked
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-input bg-card text-muted-foreground hover:border-primary hover:text-foreground',
    className,
  )}
>
  {#if checked}
    <Check class={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
  {:else}
    <Plus class={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
  {/if}
</button>
