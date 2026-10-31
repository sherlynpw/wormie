<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
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

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Human diseases</h1>
    <p class="text-sm text-muted-foreground">
      Genes grouped by the human disease their ortholog is linked to. Most links are inferred from
      the human ortholog.
    </p>
    <p class="text-[0.7rem] text-muted-foreground">
      Disease Ontology (DO) terms, with C. elegans annotations from the Alliance of Genome
      Resources:
      <a
        href="https://www.alliancegenome.org/"
        target="_blank"
        rel="noopener noreferrer"
        class="underline underline-offset-2 hover:text-foreground">the Alliance</a
      >
    </p>
  </header>

  <div class="flex flex-wrap items-center justify-between gap-3">
    <Input
      bind:value={filter}
      placeholder="Filter by name or DO ID (e.g. epilepsy, DOID:1234)..."
      class="max-w-md"
    />
    {#if rows}
      <span class="text-xs text-muted-foreground">
        Showing <b class="text-foreground">{filtered.length.toLocaleString()}</b> of {rows.length.toLocaleString()}
        diseases
      </span>
    {/if}
  </div>
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
</div>
