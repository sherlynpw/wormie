<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import PageHint from '$lib/components/PageHint.svelte';
  import { getDiseaseList, type DiseaseSummary } from '$lib/queries';

  let rows = $state<DiseaseSummary[] | null>(null);
  let filter = $state('');

  onMount(async () => {
    rows = await getDiseaseList();
  });

  const filtered = $derived.by(() => {
    if (!rows) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter(
      (r) => r.do_name.toLowerCase().includes(f) || r.do_id.toLowerCase().includes(f),
    );
  });
</script>

<svelte:head><title>Human diseases · wormie.rs.ht</title></svelte:head>

<div class="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <PageHint id="disease-browse" title="Human diseases">
    Each row is a human disease from the Disease Ontology (DO). The disease annotations of C.
    elegans genes come from the Alliance of Genome Resources, either from experiments in the worm or
    inferred from human orthologs. The count is the number of worm genes linked to the disease. This
    is a flat list because the data has no disease hierarchy. Click a row to see its genes.
  </PageHint>

  <Card>
    <CardHeader>
      <CardTitle class="text-lg">Human diseases ({rows?.length ?? '...'})</CardTitle>
      <Input
        bind:value={filter}
        placeholder="Filter by name or DO ID (e.g. epilepsy, DOID:1234)..."
        class="mt-2 max-w-md"
      />
    </CardHeader>
    <CardContent>
      {#if rows === null}
        <div class="text-sm text-muted-foreground">Loading...</div>
      {:else if filtered.length === 0}
        <div class="text-sm text-muted-foreground">
          No diseases match "<span class="font-mono">{filter}</span>".
        </div>
      {:else}
        <div class="overflow-x-auto rounded-md border bg-card">
          <table class="w-full text-sm">
            <thead class="border-b bg-card">
              <tr>
                <th
                  class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Disease
                </th>
                <th
                  class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  DO ID
                </th>
                <th
                  class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Genes
                </th>
              </tr>
            </thead>
            <tbody>
              {#each filtered as r (r.do_id)}
                <tr class="border-b last:border-b-0 hover:bg-muted/30">
                  <td class="px-3 py-2 align-middle">
                    <a href={resolve(`/disease/${r.do_id}`)} class="text-primary hover:underline">
                      {r.do_name}
                    </a>
                  </td>
                  <td class="px-3 py-2 align-middle font-mono text-xs text-muted-foreground">
                    {r.do_id}
                  </td>
                  <td
                    class="px-3 py-2 text-right align-middle font-mono tabular-nums text-muted-foreground"
                  >
                    {r.n_genes.toLocaleString()}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
