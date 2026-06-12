<script lang="ts">
  import { bulkLookup } from '$lib/queries';
  import { parseGmt, summarize, type GmtSet } from '$lib/gmt';
  import {
    runCustomEnrichment,
    runCustomGSEA,
    type EnrichmentResult,
    type GseaResult,
    type GseaInput,
  } from '$lib/db/client';
  import EnrichmentDotPlot from '$lib/components/EnrichmentDotPlot.svelte';
  import GseaDotPlot from '$lib/components/GseaDotPlot.svelte';
  import PlotExportMenu from '$lib/components/PlotExportMenu.svelte';
  import SaveDatasetButton from '$lib/components/SaveDatasetButton.svelte';
  import SaveSessionButton from '$lib/components/SaveSessionButton.svelte';
  import LoadDatasetPicker from '$lib/components/LoadDatasetPicker.svelte';
  import LoadLastButton from '$lib/components/LoadLastButton.svelte';
  import { decodeSession, type Session } from '$lib/session';
  import { lastInputs } from '$lib/stores/lastInputs.svelte';
  import { onMount } from 'svelte';
  import PageHint from '$lib/components/PageHint.svelte';
  import ControlHint from '$lib/components/ControlHint.svelte';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { cn } from '$lib/utils';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Download from 'lucide-svelte/icons/download';
  import TableIcon from 'lucide-svelte/icons/table';
  import CircleDot from 'lucide-svelte/icons/circle-dot';
  import { toast } from 'svelte-sonner';
  import { parseGeneList } from '$lib/gene-parse';
  import { downloadTsv } from '$lib/download';

  type Mode = 'enrichment' | 'gsea';

  let gmtText = $state('');
  let gmtFile: HTMLInputElement | null = $state(null);
  let parsedSets = $state<GmtSet[]>([]);
  let mode = $state<Mode>('enrichment');
  let geneListText = $state('');
  let rankedText = $state('');
  let nperm = $state(1000);
  let running = $state(false);
  let enrichResults = $state<EnrichmentResult[] | null>(null);
  let gseaResults = $state<GseaResult[] | null>(null);
  let elapsedMs = $state(0);
  let viewMode = $state<'table' | 'plot'>('table');
  let plotSvg = $state<SVGSVGElement | null>(null);

  const stats = $derived(summarize(parsedSets));

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (params.get('load') === 'gmt' && id) {
      const { datasets } = await import('$lib/stores/datasets.svelte');
      const ds = await datasets.getById(id);
      if (ds) {
        gmtText = ds.body;
        parseGmtNow();
      }
    } else if (params.get('load') === 'session' && id) {
      const { datasets } = await import('$lib/stores/datasets.svelte');
      const ds = await datasets.getById(id);
      if (ds) {
        const session = decodeSession(ds.body);
        if (session && session.tool === 'gmt') {
          const p = session.params as { mode?: Mode; nperm?: number };
          if (p.mode === 'enrichment' || p.mode === 'gsea') mode = p.mode;
          if (typeof p.nperm === 'number') nperm = p.nperm;
          gmtText = session.inputs.gmt ?? '';
          if (session.inputs.geneList) geneListText = session.inputs.geneList;
          if (session.inputs.ranked) rankedText = session.inputs.ranked;
          if (gmtText.trim()) parseGmtNow();
          // Restore cached results so the page lands on the previous view without recomputing.
          if (session.results) {
            const blob = session.results as {
              mode?: 'enrichment' | 'gsea';
              results?: EnrichmentResult[] | GseaResult[];
            };
            if (blob.mode === 'enrichment' && Array.isArray(blob.results)) {
              enrichResults = blob.results as EnrichmentResult[];
              gseaResults = null;
            } else if (blob.mode === 'gsea' && Array.isArray(blob.results)) {
              gseaResults = blob.results as GseaResult[];
              enrichResults = null;
            }
          }
          toast.success('Session restored', { description: ds.name });
        } else {
          toast.error('Could not restore session', { description: ds.name });
        }
      }
    }
  });

  function parseFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      gmtText = String(reader.result ?? '');
      parseGmtNow();
    };
    reader.readAsText(f);
  }

  function parseGmtNow() {
    const sets = parseGmt(gmtText);
    parsedSets = sets;
    enrichResults = null;
    gseaResults = null;
    if (sets.length > 0) lastInputs.stash('gmt', gmtText);
    if (sets.length === 0) {
      toast.error('No valid sets found', {
        description: 'GMT format: SET_NAME\\tDESCRIPTION\\tgene1\\tgene2\\t...',
      });
      return;
    }
    const s = summarize(sets);
    toast.success(`Parsed ${s.count} sets`, {
      description: `Sizes ${s.minSize}-${s.maxSize} (median ${s.medianSize}), ${s.uniqueGenes} unique genes`,
    });
  }

  const splitTokens = parseGeneList;

  function splitRow(line: string): string[] {
    // CSV-aware splitter: handles quoted fields and comma/tab/whitespace separators.
    const out: string[] = [];
    let buf = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') {
          buf += '"';
          i++;
        } else if (c === '"') inQ = false;
        else buf += c;
      } else if (c === '"') inQ = true;
      else if (c === ',' || c === '\t') {
        out.push(buf);
        buf = '';
      } else if (/\s/.test(c)) {
        if (buf.length === 0 && out.length === 0) {
          // skip leading whitespace
        } else {
          out.push(buf);
          buf = '';
        }
      } else buf += c;
    }
    out.push(buf);
    return out.map((s) => s.replace(/^"+|"+$/g, '').trim());
  }

  async function runEnrich() {
    if (parsedSets.length === 0) return toast.error('Parse a GMT first');
    const tokens = splitTokens(geneListText);
    if (tokens.length < 2) return toast.error('Need at least 2 genes');
    running = true;
    try {
      const r = await bulkLookup(tokens);
      const ids = [...new Set(r.hits.map((h) => h.wormbase_gene))];
      if (ids.length < 2) {
        toast.error('Resolved fewer than 2 genes', { description: 'Check gene IDs/names' });
        return;
      }
      // Resolve set genes so name-based GMTs work.
      /* eslint-disable svelte/prefer-svelte-reactivity */
      const allSetGenes = new Set<string>();
      for (const s of parsedSets) for (const g of s.genes) allSetGenes.add(g);
      const setLookup = await bulkLookup([...allSetGenes]);
      const tokenToWb = new Map<string, string>();
      /* eslint-enable svelte/prefer-svelte-reactivity */
      for (const h of setLookup.hits) tokenToWb.set(h.input, h.wormbase_gene);
      const resolvedSets = parsedSets
        .map((s) => ({
          term_id: s.name,
          name: s.name,
          genes: [...new Set(s.genes.map((g) => tokenToWb.get(g) ?? g).filter(Boolean))],
        }))
        .filter((s) => s.genes.length > 0);
      const { results, elapsedMs: el } = await runCustomEnrichment(ids, resolvedSets, {
        minK: 1,
        maxQ: 1,
      });
      enrichResults = results;
      gseaResults = null;
      elapsedMs = el;
      const sig = results.filter((r) => r.q <= 0.05).length;
      toast.success(`Enrichment complete (${el.toFixed(0)} ms)`, {
        description: `${results.length} terms tested, ${sig} significant (q ≤ 0.05)`,
      });
    } catch (e) {
      toast.error('Enrichment failed', { description: String(e) });
    } finally {
      running = false;
    }
  }

  async function runGsea() {
    if (parsedSets.length === 0) return toast.error('Parse a GMT first');
    const lines = rankedText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    const raw: { gene: string; score: number }[] = [];
    const startIdx = (() => {
      if (lines.length === 0) return 0;
      const parts = splitRow(lines[0]);
      return parts.length >= 2 && !Number.isFinite(parseFloat(parts[1])) ? 1 : 0;
    })();
    for (let i = startIdx; i < lines.length; i++) {
      const parts = splitRow(lines[i]);
      if (parts.length < 2) continue;
      const score = parseFloat(parts[1]);
      if (!parts[0] || !Number.isFinite(score)) continue;
      raw.push({ gene: parts[0], score });
    }
    if (raw.length < 10) return toast.error('Need ≥ 10 ranked entries');
    running = true;
    try {
      const r = await bulkLookup(raw.map((x) => x.gene));
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const lookup = new Map<string, string>();
      for (const h of r.hits) lookup.set(h.input.toLowerCase(), h.wormbase_gene);
      const ranked: GseaInput[] = [];
      for (const x of raw) {
        const wb = lookup.get(x.gene.toLowerCase());
        if (wb) ranked.push({ gene: wb, score: x.score });
      }
      if (ranked.length < 10) {
        toast.error('Resolved fewer than 10 genes', { description: 'Check gene IDs/names' });
        return;
      }
      /* eslint-disable svelte/prefer-svelte-reactivity */
      const allSetGenes = new Set<string>();
      for (const s of parsedSets) for (const g of s.genes) allSetGenes.add(g);
      const setLookup = await bulkLookup([...allSetGenes]);
      const tokenToWb = new Map<string, string>();
      /* eslint-enable svelte/prefer-svelte-reactivity */
      for (const h of setLookup.hits) tokenToWb.set(h.input, h.wormbase_gene);
      const resolvedSets = parsedSets
        .map((s) => ({
          term_id: s.name,
          name: s.name,
          genes: [...new Set(s.genes.map((g) => tokenToWb.get(g) ?? g).filter(Boolean))],
        }))
        .filter((s) => s.genes.length >= 5);
      const { results, elapsedMs: el } = await runCustomGSEA(ranked, resolvedSets, {
        minSize: 15,
        maxSize: 500,
        weight: 1,
        nperm,
      });
      gseaResults = results;
      enrichResults = null;
      elapsedMs = el;
      const sig = results.filter((r) => r.q <= 0.25).length;
      toast.success(`GSEA complete (${el.toFixed(0)} ms)`, {
        description: `${results.length} sets scored, ${sig} significant (q ≤ 0.25)`,
      });
    } catch (e) {
      toast.error('GSEA failed', { description: String(e) });
    } finally {
      running = false;
    }
  }

  function loadGmtExample() {
    gmtText = [
      'INSULIN_SIGNALING\tdaf-2 pathway components\tdaf-2\tage-1\takt-1\tsgk-1\tpdk-1\tdaf-16\thsf-1\tskn-1',
      'STRESS_RESPONSE\theat shock and oxidative\thsp-16.2\thsp-70\tsod-3\tmtl-1\tgst-4\tgst-7',
      'TRANSCRIPTION_FACTORS\tcanonical TFs in worm\tdaf-16\thsf-1\tskn-1\tlin-1\tpha-4\tpqm-1',
    ].join('\n');
    parseGmtNow();
  }

  function exportTsv() {
    if (enrichResults) {
      downloadTsv(
        'gmt_enrichment.tsv',
        [
          { header: 'term_id', get: (r) => r.term_id },
          { header: 'k', get: (r) => r.k },
          { header: 'K', get: (r) => r.K },
          { header: 'n', get: (r) => r.n },
          { header: 'N', get: (r) => r.N },
          { header: 'fold', get: (r) => r.fold.toFixed(3) },
          { header: 'p', get: (r) => r.p.toExponential(3) },
          { header: 'q', get: (r) => r.q.toExponential(3) },
        ],
        enrichResults,
      );
    } else if (gseaResults) {
      downloadTsv(
        'gmt_gsea.tsv',
        [
          { header: 'term_id', get: (r) => r.term_id },
          { header: 'size', get: (r) => r.size },
          { header: 'es', get: (r) => r.es.toFixed(4) },
          { header: 'nes', get: (r) => r.nes.toFixed(4) },
          { header: 'p', get: (r) => r.p.toExponential(3) },
          { header: 'q', get: (r) => r.q.toExponential(3) },
          { header: 'leading_edge', get: (r) => r.leading_edge.join('|') },
        ],
        gseaResults,
      );
    }
  }

  const SIG = $derived(mode === 'gsea' ? 0.25 : 0.05);
  // Show results area even on 0 terms so the user gets "no terms" feedback rather than a blank page.
  const hasRun = $derived(enrichResults !== null || gseaResults !== null);
  const resultCount = $derived(enrichResults?.length ?? gseaResults?.length ?? 0);
