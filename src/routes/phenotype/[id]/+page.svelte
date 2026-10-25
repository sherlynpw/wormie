<script lang="ts">
  // Phenotype DAG navigator (mirrors /go/[id]). WBPhenotype only has is_a edges, so no edge-type filter.
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { untrack } from 'svelte';
  import { SvelteFlow, Background, Controls, MiniMap, type Edge } from '@xyflow/svelte';
  import {
    getPhenotypeDetail,
    getPhenotypeEdges,
    getGenesForPhenotype,
    type PhenotypeDetail,
    type PhenotypeGeneRow,
  } from '$lib/queries';
  import PhenotypeNode, {
    type PhenotypeFlowNode,
    type PhenotypeNodeData,
  } from '$lib/components/graph/PhenotypeNode.svelte';
  import { applyLayout, type LayoutKind } from '$lib/components/graph/layout';
  import { theme } from '$lib/stores/theme.svelte';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import GenePill from '$lib/components/GenePill.svelte';
  import PageHint from '$lib/components/PageHint.svelte';
  import ControlHint from '$lib/components/ControlHint.svelte';
  import TermCrossRef from '$lib/components/TermCrossRef.svelte';
  import { query } from '$lib/db/client';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import ExternalLink from 'lucide-svelte/icons/external-link';

  const id = $derived(page.params.id ?? '');

  let term = $state<PhenotypeDetail | null>(null);
  let genes = $state<PhenotypeGeneRow[]>([]);
  let universeN = $state<number>(0);
  // Full (non-truncated) list for the cross-ref widget; getGenesForPhenotype caps visible table at 200.
  let allMembers = $state<string[]>([]);
  let loading = $state(true);
  let notFound = $state(false);
  let loadToken = 0;

  // Graph state is append-only; expand actions only add nodes/edges.
  type NodeInfo = PhenotypeNodeData & { _expandedParents?: boolean; _expandedChildren?: boolean };
  let graphNodes = $state<Record<string, NodeInfo>>({});
  let graphEdges = $state<Record<string, { source: string; target: string }>>({});
  let layoutKind = $state<LayoutKind>('radial');

  const nodeTypes = { phenotype: PhenotypeNode as unknown as never };

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

    const t = await getPhenotypeDetail(cur);
    if (my !== loadToken) return;
    if (!t) {
      notFound = true;
      loading = false;
      return;
    }
    term = t;
    graphNodes = {
      [t.term_id]: { ...t, role: 'center' } as NodeInfo,
    };

    const [g, , , nRows, mRows] = await Promise.all([
      getGenesForPhenotype(cur, 200),
      expandParents(cur, true),
      expandChildren(cur, true),
      query<{ n: number }>('SELECT COUNT(DISTINCT wormbase_gene) AS n FROM gene_phenotype'),
      query<{ wormbase_gene: string }>(
        'SELECT DISTINCT wormbase_gene FROM gene_phenotype WHERE term_id = ?',
        [cur],
      ),
    ]);
    if (my !== loadToken) return;
    genes = g;
    universeN = nRows[0]?.n ?? 0;
    allMembers = mRows.map((r) => r.wormbase_gene);
    loading = false;
  }

  async function expandParents(term_id: string, initial = false): Promise<void> {
    const parents = await getPhenotypeEdges(term_id, 'parents');
    const next = { ...graphNodes };
    const nextEdges = { ...graphEdges };
    for (const p of parents) {
      if (!next[p.term_id]) {
        const role = initial && p.term_id !== id ? 'parent' : (next[p.term_id]?.role ?? 'parent');
        next[p.term_id] = {
          term_id: p.term_id,
          name: p.name,
          n_genes: p.n_genes,
          role,
        } as NodeInfo;
      }
      nextEdges[`${p.term_id}->${term_id}`] = { source: p.term_id, target: term_id };
    }
    if (next[term_id]) next[term_id] = { ...next[term_id], _expandedParents: true };
    graphNodes = next;
    graphEdges = nextEdges;
  }

  async function expandChildren(term_id: string, initial = false): Promise<void> {
    const children = await getPhenotypeEdges(term_id, 'children');
    const next = { ...graphNodes };
    const nextEdges = { ...graphEdges };
    for (const c of children) {
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
    void initial;
  }

  const focalParents = $derived(
    Object.values(graphEdges)
      .filter((e) => e.target === id)
      .map((e) => graphNodes[e.source])
      .filter(Boolean) as NodeInfo[],
  );
  const focalChildren = $derived(
    Object.values(graphEdges)
      .filter((e) => e.source === id)
      .map((e) => graphNodes[e.target])
      .filter(Boolean) as NodeInfo[],
  );

  const flowNodes = $derived.by<PhenotypeFlowNode[]>(() => {
    const nodeList: PhenotypeFlowNode[] = Object.values(graphNodes).map((n) => ({
      id: n.term_id,
      type: 'phenotype',
      position: { x: 0, y: 0 },
      data: {
        ...n,
        onExpandParents: (tid: string) => expandParents(tid),
        onExpandChildren: (tid: string) => expandChildren(tid),
      },
    }));
    const edgeList: Edge[] = Object.values(graphEdges).map((e) => ({
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
    }));
    return applyLayout(nodeList, edgeList, { kind: layoutKind, focalId: id });
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

<svelte:head>
  <title>{term?.name ?? id} · phenotype · wormie.rs.ht</title>
</svelte:head>

<div class="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/?view=cards" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <PageHint id="phenotype-term" title="Phenotype navigator">
    Phenotype terms come from the WormBase Phenotype Ontology (WBPhenotype), a tree where a broad
    term has more specific child terms. Click a parent or child chip to move through the tree. The
    genes shown are annotated directly to this term. Genes annotated to its child terms are not
    included. Hover over a gene to preview it.
  </PageHint>

  {#if loading}
    <div class="text-sm text-muted-foreground">Loading phenotype...</div>
  {:else if notFound}
    <Card>
      <CardContent class="pt-6">
        <div class="mb-1 font-medium">Phenotype not found</div>
        <div class="text-sm text-muted-foreground">
          No phenotype matched <span class="font-mono">{id}</span>.
        </div>
      </CardContent>
    </Card>
  {:else if term}
    <Card>
      <CardHeader>
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <CardTitle class="inline-flex flex-wrap items-center gap-2 text-xl">
            {term.name}
            <a
              class="inline-flex items-center gap-1 font-mono text-[0.7rem] text-muted-foreground hover:text-primary"
              href="https://www.wormbase.org/species/all/phenotype/{term.term_id}"
              target="_blank"
              rel="noopener"
            >
              {term.term_id}
              <ExternalLink class="h-3 w-3" />
            </a>
          </CardTitle>
          <Badge variant="muted" class="text-xs">
            {term.n_genes.toLocaleString()} gene{term.n_genes === 1 ? '' : 's'}
          </Badge>
        </div>
      </CardHeader>
      {#if term.definition}
        <CardContent class="pt-0">
          <div class="text-sm leading-relaxed">{term.definition}</div>
        </CardContent>
      {/if}
    </Card>

    <div class="flex flex-wrap items-center gap-2 text-xs">
      <Badge variant="secondary">{Object.keys(graphNodes).length} nodes in view</Badge>
      <label class="ml-2 inline-flex items-center gap-1.5">
        <span class="text-muted-foreground">Layout:</span>
        <select
          bind:value={layoutKind}
          class="rounded border bg-card px-1.5 py-0.5 font-mono text-xs"
        >
          <option value="radial">radial (current term in center)</option>
          <option value="dagre-TB">tree, top to bottom</option>
          <option value="dagre-LR">tree, left to right</option>
        </select>
      </label>
      <span class="ml-auto text-muted-foreground"
        >Click a node's term ID to refocus the graph there.</span
      >
    </div>

    <div class="overflow-hidden rounded-lg border bg-card" style="height: 55vh; min-height: 460px;">
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

    <div class="grid gap-3 md:grid-cols-2">
      <Card>
        <CardHeader class="flex flex-row items-baseline justify-between pb-2">
          <CardTitle class="inline-flex items-center gap-1.5 text-base">
            Parents
            <ControlHint id="pheno-parents" title="Parents">
              Broader phenotype terms that include this one (the <code>is_a</code> links in the ontology).
            </ControlHint>
          </CardTitle>
          <span class="text-xs text-muted-foreground">{focalParents.length}</span>
        </CardHeader>
        <CardContent class="pt-0">
          {#if focalParents.length === 0}
            <div class="text-xs italic text-muted-foreground">
              No parents. This is a top-level term.
            </div>
          {:else}
            <div class="flex flex-wrap gap-1.5">
              {#each focalParents as p (p.term_id)}
                <a
                  href={resolve(`/phenotype/${p.term_id}`)}
                  class="inline-flex items-baseline gap-1.5 rounded border bg-card px-1.5 py-0.5 text-xs transition-colors hover:bg-accent"
                >
                  <span>{p.name}</span>
                  <span class="font-mono text-[0.6rem] text-muted-foreground">{p.n_genes}</span>
                </a>
              {/each}
            </div>
          {/if}
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-baseline justify-between pb-2">
          <CardTitle class="inline-flex items-center gap-1.5 text-base">
            Children
            <ControlHint id="pheno-children" title="Children">
              More specific phenotype terms that fall under this one.
            </ControlHint>
          </CardTitle>
          <span class="text-xs text-muted-foreground">{focalChildren.length}</span>
        </CardHeader>
        <CardContent class="pt-0">
          {#if focalChildren.length === 0}
            <div class="text-xs italic text-muted-foreground">
              No children. This is a leaf term (it has no more specific terms).
            </div>
          {:else}
            <div class="flex flex-wrap gap-1.5">
              {#each focalChildren as c (c.term_id)}
                <a
                  href={resolve(`/phenotype/${c.term_id}`)}
                  class="inline-flex items-baseline gap-1.5 rounded border bg-card px-1.5 py-0.5 text-xs transition-colors hover:bg-accent"
                >
                  <span>{c.name}</span>
                  <span class="font-mono text-[0.6rem] text-muted-foreground">{c.n_genes}</span>
                </a>
              {/each}
            </div>
          {/if}
        </CardContent>
      </Card>
    </div>

    <TermCrossRef members={allMembers} N={universeN} />

    <Card>
      <CardHeader class="flex flex-row items-baseline justify-between pb-2">
        <CardTitle class="inline-flex items-center gap-1.5 text-base">
          Annotated genes
          <ControlHint id="pheno-genes" title="Annotated genes">
            Genes directly annotated to <i>{term.name}</i> from RNA interference (RNAi) or allele
            (mutant) experiments. Each gene shows one count. A bold count is the number of alleles (<i
              >n_alleles</i
            >, WormBase variation IDs) that show this phenotype. A muted count with the "RNAi" label
            is the number of evidence records (<i>n_evidence</i>) for a gene with RNAi or other
            non-allele evidence only.
          </ControlHint>
        </CardTitle>
        {@const rnaiOnlyGeneCount = genes.filter((g) => g.n_alleles === 0).length}
        <span class="text-xs text-muted-foreground">
          {genes.length} shown{rnaiOnlyGeneCount > 0 ? ` · ${rnaiOnlyGeneCount} RNAi-only` : ''}
        </span>
      </CardHeader>
      <CardContent class="pt-0">
        {#if genes.length === 0}
          <div class="text-xs italic text-muted-foreground">No gene annotations.</div>
        {:else}
          <div class="grid grid-cols-[auto_auto_auto_1fr] items-baseline gap-x-3 gap-y-1 text-xs">
            {#each genes as g (g.wormbase_gene)}
              {@const rnaiOnly = g.n_alleles === 0 && g.n_evidence > 0}
              <span
                class={'text-right font-mono tabular-nums ' +
                  (rnaiOnly ? 'text-muted-foreground/70' : 'font-semibold')}
                title={rnaiOnly
                  ? `${g.n_evidence} RNAi or non-allele evidence record${g.n_evidence === 1 ? '' : 's'}`
                  : `${g.n_alleles} allele${g.n_alleles === 1 ? '' : 's'} · ${g.n_evidence} evidence records in total`}
              >
                {g.n_alleles > 0 ? g.n_alleles : g.n_evidence}
              </span>
              <span
                class="font-mono text-[0.55rem] uppercase tracking-wider {rnaiOnly
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-muted-foreground'}"
              >
                {rnaiOnly ? 'RNAi' : 'allele'}
              </span>
              <GenePill id={g.wormbase_gene} name={g.gene_name} />
              <span class="truncate text-muted-foreground">{g.concise_description ?? ''}</span>
            {/each}
          </div>
        {/if}
      </CardContent>
    </Card>
  {/if}
</div>
