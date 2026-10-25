<script lang="ts">
  // Mini interaction graph for /gene/[id]: focal gene + top-N partners, same layout selector as /go/[id] and /phenotype/[id].

  import { SvelteFlow, Background, Controls, MiniMap, type Edge } from '@xyflow/svelte';
  import InteractionNode, {
    type InteractionFlowNode,
    type InteractionNodeData,
  } from '$lib/components/graph/InteractionNode.svelte';
  import { applyLayout, type LayoutKind } from '$lib/components/graph/layout';
  import { theme } from '$lib/stores/theme.svelte';
  import type { Interaction } from '$lib/queries';
  import { CATEGORICAL_PALETTE } from '$lib/plot-colors';

  let {
    focalId,
    focalName,
    interactions,
    max = 12,
  }: {
    focalId: string;
    focalName: string | null;
    interactions: Interaction[];
    max?: number;
  } = $props();

  let layoutKind = $state<LayoutKind>('concentric');

  type PartnerAgg = {
    id: string;
    name: string;
    physical: number;
    genetic: number;
    other: number;
  };

  const partners = $derived.by<PartnerAgg[]>(() => {
    void focalId;
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<string, PartnerAgg>();
    for (const ix of interactions) {
      const other = ix.partner;
      // Skip self-interactions: id === focalId would cause each_key_duplicate in SvelteFlow.
      if (other === focalId) continue;
      const sym = ix.partner_symbol ?? ix.partner_name ?? other;
      let p = map.get(other);
      if (!p) {
        p = { id: other, name: sym, physical: 0, genetic: 0, other: 0 };
        map.set(other, p);
      }
      const t = (ix.experimental_type ?? '').toLowerCase();
      if (t === 'physical') p.physical += 1;
      else if (t === 'genetic') p.genetic += 1;
      else p.other += 1;
    }
    return [...map.values()]
      .sort((a, b) => b.physical + b.genetic + b.other - (a.physical + a.genetic + a.other))
      .slice(0, max);
  });

  // Edge colour: physical=purple, genetic=green, mixed=grey; width = 1 + min(4, sqrt(total)).
  const flowNodes = $derived.by<InteractionFlowNode[]>(() => {
    const list: InteractionFlowNode[] = [
      {
        id: focalId,
        type: 'gene',
        position: { x: 0, y: 0 },
        data: {
          wormbase_gene: focalId,
          name: focalName,
          role: 'center',
        } satisfies InteractionNodeData,
      },
    ];
    for (const p of partners) {
      list.push({
        id: p.id,
        type: 'gene',
        position: { x: 0, y: 0 },
        data: {
          wormbase_gene: p.id,
          name: p.name,
          role: 'partner',
          physical_count: p.physical,
          genetic_count: p.genetic,
          other_count: p.other,
        } satisfies InteractionNodeData,
      });
    }
    const edgeList: Edge[] = partners.map((p) => ({
      id: `${focalId}->${p.id}`,
      source: focalId,
      target: p.id,
    }));
    return applyLayout(list, edgeList, { kind: layoutKind, focalId });
  });

  const flowEdges = $derived.by<Edge[]>(() => {
    return partners.map((p) => {
      const total = p.physical + p.genetic + p.other;
      const mixed = p.physical > 0 && p.genetic > 0;
      const color = mixed
        ? 'hsl(240 4% 50% / 0.7)'
        : p.physical > 0
          ? CATEGORICAL_PALETTE[0]
          : p.genetic > 0
            ? CATEGORICAL_PALETTE[1]
            : CATEGORICAL_PALETTE[2];
      const width = (1 + Math.min(4, Math.sqrt(total))).toFixed(1);
      return {
        id: `${focalId}->${p.id}`,
        source: focalId,
        target: p.id,
        style: `stroke: ${color}; stroke-width: ${width}; opacity: 0.85;`,
      };
    });
  });

  const nodeTypes = { gene: InteractionNode as unknown as never };
</script>

{#if partners.length === 0}
  <div class="py-4 text-sm text-muted-foreground">No interactions to visualize.</div>
{:else}
  <div class="space-y-2">
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="text-muted-foreground"
        >{partners.length} partner{partners.length === 1 ? '' : 's'} in view</span
      >
      <label class="ml-auto inline-flex items-center gap-1.5">
        <span class="text-muted-foreground">Layout:</span>
        <select
          bind:value={layoutKind}
          class="rounded border bg-card px-1.5 py-0.5 font-mono text-xs"
        >
          <option value="concentric">concentric</option>
          <option value="radial">radial arcs</option>
          <option value="dagre-TB">tree, top to bottom</option>
          <option value="dagre-LR">tree, left to right</option>
        </select>
      </label>
    </div>
    <div class="overflow-hidden rounded-md border bg-card" style="height: 360px;">
      <SvelteFlow
        nodes={flowNodes}
        edges={flowEdges}
        {nodeTypes}
        fitView
        colorMode={theme.mode}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </SvelteFlow>
    </div>
    <div class="flex flex-wrap justify-center gap-4 text-[0.65rem] text-muted-foreground">
      <div class="flex items-center gap-1.5">
        <span class="inline-block h-0.5 w-3" style="background: {CATEGORICAL_PALETTE[0]};"></span>
        physical (proteins bind each other)
      </div>
      <div class="flex items-center gap-1.5">
        <span class="inline-block h-0.5 w-3" style="background: {CATEGORICAL_PALETTE[1]};"></span>
        genetic (changing one gene alters the effect of the other)
      </div>
      <div class="flex items-center gap-1.5">
        <span class="inline-block h-0.5 w-3" style="background: hsl(240 4% 50% / 0.7);"></span>
        mixed (both types recorded)
      </div>
      <div>line thickness grows with the square root of the number of recorded interactions</div>
    </div>
  </div>
{/if}
