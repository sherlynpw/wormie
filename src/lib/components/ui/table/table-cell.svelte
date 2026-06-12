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

<td class={cn('p-3 align-middle [&:has([role=checkbox])]:pr-0', className)} {...rest}>
  {@render children?.()}
</td>
