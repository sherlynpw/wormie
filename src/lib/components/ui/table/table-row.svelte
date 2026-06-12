<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  let {
    class: className,
    children,
    ...rest
  }: HTMLAttributes<HTMLTableRowElement> & { class?: string; children?: Snippet } = $props();
</script>

<tr
  class={cn(
    'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
    className,
  )}
  {...rest}
>
  {@render children?.()}
</tr>
