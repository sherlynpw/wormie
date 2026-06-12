<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import {
    Tooltip,
    TooltipTrigger,
    TooltipContent,
    TooltipProvider,
  } from '$lib/components/ui/tooltip';
  import { describeSystem } from '$lib/biogrid';

  let { name, class: className = '' }: { name: string | null | undefined; class?: string } =
    $props();

  const info = $derived(name ? describeSystem(name) : null);
</script>

{#if name}
  <TooltipProvider delayDuration={200}>
    <Tooltip>
      <TooltipTrigger>
        {#snippet child({ props }: { props: Record<string, unknown> })}
          <span {...props} class="inline-flex items-center">
            <Badge variant="outline" class="cursor-help px-1 py-0 text-[0.55rem] {className}">
              {name}
            </Badge>
          </span>
        {/snippet}
      </TooltipTrigger>
      {#if info}
        <TooltipContent>
          <div class="space-y-1">
            <div class="flex items-baseline gap-2 font-semibold">
              {name}
              <span class="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
                {info.type}
              </span>
            </div>
            <div class="leading-relaxed">{info.description}</div>
          </div>
        </TooltipContent>
      {:else}
        <TooltipContent>
          <div class="font-semibold">{name}</div>
          <div class="text-[0.65rem] text-muted-foreground">No description available.</div>
        </TooltipContent>
      {/if}
    </Tooltip>
  </TooltipProvider>
{/if}
