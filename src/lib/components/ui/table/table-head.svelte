<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  let {
    class: className,
    children,
    ...rest
  }: HTMLAttributes<HTMLTableCellElement> & { class?: string; children?: Snippet } = $props();
</script>

<th
  class={cn(
    'h-10 px-3 text-left align-middle text-xs font-medium uppercase tracking-wider text-muted-foreground [&:has([role=checkbox])]:pr-0',
    className,
  )}
  {...rest}
>
  {@render children?.()}
</th>
