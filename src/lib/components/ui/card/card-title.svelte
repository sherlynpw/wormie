<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  let {
    class: className,
    children,
    ...rest
  }: HTMLAttributes<HTMLHeadingElement> & { class?: string; children?: Snippet } = $props();
</script>

<h3 class={cn('text-lg font-semibold leading-none tracking-tight', className)} {...rest}>
  {@render children?.()}
</h3>
