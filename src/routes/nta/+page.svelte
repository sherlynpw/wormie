<script lang="ts">
  import { runNta, type NtaResult } from '$lib/nta';
  import { bulkLookup } from '$lib/queries';
  import { parseGeneList } from '$lib/gene-parse';
  import MethodsButton from '$lib/components/MethodsButton.svelte';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { toast } from 'svelte-sonner';

  let pasteText = $state('');
  let perms = $state(1000);
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
      result = await runNta(ids, { permutations: perms });
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

<svelte:head><title>Network analysis · wormie.rs.ht</title></svelte:head>

<div class="container mx-auto max-w-5xl space-y-6 p-4">
  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Network topology analysis</h1>
    <p class="text-sm text-muted-foreground">
      Tests whether a query gene list is more interconnected in the BioGRID interaction graph than a
      random gene set of the same size. Reports observed within-set edges and a permutation z-score.
      Local-first; no data leaves the browser.
    </p>
  </header>

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
            tool: 'enrichment',
            params: { kind: 'nta', perms },
            inputSummary: `${result.nodes.length} query genes`,
          }}
        />
      </CardHeader>
      <CardContent>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3">
          <div>
            <dt class="text-muted-foreground">Query genes</dt>
            <dd class="font-mono">{result.nodes.length}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">Connected (≥1 in-set edge)</dt>
            <dd class="font-mono">{result.connectedNodes.length}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">Edges (within input)</dt>
            <dd class="font-mono">{result.observedEdges}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">Expected (random)</dt>
            <dd class="font-mono">{result.expectedEdges.toFixed(2)}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">Edge z-score</dt>
            <dd class="font-mono">{result.edgeZ.toFixed(2)}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">Density</dt>
            <dd class="font-mono">{result.density.toFixed(4)}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">BioGRID universe</dt>
            <dd class="font-mono">{result.universeSize.toLocaleString()}</dd>
          </div>
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
