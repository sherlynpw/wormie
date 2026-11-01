<script lang="ts">
  import { resolve } from '$app/paths';
  import { Button } from '$lib/components/ui/button';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import OntologyTree from '$lib/components/OntologyTree.svelte';
  import { getPhenotypeRoots, getPhenotypeChildren, searchPhenotypeTerms } from '$lib/queries';
</script>

<svelte:head><title>Phenotypes · wormie.bio</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Phenotypes</h1>
    <p class="text-sm text-muted-foreground">
      Genes grouped by the phenotype they are annotated to, from RNAi or allele experiments. A gene
      annotated to a more specific term also counts toward every broader term above it.
    </p>
    <p class="text-[0.7rem] text-muted-foreground">
      WormBase Phenotype Ontology (WBPhenotype), with RNAi and allele annotations curated by
      WormBase:
      <a
        href="https://wormbase.org/tools/ontology_browser"
        target="_blank"
        rel="noopener noreferrer"
        class="underline underline-offset-2 hover:text-foreground">browse at WormBase</a
      >
    </p>
  </header>

  <OntologyTree
    loadRoots={getPhenotypeRoots}
    loadChildren={getPhenotypeChildren}
    search={searchPhenotypeTerms}
    href={(id) => resolve(`/phenotype/${id}`)}
    placeholder="Filter by name or synonym (e.g. egg laying, dauer)..."
    noun="phenotypes"
  />
</div>
