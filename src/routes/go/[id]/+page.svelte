<script lang="ts">
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { SvelteFlow, Background, Controls, MiniMap, type Edge } from '@xyflow/svelte';
  import {
    getGoTerm,
    getGoEdges,
    getGenesForGoTerm,
    DEFAULT_EDGE_TYPES,
    type GoTermDetail,
    type GoGene,
    type GoEdgeType,
  } from '$lib/queries';
  import { preloadTransitiveCount } from '$lib/stores/go-cache';
  import GoNode, { type GoFlowNode, type GoNodeData } from '$lib/components/graph/GoNode.svelte';
  import { applyLayout, type LayoutKind } from '$lib/components/graph/layout';
  import { theme } from '$lib/stores/theme.svelte';
  import GenePill from '$lib/components/GenePill.svelte';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import TermCrossRef from '$lib/components/TermCrossRef.svelte';
  import { query } from '$lib/db/client';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { cn } from '$lib/utils';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import ExternalLink from 'lucide-svelte/icons/external-link';
  import ArrowUp from 'lucide-svelte/icons/arrow-up';
  import ArrowDown from 'lucide-svelte/icons/arrow-down';
  import { UP_COLOR, DOWN_COLOR } from '$lib/plot-colors';
  import { NAMESPACE_BADGE } from '$lib/plot-colors';

  const id = $derived(page.params.id ?? '');
  let center = $state<GoTermDetail | null>(null);
  let genes = $state<GoGene[]>([]);
  let transitiveCount = $state(0);
  // Universe size for the hypergeometric in the cross-ref widget; one extra query is negligible here.
  let universeN = $state<number>(0);
  let loading = $state(true);
  let notFound = $state(false);

  let edgeTypes = $state<Record<GoEdgeType, boolean>>({
    is_a: true,
    part_of: true,
    regulates: false,
    positively_regulates: false,
    negatively_regulates: false,
  });

  // Graph accumulates nodes on expand; nodes are never auto-removed.
  type NodeInfo = GoNodeData & { _expandedParents?: boolean; _expandedChildren?: boolean };
  let graphNodes = $state<Record<string, NodeInfo>>({});
  let graphEdges = $state<Record<string, { source: string; target: string; rel_type: GoEdgeType }>>(
    {},
  );
  let layoutKind = $state<LayoutKind>('radial');

  let loadToken = 0;

  const nodeTypes = { go: GoNode as unknown as never };

  $effect(() => {
    const cur = id;
    untrack(() => load(cur));
  });

  async function load(cur: string) {
    const my = ++loadToken;
    loading = true;
    notFound = false;
    graphNodes = {};
    graphEdges = {};

    const t = await getGoTerm(cur);
    if (my !== loadToken) return;
    if (!t) {
      notFound = true;
      loading = false;
      return;
    }
    center = t;

    graphNodes = {
      [t.go_id]: { ...t, role: 'center', n_direct_genes: 0 } as NodeInfo,
    };

    const [g, tc, , , nRows] = await Promise.all([
      getGenesForGoTerm(t.go_id),
      preloadTransitiveCount(t.go_id),
      expandParents(t.go_id, true),
      expandChildren(t.go_id, true),
      query<{ n: number }>('SELECT COUNT(DISTINCT wormbase_gene) AS n FROM gene_go'),
    ]);
    if (my !== loadToken) return;
    genes = g;
    universeN = nRows[0]?.n ?? 0;
    transitiveCount = tc;
    loading = false;
  }

  async function expandParents(go_id: string, initial = false): Promise<void> {
    // Fetch all edge types always; filter chips control rendering only.
    const parents = await getGoEdges(go_id, 'parents', DEFAULT_EDGE_TYPES);
    const next = { ...graphNodes };
    const nextEdges = { ...graphEdges };
    for (const p of parents) {
      if (!next[p.go_id]) {
        const role = initial && p.go_id !== id ? 'parent' : (next[p.go_id]?.role ?? 'parent');
        next[p.go_id] = {
          go_id: p.go_id,
          name: p.name,
          namespace: p.namespace,
          n_direct_genes: p.n_direct_genes,
          role,
        } as NodeInfo;
      }
      const key = `${p.go_id}->${go_id}:${p.rel_type}`;
      nextEdges[key] = { source: p.go_id, target: go_id, rel_type: p.rel_type };
    }
    if (next[go_id]) next[go_id] = { ...next[go_id], _expandedParents: true };
    graphNodes = next;
    graphEdges = nextEdges;
  }

  async function expandChildren(go_id: string, initial = false): Promise<void> {
    const children = await getGoEdges(go_id, 'children', DEFAULT_EDGE_TYPES);
    const next = { ...graphNodes };
    const nextEdges = { ...graphEdges };
    for (const c of children) {
      if (!next[c.go_id]) {
        next[c.go_id] = {
          go_id: c.go_id,
          name: c.name,
          namespace: c.namespace,
          n_direct_genes: c.n_direct_genes,
          role: 'child',
        } as NodeInfo;
      }
      const key = `${go_id}->${c.go_id}:${c.rel_type}`;
      nextEdges[key] = { source: go_id, target: c.go_id, rel_type: c.rel_type };
    }
    if (next[go_id]) next[go_id] = { ...next[go_id], _expandedChildren: true };
    graphNodes = next;
    graphEdges = nextEdges;
    void initial;
  }

  function toggleEdgeType(t: GoEdgeType) {
    edgeTypes = { ...edgeTypes, [t]: !edgeTypes[t] };
  }

  // Laid-out nodes/edges for SvelteFlow; nodes connected only via disabled edge types are hidden to avoid orphaned floaters.
  const flowNodes = $derived.by<GoFlowNode[]>(() => {
    const visibleEdges = Object.values(graphEdges).filter((e) => edgeTypes[e.rel_type]);
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const connected = new Set<string>();
    for (const e of visibleEdges) {
      connected.add(e.source);
      connected.add(e.target);
    }
    // Always show the focused node
    connected.add(id);

    const nodeList: GoFlowNode[] = Object.values(graphNodes)
      .filter((n) => connected.has(n.go_id))
      .map((n) => ({
        id: n.go_id,
        type: 'go',
        position: { x: 0, y: 0 },
        data: {
          ...n,
          // "+" handle callbacks bound here so clicking any node expands that node, not the focal.
          onExpandParents: (gid: string) => expandParents(gid),
          onExpandChildren: (gid: string) => expandChildren(gid),
        },
      }));
    const edgeList: Edge[] = visibleEdges.map((e) => ({
      id: `${e.source}->${e.target}:${e.rel_type}`,
      source: e.source,
      target: e.target,
    }));
    return applyLayout(nodeList, edgeList, { kind: layoutKind, focalId: id });
  });

  const EDGE_STYLES: Record<GoEdgeType, string> = {
    is_a: 'stroke: hsl(240 4% 50% / 0.6); stroke-width: 1.5;',
    part_of: 'stroke: hsl(var(--plot-cat-3)); stroke-width: 1.75; stroke-dasharray: 6 3;',
    regulates: 'stroke: hsl(240 4% 50%); stroke-width: 1.75; stroke-dasharray: 2 3;',
    positively_regulates: `stroke: ${UP_COLOR}; stroke-width: 1.75; stroke-dasharray: 2 3;`,
    negatively_regulates: `stroke: ${DOWN_COLOR}; stroke-width: 1.75; stroke-dasharray: 2 3;`,
  };

  const flowEdges = $derived.by<Edge[]>(() => {
    return Object.values(graphEdges)
      .filter((e) => edgeTypes[e.rel_type])
      .map((e) => ({
        id: `${e.source}->${e.target}:${e.rel_type}`,
        source: e.source,
        target: e.target,
        style: EDGE_STYLES[e.rel_type],
        data: { rel_type: e.rel_type },
      }));
  });

  const NS_BADGE = NAMESPACE_BADGE;

  const EDGE_LABEL: Record<GoEdgeType, { label: string; swatch: string }> = {
    is_a: { label: 'is_a', swatch: 'border-t-2 border-solid border-muted-foreground' },
    part_of: {
      label: 'part_of',
      swatch: 'border-t-2 border-dashed border-[hsl(var(--plot-cat-3))]',
    },
    regulates: { label: 'regulates', swatch: 'border-t-2 border-dotted border-zinc-500' },
    positively_regulates: {
      label: '+regulates',
      swatch: 'border-t-2 border-dotted border-[hsl(var(--plot-up))]',
    },
    negatively_regulates: {
      label: '-regulates',
      swatch: 'border-t-2 border-dotted border-[hsl(var(--plot-down))]',
    },
  };
