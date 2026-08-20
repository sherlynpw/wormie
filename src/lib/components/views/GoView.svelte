<script lang="ts">
  import { preloadTransitiveCount } from '$lib/stores/go-cache';
  import { untrack, type Snippet } from 'svelte';
  import {
    getGoChildren,
    getGoOtherParents,
    getGenesForGoTerm,
    searchGoTerms,
    GO_NAMESPACE_ROOTS,
    GO_NAMESPACE_LABEL,
    type GoNamespace,
    type GoNode,
    type GoTermMatch,
    type GoGene,
    type GoParentRef,
  } from '$lib/queries';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent } from '$lib/components/ui/card';
  import { cn } from '$lib/utils';
  import { Button } from '$lib/components/ui/button';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import ChevronsDown from 'lucide-svelte/icons/chevrons-down';
  import ChevronsUp from 'lucide-svelte/icons/chevrons-up';
  import ExternalLink from 'lucide-svelte/icons/external-link';
  import Network from 'lucide-svelte/icons/network';
  import GenePill from '$lib/components/GenePill.svelte';
  import { resolve } from '$app/paths';

  let { term, freeText, meta }: { term: string; freeText: string; meta?: Snippet } = $props();

  let namespace = $state<GoNamespace>('BP');

  // Children by parent_id, expansion state, and gene listings per node.
  let children = $state<Record<string, GoNode[]>>({});
  let otherParents = $state<Record<string, GoParentRef[]>>({});
  let expanded = $state<Record<string, boolean>>({});
  let genes = $state<Record<string, GoGene[]>>({});
  let showAllGenes = $state<Record<string, boolean>>({});

  const GENE_PREVIEW = 12;
  const HOVER_DELAY = 300;

  // Transitive gene counts keyed by go_id, populated lazily on hover.
  let transitiveCounts = $state<Record<string, number>>({});
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const hoverTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function onRowHover(go_id: string) {
    if (transitiveCounts[go_id] !== undefined) return;
    if (hoverTimers.has(go_id)) return;
    const timer = setTimeout(() => {
      hoverTimers.delete(go_id);
      preloadTransitiveCount(go_id).then((n) => {
        transitiveCounts[go_id] = n;
      });
    }, HOVER_DELAY);
    hoverTimers.set(go_id, timer);
  }

  function onRowLeave(go_id: string) {
    const t = hoverTimers.get(go_id);
    if (t) {
      clearTimeout(t);
      hoverTimers.delete(go_id);
    }
  }
  let searchResults = $state<GoTermMatch[]>([]);
  let loading = $state(false);

  const inSearchMode = $derived(!!freeText.trim());

  let loadToken = 0;

  $effect(() => {
    // Capture tracked deps, then run the load outside the tracking context.
    const t = term;
    const n = namespace;
    const ft = freeText;
    untrack(() => {
      void t;
      load(n, ft);
    });
  });

  async function load(ns: GoNamespace, ft: string) {
    const my = ++loadToken;
    loading = true;
    children = {};
    expanded = {};
    genes = {};
    showAllGenes = {};
    otherParents = {};
    searchResults = [];

    if (ft.trim()) {
      const results = await searchGoTerms(ft, 200);
      if (my !== loadToken) return;
      searchResults = results;
    } else {
      const root = GO_NAMESPACE_ROOTS[ns];
      const result = await getGoChildren(root);
      if (my !== loadToken) return;
      children = { [root]: result };
    }
    if (my !== loadToken) return;
    loading = false;
  }

  async function toggle(nodeKey: string, term: GoNode, underParent: string) {
    expanded[nodeKey] = !expanded[nodeKey];
    if (!expanded[nodeKey]) return;

    const tasks: Promise<unknown>[] = [];
    if (!children[term.go_id] && term.n_children > 0) {
      tasks.push(
        getGoChildren(term.go_id).then((r) => {
          children[term.go_id] = r;
        }),
      );
    }
    if (term.n_parents > 1 && !otherParents[nodeKey]) {
      tasks.push(
        getGoOtherParents(term.go_id, underParent).then((r) => {
          otherParents[nodeKey] = r;
        }),
      );
    }
    if (term.n_direct_genes > 0 && !genes[nodeKey]) {
      tasks.push(
        getGenesForGoTerm(term.go_id).then((r) => {
          genes[nodeKey] = r;
        }),
      );
    }
    await Promise.all(tasks);
  }

  // One level only: the GO DAG is loaded lazily and expanding it fully would
  // fetch thousands of terms.
  async function expandAll() {
    const roots = children[GO_NAMESPACE_ROOTS[namespace]] ?? [];
    await Promise.all(
      roots.map((t) =>
        toggle(`${GO_NAMESPACE_ROOTS[namespace]}>${t.go_id}`, t, GO_NAMESPACE_ROOTS[namespace]),
      ),
    );
  }

  function collapseAll() {
    expanded = {};
  }

  const NS_BADGE: Record<string, string> = {
    BP: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    MF: 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
    CC: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  };
