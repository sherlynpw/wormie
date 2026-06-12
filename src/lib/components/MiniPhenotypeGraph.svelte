<script lang="ts">
  // Mini phenotype DAG for /gene/[id]: seed terms + one-hop parents, expandable via node "+" handles.
  // Layout selector mirrors /phenotype/[id] and /go/[id].

  import { SvelteFlow, Background, Controls, MiniMap, type Edge } from '@xyflow/svelte';
  import PhenotypeNode, {
    type PhenotypeFlowNode,
    type PhenotypeNodeData,
  } from '$lib/components/graph/PhenotypeNode.svelte';
  import { applyLayout, type LayoutKind } from '$lib/components/graph/layout';
  import { theme } from '$lib/stores/theme.svelte';
  import { getPhenotypeEdges, getPhenotypeParentsBulk, type PhenotypeRow } from '$lib/queries';

  let { phenotypes, focalGene }: { phenotypes: PhenotypeRow[]; focalGene: string } = $props();

  type NodeInfo = PhenotypeNodeData & { _expandedParents?: boolean; _expandedChildren?: boolean };

  let graphNodes = $state<Record<string, NodeInfo>>({});
  let graphEdges = $state<Record<string, { source: string; target: string }>>({});
  let layoutKind = $state<LayoutKind>('dagre-TB');
  let loading = $state(true);

  const nodeTypes = { phenotype: PhenotypeNode as unknown as never };

  $effect(() => {
    // Re-seed whenever the gene or phenotype list changes.
    const focal = focalGene;
    const list = phenotypes;
    void focal;
    seed(list);
  });

  async function seed(list: PhenotypeRow[]) {
    loading = true;
    if (list.length === 0) {
      graphNodes = {};
      graphEdges = {};
      loading = false;
      return;
    }
    // Cap to 25 most-supported phenotypes so the initial DAG stays legible on highly studied genes.
    const seedCap = 25;
    const seeds = list.slice(0, seedCap);
    const nodes: Record<string, NodeInfo> = {};
    for (const p of seeds) {
      nodes[p.term_id] = {
        term_id: p.term_id,
        name: p.name,
        n_genes: p.n_alleles, // n_genes not in PhenotypeRow; n_alleles used as proxy
        role: 'center',
      } as NodeInfo;
    }
    graphNodes = nodes;
    graphEdges = {};

    // One-hop parents via a single batched query, then mark seed nodes as expanded.
    const parents = await getPhenotypeParentsBulk(seeds.map((s) => s.term_id));
    const nextNodes = { ...nodes };
    const nextEdges: Record<string, { source: string; target: string }> = {};
    for (const e of parents) {
      if (!nextNodes[e.parent_id]) {
        nextNodes[e.parent_id] = {
          term_id: e.parent_id,
          name: e.parent_name,
          n_genes: e.parent_n_genes,
          role: 'parent',
        } as NodeInfo;
      }
      nextEdges[`${e.parent_id}->${e.child_id}`] = { source: e.parent_id, target: e.child_id };
    }
    for (const id of seeds.map((s) => s.term_id)) {
      if (nextNodes[id]) nextNodes[id] = { ...nextNodes[id], _expandedParents: true };
    }
    graphNodes = nextNodes;
    graphEdges = nextEdges;
    loading = false;
  }

  async function expandParents(term_id: string): Promise<void> {
    const ps = await getPhenotypeEdges(term_id, 'parents');
    const next = { ...graphNodes };
    const nextEdges = { ...graphEdges };
    for (const p of ps) {
      if (!next[p.term_id]) {
        next[p.term_id] = {
          term_id: p.term_id,
          name: p.name,
          n_genes: p.n_genes,
          role: 'parent',
        } as NodeInfo;
      }
      nextEdges[`${p.term_id}->${term_id}`] = { source: p.term_id, target: term_id };
    }
    if (next[term_id]) next[term_id] = { ...next[term_id], _expandedParents: true };
    graphNodes = next;
    graphEdges = nextEdges;
  }

  async function expandChildren(term_id: string): Promise<void> {
    const cs = await getPhenotypeEdges(term_id, 'children');
    const next = { ...graphNodes };
    const nextEdges = { ...graphEdges };
    for (const c of cs) {
      if (!next[c.term_id]) {
        next[c.term_id] = {
          term_id: c.term_id,
          name: c.name,
          n_genes: c.n_genes,
          role: 'child',
        } as NodeInfo;
      }
      nextEdges[`${term_id}->${c.term_id}`] = { source: term_id, target: c.term_id };
    }
    if (next[term_id]) next[term_id] = { ...next[term_id], _expandedChildren: true };
    graphNodes = next;
    graphEdges = nextEdges;
  }

  const flowNodes = $derived.by<PhenotypeFlowNode[]>(() => {
    const list: PhenotypeFlowNode[] = Object.values(graphNodes).map((n) => ({
      id: n.term_id,
      type: 'phenotype',
      position: { x: 0, y: 0 },
      data: {
        ...n,
        onExpandParents: (id: string) => expandParents(id),
        onExpandChildren: (id: string) => expandChildren(id),
      },
    }));
    const edgeList: Edge[] = Object.values(graphEdges).map((e) => ({
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
    }));
    // Focal node for radial layout: first seed phenotype.
    const focalId = phenotypes[0]?.term_id;
    return applyLayout(list, edgeList, { kind: layoutKind, focalId });
  });

  const flowEdges = $derived.by<Edge[]>(() => {
    return Object.values(graphEdges).map((e) => ({
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      style: 'stroke: hsl(240 4% 50% / 0.6); stroke-width: 1.5;',
    }));
  });
</script>

<div class="space-y-2">
  <div class="flex flex-wrap items-center gap-2 text-xs">
    <span class="text-muted-foreground">
      {Object.keys(graphNodes).length} term{Object.keys(graphNodes).length === 1 ? '' : 's'} in view
    </span>
    <label class="ml-auto inline-flex items-center gap-1.5">
      <span class="text-muted-foreground">Layout:</span>
      <select
        bind:value={layoutKind}
        class="rounded border bg-card px-1.5 py-0.5 font-mono text-xs"
      >
        <option value="radial">radial</option>
        <option value="dagre-TB">tree (top→bottom)</option>
        <option value="dagre-LR">tree (left→right)</option>
      </select>
    </label>
  </div>
  <div class="overflow-hidden rounded-md border bg-card" style="height: 380px;">
    {#if loading}
      <div class="flex h-full items-center justify-center text-xs text-muted-foreground">
        Loading phenotype DAG…
      </div>
    {:else if Object.keys(graphNodes).length === 0}
      <div class="flex h-full items-center justify-center text-xs italic text-muted-foreground">
        No phenotypes to chart.
      </div>
    {:else}
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
    {/if}
  </div>
  <div class="text-[0.6rem] text-muted-foreground">
    Initial view: up to 25 most-supported phenotypes + their direct parents. Click any node's
    <span class="font-mono">+</span> handle to grow that branch.
  </div>
</div>