</script>

<svelte:head><title>{center?.name ?? id} · GO · wormie.rs.ht</title></svelte:head>

<div class="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/?view=go" class="self-start">
    <ArrowLeft />
    Back to GO browser
  </Button>

  <p class="text-xs text-muted-foreground">
    Gene counts include genes annotated to child terms. The gene list at the bottom shows only the
    genes annotated directly to this term.
  </p>

  {#if loading}
    <div class="text-sm text-muted-foreground">Loading GO neighborhood...</div>
  {:else if notFound}
    <Card>
      <CardContent class="pt-6">
        <div class="mb-1 font-medium">GO term not found</div>
        <div class="text-sm text-muted-foreground">
          No term matched <span class="font-mono">{id}</span>.
        </div>
      </CardContent>
    </Card>
  {:else if center}
    <Card>
      <CardHeader>
        <div class="flex flex-wrap items-baseline gap-2">
          <span class="rounded px-1.5 py-0.5 font-mono text-xs {NS_BADGE[center.namespace]}">
            {center.namespace}
          </span>
          <CardTitle class="text-xl">{center.name}</CardTitle>
          <a
            href="https://amigo.geneontology.org/amigo/term/{center.go_id}"
            target="_blank"
            rel="noopener"
            class="ml-auto inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
          >
            {center.go_id}
            <ExternalLink class="h-3 w-3" />
          </a>
        </div>
        {#if center.definition}
          <div class="mt-1 text-sm leading-relaxed text-muted-foreground">
            {center.definition}
          </div>
        {/if}
        <div class="mt-2 flex flex-wrap gap-2 text-xs">
          <Badge variant="default" class="bg-accent text-accent-foreground hover:bg-accent">
            {transitiveCount.toLocaleString()} genes (including child terms)
          </Badge>
          <Badge variant="muted">{genes.length} directly annotated</Badge>
          <Badge variant="secondary">{Object.keys(graphNodes).length} nodes in view</Badge>
        </div>
      </CardHeader>
    </Card>

    <TermCrossRef members={genes.map((g) => g.wormbase_gene)} N={universeN} />

    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="mr-1 text-muted-foreground">Edges:</span>
      {#each Object.keys(EDGE_LABEL) as t (t)}
        {@const key = t as GoEdgeType}
        <button
          type="button"
          onclick={() => toggleEdgeType(key)}
          class={cn(
            'inline-flex items-center gap-1.5 rounded border px-2 py-1 transition-colors',
            edgeTypes[key]
              ? 'border-accent bg-accent text-accent-foreground'
              : 'bg-card text-muted-foreground hover:bg-muted/50',
          )}
          aria-pressed={edgeTypes[key]}
        >
          <span class="h-0 w-4 {EDGE_LABEL[key].swatch}"></span>
          <span class="font-mono">{EDGE_LABEL[key].label}</span>
        </button>
      {/each}
      <label class="ml-2 inline-flex items-center gap-1.5">
        <span class="text-muted-foreground">Layout:</span>
        <select
          bind:value={layoutKind}
          class="rounded border bg-card px-1.5 py-0.5 font-mono text-xs"
        >
          <option value="radial">radial (focal in center)</option>
          <option value="dagre-TB">tree, top to bottom</option>
          <option value="dagre-LR">tree, left to right</option>
        </select>
      </label>
      <span class="ml-auto text-muted-foreground"
        >Click a node's GO ID to refocus the graph there.</span
      >
    </div>

    <div class="overflow-hidden rounded-lg border bg-card" style="height: 60vh; min-height: 500px;">
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

    {@const c = center}
    <div class="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        onclick={async () => {
          // Expand all nodes not yet expanded (one-level frontier walk upward).
          const frontier = Object.values(graphNodes).filter((n) => !n._expandedParents);
          await Promise.all(frontier.map((n) => expandParents(n.go_id)));
        }}
      >
        <ArrowUp />
        Expand parents
      </Button>
      <Button
        variant="outline"
        size="sm"
        onclick={async () => {
          const frontier = Object.values(graphNodes).filter((n) => !n._expandedChildren);
          await Promise.all(frontier.map((n) => expandChildren(n.go_id)));
        }}
      >
        <ArrowDown />
        Expand children
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onclick={() => {
          graphNodes = { [c.go_id]: graphNodes[c.go_id] };
          graphEdges = {};
          expandParents(c.go_id, true);
          expandChildren(c.go_id, true);
        }}
      >
        Reset to 1-hop
      </Button>
    </div>

    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="text-base">Directly annotated genes ({genes.length})</CardTitle>
      </CardHeader>
      <CardContent class="pt-0">
        {#if genes.length === 0}
          <div class="text-sm text-muted-foreground">
            No genes directly annotated to this term. {transitiveCount.toLocaleString()} genes are annotated
            to descendant terms (see the graph above).
          </div>
        {:else}
          <div class="flex flex-wrap gap-1.5">
            {#each genes as g, i (i)}
              <GenePill id={g.wormbase_gene} name={g.gene_name}>
                {#snippet extra()}
                  <Badge variant="outline" class="px-1 py-0 text-[0.55rem]">{g.evidence_code}</Badge
                  >
                {/snippet}
              </GenePill>
            {/each}
          </div>
        {/if}
      </CardContent>
    </Card>
  {/if}
</div>
