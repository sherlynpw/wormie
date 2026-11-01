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
  import { readIdsFromUrl } from '$lib/share';
  import { page } from '$app/state';
  import { onMount } from 'svelte';

  let input = $state('');
  let hits = $state<BulkLookupHit[]>([]);
  let misses = $state<string[]>([]);
  // Ambiguous candidates the user has unchecked, as "entry|WBGene ID".
  let unchecked = $state<string[]>([]);
  let elapsedMs = $state(0);
  let busy = $state(false);

  // The home page and the selection bar both send ?ids=/?gz= here.
  onMount(async () => {
    const ids = await readIdsFromUrl(page.url);
    if (ids.length === 0) return;
    input = ids.join('\n');
    await run();
  });

  async function run() {
    const tokens = parseGeneList(input);
    unchecked = [];
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
    const ids = selectedIds;
    for (const id of ids) selection.add(id);
    toast.success('Added to selection', {
      description: `${ids.length} unique gene${ids.length === 1 ? '' : 's'}`,
    });
  }

  async function gotoEnrich() {
    const ids = selectedIds;
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

  // An entry that resolves to two or more distinct genes is ambiguous; its candidates are not
  // matched until the user keeps them checked.
  const byEntry = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const m = new Map<string, Map<string, BulkLookupHit>>();
    for (const h of hits) {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const genes = m.get(h.input) ?? new Map<string, BulkLookupHit>();
      genes.set(h.wormbase_gene, h);
      m.set(h.input, genes);
    }
    return m;
  });
  const ambiguous = $derived(
    [...byEntry]
      .filter(([, g]) => g.size > 1)
      .map(([entry, g]) => ({ entry, candidates: [...g.values()] })),
  );
  // One row per gene, with every entry that reached it.
  const matches = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const m = new Map<string, { hit: BulkLookupHit; entries: string[] }>();
    for (const [entry, genes] of byEntry) {
      if (genes.size > 1) continue;
      const [hit] = genes.values();
      const row = m.get(hit.wormbase_gene) ?? { hit, entries: [] };
      row.entries.push(entry);
      m.set(hit.wormbase_gene, row);
    }
    return [...m.values()];
  });
  const matchedEntryCount = $derived(matches.reduce((n, m) => n + m.entries.length, 0));
  const selectedIds = $derived([
    ...new Set([
      ...matches.map((m) => m.hit.wormbase_gene),
      ...ambiguous.flatMap((a) =>
        a.candidates
          .filter((c) => !unchecked.includes(candidateKey(a.entry, c)))
          .map((c) => c.wormbase_gene),
      ),
    ]),
  ]);
  // Retired identifiers still resolve; the resolver flags them rather than dropping them.
  const retiredCount = $derived(
    matches.filter((m) => m.hit.status && m.hit.status !== 'Live').length,
  );

  const geneCountLabel = $derived(
    `${matches.length} gene${matches.length === 1 ? '' : 's'}` +
      (matchedEntryCount !== matches.length ? ` from ${matchedEntryCount} entries` : ''),
  );

  function candidateKey(entry: string, c: BulkLookupHit) {
    return `${entry}|${c.wormbase_gene}`;
  }

  function toggleCandidate(key: string) {
    unchecked = unchecked.includes(key) ? unchecked.filter((k) => k !== key) : [...unchecked, key];
  }
</script>

