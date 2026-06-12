<script lang="ts" module>
  import type { Node } from '@xyflow/svelte';

  export type InteractionNodeData = {
    wormbase_gene: string;
    name: string | null;
    // center=focal, partner=direct hit, target=in filter set (e.g. neuronal),
    // intermediate=bridge on a focal-to-target path.
    role: 'center' | 'partner' | 'target' | 'intermediate';
    // True when this node is also in the filter set; independent of role so
    // the focal node can show its ring AND the target chip simultaneously.
    is_target?: boolean;
    physical_count?: number;
    genetic_count?: number;
    other_count?: number;
    hop?: number;
    [key: string]: unknown;
  };

  export type InteractionFlowNode = Node<InteractionNodeData, 'gene'>;
</script>

<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { cn } from '$lib/utils';
  import { resolve } from '$app/paths';

  let { data }: NodeProps<InteractionFlowNode> = $props();

  const cardClass = $derived(
    data.role === 'center'
      ? 'border-primary ring-2 ring-primary/40 bg-card'
      : data.role === 'target'
        ? 'border-accent bg-accent/15'
        : data.role === 'intermediate'
          ? 'border-dashed border-muted-foreground/40 bg-card/60 opacity-80'
          : 'border-border bg-card',
  );
  const sizeClass = $derived(
    data.role === 'intermediate'
      ? 'min-w-[120px] max-w-[180px] px-2.5 py-1.5 text-[0.7rem]'
      : 'min-w-[150px] max-w-[220px] px-3 py-2',
  );
</script>

<Handle type="target" position={Position.Top} class="!h-2 !w-2 !border-0 !bg-muted-foreground/50" />

<div class={cn('rounded-md border shadow-sm', sizeClass, cardClass)}>
  <a
    href={resolve(`/gene/${data.wormbase_gene}`)}
    class="block font-semibold leading-tight hover:text-primary"
    class:text-xs={data.role !== 'intermediate'}
    class:text-[0.65rem]={data.role === 'intermediate'}
  >
    {data.name ?? data.wormbase_gene}
  </a>
  <div class="mt-0.5 font-mono text-[0.55rem] text-muted-foreground">
    {data.wormbase_gene}
    {#if data.hop !== undefined && data.hop > 0}
      · {data.hop}h
    {/if}
  </div>
  {#if data.role === 'target' || (data.role === 'center' && data.is_target)}
    <Badge variant="default" class="mt-1 bg-accent px-1 py-0 text-[0.55rem] text-accent-foreground">
      target
    </Badge>
  {/if}
  {#if data.role !== 'center' && data.role !== 'intermediate' && (data.physical_count || data.genetic_count)}
    <div class="mt-1.5 flex flex-wrap gap-1">
      {#if data.physical_count}
        <Badge variant="muted" class="px-1 py-0 text-[0.55rem]">
          {data.physical_count}p
        </Badge>
      {/if}
      {#if data.genetic_count}
        <Badge variant="outline" class="px-1 py-0 text-[0.55rem]">
          {data.genetic_count}g
        </Badge>
      {/if}
    </div>
  {/if}
  <a
    href={resolve(`/network/${data.wormbase_gene}`)}
    class="mt-1 inline-block text-[0.55rem] text-primary hover:underline"
  >
    recenter →
  </a>
</div>

<Handle
  type="source"
  position={Position.Bottom}
  class="!h-2 !w-2 !border-0 !bg-muted-foreground/50"
/>
