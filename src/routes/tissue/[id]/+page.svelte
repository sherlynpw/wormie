<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { untrack } from 'svelte';
  import {
    getAnatomyTermDetail,
    getAnatomyNeighbors,
    getGenesForAnatomy,
    type AnatomyTermDetail,
    type AnatomyNeighbor,
    type AnatomyGeneRow,
  } from '$lib/queries';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import GenePill from '$lib/components/GenePill.svelte';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import ExternalLink from 'lucide-svelte/icons/external-link';

  const GENE_LIMIT = 200;
  const id = $derived(page.params.id ?? '');

  let term = $state<AnatomyTermDetail | null>(null);
  let parents = $state<AnatomyNeighbor[]>([]);
  let children = $state<AnatomyNeighbor[]>([]);
  let genes = $state<AnatomyGeneRow[]>([]);
  let loading = $state(true);
  let notFound = $state(false);
  let loadToken = 0;

  $effect(() => {
    const cur = id;
    untrack(() => load(cur));
  });

  async function load(cur: string) {
    const my = ++loadToken;
    loading = true;
    notFound = false;
    const t = await getAnatomyTermDetail(cur);
    if (my !== loadToken) return;
    if (!t) {
      term = null;
      notFound = true;
      loading = false;
      return;
    }
    const [p, c, g] = await Promise.all([
      getAnatomyNeighbors(cur, 'parents'),
      getAnatomyNeighbors(cur, 'children'),
      getGenesForAnatomy(cur, GENE_LIMIT),
    ]);
    if (my !== loadToken) return;
    term = t;
    parents = p;
    children = c;
    genes = g;
    loading = false;
  }
</script>

<svelte:head>
  <title>{term?.name ?? id} · tissue · wormie.bio</title>
</svelte:head>

{#snippet neighborList(items: AnatomyNeighbor[], empty: string)}
  {#if items.length === 0}
    <div class="text-xs italic text-muted-foreground">{empty}</div>
  {:else}
    <div class="flex flex-wrap gap-1.5">
      {#each items as n (n.term_id)}
        <a
          href={resolve(`/tissue/${n.term_id}`)}
          class="inline-flex items-baseline gap-1.5 rounded border bg-card px-1.5 py-0.5 text-xs transition-colors hover:bg-accent"
        >
          <span>{n.name}</span>
          {#if n.rel_type === 'part_of'}
            <span class="text-[0.6rem] italic text-muted-foreground">part of</span>
          {/if}
          <span class="font-mono text-[0.6rem] text-muted-foreground">{n.n_genes}</span>
        </a>
      {/each}
    </div>
  {/if}
{/snippet}

<div class="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href={resolve('/tissue')} class="self-start">
    <ArrowLeft />
    All tissues
  </Button>

  <p class="text-xs text-muted-foreground">
    The genes listed have expression reported in this tissue or in a part or more specific tissue
    below it. "Part of" means this term is a part of the linked term, not a kind of it.
  </p>

  {#if loading}
    <div class="text-sm text-muted-foreground">Loading tissue...</div>
  {:else if notFound}
    <Card>
      <CardContent class="pt-6">
        <div class="mb-1 font-medium">Tissue not found</div>
        <div class="text-sm text-muted-foreground">
          No tissue matched <span class="font-mono">{id}</span>.
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
              href="https://wormbase.org/species/all/anatomy_term/{term.term_id}"
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
      {#if term.definition || term.synonyms.length > 0}
        <CardContent class="space-y-2 pt-0">
          {#if term.definition}
            <div class="text-sm leading-relaxed">{term.definition}</div>
          {/if}
          {#if term.synonyms.length > 0}
            <div class="text-xs text-muted-foreground">
              Also known as: {term.synonyms.join(', ')}
            </div>
          {/if}
        </CardContent>
      {/if}
    </Card>

    <div class="grid gap-3 md:grid-cols-2">
      <Card>
        <CardHeader class="flex flex-row items-baseline justify-between pb-2">
          <CardTitle class="text-base">Parents</CardTitle>
          <span class="text-xs text-muted-foreground">{parents.length}</span>
        </CardHeader>
        <CardContent class="pt-0">
          {@render neighborList(parents, 'No parents listed.')}
        </CardContent>
      </Card>
      <Card>
        <CardHeader class="flex flex-row items-baseline justify-between pb-2">
          <CardTitle class="text-base">Children</CardTitle>
          <span class="text-xs text-muted-foreground">{children.length}</span>
        </CardHeader>
        <CardContent class="pt-0">
          {@render neighborList(children, 'No children listed.')}
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardHeader class="flex flex-row items-baseline justify-between pb-2">
        <CardTitle class="text-base">Genes</CardTitle>
        <span class="text-xs text-muted-foreground">
          {genes.length < term.n_genes
            ? `${genes.length.toLocaleString()} of ${term.n_genes.toLocaleString()} shown`
            : `${term.n_genes.toLocaleString()} total`}
        </span>
      </CardHeader>
      <CardContent class="pt-0">
        {#if genes.length === 0}
          <div class="text-xs italic text-muted-foreground">No gene annotations.</div>
        {:else}
          <div class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-xs">
            {#each genes as g (g.wormbase_gene)}
              <GenePill id={g.wormbase_gene} name={g.gene_name ?? g.sequence_name} />
              <span class="truncate text-muted-foreground">{g.concise_description ?? ''}</span>
            {/each}
          </div>
        {/if}
      </CardContent>
    </Card>
  {/if}
</div>
