<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Badge } from '$lib/components/ui/badge';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
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

<svelte:head><title>Neuron types · wormie.rs.ht</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Neuron types</h1>
    <p class="text-sm text-muted-foreground">
      Genes grouped by the CeNGEN neuron type that expresses them. Counts are genes called expressed
      at the medium threshold (level 2 of 4).
    </p>
    <p class="text-[0.7rem] text-muted-foreground">
      CeNGEN single-cell atlas of the L4 larval nervous system (Taylor et al. 2021):
      <a
        href="https://www.cengen.org/"
        target="_blank"
        rel="noopener noreferrer"
        class="underline underline-offset-2 hover:text-foreground">cengen.org</a
      >
    </p>
  </header>

  <div class="flex flex-wrap items-center justify-between gap-3">
    <Input
      bind:value={filter}
      placeholder="Filter by name (e.g. ADL, AVA, RIM)..."
      class="max-w-md"
    />
    {#if rows}
      <span class="text-xs text-muted-foreground">
        Showing <b class="text-foreground">{filtered.length.toLocaleString()}</b> of {rows.length.toLocaleString()}
        neuron types
      </span>
    {/if}
  </div>
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
</div>
