<script lang="ts">
  import { cn } from '$lib/utils';
  import { toast } from 'svelte-sonner';
  import Copy from 'lucide-svelte/icons/copy';
  import Check from 'lucide-svelte/icons/check';

  let {
    text,
    class: className,
    label = 'Copy',
  }: { text: string; class?: string; label?: string } = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function copy(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      toast.success('Copied', {
        description: text.length > 60 ? text.slice(0, 60) + '...' : text,
        duration: 1500,
      });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => (copied = false), 1200);
    } catch (e) {
      toast.error('Copy failed', { description: String(e) });
    }
  }
</script>

<button
  type="button"
  onclick={copy}
  aria-label="{label}: {text}"
  title={copied ? 'Copied!' : `${label}: ${text}`}
  class={cn(
    'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
    copied && 'text-emerald-600 dark:text-emerald-400',
    className,
  )}
>
  {#if copied}
    <Check class="h-3 w-3" />
  {:else}
    <Copy class="h-3 w-3" />
  {/if}
</button>
