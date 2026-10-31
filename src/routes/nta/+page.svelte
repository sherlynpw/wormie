<script lang="ts">
  import { runNta, type NtaResult, type NullModel, type EdgeKind } from '$lib/nta';
  import { bulkLookup } from '$lib/queries';
  import { parseGeneList } from '$lib/gene-parse';
  import { readIdsFromUrl } from '$lib/share';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import MethodsButton from '$lib/components/MethodsButton.svelte';
  import PageHint from '$lib/components/PageHint.svelte';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { toast } from 'svelte-sonner';
  import { resolve } from '$app/paths';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';

  let pasteText = $state('');

  onMount(async () => {
    const params = page.url.searchParams;
    const dsId = params.get('id');
    if (params.get('load') === 'list' && dsId) {
      const { datasets } = await import('$lib/stores/datasets.svelte');
      const ds = await datasets.getById(dsId);
      if (ds) {
        pasteText = ds.body;
        toast.success('Loaded', { description: ds.name });
        return;
      }
    }
    const ids = await readIdsFromUrl(page.url);
    if (ids.length > 0) {
      pasteText = ids.join('\n');
      toast.success(`Loaded ${ids.length.toLocaleString()} genes`);
    }
  });
  let perms = $state(1000);
  let nullModel = $state<NullModel>('degree');
  let edgeKind = $state<EdgeKind>('all');
  let running = $state(false);
  let result = $state<NtaResult | null>(null);

  async function run() {
    const tokens = parseGeneList(pasteText);
    if (tokens.length < 2) {
      toast.error('Need at least 2 genes');
      return;
    }
    running = true;
    try {
      const r = await bulkLookup(tokens);
      const ids = [...new Set(r.hits.map((h) => h.wormbase_gene))];
      if (ids.length < 2) {
        toast.error('Could not resolve enough gene IDs');
        return;
      }
      result = await runNta(ids, { permutations: perms, nullModel, edgeKind });
      toast.success(
        `${result.observedEdges} edges among ${ids.length} input genes (z = ${result.edgeZ.toFixed(2)})`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      running = false;
    }
  }
</script>

<svelte:head><title>Network connectivity · wormie.rs.ht</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href={resolve('/')} class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Network connectivity</h1>
    <p class="text-sm text-muted-foreground">Interactions among the genes in a list</p>
  </header>

  <PageHint id="nta.intro" title="What this step does">
    Network connectivity asks whether the genes in your list interact with each other. Input: a list
    of genes. The Biological General Repository for Interaction Datasets (BioGRID) records pairs of
    genes that interact. Physical interactions are where the proteins bind. Genetic interactions are
    where mutating both genes has an effect that neither mutation has alone. Picture this as a
    network: genes are dots and interactions are lines between them. The tool counts the lines among
    your genes. It compares that count with the counts for many random gene sets of the same size
    (permutations). Output: the observed and expected number of lines, and a z-score (how many
    standard deviations the observed count is above the expected count). A high count suggests that
    your genes work together. Well-studied genes have more known partners because more people looked
    at them. So by default each gene in a random set is swapped in for one of your genes with a
    similar degree (number of partners). Many genes have no recorded interaction. The result states
    how many of your genes could be tested.
  </PageHint>

  <Card>
    <CardHeader><CardTitle>Input</CardTitle></CardHeader>
    <CardContent class="space-y-3">
      <textarea
        class="h-40 w-full rounded border bg-background p-2 font-mono text-xs"
        placeholder="One gene per line (WBGene ID, sequence name, or symbol)"
        bind:value={pasteText}
      ></textarea>
      <div class="flex items-center gap-3 text-sm">
        <label>
          Permutations
          <input
            type="number"
            class="ml-1 w-20 rounded border bg-background px-1 py-0.5"
            bind:value={perms}
            min="100"
            max="10000"
            step="100"
          />
        </label>
        <label class="inline-flex items-center gap-1.5 text-sm">
          <span class="text-muted-foreground">Evidence:</span>
          <select
            bind:value={edgeKind}
            class="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="all">physical + genetic</option>
            <option value="physical">physical only</option>
            <option value="genetic">genetic only</option>
          </select>
        </label>
        <label class="inline-flex items-center gap-1.5 text-sm">
          <span class="text-muted-foreground">Null model:</span>
          <select
            bind:value={nullModel}
            class="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="degree">degree-preserving</option>
            <option value="uniform">uniform</option>
          </select>
        </label>
        <Button onclick={run} disabled={running || !pasteText.trim()}>
          {running ? 'Running…' : 'Run NTA'}
        </Button>
      </div>
    </CardContent>
  </Card>

  {#if result}
    <Card>
      <CardHeader class="flex flex-row items-center justify-between">
        <CardTitle>Result</CardTitle>
        <MethodsButton
          ctx={{
            tool: 'nta',
            params: {
              perms: result.permutations,
              nullModel: result.nullModel,
              edgeKind: result.edgeKind,
            },
            inputSummary: `${result.nodes.length} query genes`,
          }}
        />
      </CardHeader>
      <CardContent>
        {#if result.testedNodes < result.nodes.length}
          <div
            class="mb-4 rounded-md border border-amber-500/60 bg-amber-50 p-3 text-sm dark:bg-amber-950/30"
          >
            <span class="font-semibold">
              {result.nodes.length - result.testedNodes} of {result.nodes.length} query genes have no
              interactions in BioGRID
            </span>
            and cannot contribute edges, so this result describes the
            <span class="font-semibold">{result.testedNodes}</span> that do. BioGRID covers about 45%
            of protein-coding genes, and less for membrane proteins such as ion channels.
          </div>
        {/if}
        {#if result.degreeMatch && result.degreeMatch.sampled < result.degreeMatch.query * 0.8}
          <div class="mb-4 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Degree matching is approximate for this query: the tested genes have a median degree of
            {result.degreeMatch.query} but the null could only draw genes at a median of {result
              .degreeMatch.sampled}. There are too few genes of comparable degree to match the top
            of the distribution, which understates the expected count and makes the z-score
            conservative rather than inflated.
          </div>
        {/if}
        <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3">
          <div>
            <dt class="text-muted-foreground">Query genes</dt>
            <dd class="font-mono">{result.nodes.length}</dd>
          </div>
          <div>
            <dt
              class="text-muted-foreground"
              title="Query genes with at least one interaction with another gene in your list"
            >
              Connected (≥1 in-set edge)
            </dt>
            <dd class="font-mono">{result.connectedNodes.length}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">Edges (within input)</dt>
            <dd class="font-mono">{result.observedEdges}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">
              Expected ({result.nullModel === 'degree' ? 'degree-matched' : 'uniform'})
            </dt>
            <dd class="font-mono">{result.expectedEdges.toFixed(2)}</dd>
          </div>
          <div>
            <dt
              class="text-muted-foreground"
              title="Observed edges minus expected edges, divided by the standard deviation of the random sets"
            >
              Edge z-score
            </dt>
            <dd class="font-mono">{result.edgeZ.toFixed(2)}</dd>
          </div>
          <div>
            <dt
              class="text-muted-foreground"
              title="Edges found divided by the edges possible among all genes in your list"
            >
              Density
            </dt>
            <dd class="font-mono">{result.density.toFixed(4)}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">BioGRID evidence</dt>
            <dd class="font-mono">
              {result.edgeKind === 'all' ? 'physical + genetic' : result.edgeKind}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground">BioGRID universe</dt>
            <dd class="font-mono">{result.universeSize.toLocaleString()}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">In interaction graph</dt>
            <dd class="font-mono">{result.testedNodes} / {result.nodes.length}</dd>
          </div>
          {#if result.degreeMatch}
            <div>
              <dt class="text-muted-foreground">Median degree (query / null)</dt>
              <dd class="font-mono">
                {result.degreeMatch.query} / {result.degreeMatch.sampled}
              </dd>
            </div>
          {/if}
        </dl>

        {#if result.edges.length > 0}
          <details class="mt-4">
            <summary class="cursor-pointer text-sm">Edges ({result.edges.length})</summary>
            <table class="mt-2 w-full text-xs">
              <thead>
                <tr class="border-b text-left">
                  <th class="py-1 pr-3">A</th>
                  <th class="py-1 pr-3">B</th>
                  <th class="py-1 pr-3">Type</th>
                </tr>
              </thead>
              <tbody>
                {#each result.edges as e, i (i)}
                  <tr class="border-b last:border-b-0">
                    <td class="py-1 pr-3 font-mono">{e.symbol_a || e.a}</td>
                    <td class="py-1 pr-3 font-mono">{e.symbol_b || e.b}</td>
                    <td class="py-1 pr-3">{e.experimental_type}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </details>
        {/if}
      </CardContent>
    </Card>
  {/if}
</div>
