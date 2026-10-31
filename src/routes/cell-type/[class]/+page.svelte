<script lang="ts">
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { getGenesByNeuronType, type NeuronGeneRow } from '$lib/queries';
  import { buildIdsQuery } from '$lib/share';

  let enrichmentHref = $state<string | null>(null);

  let { data } = $props<{ data: { neuronClass: string } }>();

  let minThreshold = $state<number>(2);
  let rows = $state<NeuronGeneRow[] | null>(null);

  async function reload() {
    rows = await getGenesByNeuronType(data.neuronClass, minThreshold);
  }
  onMount(reload);

  $effect(() => {
    void minThreshold;
    reload();
  });

  const thresholdLabel = $derived(
    minThreshold === 1
      ? 'liberal'
      : minThreshold === 2
        ? 'medium'
        : minThreshold === 3
          ? 'conservative'
          : 'stringent',
  );

  // Build "send to enrichment" link from the gene set so the user can run ORA
  // on the genes expressed in this neuron type. buildIdsQuery is async (it
  // gzip-encodes), so resolve it lazily into the $state above.
  $effect(() => {
    if (!rows || rows.length === 0) {
      enrichmentHref = null;
      return;
    }
    const ids = rows.map((r) => r.wormbase_gene);
    buildIdsQuery(ids).then((qs) => {
      enrichmentHref = resolve('/enrichment') + '?' + qs;
    });
  });
</script>

<svelte:head><title>{data.neuronClass} · neuron type · wormie.rs.ht</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="ghost" size="sm" href={resolve('/cell-type')}>
      <ArrowLeft />
      All neuron types
    </Button>
    {#if enrichmentHref}
      <Button variant="outline" size="sm" href={enrichmentHref} class="ml-auto">
        Run enrichment on these genes →
      </Button>
    {/if}
  </div>

  <p class="text-xs text-muted-foreground">
    Genes called expressed in <span class="font-mono">{data.neuronClass}</span> by CeNGEN single-cell
    RNA sequencing (Taylor et al. 2021). Liberal returns the most genes and stringent keeps only the most
    certain calls. Bulk TMM is a normalized expression level from sorted bulk samples.
  </p>

  <Card>
    <CardHeader>
      <CardTitle class="font-mono text-lg">{data.neuronClass}</CardTitle>
      <div class="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <label class="flex items-center gap-2">
          <span>Threshold</span>
          <select
            bind:value={minThreshold}
            class="rounded border bg-card px-2 py-1 font-mono text-sm"
          >
            <option value={1}>1: liberal</option>
            <option value={2}>2: medium</option>
            <option value={3}>3: conservative</option>
            <option value={4}>4: stringent</option>
          </select>
        </label>
        {#if rows !== null}
          <Badge variant="muted" class="text-[0.65rem]">
            {rows.length.toLocaleString()} genes at ≥ {thresholdLabel}
          </Badge>
        {/if}
      </div>
    </CardHeader>
    <CardContent>
      {#if rows === null}
        <div class="text-sm text-muted-foreground">Loading...</div>
      {:else if rows.length === 0}
        <div class="text-sm text-muted-foreground">
          No genes called expressed in {data.neuronClass} at the {thresholdLabel} threshold.
        </div>
      {:else}
        <div class="overflow-x-auto rounded-md border bg-card">
          <table class="w-full text-sm">
            <thead class="border-b bg-card">
              <tr>
                <th
                  class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Gene
                </th>
                <th
                  class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  WormBase
                </th>
                <th
                  class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Call ≥
                </th>
                <th
                  class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Bulk TMM
                </th>
              </tr>
            </thead>
            <tbody>
              {#each rows as r (r.wormbase_gene)}
                <tr class="border-b last:border-b-0 hover:bg-muted/30">
                  <td class="px-3 py-2 align-middle">
                    <a
                      href={resolve(`/gene/${r.wormbase_gene}`)}
                      class="text-primary hover:underline"
                    >
                      {r.gene_name ?? r.wormbase_gene}
                    </a>
                  </td>
                  <td class="px-3 py-2 align-middle font-mono text-xs text-muted-foreground">
                    {r.wormbase_gene}
                  </td>
                  <td
                    class="px-3 py-2 text-right align-middle font-mono tabular-nums text-muted-foreground"
                  >
                    {r.max_threshold}
                  </td>
                  <td
                    class="px-3 py-2 text-right align-middle font-mono tabular-nums text-muted-foreground"
                  >
                    {r.tmm !== null ? r.tmm.toFixed(1) : '-'}
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
