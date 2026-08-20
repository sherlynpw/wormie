<script lang="ts">
  import { untrack } from 'svelte';
  import { runGSEA, type GseaKind, type GseaResult, type GseaInput } from '$lib/db/client';
  import { collapseTerms, type CollapseGroup } from '$lib/term-collapse';
  import { fmtP } from '$lib/format';
  import { termHref } from '$lib/term-link';
  import { downloadTsv, downloadBlob } from '$lib/download';
  import { getGeneNames } from '$lib/queries';
  import { KEGG_ENABLED } from '$lib/config';
  import {
    rankedHash,
    keyFor,
    getCached,
    setCached,
    recordRecentRun,
    storeRanked,
  } from '$lib/gsea-cache';
  import { encodeBundle, buildShareUrl } from '$lib/bundle';
  import { buildGseaReport, downloadMarkdown } from '$lib/report';
  import ControlHint from '$lib/components/ControlHint.svelte';
  import { Card, CardContent } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import Download from 'lucide-svelte/icons/download';
  import TableIcon from 'lucide-svelte/icons/table';
  import CircleDot from 'lucide-svelte/icons/circle-dot';
  import { toast } from 'svelte-sonner';
  import GenePill from '$lib/components/GenePill.svelte';
  import GseaDotPlot from '$lib/components/GseaDotPlot.svelte';
  import EnrichmentHeatmap from '$lib/components/EnrichmentHeatmap.svelte';
  import LayoutGrid from 'lucide-svelte/icons/layout-grid';
  import { resolve } from '$app/paths';
  import SaveDatasetButton from '$lib/components/SaveDatasetButton.svelte';
  import { goto } from '$app/navigation';
  import { buildIdsQuery } from '$lib/share';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import GseaEnrichmentPlot from '$lib/components/GseaEnrichmentPlot.svelte';
  import PlotExportMenu from '$lib/components/PlotExportMenu.svelte';

  let {
    ranked,
    deeplinkKind = null,
    deeplinkTerm = null,
    onResults,
    imported,
  }: {
    ranked: GseaInput[];
    deeplinkKind?: string | null;
    deeplinkTerm?: string | null;
    // Called whenever live results change for session-blob capture (restore + UpSet).
    onResults?: (results: Partial<Record<GseaKind, GseaResult[]>>) => void;
    // Pre-computed results from a saved Session; component skips running and renders directly
    // (mirrors EnrichmentResults imported flow). One-shot: subsequent live runs override.
    imported?: Partial<Record<GseaKind, GseaResult[]>>;
  } = $props();

  const ALL_KINDS: { key: GseaKind; label: string }[] = [
    { key: 'go', label: 'Gene Ontology' },
    { key: 'phenotype', label: 'Phenotypes' },
    { key: 'disease', label: 'Diseases' },
    { key: 'wormcat', label: 'WormCat' },
    { key: 'neuronal', label: 'Neuronal class' },
    { key: 'tissue', label: 'Tissues' },
    { key: 'cell-type', label: 'Neurons (CeNGEN)' },
    { key: 'synaptogenesis', label: 'Synaptogenesis' },
    { key: 'pathway', label: 'KEGG' },
  ];
  // KEGG excluded from the build drops the pathway category (license).
  const KINDS = ALL_KINDS.filter((k) => KEGG_ENABLED || k.key !== 'pathway');

  let active = $state<GseaKind>('go');
  let nperm = $state<number>(1000);
  let multilevel = $state<boolean>(true);
  let minSize = $state<number>(15);
  let maxSize = $state<number>(500);
  let results = $state<Record<GseaKind, GseaResult[] | null>>({
    go: null,
    phenotype: null,
    wormcat: null,
    neuronal: null,
    tissue: null,
    disease: null,
    'cell-type': null,
    synaptogenesis: null,
    pathway: null,
  });
  let loading = $state<Record<GseaKind, boolean>>({
    go: false,
    phenotype: false,
    wormcat: false,
    neuronal: false,
    tissue: false,
    disease: false,
    'cell-type': false,
    synaptogenesis: false,
    pathway: false,
  });
  let elapsed = $state<Record<GseaKind, number>>({
    go: 0,
    phenotype: 0,
    wormcat: 0,
    neuronal: 0,
    tissue: 0,
    disease: 0,
    'cell-type': 0,
    synaptogenesis: 0,
    pathway: 0,
  });
  let expanded = $state<Record<string, boolean>>({});

  // Bubble live results up for session-blob capture; drop null/empty kinds.
  $effect(() => {
    if (!onResults) return;
    const out: Partial<Record<GseaKind, GseaResult[]>> = {};
    for (const k of Object.keys(results) as GseaKind[]) {
      const r = results[k];
      if (r && r.length > 0) out[k] = r;
    }
    onResults(out);
  });
  // Lazy WBGene → canonical name resolution for leading-edge pills; one batch query per expand
  // beats a per-pill fetch round-trip.
  const nameMap = new SvelteMap<string, string | null>();
  const seenNamesFor = new SvelteSet<string>();

  async function ensureNames(ids: string[]) {
    const missing = ids.filter((id) => !nameMap.has(id));
    if (missing.length === 0) return;
    const res = await getGeneNames(missing);
    for (const id of missing) {
      nameMap.set(id, res.get(id)?.gene_name ?? null);
    }
  }

  async function sendGenes(genes: string[], to: 'enrichment' | 'nta') {
    const q = await buildIdsQuery(genes);
    await goto(resolve(`/${to}`) + `?${q}`);
  }

  function toggleExpandedAndResolve(termId: string, leadingEdge: string[]) {
    toggleExpanded(termId);
    if (!seenNamesFor.has(termId)) {
      seenNamesFor.add(termId);
      void ensureNames(leadingEdge);
    }
  }
  let loadToken = 0;
  let viewMode = $state<'table' | 'plot' | 'heatmap'>('table');
  let plotSvg = $state<SVGSVGElement | null>(null);
  let plotSort = $state<'nes' | 'q' | 'size'>('nes');

  $effect(() => {
    const fp = ranked.length + ':' + (ranked[0]?.gene ?? '');
    void fp;
    untrack(() => {
      results = {
        go: null,
        phenotype: null,
        wormcat: null,
        neuronal: null,
        tissue: null,
        disease: null,
        'cell-type': null,
        synaptogenesis: null,
        pathway: null,
      };
      expanded = {};
      // Switch to deeplinked kind before running so we don't compute the default kind first.
      if (deeplinkKind && KINDS.some((k) => k.key === deeplinkKind)) {
        active = deeplinkKind as GseaKind;
      }
      runFor(active);
    });
  });

  // Session restore: populate live table from `imported` when no ranked list exists yet; the first
  // populated kind becomes active. A live run clears this via the effect above.
  let consumedImported = $state(false);
  $effect(() => {
    if (consumedImported || !imported) return;
    if (ranked.length > 0) return; // live run is in charge
    untrack(() => {
      let firstKind: GseaKind | null = null;
      for (const k of KINDS) {
        const r = imported?.[k.key];
        if (r && r.length > 0) {
          results[k.key] = r;
          if (!firstKind) firstKind = k.key;
        }
      }
      if (firstKind) active = firstKind;
      consumedImported = true;
    });
  });

  // Deeplink term reveal: once results arrive for the active kind, expand the matching row and
  // scroll it into view. Runs once per deeplinkTerm so manual collapses afterward stick.
  let appliedDeeplink = $state<string | null>(null);
  $effect(() => {
    const term = deeplinkTerm;
    const k = active;
    const r = results[k];
    if (!term || !r || r.length === 0) return;
    if (appliedDeeplink === term) return;
    const hit = r.find((row) => row.term_id === term);
    if (!hit) return;
    untrack(() => {
      expanded[term] = true;
      void ensureNames(hit.leading_edge);
      appliedDeeplink = term;
      // Scroll after the row mounts.
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-term-row="${CSS.escape(term)}"]`);
        if (el) (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  });

  $effect(() => {
    const k = active;
    untrack(() => {
      if (ranked.length >= 10 && results[k] === null && !loading[k]) {
        runFor(k);
      }
    });
  });

  async function runFor(kind: GseaKind) {
    if (ranked.length < 10) return;
    const my = ++loadToken;
    loading[kind] = true;
    try {
      const rh = await rankedHash(ranked);
      const cacheKey = await keyFor({
        kind,
        minSize,
        maxSize,
        weight: 1,
        nperm,
        multilevel,
        rankedHash: rh,
      });
      const cached = await getCached(cacheKey);
      if (cached) {
        if (my !== loadToken && results[kind] !== null) return;
        results[kind] = cached.results;
        elapsed[kind] = cached.elapsedMs; // original wall-time shown as a hint
        return;
      }
      const { results: r, elapsedMs } = await runGSEA(ranked, kind, {
        minSize,
        maxSize,
        weight: 1,
        nperm,
        multilevel,
      });
      if (my !== loadToken && results[kind] !== null) return;
      results[kind] = r;
      elapsed[kind] = elapsedMs;
      void setCached(cacheKey, r, elapsedMs);
      recordRecentRun({
        cacheKey,
        kind,
        rankedHash: rh,
        n_genes: ranked.length,
        n_results: r.length,
        n_significant: r.filter((x) => x.q <= 0.25).length,
        params: { minSize, maxSize, nperm, multilevel },
        at: Date.now(),
      });
      void storeRanked(rh, ranked);
    } catch (e) {
      toast.error('GSEA failed', { description: String(e) });
      results[kind] = [];
    } finally {
      loading[kind] = false;
    }
  }

  function rerun() {
    results = {
      go: null,
      phenotype: null,
      wormcat: null,
      neuronal: null,
      tissue: null,
      disease: null,
      'cell-type': null,
      synaptogenesis: null,
      pathway: null,
    };
    runFor(active);
  }

  function exportTsv() {
    const r = activeResults;
    if (r.length === 0) {
      toast.error('Nothing to export');
      return;
    }
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const qTag = effQ >= 1 ? 'all' : `q${effQ}`;
    downloadTsv(
      `gsea_${active}_${qTag}_${ts}.tsv`,
      [
        { header: 'term_id', get: (row) => row.term_id },
        { header: 'name', get: (row) => row.name },
        { header: 'namespace', get: (row) => row.namespace ?? '' },
        { header: 'size', get: (row) => row.size },
        { header: 'es', get: (row) => row.es.toFixed(4) },
        { header: 'nes', get: (row) => row.nes.toFixed(4) },
        { header: 'p', get: (row) => row.p.toExponential(3) },
        { header: 'q', get: (row) => row.q.toExponential(3) },
        { header: 'leading_edge', get: (row) => row.leading_edge.join('|') },
      ],
      r,
    );
    toast.success('Exported', { description: `${r.length} ${active} terms` });
  }

  async function copyTermLink(termId: string) {
    if (ranked.length === 0) {
      toast.error('Nothing to share', { description: 'Ranked list is empty.' });
      return;
    }
    try {
      const enc = await encodeBundle({ v: 1, ranked });
      const url = buildShareUrl(enc, { term: termId, kind: active });
      await navigator.clipboard.writeText(url);
      toast.success('Term link copied', { description: `Lands on ${termId} (${active})` });
    } catch (e) {
      toast.error('Could not build link', { description: String(e) });
    }
  }

  async function exportReport() {
    const r = activeResults;
    if (r.length === 0) {
      toast.error('Nothing to export');
      return;
    }
    const md = await buildGseaReport({
      kind: active,
      nGenes: ranked.length,
      params: { minSize, maxSize, nperm, multilevel },
      results: r,
    });
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    downloadMarkdown(md, `gsea_${active}_${effQ >= 1 ? 'all' : `q${effQ}`}_${ts}.md`);
    toast.success('Report exported', { description: `${r.length} ${active} terms` });
  }

  // JSON bundle: per-term leading edges + NES/q for /gsea/intersect cross-comparison; lighter
  // than TSV (no descriptions, just IDs).
  // Shared by the download and the save-to-datasets paths so a stored bundle is
  // byte-identical to a downloaded one.
  function buildBundleJson(): string {
    const r = results[active] ?? [];
    if (r.length === 0) return '';
    const payload = {
      format: 'wb.gsea.bundle.v1',
      kind: active,
      params: { minSize, maxSize, weight: 1, nperm, multilevel },
      n_genes: ranked.length,
      built_at: new Date().toISOString(),
      terms: r.map((row) => ({
        term_id: row.term_id,
        name: row.name,
        namespace: row.namespace ?? null,
        size: row.size,
        nes: row.nes,
        q: row.q,
        leading_edge: row.leading_edge,
      })),
    };
    return JSON.stringify(payload, null, 2);
  }

  function exportJsonBundle() {
    const json = buildBundleJson();
    if (!json) {
      toast.error('Nothing to export');
      return;
    }
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    downloadBlob(
      new Blob([json], { type: 'application/json' }),
      `gsea_${active}_${ts}.bundle.json`,
    );
    toast.success('Bundle exported', {
      description: `${(results[active] ?? []).length} ${active} terms`,
    });
  }

  const SIG_THRESHOLD = 0.25;
  // Filtered here so loosening the cutoff needs no recompute.
  let qCutoff = $state(SIG_THRESHOLD);
  // Clearing the input yields undefined, which would filter everything out.
  const effQ = $derived(Number.isFinite(qCutoff) ? qCutoff : 1);
  const allResults = $derived(results[active] ?? []);
  const activeResults = $derived(effQ >= 1 ? allResults : allResults.filter((r) => r.q <= effQ));
  const significantCount = $derived(allResults.filter((r) => r.q <= SIG_THRESHOLD).length);

  // REVIGO-style collapse by leading-edge Jaccard similarity. GOALL-propagated parent/child terms
  // often share most leading-edge genes; collapse de-duplicates them. Proxy for Resnik IC, but
  // works for any term kind without an ontology IC table.
  let collapseRedundant = $state<boolean>(true);
  let jaccardCutoff = $state<number>(0.5);

  type Group = CollapseGroup<GseaResult>;

  const groupedResults = $derived.by<Group[]>(() => {
    if (!collapseRedundant || activeResults.length === 0) {
      return activeResults.map((r) => ({ rep: r, children: [] }));
    }
    return collapseTerms(activeResults, {
      cutoff: jaccardCutoff,
      geneSetOf: (r) => r.leading_edge,
      scoreOf: (r) => r.q,
      tiebreaker: (r) => r.p,
      partitionOf: (r) => (r.es >= 0 ? 1 : -1), // never merge up- and down-regulated sets
    });
  });

  const displayCount = $derived(groupedResults.length);
  const collapsedCount = $derived(groupedResults.reduce((acc, g) => acc + g.children.length, 0));

  function toggleExpanded(term_id: string) {
    expanded = { ...expanded, [term_id]: !expanded[term_id] };
  }
</script>

<div class="space-y-3">
  <div class="flex flex-wrap items-center gap-2">
    {#each KINDS as k (k.key)}
      <button
        type="button"
        onclick={() => (active = k.key)}
        class={cn(
          'rounded-md px-3 py-1.5 text-sm transition-colors',
          active === k.key
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50',
        )}
      >
        {k.label}
      </button>
    {/each}
    <div
      class="ml-auto flex flex-wrap items-center justify-end gap-1.5 text-xs text-muted-foreground"
    >
      <label class="inline-flex items-center gap-1">
        size
        <input
          type="number"
          min="1"
          max="500"
          bind:value={minSize}
          class="w-11 rounded border bg-card px-1 py-0.5 font-mono text-xs"
        />
        <span>–</span>
        <input
          type="number"
          min="50"
          max="20000"
          bind:value={maxSize}
          class="w-14 rounded border bg-card px-1 py-0.5 font-mono text-xs"
        />
        <ControlHint id="gsea-size" title="Gene-set size filter">
          Subramanian / fgsea convention is <b>15 – 500</b>. Smaller than 15 inflates false
          positives from tiny sets; larger than 500 tests over-generic terms.
        </ControlHint>
      </label>
      <label class="inline-flex items-center gap-1">
        perms
        <select bind:value={nperm} class="rounded border bg-card px-1 py-0.5 font-mono text-xs">
          <option value={500}>500</option>
          <option value={1000}>1000</option>
          <option value={2500}>2500</option>
          <option value={5000}>5000</option>
        </select>
        <ControlHint id="gsea-perms" title="Permutations">
          Controls the precision of mid-range p-values. Tail p-values are handled separately by <i
            >multilevel</i
          > so you don't need to crank this above 2500 for most analyses.
        </ControlHint>
      </label>
      <label class="inline-flex cursor-pointer items-center gap-1">
        <input type="checkbox" bind:checked={multilevel} class="rounded" />
        multilevel
        <ControlHint id="gsea-multilevel" title="Adaptive multilevel">
          Refines tail p-values past the <code>1/(nperm+1)</code> floor via Korotkevich adaptive
          multilevel splitting (fgsea). Adds ~<code>M·log₂(1/p)</code> work per floor-hitting term. Match
          fgseaMultilevel's behavior.
        </ControlHint>
      </label>
      <label class="inline-flex cursor-pointer items-center gap-1">
        <input type="checkbox" bind:checked={collapseRedundant} class="rounded" />
        collapse
        <ControlHint id="gsea-collapse" title="REVIGO-style collapse">
          Groups terms whose leading-edge gene lists overlap above the Jaccard cutoff (same sign
          only). The most-significant term becomes the representative; redundant siblings get folded
          under it. Data-driven proxy for proper semantic similarity (Resnik IC) but works for any
          term kind.
        </ControlHint>
      </label>
      {#if collapseRedundant}
        <label
          class="inline-flex items-center gap-1"
          title="Jaccard cutoff for grouping. Lower = more aggressive collapse."
        >
          J≥
          <input
            type="number"
            step="0.05"
            min="0.1"
            max="0.95"
            bind:value={jaccardCutoff}
            class="w-12 rounded border bg-card px-1 py-0.5 font-mono text-xs"
          />
        </label>
      {/if}
      <Button
        variant="outline"
        size="sm"
        onclick={rerun}
        disabled={loading[active] || ranked.length < 10}
      >
        Re-run
      </Button>
      {#if ranked.length < 10}
        <span>Need ≥ 10 ranked genes.</span>
      {:else if loading[active]}
        <span>Computing... ({nperm} perms)</span>
      {:else if results[active]}
        <span>
          <span class="font-semibold tabular-nums text-foreground">{significantCount}</span>
          significant (q ≤ 0.25) of {allResults.length} tested
        </span>
        <label class="inline-flex items-center gap-1" title="Hide terms above this q-value">
          <span>show q ≤</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            bind:value={qCutoff}
            class="h-6 w-16 rounded border border-input bg-background px-1 font-mono text-xs"
          />
          {#if effQ < 1}
            <button
              type="button"
              onclick={() => (qCutoff = 1)}
              class="rounded border px-1.5 py-0.5 text-[0.7rem] transition-colors hover:bg-accent"
            >
              show all
            </button>
          {:else}
            <button
              type="button"
              onclick={() => (qCutoff = SIG_THRESHOLD)}
              class="rounded border px-1.5 py-0.5 text-[0.7rem] transition-colors hover:bg-accent"
            >
              significant only
            </button>
          {/if}
        </label>
        {#if collapseRedundant && collapsedCount > 0}
          <span class="text-muted-foreground"
            >(showing {displayCount}; {collapsedCount} folded)</span
          >
        {/if}
        <span class="font-mono">· {elapsed[active].toFixed(0)} ms</span>
        <div class="inline-flex overflow-hidden rounded-md border">
          <button
            type="button"
            onclick={() => (viewMode = 'table')}
            class={cn(
              'inline-flex items-center gap-1 px-2 py-1 text-xs transition-colors',
              viewMode === 'table'
                ? 'bg-accent text-accent-foreground'
                : 'bg-card hover:bg-muted/50',
            )}
            title="Table view"
          >
            <TableIcon class="h-3 w-3" />
            Table
          </button>
          <button
            type="button"
            onclick={() => (viewMode = 'plot')}
            class={cn(
              'inline-flex items-center gap-1 border-l px-2 py-1 text-xs transition-colors',
              viewMode === 'plot'
                ? 'bg-accent text-accent-foreground'
                : 'bg-card hover:bg-muted/50',
            )}
            title="Dot plot"
          >
            <CircleDot class="h-3 w-3" />
            Plot
          </button>
          <button
            type="button"
            onclick={() => {
              viewMode = 'heatmap';
              // Pre-resolve gene names for top-25 heatmap rows.
              const top = activeResults
                .slice()
                .sort((a, b) => a.q - b.q)
                .slice(0, 25);
              for (const r of top) {
                if (!seenNamesFor.has(r.term_id)) {
                  seenNamesFor.add(r.term_id);
                  void ensureNames(r.leading_edge);
                }
              }
            }}
            class={cn(
              'inline-flex items-center gap-1 border-l px-2 py-1 text-xs transition-colors',
              viewMode === 'heatmap'
                ? 'bg-accent text-accent-foreground'
                : 'bg-card hover:bg-muted/50',
            )}
            title="Term × leading-edge gene heatmap"
            disabled={activeResults.length === 0}
          >
            <LayoutGrid class="h-3 w-3" />
            Heatmap
          </button>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={activeResults.length === 0}
          onclick={exportTsv}
        >
          <Download class="h-3 w-3" />
          TSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={activeResults.length === 0}
          onclick={exportJsonBundle}
          title="Download a JSON bundle to combine with other GSEA runs in /gsea/intersect"
        >
          <Download class="h-3 w-3" />
          JSON
        </Button>
        <SaveDatasetButton
          type="gsea-bundle"
          body={buildBundleJson}
          defaultName={`${active} bundle`}
          disabled={allResults.length === 0}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={activeResults.length === 0}
          onclick={exportReport}
          title="Download a Markdown report (significant terms + leading edges + data-freshness footer)"
        >
          <Download class="h-3 w-3" />
          Report
        </Button>
        {#if viewMode === 'plot' && activeResults.length > 0}
          <label class="inline-flex items-center gap-1 text-xs">
            sort
            <select bind:value={plotSort} class="rounded border bg-card px-1 py-0.5 text-xs">
              <option value="nes">NES (up at top)</option>
              <option value="q">q (significance)</option>
              <option value="size">set size</option>
            </select>
          </label>
          <PlotExportMenu getSvg={() => plotSvg} baseName={`gsea_${active}`} />
        {/if}
      {/if}
    </div>
  </div>

  {#if ranked.length < 10 && activeResults.length === 0}
    <Card>
      <CardContent class="pt-6 text-sm text-muted-foreground">
        GSEA needs a ranked list of at least 10 genes with numeric scores.
      </CardContent>
    </Card>
  {:else if loading[active] && !results[active]}
    <div class="py-6 text-sm text-muted-foreground">
      Computing {active} GSEA ({nperm} permutations)...
    </div>
  {:else if activeResults.length === 0}
    <Card>
      <CardContent class="pt-6 text-sm text-muted-foreground">
        {#if allResults.length > 0}
          None of the {allResults.length.toLocaleString()}
          tested {active} terms reach q ≤ {effQ}.
          <button
            type="button"
            onclick={() => (qCutoff = 1)}
            class="ml-1 underline underline-offset-2 hover:text-foreground"
          >
            Show all tested terms
          </button>
        {:else}
          No enriched {active} terms found for this ranking.
        {/if}
      </CardContent>
    </Card>
  {:else if viewMode === 'plot'}
    <div class="rounded-lg border bg-card p-3">
      <GseaDotPlot
        results={activeResults}
        linkFor={(r) => termHref(active, r.term_id)}
        sortBy={plotSort}
        bind:svgEl={plotSvg}
      />
    </div>
  {:else if viewMode === 'heatmap'}
    <EnrichmentHeatmap
      results={activeResults.map((r) => ({
        term_id: r.term_id,
        name: r.name,
        q: r.q,
        overlap: r.leading_edge,
      }))}
      geneLabel={(g) => nameMap.get(g) ?? g}
      title="Term × leading-edge gene (top 25 by q)"
      exportName={`gsea-heatmap_${active}`}
    />
  {:else}
    <div class="overflow-x-auto rounded-lg border bg-card">
      <table class="w-full text-sm">
        <thead class="border-b bg-card">
          <tr>
            <th
              class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Term
            </th>
            <th
              class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
              >size</th
            >
            <th
              class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
              >ES</th
            >
            <th
              class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
              >NES</th
            >
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
          {#each groupedResults as group, i (group.rep.term_id + ':' + i)}
            {@const r = group.rep}
            {@const href = termHref(active, r.term_id)}
            {@const isOpen = expanded[r.term_id]}
            <tr
              data-term-row={r.term_id}
              class="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
              onclick={() => toggleExpandedAndResolve(r.term_id, r.leading_edge)}
            >
              <td class="px-3 py-1.5 align-top">
                <div class="flex flex-wrap items-baseline gap-2">
                  {#if href}
                    <a
                      href={resolve(href as '/')}
                      class="font-mono text-[0.65rem] text-primary hover:underline"
                      title={r.term_id}
                      onclick={(e) => e.stopPropagation()}
                    >
                      {r.term_id}
                    </a>
                  {:else}
                    <span class="font-mono text-[0.65rem] text-muted-foreground">{r.term_id}</span>
                  {/if}
                  <span class="text-sm">{r.name}</span>
                  {#if r.namespace}
                    <Badge variant="muted" class="py-0 text-[0.55rem]">{r.namespace}</Badge>
                  {/if}
                  {#if r.q <= 0.05}
                    <Badge
                      variant="default"
                      class="bg-accent py-0 text-[0.55rem] text-accent-foreground hover:bg-accent"
                    >
                      significant
                    </Badge>
                  {:else if r.q <= SIG_THRESHOLD}
                    <Badge variant="outline" class="py-0 text-[0.55rem]">marginal</Badge>
                  {/if}
                  {#if r.es >= 0}
                    <Badge variant="muted" class="py-0 text-[0.55rem]">up</Badge>
                  {:else}
                    <Badge variant="muted" class="py-0 text-[0.55rem]">down</Badge>
                  {/if}
                  {#if group.children.length > 0}
                    <Badge
                      variant="outline"
                      class="py-0 text-[0.55rem]"
                      title="Similar terms folded under this one"
                    >
                      +{group.children.length} similar
                    </Badge>
                  {/if}
                </div>
              </td>
              <td class="px-3 py-1.5 text-right align-top font-mono text-xs tabular-nums">
                {r.size}
              </td>
              <td class="px-3 py-1.5 text-right align-top font-mono text-xs tabular-nums">
                {r.es.toFixed(3)}
              </td>
              <td
                class="px-3 py-1.5 text-right align-top font-mono text-xs tabular-nums {r.nes >= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-700 dark:text-rose-400'}"
              >
                {r.nes.toFixed(2)}
              </td>
              <td
                class="whitespace-nowrap px-3 py-1.5 text-right align-top font-mono text-xs tabular-nums"
              >
                {fmtP(r.p)}
              </td>
              <td
                class={cn(
                  'whitespace-nowrap px-3 py-1.5 text-right align-top font-mono text-xs tabular-nums',
                  r.q <= SIG_THRESHOLD ? 'font-semibold' : 'text-muted-foreground',
                )}
              >
                {fmtP(r.q)}
              </td>
            </tr>
            {#if isOpen}
              <tr class="border-b bg-muted/20 last:border-b-0">
                <td class="space-y-3 px-3 py-2" colspan="6">
                  <GseaEnrichmentPlot
                    {ranked}
                    geneSet={r.members ?? r.leading_edge}
                    leadingEdge={r.leading_edge}
                    es={r.es}
                    nes={r.nes}
                    p={r.p}
                    q={r.q}
                    title={r.name}
                    exportName={`gsea-es_${r.term_id}`}
                  />
                  <div>
                    <div class="mb-1.5 flex items-baseline gap-2">
                      <div
                        class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        Leading edge ({r.leading_edge.length} genes)
                      </div>
                      <button
                        type="button"
                        class="ml-auto text-[0.65rem] text-primary hover:underline"
                        onclick={(e) => {
                          e.stopPropagation();
                          void copyTermLink(r.term_id);
                        }}
                        title="Copy a URL that opens this analysis with this term expanded"
                      >
                        copy term link
                      </button>
                      <a
                        href={resolve(`/?q=${encodeURIComponent(r.leading_edge.join(','))}`)}
                        class="text-[0.65rem] text-primary hover:underline"
                        onclick={(e) => e.stopPropagation()}
                        title="Open these genes in the browser as a filtered gene list"
                      >
                        open in gene browser →
                      </a>
                      <button
                        type="button"
                        class="text-[0.65rem] text-primary hover:underline"
                        onclick={(e) => {
                          e.stopPropagation();
                          void sendGenes(r.leading_edge, 'enrichment');
                        }}
                        title="Run over-representation on the leading-edge genes"
                      >
                        test for enrichment →
                      </button>
                      <button
                        type="button"
                        class="text-[0.65rem] text-primary hover:underline"
                        onclick={(e) => {
                          e.stopPropagation();
                          void sendGenes(r.leading_edge, 'nta');
                        }}
                        title="Test whether the leading-edge genes interact with each other"
                      >
                        test connectivity →
                      </button>
                    </div>
                    <div class="flex flex-wrap gap-1">
                      {#each r.leading_edge as g (g)}
                        <GenePill id={g} name={nameMap.get(g) ?? null} />
                      {/each}
                    </div>
                  </div>
                  {#if group.children.length > 0}
                    <div>
                      <div
                        class="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        Similar terms ({group.children.length})
                      </div>
                      <div class="space-y-1">
                        {#each group.children as c (c.term_id)}
                          {@const cHref = termHref(active, c.term_id)}
                          <div class="flex flex-wrap items-baseline gap-2 text-xs">
                            {#if cHref}
                              <a
                                href={resolve(cHref as '/')}
                                class="font-mono text-[0.65rem] text-primary hover:underline"
                                onclick={(e) => e.stopPropagation()}>{c.term_id}</a
                              >
                            {:else}
                              <span class="font-mono text-[0.65rem] text-muted-foreground"
                                >{c.term_id}</span
                              >
                            {/if}
                            <span>{c.name}</span>
                            <span class="ml-auto font-mono tabular-nums text-muted-foreground">
                              size {c.size} · NES {c.nes.toFixed(2)} · q {fmtP(c.q)}
                            </span>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
