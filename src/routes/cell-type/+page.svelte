<script lang="ts">
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Badge } from '$lib/components/ui/badge';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import PageHint from '$lib/components/PageHint.svelte';
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { getNeuronTypeSummary, type NeuronTypeSummary } from '$lib/queries';

  let rows = $state<NeuronTypeSummary[] | null>(null);
  let filter = $state('');

  onMount(async () => {
    rows = await getNeuronTypeSummary();
  });

  const filtered = $derived.by(() => {
    if (!rows) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter((r) => r.neuron_type.toLowerCase().includes(f));
  });
</script>

<div class="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <PageHint id="cell-type" title="CeNGEN neuron types">
    Single-cell RNA-Seq of the L4 nervous system (Taylor et al. 2021). Each row is one neuron class
    with the count of genes called expressed at the medium FACS-calibrated threshold (≥ 2). Click a
    row to see the gene list.
  </PageHint>

  <Card>
    <CardHeader>
      <CardTitle class="text-lg">Neuron types ({rows?.length ?? '...'})</CardTitle>
      <Input
        bind:value={filter}
        placeholder="Filter by name (e.g. ADL, AVA, RIM)..."
        class="mt-2 max-w-md"
      />
    </CardHeader>
    <CardContent>
      {#if rows === null}
        <div class="text-sm text-muted-foreground">Loading...</div>
      {:else if filtered.length === 0}
        <div class="text-sm text-muted-foreground">
          No neuron types match "<span class="font-mono">{filter}</span>".
        </div>
      {:else}
        <div class="overflow-x-auto rounded-md border bg-card">
          <table class="w-full text-sm">
            <thead class="border-b bg-card">
              <tr>
                <th
                  class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Neuron type
                </th>
                <th
                  class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Genes (≥ medium)
                </th>
                <th
                  class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Bulk reps
                </th>
                <th
                  class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Coverage
                </th>
              </tr>
            </thead>
            <tbody>
              {#each filtered as r (r.neuron_type)}
                <tr class="border-b last:border-b-0 hover:bg-muted/30">
                  <td class="px-3 py-2 align-middle">
                    <a
                      href={resolve(`/cell-type/${encodeURIComponent(r.neuron_type)}`)}
                      class="font-mono text-primary hover:underline"
                    >
                      {r.neuron_type}
                    </a>
                  </td>
                  <td
                    class="px-3 py-2 text-right align-middle font-mono tabular-nums text-muted-foreground"
                  >
                    {r.n_genes.toLocaleString()}
                  </td>
                  <td
                    class="px-3 py-2 text-right align-middle font-mono tabular-nums text-muted-foreground"
                  >
                    {r.n_replicates}
                  </td>
                  <td class="px-3 py-2 align-middle">
                    {#if r.has_binary}
                      <Badge variant="muted" class="text-[0.6rem]">binary calls</Badge>
                    {/if}
                    {#if r.n_replicates > 0}
                      <Badge variant="muted" class="text-[0.6rem]">bulk TMM</Badge>
                    {/if}
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
