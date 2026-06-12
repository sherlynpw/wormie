<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  let {
    class: className,
    children,
    ...rest
  }: HTMLAttributes<HTMLTableSectionElement> & { class?: string; children?: Snippet } = $props();
</script>

<thead class={cn('sticky top-0 z-10 bg-card [&_tr]:border-b', className)} {...rest}>
  {@render children?.()}
</thead>
