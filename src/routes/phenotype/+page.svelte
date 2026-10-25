<script lang="ts">
  import { resolve } from '$app/paths';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import PageHint from '$lib/components/PageHint.svelte';
  import OntologyTree from '$lib/components/OntologyTree.svelte';
  import { getPhenotypeRoots, getPhenotypeChildren, searchPhenotypeTerms } from '$lib/queries';
</script>

<svelte:head><title>Phenotypes · wormie.rs.ht</title></svelte:head>

<div class="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <PageHint id="phenotype-browse" title="Phenotypes">
    This tree lists the terms of the WormBase Phenotype Ontology (WBPhenotype), from broad terms to
    specific ones. The number on each row is the count of genes annotated directly to that term from
    RNA interference (RNAi) or allele (mutant) experiments. It does not include genes annotated to
    child terms. Click the arrow to open the child terms. Click a name to open the phenotype page
    with its genes. The filter box searches term names and synonyms.
  </PageHint>

  <Card>
    <CardHeader>
      <CardTitle class="text-lg">Phenotypes</CardTitle>
    </CardHeader>
    <CardContent>
      <OntologyTree
        loadRoots={getPhenotypeRoots}
        loadChildren={getPhenotypeChildren}
        search={searchPhenotypeTerms}
        href={(id) => resolve(`/phenotype/${id}`)}
        placeholder="Filter by name or synonym (e.g. egg laying, dauer)..."
        noun="phenotypes"
      />
    </CardContent>
  </Card>
</div>