<svelte:head><title>Gene name resolver · wormie.bio</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Gene name resolver</h1>
    <p class="text-sm text-muted-foreground">
      Match gene names, sequence names, aliases and IDs to WormBase gene IDs
    </p>
  </header>

  <PageHint id="lookup" title="What this step does">
    One gene can have several names: a common name (<code>daf-16</code>), a sequence name (<code
      >R13H8.1</code
    >), aliases from older papers, an Entrez Gene number (from the National Center for Biotechnology
    Information, NCBI), and its permanent WormBase ID (<code>WBGene00000912</code>). Only the
    WormBase ID never changes, so every tool here uses it. Paste any mix of these, one per line or
    separated by commas, and each is matched to its WormBase ID. Entries that match several genes
    are listed under Ambiguous, with every candidate gene selected; uncheck any you do not want.
    Entries that match no gene are listed under Not found. Neither kind is dropped. A name from an
    older paper may belong to a gene that WormBase has since merged into another gene or withdrawn.
    These genes are still matched and are marked <b>Dead</b> or <b>Suppressed</b>, so you can decide
    whether to keep them.
  </PageHint>

  <Card>
    <CardHeader class="pb-3">
      <CardTitle class="text-base">Paste gene names or IDs</CardTitle>
      <div class="text-xs text-muted-foreground">
        Paste a list of WormBase gene IDs (WBGene IDs), gene names, sequence names, or aliases.
        Separate entries with new lines, commas, spaces, or pipes (|).
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
          {geneCountLabel}
          {#if ambiguous.length > 0}
            <span class="text-sm font-normal text-muted-foreground">
              · {ambiguous.length} ambiguous
            </span>
          {/if}
          {#if misses.length > 0}
            <span class="text-sm font-normal text-muted-foreground">
              · {misses.length} miss{misses.length === 1 ? '' : 'es'}
            </span>
          {/if}
          {#if retiredCount > 0}
            <span class="text-sm font-normal text-amber-700 dark:text-amber-500">
              · {retiredCount} retired
            </span>
          {/if}
        </CardTitle>
        {#if selectedIds.length > 0}
          <div class="flex gap-2">
            <Button variant="outline" size="sm" onclick={addAllToSelection}>
              <Plus class="h-3 w-3" />
              Add all to selection
            </Button>
            <Button
              variant="outline"
              size="sm"
              onclick={gotoEnrich}
              disabled={selectedIds.length < 2}
            >
              <BarChart class="h-3 w-3" />
              Run enrichment
            </Button>
          </div>
        {/if}
      </CardHeader>
      <CardContent class="space-y-3 pt-0">
        {#if matches.length > 0}
          <div class="flex flex-wrap gap-1.5">
            {#each matches as { hit: h, entries } (h.wormbase_gene)}
              <GenePill id={h.wormbase_gene} name={h.gene_name}>
                {#snippet extra()}
                  {#each entries.filter((e) => e.toLowerCase() !== (h.gene_name ?? h.wormbase_gene).toLowerCase()) as e (e)}
                    <Badge variant="outline" class="px-1 py-0 text-[0.55rem]">
                      {e}
                    </Badge>
                  {/each}
                  {#if h.chromosome}
                    <Badge
                      variant="outline"
                      class="px-1 py-0 font-mono text-[0.55rem]"
                      title="Genetic map position (chromosome and centimorgans, cM), estimated by WormBase from nearby mapped genes"
                    >
                      {h.chromosome}{h.cm != null ? `:${h.cm.toFixed(2)}` : ''}
                    </Badge>
                  {/if}
                  {#if h.status && h.status !== 'Live'}
                    <Badge
                      variant="outline"
                      class="border-amber-500/50 bg-amber-100 px-1 py-0 text-[0.55rem] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                      title={h.status === 'Dead'
                        ? 'Retired in WormBase: merged into another gene or withdrawn. The ID is still matched, but the gene is no longer current.'
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
        {#if ambiguous.length > 0}
          <div data-testid="ambiguous-group">
            <div
              class="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Ambiguous
            </div>
            <div class="space-y-1.5">
              {#each ambiguous as a (a.entry)}
                <div class="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    class="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                  >
                    {a.entry}
                  </span>
                  <span class="text-muted-foreground">matches {a.candidates.length} genes:</span>
                  {#each a.candidates as c (c.wormbase_gene)}
                    <label
                      class="inline-flex items-center gap-1 rounded border bg-card px-1.5 py-0.5"
                    >
                      <input
                        type="checkbox"
                        checked={!unchecked.includes(candidateKey(a.entry, c))}
                        onchange={() => toggleCandidate(candidateKey(a.entry, c))}
                        aria-label="Keep {c.gene_name ?? c.wormbase_gene} for {a.entry}"
                      />
                      <a href={resolve(`/gene/${c.wormbase_gene}`)} class="hover:text-primary">
                        <span class="font-medium">{c.gene_name ?? c.wormbase_gene}</span>
                        <span class="font-mono text-[0.65rem] text-muted-foreground">
                          {c.wormbase_gene}
                        </span>
                      </a>
                    </label>
                  {/each}
                </div>
              {/each}
            </div>
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
