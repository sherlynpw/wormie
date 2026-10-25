<script lang="ts">
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { SvelteFlow, Background, Controls, MiniMap, type Edge } from '@xyflow/svelte';
  import {
    getGene,
    getNeuronalGeneSet,
    getWormcatCategories,
    getWormcatGeneSet,
    type GeneRow,
    type WormcatCategoryRow,
  } from '$lib/queries';
  import InteractionNode, {
    type InteractionFlowNode,
  } from '$lib/components/graph/InteractionNode.svelte';
  import { applyLayout, type LayoutKind } from '$lib/components/graph/layout';
  import { theme } from '$lib/stores/theme.svelte';
  import { expandNetwork, type EdgeTypeFilter, type ExpansionResult } from '$lib/network-expand';
  import { datasets, type Dataset } from '$lib/stores/datasets.svelte';
  import { parseGeneList } from '$lib/gene-parse';
  import { downloadTsv } from '$lib/download';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { cn } from '$lib/utils';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Download from 'lucide-svelte/icons/download';
  import PageHint from '$lib/components/PageHint.svelte';
  import { CATEGORICAL_PALETTE } from '$lib/plot-colors';

  const id = $derived(page.params.id ?? '');
  let center = $state<GeneRow | null>(null);
  let loading = $state(true);
  let notFound = $state(false);

  let edgeTypes = $state({ physical: true, genetic: true, other: false });
  let layoutKind = $state<LayoutKind>('concentric');
  // Hide bridge nodes; show one virtual focal→target edge per target, labelled with hop count.
  let targetsOnly = $state(false);

  // Filter source: 'none' (no Steiner prune), 'neuronal', 'wormcat:<cat>', or 'dataset:<id>'.
  type FilterSource =
    | { kind: 'none' }
    | { kind: 'neuronal' }
    | { kind: 'wormcat'; category: string }
    | { kind: 'dataset'; id: string };
  let filterSource = $state<FilterSource>({ kind: 'none' });
  // -1 = unlimited BFS (same sentinel for maxNodes). maxNodes is viz-only; batch always ignores it.
  let maxHops = $state<number>(1);
  let maxNodes = $state<number>(20);

  let wormcatCategories = $state<WormcatCategoryRow[]>([]);
  let datasetList = $state<Dataset[]>([]);
  let filterSetCache = $state<{ key: string; set: Set<string> } | null>(null);

  let expansion = $state<ExpansionResult | null>(null);
  let expanding = $state(false);
  let expandTook = $state<number>(0);

  const nodeTypes = { gene: InteractionNode as unknown as never };

  let loadToken = 0;
  let expandToken = 0;

  $effect(() => {
    const cur = id;
    untrack(() => load(cur));
  });

  async function load(cur: string) {
    const my = ++loadToken;
    loading = true;
    notFound = false;
    const [g, cats] = await Promise.all([getGene(cur), getWormcatCategories()]);
    if (my !== loadToken) return;
    center = g;
    wormcatCategories = cats;
    await datasets.init();
    datasetList = datasets.byType('gene-list');
    if (!g) notFound = true;
    loading = false;
    if (g) await rerunExpansion();
  }

  async function resolveFilterSet(): Promise<Set<string>> {
    const src = filterSource;
    if (src.kind === 'none') return new Set<string>();
    // Cache by serialized key to avoid re-fetching the full neuronal/wormcat table on repeat calls.
    const key = JSON.stringify(src);
    if (filterSetCache && filterSetCache.key === key) return filterSetCache.set;
    let ids: string[] = [];
    if (src.kind === 'neuronal') ids = await getNeuronalGeneSet();
    else if (src.kind === 'wormcat') ids = await getWormcatGeneSet(src.category);
    else if (src.kind === 'dataset') {
      const ds = await datasets.getById(src.id);
      if (ds) ids = parseGeneList(ds.body);
    }
    const set = new Set<string>(ids);
    filterSetCache = { key, set };
    return set;
  }

  async function rerunExpansion() {
    if (!center) return;
    const my = ++expandToken;
    expanding = true;
    const t0 = performance.now();
    const types: EdgeTypeFilter = [];
    if (edgeTypes.physical) types.push('physical');
    if (edgeTypes.genetic) types.push('genetic');
    if (edgeTypes.other) types.push('other');
    const targets = await resolveFilterSet();
    try {
      const res = await expandNetwork({
        focal: center.wormbase_gene,
        targets,
        maxHops, // -1 -> Infinity inside expandNetwork (BFS to natural termination)
        maxNodes,
        edgeTypes: types,
      });
      if (my !== expandToken) return;
      expansion = res;
      expandTook = performance.now() - t0;
    } finally {
      if (my === expandToken) expanding = false;
    }
  }

  // 250 ms debounce prevents rapid re-expansion while typing; token guard cancels stale flights.
  let rerunTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    void edgeTypes.physical;
    void edgeTypes.genetic;
    void edgeTypes.other;
    void filterSource;
    void maxHops;
    void maxNodes;
    // Auto-disable targetsOnly when the filter is cleared (meaningless without one).
    if (filterSource.kind === 'none' && targetsOnly) targetsOnly = false;
    if (!center) return;
    if (rerunTimer) clearTimeout(rerunTimer);
    rerunTimer = setTimeout(() => {
      untrack(() => rerunExpansion());
    }, 250);
  });

  const flow = $derived.by<{ nodes: InteractionFlowNode[]; edges: Edge[] }>(() => {
    if (!center || !expansion) return { nodes: [], edges: [] };

    // Targets-only: drop intermediates, emit one virtual focal→target edge per reached target.
    if (targetsOnly) {
      const focalId = center.wormbase_gene;
      const nodes: InteractionFlowNode[] = [];
      for (const n of expansion.nodes.values()) {
        if (n.id !== focalId && n.role !== 'target') continue;
        const role: 'center' | 'target' = n.id === focalId ? 'center' : 'target';
        nodes.push({
          id: n.id,
          type: 'gene',
          position: { x: 0, y: 0 },
          data: {
            wormbase_gene: n.id,
            name: n.name,
            role,
            hop: n.hop,
            is_target: n.is_target,
          },
        });
      }
      const edges: Edge[] = [];
      for (const n of expansion.nodes.values()) {
        if (n.id === focalId || n.role !== 'target') continue;
        // Dash density encodes distance: 1 hop = solid, 2 = sparse dash, 3+ = sparser dash.
        const dash =
          n.hop <= 1 ? '' : n.hop === 2 ? 'stroke-dasharray: 4 4;' : 'stroke-dasharray: 2 6;';
        edges.push({
          id: `${focalId}-->${n.id}:reach`,
          source: focalId,
          target: n.id,
          style: `stroke: hsl(var(--plot-down)); stroke-width: 1.5; opacity: ${0.9 - Math.min(0.4, (n.hop - 1) * 0.15)}; ${dash}`,
          label: `${n.hop}h`,
          labelStyle: 'font-size: 9px; fill: var(--muted-foreground);',
        });
      }
      return {
        nodes: applyLayout(nodes, edges, { kind: layoutKind, focalId }),
        edges,
      };
    }

    const nodes: InteractionFlowNode[] = [];
    for (const n of expansion.nodes.values()) {
      // Map network-expand role to InteractionNode role ('focal' -> 'center').
      const role: 'center' | 'target' | 'intermediate' | 'partner' =
        n.role === 'focal' ? 'center' : n.role;
      nodes.push({
        id: n.id,
        type: 'gene',
        position: { x: 0, y: 0 },
        data: {
          wormbase_gene: n.id,
          name: n.name,
          role,
          hop: n.hop,
          is_target: n.is_target,
        },
      });
    }
    const edges: Edge[] = expansion.edges.map((e) => {
      const types = e.types;
      const physical = types.has('physical');
      const genetic = types.has('genetic');
      const other = types.has('other');
      const color =
        physical && (genetic || other)
          ? 'hsl(240 4% 50% / 0.7)'
          : physical
            ? CATEGORICAL_PALETTE[0]
            : genetic
              ? CATEGORICAL_PALETTE[1]
              : CATEGORICAL_PALETTE[2];
      const dash =
        physical && !genetic && !other
          ? ''
          : genetic && !physical
            ? 'stroke-dasharray: 6 3;'
            : other && !physical && !genetic
              ? 'stroke-dasharray: 2 3;'
              : '';
      const width = (1 + Math.min(4, Math.sqrt(e.count))).toFixed(1);
      return {
        id: `${e.source}--${e.target}`,
        source: e.source,
        target: e.target,
        style: `stroke: ${color}; stroke-width: ${width}; ${dash}`,
        data: { types: [...types] },
      };
    });
    return {
      nodes: applyLayout(nodes, edges, {
        kind: layoutKind,
        focalId: center.wormbase_gene,
      }),
      edges,
    };
  });

  const EDGE_LEGEND: { key: 'physical' | 'genetic' | 'other'; label: string; swatch: string }[] = [
    {
      key: 'physical',
      label: 'Physical',
      swatch: 'border-t-2 border-solid border-[hsl(var(--plot-down))]',
    },
    {
      key: 'genetic',
      label: 'Genetic',
      swatch: 'border-t-2 border-dashed border-[hsl(var(--plot-up))]',
    },
    {
      key: 'other',
      label: 'Other',
      swatch: 'border-t-2 border-dotted border-[hsl(var(--plot-cat-3))]',
    },
  ];

  // String mirror of FilterSource for <select> option values.
  const filterValue = $derived.by(() => {
    const s = filterSource;
    if (s.kind === 'none') return 'none';
    if (s.kind === 'neuronal') return 'neuronal';
    if (s.kind === 'wormcat') return `wormcat:${s.category}`;
    return `dataset:${s.id}`;
  });
  function setFilterValue(v: string) {
    if (v === 'none') filterSource = { kind: 'none' };
    else if (v === 'neuronal') filterSource = { kind: 'neuronal' };
    else if (v.startsWith('wormcat:'))
      filterSource = { kind: 'wormcat', category: v.slice('wormcat:'.length) };
    else if (v.startsWith('dataset:'))
      filterSource = { kind: 'dataset', id: v.slice('dataset:'.length) };
  }

  function tsTag(): string {
    return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  }
  function exportNodes() {
    if (!expansion || !center) return;
    downloadTsv(
      `network_${center.wormbase_gene}_nodes_${tsTag()}.tsv`,
      [
        { header: 'wormbase_gene', get: (n) => n.id },
        { header: 'name', get: (n) => n.name ?? '' },
        { header: 'role', get: (n) => n.role },
        { header: 'is_target', get: (n) => (n.is_target ? 'yes' : 'no') },
        { header: 'hop_from_focal', get: (n) => n.hop },
      ],
      [...expansion.nodes.values()],
    );
  }
  function exportEdges() {
    if (!expansion || !center) return;
    downloadTsv(
      `network_${center.wormbase_gene}_edges_${tsTag()}.tsv`,
      [
        { header: 'source', get: (e) => e.source },
        { header: 'target', get: (e) => e.target },
        { header: 'evidence_types', get: (e) => [...e.types].sort().join('|') },
        { header: 'n_evidence', get: (e) => e.count },
      ],
      expansion.edges,
    );
  }
  function exportPaths() {
    if (!expansion || !center) return;
    if (expansion.paths.length === 0) {
      // Paths are only emitted when a real target filter is applied.
      return;
    }
    downloadTsv(
      `network_${center.wormbase_gene}_paths_${tsTag()}.tsv`,
      [
        { header: 'target_id', get: (p) => p.target_id },
        { header: 'target_name', get: (p) => p.target_name ?? '' },
        { header: 'hops', get: (p) => p.hops },
        { header: 'path_ids', get: (p) => p.path_ids.join('/') },
        { header: 'path_names', get: (p) => p.path_names.map((n) => n ?? '?').join('/') },
      ],
      expansion.paths,
    );
  }
  async function exportTargets() {
    if (!expansion || !center) return;
    const targets = await resolveFilterSet();
    if (targets.size === 0) return;
    // Emits only reached targets (neuronal set is ~5k rows; unreached omitted to reduce clutter).
    const { getGeneNames } = await import('$lib/queries');
    const names = await getGeneNames([...targets]);
    type Row = { target_id: string; target_name: string; hops: number };
    const rows: Row[] = [];
    for (const tid of targets) {
      const node = expansion.nodes.get(tid);
      if (!node) continue;
      rows.push({
        target_id: tid,
        target_name: names.get(tid)?.gene_name ?? '',
        hops: node.hop,
      });
    }
    rows.sort((a, b) => a.hops - b.hops || a.target_name.localeCompare(b.target_name));
    downloadTsv(
      `network_${center.wormbase_gene}_targets_${tsTag()}.tsv`,
      [
        { header: 'target_id', get: (r) => r.target_id },
        { header: 'target_name', get: (r) => r.target_name },
        { header: 'hops_from_focal', get: (r) => r.hops },
      ],
      rows,
    );
  }

  let skipViz = $state(false);
  // Batch: run expansion across multiple focals and emit combined TSVs (no viz, data-only).
  let batchInput = $state('');
  let batchRunning = $state(false);
  let batchProgress = $state<{ done: number; total: number; current: string }>({
    done: 0,
    total: 0,
    current: '',
  });
  type BatchResult = {
    focal_id: string;
    focal_name: string | null;
    result: ExpansionResult;
  };
  let batchResults = $state<BatchResult[]>([]);
  let batchError = $state<string | null>(null);

  async function runBatch() {
    batchError = null;
    batchResults = [];
    const tokens = parseGeneList(batchInput);
    if (tokens.length === 0) {
      batchError = 'Paste at least one focal gene (WBGene IDs or names).';
      return;
    }
    // Resolve names to WBGene IDs in one round-trip.
    const { bulkLookup } = await import('$lib/queries');
    const resolved = await bulkLookup(tokens);
    const focals = [...new Set(resolved.hits.map((h) => h.wormbase_gene))];
    if (focals.length === 0) {
      batchError = `None of the ${tokens.length} input tokens resolved to a gene.`;
      return;
    }
    // Resolve names for display.
    const { getGeneNames } = await import('$lib/queries');
    const names = await getGeneNames(focals);

    const types: EdgeTypeFilter = [];
    if (edgeTypes.physical) types.push('physical');
    if (edgeTypes.genetic) types.push('genetic');
    if (edgeTypes.other) types.push('other');
    const targets = await resolveFilterSet();

    batchRunning = true;
    batchProgress = { done: 0, total: focals.length, current: '' };
    const out: BatchResult[] = [];
    try {
      for (const f of focals) {
        const meta = names.get(f);
        const nameForLog = meta?.gene_name ?? f;
        batchProgress = { done: out.length, total: focals.length, current: nameForLog };
        // Batch ignores node cap; -1 runs BFS to natural termination.
        const res = await expandNetwork({
          focal: f,
          targets,
          maxHops,
          maxNodes: -1,
          edgeTypes: types,
        });
        out.push({ focal_id: f, focal_name: meta?.gene_name ?? null, result: res });
      }
    } finally {
      batchRunning = false;
      batchProgress = { done: out.length, total: focals.length, current: '' };
    }
    batchResults = out;
  }

  function exportBatchNodes() {
    if (batchResults.length === 0) return;
    const rows: {
      focal_id: string;
      focal_name: string;
      id: string;
      name: string;
      role: string;
      is_target: 'yes' | 'no';
      hop: number;
    }[] = [];
    for (const b of batchResults) {
      for (const n of b.result.nodes.values()) {
        rows.push({
          focal_id: b.focal_id,
          focal_name: b.focal_name ?? '',
          id: n.id,
          name: n.name ?? '',
          role: n.role,
          is_target: n.is_target ? 'yes' : 'no',
          hop: n.hop,
        });
      }
    }
    downloadTsv(
      `network_batch_nodes_${tsTag()}.tsv`,
      [
        { header: 'focal_id', get: (r) => r.focal_id },
        { header: 'focal_name', get: (r) => r.focal_name },
        { header: 'wormbase_gene', get: (r) => r.id },
        { header: 'name', get: (r) => r.name },
        { header: 'role', get: (r) => r.role },
        { header: 'is_target', get: (r) => r.is_target },
        { header: 'hop_from_focal', get: (r) => r.hop },
      ],
      rows,
    );
  }
  function exportBatchEdges() {
    if (batchResults.length === 0) return;
    const rows: {
      focal_id: string;
      focal_name: string;
      source: string;
      target: string;
      types: string;
      count: number;
    }[] = [];
    for (const b of batchResults) {
      for (const e of b.result.edges) {
        rows.push({
          focal_id: b.focal_id,
          focal_name: b.focal_name ?? '',
          source: e.source,
          target: e.target,
          types: [...e.types].sort().join('|'),
          count: e.count,
        });
      }
    }
    downloadTsv(
      `network_batch_edges_${tsTag()}.tsv`,
      [
        { header: 'focal_id', get: (r) => r.focal_id },
        { header: 'focal_name', get: (r) => r.focal_name },
        { header: 'source', get: (r) => r.source },
        { header: 'target', get: (r) => r.target },
        { header: 'evidence_types', get: (r) => r.types },
        { header: 'n_evidence', get: (r) => r.count },
      ],
      rows,
    );
  }
  async function exportBatchTargets() {
    if (batchResults.length === 0) return;
    const targets = await resolveFilterSet();
    if (targets.size === 0) return;
    // Reached-only per focal; union across rows externally for a full reachability matrix.
    const { getGeneNames } = await import('$lib/queries');
    const names = await getGeneNames([...targets]);
    type Row = {
      focal_id: string;
      focal_name: string;
      target_id: string;
      target_name: string;
      hops: number;
    };
    const rows: Row[] = [];
    for (const b of batchResults) {
      for (const tid of targets) {
        const node = b.result.nodes.get(tid);
        if (!node) continue;
        rows.push({
          focal_id: b.focal_id,
          focal_name: b.focal_name ?? '',
          target_id: tid,
          target_name: names.get(tid)?.gene_name ?? '',
          hops: node.hop,
        });
      }
    }
    rows.sort(
      (a, b) =>
        a.focal_name.localeCompare(b.focal_name) ||
        a.hops - b.hops ||
        a.target_name.localeCompare(b.target_name),
    );
    downloadTsv(
      `network_batch_targets_${tsTag()}.tsv`,
      [
        { header: 'focal_id', get: (r) => r.focal_id },
        { header: 'focal_name', get: (r) => r.focal_name },
        { header: 'target_id', get: (r) => r.target_id },
        { header: 'target_name', get: (r) => r.target_name },
        { header: 'hops_from_focal', get: (r) => r.hops },
      ],
      rows,
    );
  }
  function exportBatchPaths() {
    if (batchResults.length === 0) return;
    const rows: {
      focal_id: string;
      focal_name: string;
      target_id: string;
      target_name: string;
      hops: number;
      path_ids: string;
      path_names: string;
    }[] = [];
    for (const b of batchResults) {
      for (const p of b.result.paths) {
        rows.push({
          focal_id: b.focal_id,
          focal_name: b.focal_name ?? '',
          target_id: p.target_id,
          target_name: p.target_name ?? '',
          hops: p.hops,
          path_ids: p.path_ids.join('/'),
          path_names: p.path_names.map((n) => n ?? '?').join('/'),
        });
      }
    }
    downloadTsv(
      `network_batch_paths_${tsTag()}.tsv`,
      [
        { header: 'focal_id', get: (r) => r.focal_id },
        { header: 'focal_name', get: (r) => r.focal_name },
        { header: 'target_id', get: (r) => r.target_id },
        { header: 'target_name', get: (r) => r.target_name },
        { header: 'hops', get: (r) => r.hops },
        { header: 'path_ids', get: (r) => r.path_ids },
        { header: 'path_names', get: (r) => r.path_names },
      ],
      rows,
    );
  }
