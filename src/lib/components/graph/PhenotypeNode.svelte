<script lang="ts" module>
  import type { Node } from '@xyflow/svelte';

  export type PhenotypeNodeData = {
    term_id: string;
    name: string;
    n_genes: number;
    role: 'center' | 'parent' | 'child';
    _expandedParents?: boolean;
    _expandedChildren?: boolean;
    onExpandParents?: (term_id: string) => void;
    onExpandChildren?: (term_id: string) => void;
    [key: string]: unknown;
  };

  export type PhenotypeFlowNode = Node<PhenotypeNodeData, 'phenotype'>;
</script>

<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { cn } from '$lib/utils';
  import { resolve } from '$app/paths';
  import Plus from 'lucide-svelte/icons/plus';

  let { data }: NodeProps<PhenotypeFlowNode> = $props();

  const cardClass = $derived(
    data.role === 'center'
      ? 'border-primary ring-2 ring-primary/40 bg-card'
      : 'border-border bg-card',
  );

  const canExpandParents = $derived(
    !data._expandedParents && typeof data.onExpandParents === 'function',
  );
  const canExpandChildren = $derived(
    !data._expandedChildren && typeof data.onExpandChildren === 'function',
  );
</script>

<div class="relative">
  {#if canExpandParents}
    <button
      type="button"
      class="absolute left-1/2 top-0 z-10 inline-flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground"
      title="Expand parents (broader phenotypes)"
      onclick={(e) => {
        e.stopPropagation();
        data.onExpandParents?.(data.term_id);
      }}
    >
      <Plus class="h-3 w-3" />
    </button>
  {/if}

  <Handle
    type="target"
    position={Position.Top}
    class="!h-2 !w-2 !border-0 !bg-muted-foreground/50"
  />

  <div class={cn('min-w-[180px] max-w-[260px] rounded-md border px-3 py-2 shadow-sm', cardClass)}>
    <div class="mb-1 flex items-center gap-1.5">
      <a
        href={resolve(`/phenotype/${data.term_id}`)}
        class="font-mono text-[0.7rem] text-primary hover:underline"
      >
        {data.term_id}
      </a>
    </div>
    <div class="text-xs font-medium leading-snug">{data.name}</div>
    {#if data.n_genes > 0}
      <div class="mt-1.5">
        <Badge variant="muted" class="py-0 text-[0.6rem]">
          {data.n_genes.toLocaleString()} genes
        </Badge>
      </div>
    {/if}
  </div>

  <Handle
    type="source"
    position={Position.Bottom}
    class="!h-2 !w-2 !border-0 !bg-muted-foreground/50"
  />

  {#if canExpandChildren}
    <button
      type="button"
      class="absolute bottom-0 left-1/2 z-10 inline-flex h-5 w-5 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground"
      title="Expand children (more-specific phenotypes)"
      onclick={(e) => {
        e.stopPropagation();
        data.onExpandChildren?.(data.term_id);
      }}
    >
      <Plus class="h-3 w-3" />
    </button>
  {/if}
</div>
