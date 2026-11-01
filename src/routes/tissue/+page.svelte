<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import OntologyTree from '$lib/components/OntologyTree.svelte';
  import {
    hasAnatomyTree,
    getAnatomyRoots,
    getAnatomyChildren,
    searchAnatomyTerms,
    getAnatomyTermsWithGenes,
    type OntologyNode,
  } from '$lib/queries';

  // null while checking; false means an older database without the anatomy hierarchy.
  let tree = $state<boolean | null>(null);
  let flat = $state<OntologyNode[] | null>(null);
  let filter = $state('');

  onMount(async () => {
    tree = await hasAnatomyTree();
    if (!tree) flat = await getAnatomyTermsWithGenes();
  });

  const filtered = $derived.by(() => {
    if (!flat) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return flat;
    return flat.filter((r) => r.name.toLowerCase().includes(f) || r.id.toLowerCase().includes(f));
  });
</script>

<svelte:head><title>Tissues · wormie.bio</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Tissues</h1>
    <p class="text-sm text-muted-foreground">
      Genes grouped by the tissue where they are expressed. A gene reported in a part or a more
      specific tissue also counts toward every broader tissue above it.
    </p>
    <p class="text-[0.7rem] text-muted-foreground">
      WormBase anatomy ontology (WBbt), with expression data from the Alliance of Genome Resources:
      <a
        href="https://github.com/obophenotype/c-elegans-gross-anatomy-ontology"
        target="_blank"
        rel="noopener noreferrer"
        class="underline underline-offset-2 hover:text-foreground">the ontology</a
      >
    </p>
  </header>

  {#if tree === null}
    <div class="text-sm text-muted-foreground">Loading...</div>
  {:else if tree}
    <OntologyTree
      loadRoots={getAnatomyRoots}
      loadChildren={getAnatomyChildren}
      search={searchAnatomyTerms}
      href={(id) => resolve(`/tissue/${id}`)}
      placeholder="Filter by name or synonym (e.g. gonad, pharynx)..."
      noun="tissues"
    />
  {:else}
    <div class="space-y-3">
      <div class="text-xs text-muted-foreground">
        This database build has no anatomy hierarchy, so the tissues are listed flat, most genes
        first.
      </div>
      <Input
        bind:value={filter}
        placeholder="Filter by name or WBbt ID (e.g. gonad)..."
        class="max-w-md"
      />
      {#if flat === null}
        <div class="text-sm text-muted-foreground">Loading...</div>
      {:else if filtered.length === 0}
        <div class="text-sm text-muted-foreground">No tissues match.</div>
      {:else}
        <div class="divide-y rounded-lg border bg-card">
          {#each filtered as n (n.id)}
            <div class="flex items-center gap-2 px-3 py-1.5 text-sm">
              <a
                href={resolve(`/tissue/${n.id}`)}
                class="truncate hover:text-primary hover:underline"
              >
                {n.name}
              </a>
              <span class="shrink-0 font-mono text-[0.65rem] text-muted-foreground">{n.id}</span>
              <span class="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                {n.n_genes.toLocaleString()}
              </span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