</script>

<svelte:head
  ><title>{center ? (center.gene_name ?? center.wormbase_gene) : id} · network · wormie.rs.ht</title
  ></svelte:head
>

<div class="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/gene/{id}" class="self-start">
    <ArrowLeft />
    Back to gene detail
  </Button>

  <PageHint id="network" title="Interaction neighborhood">
    Interactions for this gene from the Biological General Repository for Interaction Datasets
    (BioGRID). Each dot is a gene and each line is a recorded interaction. Click a neighbor gene to
    make it the center. Lines are weighted by the number of evidence records. Only interactions
    recorded in BioGRID are shown, and none are inferred. A hop is one interaction step away from
    the center gene.
  </PageHint>

  {#if loading}
    <div class="text-sm text-muted-foreground">Loading interaction network...</div>
  {:else if notFound}
    <Card>
      <CardContent class="pt-6">
        <div class="mb-1 font-medium">Gene not found</div>
        <div class="text-sm text-muted-foreground">
          No gene matched <span class="font-mono">{id}</span>.
        </div>
      </CardContent>
    </Card>
  {:else if center}
    <Card>
      <CardHeader>
        <CardTitle class="text-xl">
          {center.gene_name ?? center.wormbase_gene} interaction network
        </CardTitle>
        <div class="font-mono text-xs text-muted-foreground">{center.wormbase_gene}</div>
        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {#if expansion}
            <Badge variant="secondary">
              {expansion.nodes.size} node{expansion.nodes.size === 1 ? '' : 's'} in view
            </Badge>
            <Badge variant="muted">
              {expansion.edges.length} edge{expansion.edges.length === 1 ? '' : 's'}
            </Badge>
            {#if filterSource.kind !== 'none'}
              <Badge variant="default" class="bg-accent text-accent-foreground">
                {expansion.targetsReachable} target{expansion.targetsReachable === 1 ? '' : 's'} reachable
              </Badge>
            {/if}
            {#if expansion.truncated && maxNodes > 0}
              <Badge variant="outline" class="border-amber-500 text-amber-700 dark:text-amber-300">
                truncated at {maxNodes.toLocaleString()} nodes. Set node cap to&nbsp;<span
                  class="font-mono">-1</span
                >&nbsp;for unlimited or narrow the filter
              </Badge>
            {/if}
            <span class="font-mono text-muted-foreground">
              · hops run: {expansion.hopsRun} · {expandTook.toFixed(0)} ms
            </span>
          {/if}
          {#if expanding}
            <span class="text-muted-foreground">expanding…</span>
          {/if}
        </div>
      </CardHeader>
    </Card>

    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="mr-1 text-muted-foreground">Edges:</span>
      {#each EDGE_LEGEND as l (l.key)}
        <button
          type="button"
          onclick={() => (edgeTypes = { ...edgeTypes, [l.key]: !edgeTypes[l.key] })}
          class={cn(
            'inline-flex items-center gap-1.5 rounded border px-2 py-1 transition-colors',
            edgeTypes[l.key]
              ? 'border-accent bg-accent text-accent-foreground'
              : 'bg-card text-muted-foreground hover:bg-muted/50',
          )}
          aria-pressed={edgeTypes[l.key]}
        >
          <span class="h-0 w-4 {l.swatch}"></span>
          <span>{l.label}</span>
        </button>
      {/each}
      <label class="ml-2 inline-flex items-center gap-1.5">
        <span class="text-muted-foreground">Layout:</span>
        <select
          bind:value={layoutKind}
          class="rounded border bg-card px-1.5 py-0.5 font-mono text-xs"
        >
          <option value="concentric">concentric (focal in center)</option>
          <option value="radial">radial arcs (directed)</option>
          <option value="dagre-TB">tree, top to bottom</option>
          <option value="dagre-LR">tree, left to right</option>
        </select>
      </label>
      <label
        class="inline-flex items-center gap-1.5"
        title="Hide the genes between the center gene and the targets. Each target reached is shown as one dashed line from the center gene, labelled with the number of hops. Needs a target filter."
      >
        <input
          type="checkbox"
          bind:checked={targetsOnly}
          disabled={filterSource.kind === 'none'}
          class="rounded disabled:opacity-50"
        />
        <span
          class={filterSource.kind === 'none'
            ? 'text-muted-foreground/50'
            : 'text-muted-foreground'}>Targets only</span
        >
      </label>
      <label
        class="inline-flex items-center gap-1.5"
        title="Do not draw the network. Use this for large networks when you only want the tab-separated values (TSV) file exports."
      >
        <input type="checkbox" bind:checked={skipViz} class="rounded" />
        <span class="text-muted-foreground">Skip viz (data only)</span>
      </label>
      <div class="inline-flex gap-1">
        <Button variant="outline" size="sm" onclick={exportNodes} disabled={!expansion}>
          <Download class="h-3 w-3" /> Nodes
        </Button>
        <Button variant="outline" size="sm" onclick={exportEdges} disabled={!expansion}>
          <Download class="h-3 w-3" /> Edges
        </Button>
        <Button
          variant="outline"
          size="sm"
          onclick={exportPaths}
          disabled={!expansion || expansion.paths.length === 0}
          title={!expansion || expansion.paths.length === 0
            ? 'Paths are only exported when a target filter (neuronal / WormCat / dataset) is applied.'
            : `Export the ${expansion.paths.length} shortest paths from the center gene to each target it reaches.`}
        >
          <Download class="h-3 w-3" /> Paths
        </Button>
        <Button
          variant="outline"
          size="sm"
          onclick={exportTargets}
          disabled={!expansion || filterSource.kind === 'none'}
          title={filterSource.kind === 'none'
            ? 'The targets export needs a filter (neuronal / WormCat / dataset) to be selected.'
            : 'Export the filter target set, with columns showing whether each target was reached and in how many hops from this gene.'}
        >
          <Download class="h-3 w-3" /> Targets
        </Button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-md border bg-card p-2 text-xs">
      <label class="inline-flex items-center gap-1.5">
        <span class="text-muted-foreground">Filter targets:</span>
        <select
          value={filterValue}
          onchange={(e) => setFilterValue((e.currentTarget as HTMLSelectElement).value)}
          class="rounded border bg-background px-1.5 py-0.5 font-mono text-xs"
        >
          <option value="none">None (show all within hops)</option>
          <option value="neuronal">Neuronal classifications</option>
          {#if wormcatCategories.length > 0}
            <optgroup label="WormCat category">
              {#each wormcatCategories as c (c.category_1)}
                <option value={`wormcat:${c.category_1}`}
                  >{c.category_1} ({c.n_genes.toLocaleString()})</option
                >
              {/each}
            </optgroup>
          {/if}
          {#if datasetList.length > 0}
            <optgroup label="Dataset (gene lists)">
              {#each datasetList as d (d.id)}
                <option value={`dataset:${d.id}`}>{d.name}</option>
              {/each}
            </optgroup>
          {/if}
        </select>
      </label>

      <label
        class="inline-flex items-center gap-1.5"
        title="How many interaction steps to follow from the center gene. Use -1 for no limit (the search stops when no new genes are found)."
      >
        <span class="text-muted-foreground">Max hops:</span>
        <input
          type="number"
          min="-1"
          max="6"
          step="1"
          bind:value={maxHops}
          class="w-14 rounded border bg-background px-1 py-0.5 font-mono text-xs"
        />
        {#if maxHops < 0}
          <span
            class="font-mono text-[0.6rem] uppercase tracking-wider text-amber-700 dark:text-amber-400"
            >unlimited</span
          >
        {/if}
      </label>

      <label
        class="inline-flex items-center gap-1.5"
        title="Most genes to draw in the network. -1 means no limit. Batch mode ignores this limit."
      >
        <span class="text-muted-foreground">Node cap:</span>
        <input
          type="number"
          min="-1"
          max="5000"
          step="10"
          bind:value={maxNodes}
          class="w-20 rounded border bg-background px-1 py-0.5 font-mono text-xs"
        />
        {#if maxNodes < 0}
          <span
            class="font-mono text-[0.6rem] uppercase tracking-wider text-amber-700 dark:text-amber-400"
            >unlimited</span
          >
        {/if}
      </label>

      <span class="ml-auto text-muted-foreground">
        Use&nbsp;<span class="font-mono">-1</span>&nbsp;for no limit in either field. A hub gene (a
        gene with very many interactions) at 3 or more hops can give a network too large to draw.
        For that case use batch mode, which gives data only at any size.
      </span>
    </div>

    {#if !skipViz}
      {#if expansion && expansion.nodes.size > 300}
        <div
          class="flex flex-wrap items-center gap-2 rounded-md border border-amber-400/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <span class="font-semibold">{expansion.nodes.size} nodes in view.</span>
          Drawing that many may be slow. Consider
          <button
            type="button"
            class="rounded border border-dashed px-1.5 py-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40"
            onclick={() => (skipViz = true)}>Skip viz (data only)</button
          >
          and use the TSV exports above.
        </div>
      {/if}
      <div
        class="overflow-hidden rounded-lg border bg-card"
        style="height: 65vh; min-height: 520px;"
      >
        <SvelteFlow
          nodes={flow.nodes}
          edges={flow.edges}
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
    {:else}
      <Card>
        <CardContent class="space-y-3 pt-6">
          <div class="text-sm">
            Data-only mode. The viz is skipped; use the
            <span class="font-mono">Nodes / Edges / Paths</span>
            buttons in the toolbar above to download TSVs. Toggle the checkbox off to re-enable rendering.
          </div>
          {#if expansion}
            <div class="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
              <div class="rounded border bg-card p-2">
                <div class="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  Nodes
                </div>
                <div class="font-mono text-lg">{expansion.nodes.size.toLocaleString()}</div>
              </div>
              <div class="rounded border bg-card p-2">
                <div class="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  Edges
                </div>
                <div class="font-mono text-lg">{expansion.edges.length.toLocaleString()}</div>
              </div>
              <div class="rounded border bg-card p-2">
                <div class="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  Targets reachable
                </div>
                <div class="font-mono text-lg">{expansion.targetsReachable.toLocaleString()}</div>
              </div>
              <div class="rounded border bg-card p-2">
                <div class="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  Hops walked
                </div>
                <div class="font-mono text-lg">{expansion.hopsRun}</div>
              </div>
            </div>
          {/if}
        </CardContent>
      </Card>
    {/if}

    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="text-base">Batch expansion (data only)</CardTitle>
        <div class="text-xs text-muted-foreground">
          Run the same filter, hops and edge types for several center genes. The output joins the
          genes, interactions and paths of every center gene into one tab-separated values (TSV)
          file with a <span class="font-mono">focal_id</span> column. Enter WormBase gene IDs
          (WBGene IDs) or gene names, separated by commas, spaces or new lines. The node limit above
          is ignored here. Each center gene is followed until no new genes are found or until
          <span class="font-mono">Max hops</span> is reached.
        </div>
      </CardHeader>
      <CardContent class="space-y-2">
        <div class="flex flex-wrap items-center gap-2 text-xs">
          {#each datasetList as d (d.id)}
            {#if d.type === 'gene-list'}
              <button
                type="button"
                class="rounded border border-dashed bg-card px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                onclick={() => (batchInput = d.body)}
                title="Load this dataset into the batch input"
              >
                Load: {d.name}
              </button>
            {/if}
          {/each}
        </div>
        <textarea
          bind:value={batchInput}
          rows="4"
          placeholder="daf-2, daf-16, age-1&#10;hsf-1&#10;WBGene00000898"
          class="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={batchRunning}
        ></textarea>
        <div class="flex flex-wrap items-center gap-2">
          <Button onclick={runBatch} disabled={batchRunning || !batchInput.trim()}>
            {batchRunning
              ? `Running ${batchProgress.done + 1}/${batchProgress.total}…`
              : 'Run batch'}
          </Button>
          {#if batchRunning && batchProgress.current}
            <span class="text-xs text-muted-foreground">on {batchProgress.current}</span>
          {/if}
          {#if batchResults.length > 0 && !batchRunning}
            <Badge variant="secondary">
              {batchResults.length} focal{batchResults.length === 1 ? '' : 's'}
            </Badge>
            {@const totalNodes = batchResults.reduce((acc, r) => acc + r.result.nodes.size, 0)}
            {@const totalEdges = batchResults.reduce((acc, r) => acc + r.result.edges.length, 0)}
            {@const totalPaths = batchResults.reduce((acc, r) => acc + r.result.paths.length, 0)}
            <Badge variant="muted">{totalNodes.toLocaleString()} nodes</Badge>
            <Badge variant="muted">{totalEdges.toLocaleString()} edges</Badge>
            <Badge variant="muted">{totalPaths.toLocaleString()} paths</Badge>
            <div class="ml-auto inline-flex gap-1">
              <Button variant="outline" size="sm" onclick={exportBatchNodes}>
                <Download class="h-3 w-3" /> Batch nodes
              </Button>
              <Button variant="outline" size="sm" onclick={exportBatchEdges}>
                <Download class="h-3 w-3" /> Batch edges
              </Button>
              <Button
                variant="outline"
                size="sm"
                onclick={exportBatchPaths}
                disabled={totalPaths === 0}
                title={totalPaths === 0
                  ? 'Paths need a target filter (neuronal / WormCat / dataset) to be set above.'
                  : ''}
              >
                <Download class="h-3 w-3" /> Batch paths
              </Button>
              <Button
                variant="outline"
                size="sm"
                onclick={exportBatchTargets}
                disabled={filterSource.kind === 'none'}
                title={filterSource.kind === 'none'
                  ? 'The targets export needs a filter to be selected.'
                  : 'Export a table of which targets each center gene reaches.'}
              >
                <Download class="h-3 w-3" /> Batch targets
              </Button>
            </div>
          {/if}
        </div>
        {#if batchError}
          <div class="text-xs text-rose-600 dark:text-rose-400">{batchError}</div>
        {/if}
      </CardContent>
    </Card>

    <div class="text-xs text-muted-foreground">
      Source:
      <a href="https://thebiogrid.org/" target="_blank" rel="noopener" class="hover:text-primary"
        >BioGRID 5.0.257</a
      >
    </div>
  {/if}
</div>