</script>

{#snippet termRow(t: GoNode, underParent: string, depth: number)}
  {@const nodeKey = `${underParent}>${t.go_id}`}
  {@const isOpen = expanded[nodeKey]}
  {@const childList = children[t.go_id]}
  {@const expandable = t.n_children > 0 || t.n_direct_genes > 0}
  <div>
    <div
      role="group"
      class="flex w-full items-center gap-2 py-2 pr-3 transition-colors hover:bg-muted/50"
      style="padding-left: {1.25 + depth * 1.5}rem"
      onmouseenter={() => onRowHover(t.go_id)}
      onmouseleave={() => onRowLeave(t.go_id)}
    >
      <button
        type="button"
        class={cn(
          'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded transition-transform',
          !expandable && 'opacity-20',
          isOpen && 'rotate-90',
        )}
        disabled={!expandable}
        onclick={() => toggle(nodeKey, t, underParent)}
        aria-label="Toggle"
      >
        <ChevronRight class="h-4 w-4 text-muted-foreground" />
      </button>
      <span class={cn('truncate', depth === 0 && 'font-semibold')}>{t.name}</span>
      <a
        href={resolve(`/go/${t.go_id}`)}
        class="shrink-0 font-mono text-[0.65rem] text-muted-foreground hover:text-primary hover:underline"
      >
        {t.go_id}
      </a>
      <a
        href="https://amigo.geneontology.org/amigo/term/{t.go_id}"
        target="_blank"
        rel="noopener"
        class="shrink-0 text-muted-foreground hover:text-primary"
      >
        <ExternalLink class="h-3 w-3" />
      </a>
      {#if (transitiveCounts[t.go_id] ?? t.n_direct_genes) > 0}
        <Badge
          variant="muted"
          class="ml-auto shrink-0 tabular-nums"
          title={`${t.n_direct_genes.toLocaleString()} genes annotated directly${
            transitiveCounts[t.go_id] !== undefined
              ? `, ${transitiveCounts[t.go_id].toLocaleString()} including sub-terms`
              : ''
          }${t.n_children > 0 ? ` · ${t.n_children} sub-terms` : ''}`}
        >
          {(transitiveCounts[t.go_id] ?? t.n_direct_genes).toLocaleString()}
        </Badge>
      {/if}
    </div>
    {#if isOpen && otherParents[nodeKey]?.length}
      <div
        class="text-[0.65rem] italic text-muted-foreground"
        style="padding-left: {2.75 + depth * 1.5}rem"
      >
        also under
        {#each otherParents[nodeKey] as p, i (p.go_id)}{#if i > 0},
          {/if}<span class="font-mono">{p.go_id}</span> ({p.name}){/each}
      </div>
    {/if}
    {#if isOpen && t.n_direct_genes > 0}
      {@const list = genes[nodeKey]}
      {@const showAll = showAllGenes[nodeKey]}
      <div
        class="flex flex-wrap gap-1 py-1.5"
        style="padding-left: {2.75 + depth * 1.5}rem; padding-right: 0.75rem;"
      >
        {#if !list}
          <span class="text-xs text-muted-foreground">Loading genes...</span>
        {:else}
          {@const visible = showAll ? list : list.slice(0, GENE_PREVIEW)}
          {#each visible as g, i (`${g.wormbase_gene}:${g.evidence_code}:${i}`)}
            <GenePill id={g.wormbase_gene} name={g.gene_name}>
              {#snippet extra()}
                <Badge variant="outline" class="px-1 py-0 text-[0.55rem]">{g.evidence_code}</Badge>
              {/snippet}
            </GenePill>
          {/each}
          {#if list.length > GENE_PREVIEW}
            <button
              type="button"
              onclick={() => (showAllGenes[nodeKey] = !showAll)}
              class="px-1.5 py-0.5 text-xs text-muted-foreground hover:text-primary"
            >
              {showAll ? 'Show fewer' : `+${list.length - GENE_PREVIEW} more`}
            </button>
          {/if}
        {/if}
      </div>
    {/if}
    {#if isOpen && childList}
      {#each childList as c (c.go_id)}
        {@render termRow(c, t.go_id, depth + 1)}
      {/each}
    {/if}
  </div>
{/snippet}

{#if loading}
  <div class="py-6 text-sm text-muted-foreground">Loading GO ontology...</div>
{:else if inSearchMode}
  <div class="space-y-2">
    <div class="text-xs text-muted-foreground">
      {searchResults.length} GO terms matching "{freeText}"
    </div>
    <div class="divide-y rounded-lg border bg-card">
      {#each searchResults as t (t.go_id)}
        <div class="flex items-center gap-2 px-3 py-1.5 text-sm">
          <span
            class={cn('rounded px-1.5 py-0.5 font-mono text-[0.6rem]', NS_BADGE[t.namespace] ?? '')}
          >
            {t.namespace}
          </span>
          <a
            href={resolve(`/go/${t.go_id}`)}
            class="font-mono text-xs text-primary hover:underline"
          >
            {t.go_id}
          </a>
          <a
            href="https://amigo.geneontology.org/amigo/term/{t.go_id}"
            target="_blank"
            rel="noopener"
            class="text-muted-foreground hover:text-primary"
          >
            <ExternalLink class="h-3 w-3" />
          </a>
          <span class="truncate">{t.name}</span>
          <Badge variant="muted" class="ml-auto shrink-0 tabular-nums">
            {t.n_direct_genes.toLocaleString()}
          </Badge>
        </div>
      {:else}
        <div class="text-center text-muted-foreground py-10 text-sm">No matching GO terms.</div>
      {/each}
    </div>
    <Card class="mt-2 border-dashed">
      <CardContent class="pt-4 text-xs text-muted-foreground">
        <Network class="mr-1 inline h-3 w-3" />
        Clear the search to browse the GO hierarchy by namespace.
      </CardContent>
    </Card>
  </div>
{:else}
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-1">
      <Button variant="outline" size="sm" onclick={expandAll}>
        <ChevronsDown class="h-3 w-3" />
        Expand all
      </Button>
      <Button variant="outline" size="sm" onclick={collapseAll}>
        <ChevronsUp class="h-3 w-3" />
        Collapse all
      </Button>
      <span class="mx-1 h-4 w-px bg-border"></span>
      {#each ['BP', 'MF', 'CC'] as GoNamespace[] as ns (ns)}
        <Button
          variant={namespace === ns ? 'secondary' : 'outline'}
          size="sm"
          onclick={() => (namespace = ns)}
          class="gap-2"
        >
          <span class={cn('rounded px-1.5 py-0.5 font-mono text-[0.6rem]', NS_BADGE[ns])}>
            {ns}
          </span>
          {GO_NAMESPACE_LABEL[ns]}
        </Button>
      {/each}
      {#if meta}
        <div class="ml-auto">{@render meta()}</div>
      {/if}
    </div>

    <div class="divide-y rounded-lg border bg-card">
      {#each children[GO_NAMESPACE_ROOTS[namespace]] ?? [] as t (t.go_id)}
        {@render termRow(t, GO_NAMESPACE_ROOTS[namespace], 0)}
      {:else}
        <div class="text-center text-muted-foreground py-10 text-sm">No terms found.</div>
      {/each}
    </div>
  </div>
{/if}
