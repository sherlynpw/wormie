<script lang="ts">
  import { LinkPreview as LinkPreviewPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils';

  let {
    class: className,
    sideOffset = 6,
    align = 'start',
    ...rest
  }: LinkPreviewPrimitive.ContentProps & { class?: string } = $props();
</script>

<LinkPreviewPrimitive.Portal>
  <LinkPreviewPrimitive.Content
    {sideOffset}
    {align}
    class={cn(
      'z-50 w-80 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
      'data-[side=bottom]:slide-in-from-top-2',
      'data-[side=top]:slide-in-from-bottom-2',
      className,
    )}
    {...rest}
  />
</LinkPreviewPrimitive.Portal>
