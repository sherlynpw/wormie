<script lang="ts">
  import { toast } from 'svelte-sonner';
  import { cn } from '$lib/utils';
  import Copy from 'lucide-svelte/icons/copy';
  import Check from 'lucide-svelte/icons/check';
  import type { Snippet } from 'svelte';

  let {
    text,
    label,
    class: className,
    children,
  }: { text?: string; label?: string; class?: string; children: Snippet } = $props();

  let host: HTMLElement | null = $state(null);
  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function copy(e: MouseEvent) {
    // Don't fire when user clicks a real nested link or button.
    // Note: the host element itself has role=button, so we explicitly exclude it.
    const target = e.target as HTMLElement;
    const interactive = target.closest('a, button');
    if (interactive && interactive !== host) return;

    const value = text ?? host?.textContent?.trim() ?? '';
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
      toast.success(label ? `${label} copied` : 'Copied', {
        description: value.length > 60 ? value.slice(0, 60) + '...' : value,
        duration: 1500,
      });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => (copied = false), 900);
    } catch (err) {
      toast.error('Copy failed', { description: String(err) });
    }
  }
</script>

<div
  bind:this={host}
  role="button"
  tabindex="0"
  onclick={copy}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      copy(e as unknown as MouseEvent);
    }
  }}
  title={label ? `Click to copy ${label.toLowerCase()}` : 'Click to copy'}
  class={cn(
    'group relative -mx-1 cursor-copy rounded px-1 transition-colors hover:bg-muted/40',
    copied && 'bg-emerald-100/60 dark:bg-emerald-950/30',
    className,
  )}
>
  {@render children()}
  <span
    class={cn(
      'pointer-events-none absolute right-1 top-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100',
      copied && 'text-emerald-600 opacity-100 dark:text-emerald-400',
    )}
  >
    {#if copied}
      <Check class="h-3 w-3" />
    {:else}
      <Copy class="h-3 w-3" />
    {/if}
  </span>
</div>
