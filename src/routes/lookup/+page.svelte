<script lang="ts">
  import { bulkLookup, type BulkLookupHit } from '$lib/queries';
  import { selection } from '$lib/stores/selection.svelte';
  import { buildIdsQuery } from '$lib/share';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import GenePill from '$lib/components/GenePill.svelte';
  import { toast } from 'svelte-sonner';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Plus from 'lucide-svelte/icons/plus';
  import BarChart from 'lucide-svelte/icons/bar-chart-3';
  import PageHint from '$lib/components/PageHint.svelte';
  import { parseGeneList } from '$lib/gene-parse';

  let input = $state('');
  let hits = $state<BulkLookupHit[]>([]);
  let misses = $state<string[]>([]);
  let elapsedMs = $state(0);
  let busy = $state(false);

  async function run() {
    const tokens = parseGeneList(input);
    if (tokens.length === 0) {
      hits = [];
      misses = [];
      return;
    }
    busy = true;
    const t0 = performance.now();
    const r = await bulkLookup(tokens);
    hits = r.hits;
    misses = r.misses;
    elapsedMs = performance.now() - t0;
    busy = false;
  }

  function addAllToSelection() {
    const ids = [...new Set(hits.map((h) => h.wormbase_gene))];
    for (const id of ids) selection.add(id);
    toast.success('Added to selection', {
      description: `${ids.length} unique gene${ids.length === 1 ? '' : 's'}`,
    });
  }

  async function gotoEnrich() {
    const ids = [...new Set(hits.map((h) => h.wormbase_gene))];
    if (ids.length < 2) return;
    const q = await buildIdsQuery(ids);
    goto(resolve(`/enrichment?${q}`));
  }

  function copyMisses() {
    navigator.clipboard.writeText(misses.join('\n')).then(() => {
      toast.success('Misses copied', {
        description: `${misses.length} unmatched input${misses.length === 1 ? '' : 's'}`,
      });
    });
  }

  const uniqueHits = $derived(
    Array.from(new Map(hits.map((h) => [h.wormbase_gene + ':' + h.input, h])).values()),
  );
  // Retired identifiers still resolve; the resolver flags them rather than dropping them.
  const retiredHits = $derived(uniqueHits.filter((h) => h.status && h.status !== 'Live'));
</script>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Gene name resolver</h1>
    <p class="text-sm text-muted-foreground">Any gene name into a WormBase ID</p>
  </header>

  <PageHint id="lookup" title="What this step does">
    One gene answers to several names: a common name (<code>daf-16</code>), a sequence name (<code
      >R13H8.1</code
    >), aliases from older papers, an Entrez number, and its permanent WormBase ID (<code
      >WBGene00000912</code
    >). Only the WormBase ID is stable, so every tool here keys on it. Paste any mixture of the
    rest, one per line or comma-separated, and each is matched to its WormBase ID. Anything that
    matches several genes, or none, is listed separately rather than quietly dropped. A name from an
    older paper may belong to a gene WormBase has since merged away or withdrawn; those still
    resolve, and are flagged <b>Dead</b> or <b>Suppressed</b> so you can decide whether to keep them,
    rather than being silently dropped or silently carried into an analysis.
  </PageHint>

  <Card>
    <CardHeader class="pb-3">
      <CardTitle class="text-base">Paste gene names or IDs</CardTitle>
      <div class="text-xs text-muted-foreground">
        Paste a list of WBGene IDs, gene names, sequence names, or aliases. One per line, comma,
        space, or pipe-separated all work.
      </div>
    </CardHeader>
    <CardContent class="space-y-3">
      <textarea
        bind:value={input}
        rows="8"
        placeholder="daf-16, daf-2, age-1&#10;hsf-1&#10;WBGene00000898"
        class="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      ></textarea>
      <div class="flex items-center gap-2">
        <Button onclick={run} disabled={busy}>
          {busy ? 'Looking up...' : 'Look up'}
        </Button>
        <Button variant="ghost" onclick={() => (input = '')} disabled={busy || !input}>
          Clear
        </Button>
        {#if elapsedMs > 0}
          <span class="ml-auto font-mono text-xs text-muted-foreground">
            {elapsedMs.toFixed(0)} ms
          </span>
        {/if}
      </div>
    </CardContent>
  </Card>

  {#if hits.length > 0 || misses.length > 0}
    <Card>
      <CardHeader class="flex flex-row items-baseline justify-between pb-3">
        <CardTitle class="text-base">
          {uniqueHits.length} match{uniqueHits.length === 1 ? '' : 'es'}
          {#if misses.length > 0}
            <span class="text-sm font-normal text-muted-foreground">
              · {misses.length} miss{misses.length === 1 ? '' : 'es'}
            </span>
          {/if}
          {#if retiredHits.length > 0}
            <span class="text-sm font-normal text-amber-700 dark:text-amber-500">
              · {retiredHits.length} retired
            </span>
          {/if}
        </CardTitle>
        {#if hits.length > 0}
          <div class="flex gap-2">
            <Button variant="outline" size="sm" onclick={addAllToSelection}>
              <Plus class="h-3 w-3" />
              Add all to selection
            </Button>
            <Button
              variant="outline"
              size="sm"
              onclick={gotoEnrich}
              disabled={uniqueHits.length < 2}
            >
              <BarChart class="h-3 w-3" />
              Run enrichment
            </Button>
          </div>
        {/if}
      </CardHeader>
      <CardContent class="space-y-3 pt-0">
        {#if uniqueHits.length > 0}
          <div class="flex flex-wrap gap-1.5">
            {#each uniqueHits as h, i (i)}
              <GenePill id={h.wormbase_gene} name={h.gene_name}>
                {#snippet extra()}
                  {#if h.input.toLowerCase() !== (h.gene_name ?? h.wormbase_gene).toLowerCase()}
                    <Badge variant="outline" class="px-1 py-0 text-[0.55rem]">
                      {h.input}
                    </Badge>
                  {/if}
                  {#if h.status && h.status !== 'Live'}
                    <Badge
                      variant="outline"
                      class="border-amber-500/50 bg-amber-100 px-1 py-0 text-[0.55rem] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                      title={h.status === 'Dead'
                        ? 'Retired in WormBase: merged into another gene or withdrawn. The ID still resolves, but the gene is no longer current.'
                        : 'Suppressed in WormBase: the gene model is no longer supported by evidence.'}
                    >
                      {h.status}
                    </Badge>
                  {/if}
                {/snippet}
              </GenePill>
            {/each}
          </div>
        {/if}
        {#if misses.length > 0}
          <div>
            <div
              class="mb-2 flex items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Not found
              <button
                type="button"
                onclick={copyMisses}
                class="text-xs normal-case text-primary hover:underline"
              >
                Copy
              </button>
            </div>
            <div class="flex flex-wrap gap-1">
              {#each misses as m (m)}
                <span
                  class="inline-block rounded bg-destructive/10 px-1.5 py-0.5 font-mono text-xs text-destructive"
                >
                  {m}
                </span>
              {/each}
            </div>
          </div>
        {/if}
      </CardContent>
    </Card>
  {/if}
</div>