</script>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <PageHint id="gmt" title="Custom gene sets (GMT)">
    Paste or drop a GMT file (MSigDB hallmark, curated, your own). If your sets use human symbols,
    toggle <b>map orthologs</b> to translate via WormBase. Then paste either a gene list (for ORA) or
    a ranked stat list (for GSEA) and run.
  </PageHint>

  <Card>
    <CardHeader>
      <CardTitle class="text-xl">Custom GMT analysis</CardTitle>
      <div class="text-sm text-muted-foreground">
        Paste or upload a GMT collection (MSigDB / Reactome / KEGG / custom WormCat exports) and run
        enrichment or preranked GSEA against your genes. Set names work as term IDs in results. Gene
        IDs are bulk-resolved to WBGene before analysis, so symbols and sequence names both work.
      </div>
    </CardHeader>
    <CardContent class="space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <input
          bind:this={gmtFile}
          type="file"
          accept=".gmt,.txt"
          onchange={parseFile}
          class="hidden"
        />
        <Button variant="outline" size="sm" onclick={() => gmtFile?.click()}>Upload .gmt</Button>
        <SaveDatasetButton type="gmt" body={() => gmtText} disabled={!gmtText.trim()} />
        <SaveSessionButton
          disabled={!gmtText.trim()}
          build={() =>
            ({
              v: 1,
              tool: 'gmt',
              inputs: {
                gmt: gmtText,
                ...(mode === 'enrichment' && geneListText.trim() ? { geneList: geneListText } : {}),
                ...(mode === 'gsea' && rankedText.trim() ? { ranked: rankedText } : {}),
              },
              params: { mode, nperm },
            }) satisfies Session}
          getResults={() => {
            // enrichResults and gseaResults are mutually exclusive (mode toggle clears the other).
            if (mode === 'enrichment' && enrichResults && enrichResults.length > 0) {
              return { mode: 'enrichment', results: enrichResults };
            }
            if (mode === 'gsea' && gseaResults && gseaResults.length > 0) {
              return { mode: 'gsea', results: gseaResults };
            }
            return null;
          }}
        />
        <LoadDatasetPicker
          type="gmt"
          onload={(ds) => {
            gmtText = ds.body;
            parseGmtNow();
          }}
        />
        <LoadLastButton
          type="gmt"
          onload={(body) => {
            gmtText = body;
            parseGmtNow();
          }}
        />
        <Button variant="ghost" size="sm" onclick={loadGmtExample}>Try example</Button>
        <ControlHint id="gmt-format" title="GMT format">
          One set per line: <code
            >set_name &lt;tab&gt; description &lt;tab&gt; gene1 &lt;tab&gt; gene2 ...</code
          >. Gene tokens can be WBGene IDs, sequence names, gene-class names, or even human symbols
          (auto-resolved via WormBase orthologs). Drop a <code>.gmt</code> file here or use Load saved.
        </ControlHint>
        {#if parsedSets.length > 0}
          <Badge variant="muted" class="text-[0.65rem]">
            {stats.count} sets · {stats.uniqueGenes} unique genes · median {stats.medianSize}
          </Badge>
        {/if}
      </div>
      <textarea
        bind:value={gmtText}
        oninput={parseGmtNow}
        rows="6"
        placeholder="INSULIN_SIGNALING\tdaf-2 pathway\tdaf-2\tage-1\takt-1\t..."
        class="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      ></textarea>
    </CardContent>
  </Card>

  {#if parsedSets.length > 0}
    <Card>
      <CardHeader>
        <CardTitle class="inline-flex items-center gap-1.5 text-base">
          Run analysis
          <ControlHint id="gmt-mode" title="Enrichment vs GSEA">
            <b>Enrichment (hypergeometric)</b>: tests whether your gene list overlaps each custom
            set more than chance. Use when you have an already-filtered list of "interesting" genes.<br
            /><br />
            <b>GSEA (preranked)</b>: walks the full ranked stat list, no cutoff. Use when you have a
            signed score per gene (Wald stat, log2FC).
          </ControlHint>
        </CardTitle>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onclick={() => (mode = 'enrichment')}
            class={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              mode === 'enrichment'
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            Enrichment (hypergeometric)
          </button>
          <button
            type="button"
            onclick={() => (mode = 'gsea')}
            class={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              mode === 'gsea'
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            GSEA (preranked)
          </button>
        </div>
      </CardHeader>
      <CardContent class="space-y-3">
        {#if mode === 'enrichment'}
          <textarea
            bind:value={geneListText}
            rows="6"
            placeholder="daf-16, daf-2, age-1\nhsf-1\nWBGene00000898"
            class="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          ></textarea>
          <Button onclick={runEnrich} disabled={running || !geneListText.trim()}>
            {running ? 'Running...' : 'Run enrichment'}
          </Button>
        {:else}
          <textarea
            bind:value={rankedText}
            rows="8"
            placeholder="gene\tstat\ndaf-16\t8.5\ndaf-2\t-7.2\n..."
            class="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          ></textarea>
          <div class="flex items-end gap-3">
            <label class="block">
              <span
                class="mb-1 block text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Permutations
              </span>
              <select bind:value={nperm} class="rounded border bg-card px-2 py-1 font-mono text-sm">
                <option value={500}>500</option>
                <option value={1000}>1000</option>
                <option value={2500}>2500</option>
                <option value={5000}>5000</option>
              </select>
            </label>
            <Button onclick={runGsea} disabled={running || !rankedText.trim()}>
              {running ? 'Running...' : 'Run GSEA'}
            </Button>
          </div>
        {/if}
      </CardContent>
    </Card>
  {/if}

  {#if hasRun}
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm text-muted-foreground">
        {resultCount} terms tested · {elapsedMs.toFixed(0)} ms
      </span>
      <div class="ml-auto inline-flex overflow-hidden rounded-md border">
        <button
          type="button"
          onclick={() => (viewMode = 'table')}
          class={cn(
            'inline-flex items-center gap-1 px-2 py-1 text-xs transition-colors',
            viewMode === 'table' ? 'bg-accent text-accent-foreground' : 'bg-card hover:bg-muted/50',
          )}
        >
          <TableIcon class="h-3 w-3" />
          Table
        </button>
        <button
          type="button"
          onclick={() => (viewMode = 'plot')}
          class={cn(
            'inline-flex items-center gap-1 border-l px-2 py-1 text-xs transition-colors',
            viewMode === 'plot' ? 'bg-accent text-accent-foreground' : 'bg-card hover:bg-muted/50',
          )}
        >
          <CircleDot class="h-3 w-3" />
          Plot
        </button>
      </div>
      <Button variant="outline" size="sm" onclick={exportTsv}>
        <Download class="h-3 w-3" />
        TSV
      </Button>
      {#if viewMode === 'plot'}
        <PlotExportMenu getSvg={() => plotSvg} baseName="gmt_{mode}" />
      {/if}
    </div>

    {#if resultCount === 0}
      <Card>
        <CardContent class="pt-6 text-sm text-muted-foreground">
          No terms passed the filter for your input. With small gene lists, lower the input
          threshold or check that your GMT gene IDs resolve (sequence names, symbols, and WBGene IDs
          all work). For GSEA, sets smaller than min size 5 are dropped.
        </CardContent>
      </Card>
    {:else if viewMode === 'plot'}
      <div class="rounded-lg border bg-card p-3">
        {#if enrichResults}
          <EnrichmentDotPlot results={enrichResults} bind:svgEl={plotSvg} />
        {:else if gseaResults}
          <GseaDotPlot results={gseaResults} bind:svgEl={plotSvg} />
        {/if}
      </div>
    {:else}
      <div class="overflow-x-auto rounded-lg border bg-card">
        <table class="w-full text-sm">
          <thead class="border-b bg-card">
            <tr>
              <th
                class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Set
              </th>
              {#if enrichResults}
                <th
                  class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                  >k / n</th
                >
                <th
                  class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                  >K / N</th
                >
                <th
                  class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                  >fold</th
                >
              {:else}
                <th
                  class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                  >size</th
                >
                <th
                  class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                  >NES</th
                >
              {/if}
              <th
                class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >p</th
              >
              <th
                class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >q (BH)</th
              >
            </tr>
          </thead>
          <tbody>
            {#if enrichResults}
              {#each enrichResults as r, i (r.term_id + ':' + i)}
                <tr class="border-b last:border-b-0 hover:bg-muted/30">
                  <td class="px-3 py-1.5 align-top">
                    <span class="text-sm">{r.name}</span>
                    {#if r.q <= SIG}
                      <Badge
                        variant="default"
                        class="ml-2 bg-accent py-0 text-[0.55rem] text-accent-foreground hover:bg-accent"
                      >
                        significant
                      </Badge>
                    {/if}
                  </td>
                  <td class="px-3 py-1.5 text-right font-mono text-xs tabular-nums"
                    >{r.k} / {r.n}</td
                  >
                  <td
                    class="px-3 py-1.5 text-right font-mono text-xs tabular-nums text-muted-foreground"
                    >{r.K} / {r.N}</td
                  >
                  <td class="px-3 py-1.5 text-right font-mono text-xs tabular-nums"
                    >{r.fold.toFixed(2)}×</td
                  >
                  <td class="px-3 py-1.5 text-right font-mono text-xs tabular-nums"
                    >{r.p < 0.01 ? r.p.toExponential(2) : r.p.toFixed(3)}</td
                  >
                  <td
                    class={cn(
                      'px-3 py-1.5 text-right font-mono text-xs tabular-nums',
                      r.q <= SIG ? 'font-semibold' : 'text-muted-foreground',
                    )}
                  >
                    {r.q < 0.01 ? r.q.toExponential(2) : r.q.toFixed(3)}
                  </td>
                </tr>
              {/each}
            {:else if gseaResults}
              {#each gseaResults as r, i (r.term_id + ':' + i)}
                <tr class="border-b last:border-b-0 hover:bg-muted/30">
                  <td class="px-3 py-1.5 align-top">
                    <span class="text-sm">{r.name}</span>
                    {#if r.q <= SIG}
                      <Badge
                        variant="default"
                        class="ml-2 bg-accent py-0 text-[0.55rem] text-accent-foreground hover:bg-accent"
                      >
                        significant
                      </Badge>
                    {/if}
                  </td>
                  <td class="px-3 py-1.5 text-right font-mono text-xs tabular-nums">{r.size}</td>
                  <td
                    class="px-3 py-1.5 text-right font-mono text-xs tabular-nums {r.nes >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-rose-700 dark:text-rose-400'}"
                  >
                    {r.nes.toFixed(2)}
                  </td>
                  <td class="px-3 py-1.5 text-right font-mono text-xs tabular-nums"
                    >{r.p < 0.01 ? r.p.toExponential(2) : r.p.toFixed(3)}</td
                  >
                  <td
                    class={cn(
                      'px-3 py-1.5 text-right font-mono text-xs tabular-nums',
                      r.q <= SIG ? 'font-semibold' : 'text-muted-foreground',
                    )}
                  >
                    {r.q < 0.01 ? r.q.toExponential(2) : r.q.toFixed(3)}
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>
