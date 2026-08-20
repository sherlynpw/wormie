<script lang="ts">
  import { untrack } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { runEnrichment, type EnrichmentKind, type EnrichmentResult } from '$lib/enrichment';
  import { getGeneNames } from '$lib/queries';
  import { KEGG_ENABLED } from '$lib/config';
  import EnrichmentDotPlot from '$lib/components/EnrichmentDotPlot.svelte';
  import EnrichmentHeatmap from '$lib/components/EnrichmentHeatmap.svelte';
  import GenePill from '$lib/components/GenePill.svelte';
  import PlotExportMenu from '$lib/components/PlotExportMenu.svelte';
  import { Card, CardContent } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import Download from 'lucide-svelte/icons/download';
  import TableIcon from 'lucide-svelte/icons/table';
  import CircleDot from 'lucide-svelte/icons/circle-dot';
  import Share2 from 'lucide-svelte/icons/share-2';
  import LayoutGrid from 'lucide-svelte/icons/layout-grid';
  import EnrichmentCnetplot from '$lib/components/EnrichmentCnetplot.svelte';
  import { toast } from 'svelte-sonner';
  import { datasets } from '$lib/stores/datasets.svelte';
  import ControlHint from '$lib/components/ControlHint.svelte';
  import { resolve } from '$app/paths';
  import X from 'lucide-svelte/icons/x';
  import { fmtP } from '$lib/format';
  import { termHref } from '$lib/term-link';
  import { parseGeneList } from '$lib/gene-parse';
  import { downloadTsv } from '$lib/download';
  import { collapseTerms, type CollapseGroup } from '$lib/term-collapse';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import ChevronDown from 'lucide-svelte/icons/chevron-down';

  let {
    ids,
    imported,
    onHighlight,
    onResults,
    initialBackground = null,
  }: {
    ids: string[];
    imported?: Partial<Record<EnrichmentKind, EnrichmentResult[]>>;
    // Called on row click; parent uses this to spotlight term members on a sibling visual
    // (e.g. the volcano on /enrichment). Null clears the highlight.
    onHighlight?: (sel: { term_id: string; kind: EnrichmentKind } | null) => void;
    // Called whenever live results change so the parent can stash them in a saved Session
    // for restore without recomputing.
    onResults?: (results: Partial<Record<EnrichmentKind, EnrichmentResult[]>>) => void;
    // Null leaves the ORA default, the full annotated genome.
    initialBackground?: { genes: string[]; label: string } | null;
  } = $props();

  let highlightedRow = $state<string | null>(null);
  function toggleHighlight(r: EnrichmentResult) {
    if (!onHighlight) return;
    const key = active + ':' + r.term_id;
    if (highlightedRow === key) {
      highlightedRow = null;
      onHighlight(null);
    } else {
      highlightedRow = key;
      onHighlight({ term_id: r.term_id, kind: active });
    }
  }

  const isImported = $derived(!!imported);

  // Bubble result changes to parent for session-blob capture; drop null/empty kinds.
  $effect(() => {
    if (!onResults) return;
    const out: Partial<Record<EnrichmentKind, EnrichmentResult[]>> = {};
    for (const k of Object.keys(results) as EnrichmentKind[]) {
      const r = results[k];
      if (r && r.length > 0) out[k] = r;
    }
    onResults(out);
  });

  const ALL_KINDS: { key: EnrichmentKind; label: string }[] = [
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

  let active = $state<EnrichmentKind>('go');
  let viewMode = $state<'table' | 'plot' | 'cnet' | 'heatmap'>('table');
  // Lazy name resolution: a bulk upfront query over all overlaps froze the page on large input
  // sets (5-20k tokens in the fuzzy SQL path). Resolve only on expand, scoped to that term's hits.
  const geneNameMap: Map<string, string> = new SvelteMap();
  const resolvedTerms: Set<string> = new SvelteSet();
  function geneLabel(id: string): string {
    return geneNameMap.get(id) ?? id;
  }
  async function resolveOverlap(term_id: string, ids: string[]) {
    if (resolvedTerms.has(term_id)) return;
    resolvedTerms.add(term_id);
    if (ids.length === 0) return;
    const missing = ids.filter((id) => !geneNameMap.has(id));
    if (missing.length === 0) return;
    const meta = await getGeneNames(missing);
    for (const id of missing) {
      const m = meta.get(id);
      geneNameMap.set(id, m?.gene_name || m?.sequence_name || id);
    }
  }
  // On heatmap view, pre-resolve names for the top-25 rows; runs once per (active, kind) pair.
  $effect(() => {
    if (viewMode !== 'heatmap') return;
    const rows = activeResults;
    if (rows.length === 0) return;
    const top = rows
      .slice()
      .sort((a, b) => a.q - b.q)
      .slice(0, 25);
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const ids = new Set<string>();
    for (const r of top) for (const g of r.overlap) ids.add(g);
    untrack(() => {
      void resolveOverlap(`__heatmap:${active}`, [...ids]);
    });
  });
  let results = $state<Record<EnrichmentKind, EnrichmentResult[] | null>>({
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
  let loading = $state<Record<EnrichmentKind, boolean>>({
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
  let elapsed = $state<Record<EnrichmentKind, number>>({
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
  let loadToken = 0;
  let plotSvg = $state<SVGSVGElement | null>(null);
  let plotSort = $state<'q' | 'fold' | 'k'>('q');

  $effect(() => {
    if (imported) {
      const im = imported;
      untrack(() => {
        results = {
          go: im.go ?? [],
          phenotype: im.phenotype ?? [],
          wormcat: im.wormcat ?? [],
          neuronal: im.neuronal ?? [],
          tissue: im.tissue ?? [],
          disease: im.disease ?? [],
          'cell-type': im['cell-type'] ?? [],
          synaptogenesis: im.synaptogenesis ?? [],
          pathway: im.pathway ?? [],
        };
        // Prefer the first non-empty kind as the active tab
        const firstWithData = (KINDS.find((k) => (im[k.key] ?? []).length > 0) ?? KINDS[0]).key;
        active = firstWithData;
      });
      return;
    }
    const fp = ids.join(',');
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
      runFor(active);
    });
  });

  let customBackground = $state<string[]>([]);
  let backgroundLabel = $state<string>('');
  let appliedBackground = $state<string>('');

  $effect(() => {
    const bg = initialBackground;
    const key = bg ? `${bg.label}:${bg.genes.length}` : '';
    if (key === appliedBackground) return;
    appliedBackground = key;
    untrack(() => (bg ? setBackground(bg.genes, bg.label) : setBackground([], '')));
  });

  $effect(() => {
    if (isImported) return;
    const k = active;
    untrack(() => {
      if (ids.length >= 2 && results[k] === null && !loading[k]) {
        runFor(k);
      }
    });
  });

  async function runFor(kind: EnrichmentKind) {
    if (ids.length < 2) return;
    const my = ++loadToken;
    loading[kind] = true;
    try {
      const { results: r, elapsedMs } = await runEnrichment(ids, kind, {
        minK: 2,
        maxQ: 1,
        background: customBackground.length > 0 ? customBackground : undefined,
      });
      if (my !== loadToken && results[kind] !== null) return;
      results[kind] = r;
      elapsed[kind] = elapsedMs;
    } catch (e) {
      toast.error('Enrichment failed', { description: String(e) });
      results[kind] = [];
    } finally {
      loading[kind] = false;
    }
  }

  // Custom background for the hypergeometric universe; empty = full annotated genome (ORA default).
  function setBackground(genes: string[], label: string) {
    customBackground = genes;
    backgroundLabel = label;
    // Invalidate all kinds so they recompute against the new universe.
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
  function clearBackground() {
    setBackground([], '');
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
      `enrichment_${active}_${qTag}_${ts}.tsv`,
      [
        { header: 'term_id', get: (row) => row.term_id },
        { header: 'name', get: (row) => row.name },
        { header: 'namespace', get: (row) => row.namespace ?? '' },
        { header: 'k', get: (row) => row.k },
        { header: 'K', get: (row) => row.K },
        { header: 'n', get: (row) => row.n },
        { header: 'N', get: (row) => row.N },
        { header: 'fold', get: (row) => row.fold.toFixed(3) },
        { header: 'p', get: (row) => row.p.toExponential(3) },
        { header: 'q', get: (row) => row.q.toExponential(3) },
      ],
      r,
    );
    toast.success('Exported', { description: `${r.length} ${active} terms` });
  }

  const SIG_THRESHOLD = 0.05;
  // Filtered here, not in the worker, so loosening the cutoff needs no recompute.
  // BH correction runs over all candidates either way.
  let qCutoff = $state(SIG_THRESHOLD);
  // Clearing the input yields undefined, which would filter everything out.
  const effQ = $derived(Number.isFinite(qCutoff) ? qCutoff : 1);
  const allResults = $derived(results[active] ?? []);
  const activeResults = $derived(effQ >= 1 ? allResults : allResults.filter((r) => r.q <= effQ));
  const significantCount = $derived(allResults.filter((r) => r.q <= SIG_THRESHOLD).length);
  // Read off the results so the stated universe cannot drift from the one tested.
  const universeN = $derived(allResults[0]?.N ?? 0);
  const activeLabel = $derived(ALL_KINDS.find((k) => k.key === active)?.label ?? active);

  // ORA sanity: when n/N > 0.5 (input is most of the annotated universe), fold collapses to ~1x
  // and q-values become meaningless. Usually hit when a full DESeq2 table is pasted unfiltered.
  const universeWarning = $derived.by(() => {
    const first = allResults[0];
    if (!first || first.N === 0) return null;
    const ratio = first.n / first.N;
    if (ratio <= 0.5) return null;
    return { n: first.n, N: first.N, ratio };
  });

  // REVIGO-style collapse: groups terms by Jaccard similarity on overlap genes above `jaccardCutoff`;
  // best-q term becomes representative, redundant siblings fold under it.
  let collapseRedundant = $state<boolean>(true);
  let jaccardCutoff = $state<number>(0.5);
  // SvelteMap so toggling one row's expand state re-renders only THAT row; a plain object
  // reassignment invalidates every row in the {#each} (O(N) on each click).
  const expanded: Map<string, boolean> = new SvelteMap();

  type Group = CollapseGroup<EnrichmentResult>;

  const groupedResults = $derived.by<Group[]>(() => {
    if (!collapseRedundant || activeResults.length === 0) {
      return activeResults.map((r) => ({ rep: r, children: [] }));
    }
    // Imported clusterProfiler rows sometimes lack a gene-ID column; skip collapse rather than
    // merging on empty overlap data.
    if (activeResults.every((r) => r.overlap.length === 0)) {
      return activeResults.map((r) => ({ rep: r, children: [] }));
    }
    return collapseTerms(activeResults, {
      cutoff: jaccardCutoff,
      geneSetOf: (r) => r.overlap,
      scoreOf: (r) => r.q,
      tiebreaker: (r) => r.p,
    });
  });

  const displayCount = $derived(groupedResults.length);
  const collapsedCount = $derived(groupedResults.reduce((acc, g) => acc + g.children.length, 0));

  // Chip mount is deferred one frame: row expands instantly (header + count), then chips
  // are added via requestAnimationFrame to avoid synchronously materializing 60+ `<a>` nodes.
  const chipsReady: Set<string> = new SvelteSet();
  function toggleExpanded(term_id: string) {
    const next = !expanded.get(term_id);
    expanded.set(term_id, next);
    if (next) {
      const row = activeResults.find((x) => x.term_id === term_id);
      if (row) void resolveOverlap(term_id, row.overlap);
      requestAnimationFrame(() => chipsReady.add(term_id));
    } else {
      chipsReady.delete(term_id);
    }
  }

  const OVERLAP_PREVIEW = 60;
  const overlapShowAll: Map<string, boolean> = new SvelteMap();
  function toggleShowAll(term_id: string) {
    overlapShowAll.set(term_id, !overlapShowAll.get(term_id));
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
      class="ml-auto flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground"
    >
      {#if !isImported}
        <label class="inline-flex items-center gap-1">
          background
          <select
            class="rounded border bg-card px-1 py-0.5 font-mono text-xs"
            onchange={async (e) => {
              const target = e.currentTarget as HTMLSelectElement;
              const id = target.value;
              if (!id) {
                clearBackground();
                return;
              }
              await datasets.init();
              const ds = await datasets.getById(id);
              if (!ds) {
                toast.error('Could not load list');
                target.value = '';
                return;
              }
              const tokens = [...new Set(parseGeneList(ds.body))];
              if (tokens.length < 100) {
                toast.warning('Background looks small', {
                  description: `${tokens.length} genes; statistical power is limited below ~500.`,
                });
              }
              setBackground(tokens, ds.name);
            }}
          >
            <option value="">(full genome)</option>
            {#each datasets.byType('gene-list') as d (d.id)}
              <option value={d.id}>{d.name}</option>
            {/each}
          </select>
          <ControlHint id="enrich-bg" title="Custom background">
            By default ORA uses the full annotated genome as the universe (the standard
            hypergeometric assumption). If your experiment can only detect a biased subset (e.g. a
            neuronal screen), pick a gene-list dataset as the background so both N and per-term K
            reflect the actual testable space. Statistically correct; eliminates spurious "ribosome
            enrichment" artifacts from biased assays.
          </ControlHint>
        </label>
        {#if backgroundLabel}
          <span
            class="inline-flex items-center gap-1 rounded border bg-accent/40 px-1.5 py-0.5 text-foreground"
            title={`Restricted to ${customBackground.length} genes`}
          >
            bg: {backgroundLabel}
            <button
              type="button"
              onclick={clearBackground}
              class="text-muted-foreground hover:text-foreground"
              aria-label="Clear background"
            >
              <X class="h-3 w-3" />
            </button>
          </span>
        {/if}
      {/if}
      {#if !isImported && ids.length < 2}
        <span>Pick at least 2 genes.</span>
      {:else if loading[active]}
        <span>Computing...</span>
      {:else if results[active]}
        <span>
          <span class="font-semibold tabular-nums text-foreground">{significantCount}</span>
          significant (q ≤ 0.05) of {allResults.length} tested
        </span>

        <label class="inline-flex items-center gap-1" title="Hide terms above this q-value">
          <span>show q ≤</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
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
        {#if !isImported}
          <span class="font-mono">· {elapsed[active].toFixed(0)} ms</span>
        {:else}
          <span class="font-mono">· imported</span>
        {/if}
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
            onclick={() => (viewMode = 'cnet')}
            class={cn(
              'inline-flex items-center gap-1 border-l px-2 py-1 text-xs transition-colors',
              viewMode === 'cnet'
                ? 'bg-accent text-accent-foreground'
                : 'bg-card hover:bg-muted/50',
            )}
            title="Term-gene network (Cnetplot)"
            disabled={!activeResults.some((r) => r.overlap && r.overlap.length > 0)}
          >
            <Share2 class="h-3 w-3" />
            Cnet
          </button>
          <button
            type="button"
            onclick={() => (viewMode = 'heatmap')}
            class={cn(
              'inline-flex items-center gap-1 border-l px-2 py-1 text-xs transition-colors',
              viewMode === 'heatmap'
                ? 'bg-accent text-accent-foreground'
                : 'bg-card hover:bg-muted/50',
            )}
            title="Term × gene heatmap"
            disabled={!activeResults.some((r) => r.overlap && r.overlap.length > 0)}
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
        {#if viewMode === 'plot' && activeResults.length > 0}
          <label class="inline-flex items-center gap-1 text-xs">
            sort
            <select bind:value={plotSort} class="rounded border bg-card px-1 py-0.5 text-xs">
              <option value="q">q (significance)</option>
              <option value="fold">fold</option>
              <option value="k">gene count</option>
            </select>
          </label>
          <PlotExportMenu getSvg={() => plotSvg} baseName={`enrichment_${active}`} />
        {/if}
        {#if viewMode === 'table' && activeResults.length > 0}
          <label class="inline-flex items-center gap-1 text-xs">
            <input type="checkbox" bind:checked={collapseRedundant} class="rounded" />
            collapse
            <ControlHint id="enrich-collapse" title="REVIGO-style collapse">
              Groups redundant terms by Jaccard similarity of the overlap genes. The
              most-significant term becomes the representative; redundant siblings get folded under
              it. Disabled when no overlap data is available (eg some imported tables).
            </ControlHint>
          </label>
          {#if collapseRedundant}
            <label
              class="inline-flex items-center gap-1 text-xs text-muted-foreground"
              title="Jaccard cutoff for grouping. Lower = more aggressive collapse."
            >
              cutoff
              <input
                type="number"
                step="0.05"
                min="0.1"
                max="0.95"
                bind:value={jaccardCutoff}
                class="w-14 rounded border bg-card px-1 py-0.5 text-xs"
              />
            </label>
          {/if}
          {#if collapseRedundant && collapsedCount > 0}
            <span class="text-[0.7rem] text-muted-foreground"
              >(showing {displayCount}; {collapsedCount} folded)</span
            >
          {/if}
        {/if}
      {/if}
    </div>
    {#if universeN > 0}
      <p class="mt-1 text-xs text-muted-foreground">
        {#if backgroundLabel}
          Tested against the genes in your differential expression table ({universeN.toLocaleString()}
          of them carry a
          {activeLabel} annotation), not the full annotated set, so fold enrichment is not comparable
          with a run on a pasted gene list.
        {:else}
          Tested against every gene in the database carrying a {activeLabel} annotation ({universeN.toLocaleString()}
          of them).
        {/if}
      </p>
    {/if}
  </div>

  {#if !isImported && ids.length < 2}
    <Card>
      <CardContent class="pt-6 text-sm text-muted-foreground">
        Enrichment needs at least 2 genes. Select genes from the cards/table views and the bar at
        the bottom will offer this analysis.
      </CardContent>
    </Card>
  {:else if loading[active] && !results[active]}
    <div class="py-6 text-sm text-muted-foreground">Computing {active} enrichment...</div>
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
          No enriched {active} terms found for this gene set.
        {/if}
      </CardContent>
    </Card>
  {:else}
    {#if universeWarning}
      <div
        class="rounded-md border border-amber-400/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200"
      >
        <span class="font-semibold">Input ≈ universe.</span>
        Tested {universeWarning.n.toLocaleString()} genes against a universe of
        {universeWarning.N.toLocaleString()} annotated genes ({(
          universeWarning.ratio * 100
        ).toFixed(0)}%). Fold enrichment will collapse to ~1× and q-values become uninformative.
        Filter the input to a DE subset first (use the
        <span class="font-mono">DE table / volcano</span> mode, or a top-N |score| cut on a ranked list),
        then re-run.
      </div>
    {/if}
    {#if viewMode === 'plot'}
      <div class="rounded-lg border bg-card p-3">
        <EnrichmentDotPlot
          results={activeResults}
          linkFor={(r) => termHref(active, r.term_id)}
          sortBy={plotSort}
          bind:svgEl={plotSvg}
        />
      </div>
    {:else if viewMode === 'cnet'}
      <div class="rounded-lg border bg-card p-3">
        <EnrichmentCnetplot
          results={activeResults}
          kind={active}
          exportName={`enrichment-cnet_${active}`}
        />
      </div>
    {:else if viewMode === 'heatmap'}
      <EnrichmentHeatmap
        results={activeResults}
        geneLabel={(g) => geneNameMap.get(g) ?? g}
        title="Term × gene (top 25 by q)"
        exportName={`enrichment-heatmap_${active}`}
        onTermClick={(term_id) => {
          const r = activeResults.find((x) => x.term_id === term_id);
          if (r) toggleHighlight(r);
        }}
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
            {#each groupedResults as g, gi (g.rep.term_id + ':' + gi)}
              {@const r = g.rep}
              {@const href = termHref(active, r.term_id)}
              {@const isHi = highlightedRow === active + ':' + r.term_id}
              {@const isExpanded = expanded.get(r.term_id) === true}
              <tr
                class={'cursor-pointer border-b last:border-b-0 hover:bg-muted/30 ' +
                  (isHi ? 'bg-amber-50 dark:bg-amber-950/30' : '')}
                onclick={() => {
                  toggleExpanded(r.term_id);
                  if (onHighlight) toggleHighlight(r);
                }}
                title={onHighlight
                  ? 'Click to expand and highlight this term on the volcano above'
                  : 'Click to expand'}
              >
                <td class="px-3 py-1.5 align-top">
                  <div class="flex flex-wrap items-baseline gap-2">
                    {#if g.children.length > 0}
                      <button
                        type="button"
                        onclick={(e) => {
                          e.stopPropagation();
                          toggleExpanded(r.term_id);
                        }}
                        class="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                        title={isExpanded
                          ? 'Collapse'
                          : `Show ${g.children.length} folded term${g.children.length === 1 ? '' : 's'}`}
                      >
                        {#if isExpanded}
                          <ChevronDown class="h-3 w-3" />
                        {:else}
                          <ChevronRight class="h-3 w-3" />
                        {/if}
                      </button>
                    {/if}
                    {#if href}
                      <a
                        href={resolve(href as '/')}
                        class="font-mono text-[0.65rem] text-primary hover:underline"
                        title={r.term_id}
                      >
                        {r.term_id}
                      </a>
                    {:else}
                      <span class="font-mono text-[0.65rem] text-muted-foreground">{r.term_id}</span
                      >
                    {/if}
                    <span class="text-sm">{r.name}</span>
                    {#if r.namespace}
                      <Badge variant="muted" class="py-0 text-[0.55rem]">{r.namespace}</Badge>
                    {/if}
                    {#if g.children.length > 0}
                      <Badge variant="muted" class="py-0 text-[0.55rem]"
                        >+{g.children.length} similar</Badge
                      >
                    {/if}
                    {#if r.q <= SIG_THRESHOLD}
                      <Badge
                        variant="default"
                        class="bg-accent py-0 text-[0.55rem] text-accent-foreground hover:bg-accent"
                      >
                        significant
                      </Badge>
                    {/if}
                  </div>
                </td>
                <td
                  class="whitespace-nowrap px-3 py-1.5 text-right align-top font-mono text-xs tabular-nums"
                >
                  {r.k} / {r.n}
                </td>
                <td
                  class="whitespace-nowrap px-3 py-1.5 text-right align-top font-mono text-xs tabular-nums text-muted-foreground"
                >
                  {r.K} / {r.N}
                </td>
                <td class="px-3 py-1.5 text-right align-top font-mono text-xs tabular-nums">
                  {r.fold.toFixed(2)}×
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
              {#if isExpanded && r.overlap && r.overlap.length > 0}
                {@const showAll = overlapShowAll.get(r.term_id) === true}
                {@const ready = chipsReady.has(r.term_id)}
                {@const shown = showAll ? r.overlap : r.overlap.slice(0, OVERLAP_PREVIEW)}
                <tr class="border-b bg-muted/10 last:border-b-0">
                  <td colspan="6" class="px-3 py-2 pl-9">
                    <div
                      class="mb-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      Hit genes ({r.overlap.length})
                    </div>
                    {#if !ready}
                      <div class="text-[0.65rem] italic text-muted-foreground">Loading...</div>
                    {:else}
                      <div class="flex flex-wrap gap-1">
                        {#each shown as g (g)}
                          {@const label = geneLabel(g)}
                          <GenePill id={g} name={label === g ? null : label} />
                        {/each}
                        {#if r.overlap.length > OVERLAP_PREVIEW}
                          <button
                            type="button"
                            onclick={(e) => {
                              e.stopPropagation();
                              toggleShowAll(r.term_id);
                            }}
                            class="inline-flex items-center rounded border border-dashed bg-card px-1.5 py-0.5 text-[0.65rem] text-muted-foreground hover:bg-muted/50"
                          >
                            {showAll
                              ? `show first ${OVERLAP_PREVIEW}`
                              : `+${r.overlap.length - OVERLAP_PREVIEW} more`}
                          </button>
                        {/if}
                      </div>
                    {/if}
                  </td>
                </tr>
              {/if}
              {#if isExpanded}
                {#each g.children as c, ci (c.term_id + ':child:' + ci)}
                  {@const cHref = termHref(active, c.term_id)}
                  <tr class="border-b bg-muted/20 last:border-b-0">
                    <td class="px-3 py-1 pl-9 align-top">
                      <div class="flex flex-wrap items-baseline gap-2">
                        {#if cHref}
                          <a
                            href={resolve(cHref as '/')}
                            class="font-mono text-[0.6rem] text-primary hover:underline"
                            title={c.term_id}
                          >
                            {c.term_id}
                          </a>
                        {:else}
                          <span class="font-mono text-[0.6rem] text-muted-foreground"
                            >{c.term_id}</span
                          >
                        {/if}
                        <span class="text-xs text-muted-foreground">{c.name}</span>
                      </div>
                    </td>
                    <td
                      class="whitespace-nowrap px-3 py-1 text-right align-top font-mono text-[0.7rem] tabular-nums text-muted-foreground"
                    >
                      {c.k} / {c.n}
                    </td>
                    <td
                      class="whitespace-nowrap px-3 py-1 text-right align-top font-mono text-[0.7rem] tabular-nums text-muted-foreground"
                    >
                      {c.K} / {c.N}
                    </td>
                    <td
                      class="px-3 py-1 text-right align-top font-mono text-[0.7rem] tabular-nums text-muted-foreground"
                    >
                      {c.fold.toFixed(2)}×
                    </td>
                    <td
                      class="whitespace-nowrap px-3 py-1 text-right align-top font-mono text-[0.7rem] tabular-nums text-muted-foreground"
                    >
                      {fmtP(c.p)}
                    </td>
                    <td
                      class="whitespace-nowrap px-3 py-1 text-right align-top font-mono text-[0.7rem] tabular-nums text-muted-foreground"
                    >
                      {fmtP(c.q)}
                    </td>
                  </tr>
                {/each}
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>
