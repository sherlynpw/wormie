<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import { selection } from '$lib/stores/selection.svelte';
  import { handoff } from '$lib/pipeline-handoff';
  import { bulkLookup, getGenesByIds, resolveOrthologs, type GeneRow } from '$lib/queries';
  import { readIdsFromUrl, buildIdsQuery } from '$lib/share';
  import EnrichmentResults from '$lib/components/EnrichmentResults.svelte';
  import MethodsButton from '$lib/components/MethodsButton.svelte';
  import PageHint from '$lib/components/PageHint.svelte';
  import ControlHint from '$lib/components/ControlHint.svelte';
  import VolcanoPlot from '$lib/components/VolcanoPlot.svelte';
  import { getTermMembers } from '$lib/queries';
  import InputGeneList from '$lib/components/InputGeneList.svelte';
  import SaveDatasetButton from '$lib/components/SaveDatasetButton.svelte';
  import SaveSessionButton from '$lib/components/SaveSessionButton.svelte';
  import LoadDatasetPicker from '$lib/components/LoadDatasetPicker.svelte';
  import LoadLastButton from '$lib/components/LoadLastButton.svelte';
  import { decodeSession, type Session } from '$lib/session';
  import { lastInputs } from '$lib/stores/lastInputs.svelte';
  import { onMount } from 'svelte';
  import {
    parseClusterProfilerCsv,
    detectDeseqTable,
    looksLikeSingleCellMarkers,
  } from '$lib/import-enrichment';
  import type { EnrichmentKind, EnrichmentResult } from '$lib/db/client';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Link2 from 'lucide-svelte/icons/link-2';
  import { toast } from 'svelte-sonner';
  import { cn } from '$lib/utils';
  import { parseGeneList } from '$lib/gene-parse';

  type Mode = 'url' | 'selection' | 'paste' | 'deseq2' | 'results';

  let urlIds = $state<string[]>([]);
  let mode = $state<Mode>('selection');
  let pasteText = $state('');
  // Non-celegans tokens are mapped to WBGene IDs via the Alliance ortholog table before enrichment.
  let inputSpecies = $state<'celegans' | 'human' | 'mouse' | 'rat' | 'zebrafish'>('celegans');
  const SPECIES_TO_ALLIANCE: Record<string, string> = {
    human: 'Homo sapiens',
    mouse: 'Mus musculus',
    rat: 'Rattus norvegicus',
    zebrafish: 'Danio rerio',
  };
  let resolvedIds = $state<string[]>([]);
  let deBackground = $state<{ genes: string[]; label: string } | null>(null);
  let resolving = $state(false);
  let importText = $state('');
  let importDragOver = $state(false);
  let pasteDragOver = $state(false);
  async function onPasteDrop(e: DragEvent) {
    e.preventDefault();
    pasteDragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      pasteText = await file.text();
      toast.success('Loaded file', { description: file.name, duration: 1500 });
    } catch (err) {
      toast.error('Could not read file', { description: String(err) });
    }
  }
  async function onImportDrop(e: DragEvent) {
    e.preventDefault();
    importDragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      importText = text;
      toast.success('Loaded file', { description: file.name, duration: 1500 });
    } catch (err) {
      toast.error('Could not read file', { description: String(err) });
    }
  }
  let importedResults = $state<Partial<Record<EnrichmentKind, EnrichmentResult[]>> | null>(null);
  let latestResults = $state<Partial<Record<EnrichmentKind, EnrichmentResult[]>>>({});
  let importStats = $state<{
    total: number;
    dropped: number;
    counts: Record<string, number>;
  } | null>(null);

  // DESeq2-detected DE filter state
  type DeseqRow = { gene: string; padj: number | null; log2fc: number | null; stat: number | null };
  let deseqRows = $state<DeseqRow[] | null>(null);
  let deseqHasPadj = $state(false);
  // Includes both wormbase_gene and gene_name forms to match whichever the user's CSV used.
  let volcanoHighlight = $state<Set<string> | null>(null);
  let highlightLabel = $state<string>('');

  async function highlightTerm(sel: { term_id: string; kind: EnrichmentKind } | null) {
    if (!sel) {
      volcanoHighlight = null;
      highlightLabel = '';
      return;
    }
    const members = await getTermMembers(sel.term_id, sel.kind);
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const s = new Set<string>();
    for (const m of members) {
      s.add(m.wormbase_gene);
      if (m.gene_name) {
        s.add(m.gene_name);
        s.add(m.gene_name.toLowerCase());
      }
    }
    volcanoHighlight = s;
    highlightLabel = `${members.length} ${sel.kind} members of ${sel.term_id}`;
  }
  let deseqHasLog2fc = $state(false);
  let padjMax = $state(0.05);
  let lfcMin = $state(0); // |log2FC| threshold
  let deDirection = $state<'all' | 'up' | 'down'>('all');
  const dePassing = $derived.by(() => {
    if (!deseqRows) return [] as DeseqRow[];
    return deseqRows.filter((r) => {
      if (deseqHasPadj && (r.padj === null || r.padj > padjMax)) return false;
      if (deseqHasLog2fc) {
        if (lfcMin > 0 && (r.log2fc === null || Math.abs(r.log2fc) < lfcMin)) return false;
        if (deDirection !== 'all') {
          if (r.log2fc === null) return false;
          if (deDirection === 'up' ? r.log2fc <= 0 : r.log2fc >= 0) return false;
        }
      }
      return true;
    });
  });

  $effect(() => {
    const u = page.url;
    untrack(async () => {
      const ids = await readIdsFromUrl(u);
      urlIds = ids;
      if (ids.length > 0) mode = 'url';
    });
  });

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);

    if (params.get('from') === 'de') {
      const h = handoff.deseq2.consume();
      if (h) {
        importText = h.tsv;
        mode = 'deseq2';
        toast.success('Loaded DESeq2 results from /de');
      }
    }

    const which = params.get('load');
    const id = params.get('id');
    if (
      !id ||
      (which !== 'paste' &&
        which !== 'deseq2' &&
        which !== 'ranked' &&
        which !== 'results' &&
        which !== 'session')
    )
      return;
    const { datasets } = await import('$lib/stores/datasets.svelte');
    const ds = await datasets.getById(id);
    if (!ds) return;
    if (which === 'session') {
      const session = decodeSession(ds.body);
      if (!session || session.tool !== 'enrichment') {
        toast.error('Could not restore session', { description: ds.name });
        return;
      }
      const p = session.params as {
        mode?: Mode;
        padjMax?: number;
        lfcMin?: number;
        deDirection?: 'all' | 'up' | 'down';
        rankedTopN?: number;
      };
      const restoredMode = p.mode ?? 'paste';
      const primary = session.inputs.primary ?? '';
      if (restoredMode === 'deseq2' || restoredMode === 'results') {
        importText = primary;
        mode = restoredMode;
      } else {
        pasteText = primary;
        mode = 'paste';
      }
      if (typeof p.padjMax === 'number') padjMax = p.padjMax;
      if (typeof p.lfcMin === 'number') lfcMin = p.lfcMin;
      if (p.deDirection === 'all' || p.deDirection === 'up' || p.deDirection === 'down')
        deDirection = p.deDirection;
      if (typeof p.rankedTopN === 'number') rankedTopN = p.rankedTopN;
      // Session results: restore directly to avoid re-running enrichment.
      if (session.results) {
        importedResults = session.results as Partial<Record<EnrichmentKind, EnrichmentResult[]>>;
      }
      toast.success('Session restored', { description: ds.name });
      return;
    }
    if (which === 'paste') {
      pasteText = ds.body;
      mode = 'paste';
    } else if (which === 'deseq2') {
      importText = ds.body;
      mode = 'deseq2';
    } else if (which === 'results') {
      importText = ds.body;
      mode = 'results';
    } else if (which === 'ranked') {
      // Ranked dataset: default to top 500 by |score|; using the full set produces fold=1x (input = universe).
      const parsed = parseRankedBody(ds.body);
      rankedAll = parsed;
      if (parsed.length > 0) {
        const top = applyTopN(parsed, rankedTopN);
        pasteText = top.map((p) => p.gene).join('\n');
        toast.success('Loaded ranked dataset', {
          description: `Top ${top.length} of ${parsed.length} by |score|. Adjust the slider then click Resolve.`,
        });
      } else {
        // Not gene+score format; fall back to gene-column extract.
        pasteText = extractGeneColumn(ds.body);
        toast.success('Loaded', { description: ds.name });
      }
      mode = 'paste';
      return;
    }
    toast.success('Loaded', { description: ds.name });
  });

  // rankedAll holds parsed (gene, score) pairs; slider writes to pasteText so resolve flow is unchanged.
  type RankedRow = { gene: string; score: number };
  let rankedAll = $state<RankedRow[]>([]);
  let rankedTopN = $state<number>(500);
  function parseRankedBody(body: string): RankedRow[] {
    const lines = body.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
    if (lines.length === 0) return [];
    // Skip header if col-2 of line 0 is not numeric.
    const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : /\s+/;
    const splitter = (s: string) =>
      typeof delim === 'string' ? s.split(delim) : s.split(delim as RegExp);
    let start = 0;
    {
      const cells = splitter(lines[0]);
      const score = parseFloat(cells[1] ?? '');
      if (!Number.isFinite(score)) start = 1;
    }
    const out: RankedRow[] = [];
    for (let i = start; i < lines.length; i++) {
      const cells = splitter(lines[i]).map((s) => s.trim().replace(/^"+|"+$/g, ''));
      const gene = cells[0];
      const score = parseFloat(cells[1] ?? '');
      if (!gene || !Number.isFinite(score)) continue;
      out.push({ gene, score });
    }
    return out;
  }
  function applyTopN(rows: RankedRow[], n: number): RankedRow[] {
    const sorted = [...rows].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    return sorted.slice(0, n);
  }
  function refreshTopN() {
    if (rankedAll.length === 0) return;
    const top = applyTopN(rankedAll, rankedTopN);
    pasteText = top.map((p) => p.gene).join('\n');
  }

  // Extract just the gene-id column so numeric columns from DESeq2/ranked tables don't flood bulkLookup.
  function extractGeneColumn(body: string): string {
    const lines = body.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
    if (lines.length === 0) return body;
    const delim = lines[0].includes('\t') ? '\t' : ',';
    const header = lines[0].split(delim).map((h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/^"+|"+$/g, ''),
    );
    const idCandidates = [
      'gene_id',
      'wormbase_gene',
      'wbgene',
      'gene',
      'id',
      'gene_name',
      'symbol',
      'name',
    ];
    let gi = -1;
    for (const c of idCandidates) {
      const ix = header.indexOf(c);
      if (ix >= 0) {
        gi = ix;
        break;
      }
    }
    if (gi < 0) return body; // unknown shape, fall back to raw paste
    const out: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(delim);
      const v = (cells[gi] ?? '').trim().replace(/^"+|"+$/g, '');
      if (v) out.push(v);
    }
    return out.join('\n');
  }

  async function resolvePaste() {
    // Extract gene column first: a raw DESeq2 paste (50k rows × 6 cols) would produce ~300k tokens,
    // most numeric, overwhelming the fuzzy join in bulkLookup.
    const body = extractGeneColumn(pasteText);
    const tokens = parseGeneList(body);
    if (tokens.length === 0) {
      resolvedIds = [];
      return;
    }
    resolving = true;
    try {
      if (inputSpecies !== 'celegans') {
        const alliance = SPECIES_TO_ALLIANCE[inputSpecies];
        const ortho = await resolveOrthologs(tokens, alliance);
        const wormIds = [...new Set(ortho.flatMap((h) => h.worm_genes))];
        const misses = ortho.filter((h) => h.worm_genes.length === 0).map((h) => h.input);
        resolvedIds = wormIds;
        if (misses.length > 0) {
          toast.warning(
            `${misses.length} input${misses.length === 1 ? '' : 's'} with no ortholog`,
            {
              description: misses.slice(0, 6).join(', ') + (misses.length > 6 ? '...' : ''),
            },
          );
        } else {
          toast.success(
            `Mapped ${wormIds.length} worm genes from ${tokens.length} ${inputSpecies} inputs`,
          );
        }
        if (wormIds.length > 0) lastInputs.stash('gene-list', pasteText);
        return;
      }
      const r = await bulkLookup(tokens);
      const unique = [...new Set(r.hits.map((h) => h.wormbase_gene))];
      resolvedIds = unique;
      if (unique.length > 0) lastInputs.stash('gene-list', pasteText);
      if (r.misses.length > 0) {
        toast.warning(`${r.misses.length} input${r.misses.length === 1 ? '' : 's'} not matched`, {
          description: r.misses.slice(0, 6).join(', ') + (r.misses.length > 6 ? '...' : ''),
        });
      } else {
        toast.success('Resolved', {
          description: `${unique.length} unique gene${unique.length === 1 ? '' : 's'}`,
        });
      }
    } finally {
      resolving = false;
    }
  }

  const ids = $derived(
    mode === 'url'
      ? urlIds
      : mode === 'selection'
        ? selection.ids
        : mode === 'paste'
          ? resolvedIds
          : [],
  );

  async function parseImport() {
    // DESeq2 detected: surface padj/|log2FC| filter so only the DE subset is tested (not the whole universe).
    const deseq = detectDeseqTable(importText);
    if (deseq) {
      deseqRows = deseq.rows;
      deseqHasPadj = deseq.hasPadj;
      deseqHasLog2fc = deseq.hasLog2fc;
      importedResults = null;
      importStats = null;
      resolvedIds = [];
      lastInputs.stash('deseq2', importText);
      toast.success('Detected DESeq2 output', {
        description: `${deseq.rows.length.toLocaleString()} rows. Set padj / log2FC thresholds below, then "Run enrichment on DE subset".`,
      });
      return;
    }
    if (looksLikeSingleCellMarkers(importText)) {
      toast.error('Single-cell marker table', {
        description:
          'Seurat / scanpy marker tables are already filtered, so their rows are not the set of genes tested. Paste the marker gene names into the gene-list box instead, which tests them against the genome-wide universe.',
      });
      return;
    }
    try {
      const parsed = parseClusterProfilerCsv(importText);
      if (Object.keys(parsed.results).length === 0) {
        toast.error('No parseable rows', {
          description:
            'Expected columns like ID, Description, GeneRatio, BgRatio, pvalue, p.adjust.',
        });
        return;
      }
      importedResults = parsed.results;
      const counts: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed.results)) counts[k] = v?.length ?? 0;
      importStats = { total: parsed.totalRows, dropped: parsed.dropped, counts };
      const summary = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${k}`)
        .join(', ');
      toast.success('Imported', { description: summary });
    } catch (e) {
      toast.error('Parse failed', { description: String(e instanceof Error ? e.message : e) });
    }
  }

  async function runOnDeSubset() {
    const subset = dePassing;
    if (subset.length === 0) {
      toast.error('No genes pass the filter');
      return;
    }
    resolving = true;
    try {
      // Universe is every tested row, so terms whose members were never expressed
      // don't inflate N or per-term K. Resolved before the handoff drops deseqRows.
      const universeRows = deseqRows ?? [];
      const [r, bg] = await Promise.all([
        bulkLookup(subset.map((row) => row.gene)),
        bulkLookup(universeRows.map((row) => row.gene)),
      ]);
      const unique = [...new Set(r.hits.map((h) => h.wormbase_gene))];
      const universe = [...new Set(bg.hits.map((h) => h.wormbase_gene))];
      deBackground =
        universe.length > 0
          ? {
              genes: universe,
              label: `differential expression (${universe.length.toLocaleString()} genes)`,
            }
          : null;
      resolvedIds = unique;
      deseqRows = null;
      mode = 'paste';
      toast.success('Running enrichment', {
        description: `${unique.length.toLocaleString()} DE genes (padj ≤ ${padjMax}${lfcMin > 0 ? `, |log2FC| ≥ ${lfcMin}` : ''}${deDirection !== 'all' ? `, ${deDirection}-regulated` : ''})`,
      });
    } finally {
      resolving = false;
    }
  }

  function loadImportExample() {
    importText = [
      'ID,Description,GeneRatio,BgRatio,pvalue,p.adjust,qvalue,geneID,Count,ontology',
      'GO:0006952,defense response,42/199,180/9826,1.2e-12,3.4e-10,2.1e-10,daf-16/skn-1/...,42,BP',
      'GO:0009408,response to heat,15/199,60/9826,5.1e-08,7.2e-06,4.5e-06,hsp-16.2/hsf-1/...,15,BP',
      'GO:0005634,nucleus,80/199,1200/9826,3.4e-05,1.1e-03,9.0e-04,daf-16/lin-1/...,80,CC',
      'GO:0003700,DNA-binding transcription factor activity,22/199,310/9826,1.4e-04,2.5e-03,2.0e-03,daf-16/skn-1/...,22,MF',
    ].join('\n');
  }

  let geneMeta = $state<GeneRow[]>([]);
  $effect(() => {
    const cur = ids.slice();
    untrack(async () => {
      if (cur.length === 0) {
        geneMeta = [];
        return;
      }
      geneMeta = await getGenesByIds(cur);
    });
  });

  // Results in hand travel with the navigation so the overlap page starts with a
  // slot filled, instead of asking the user to copy the table out and paste it back.
  const overlapPayload = $derived(
    (importedResults && Object.keys(importedResults).length > 0 ? importedResults : null) ??
      (Object.keys(latestResults).length > 0 ? latestResults : null),
  );

  async function goToOverlap() {
    if (overlapPayload) {
      const { enrichmentResultsToCsv } = await import('$lib/results-to-paste');
      handoff.enrichmentOverlap.set({
        name: 'This over-representation run',
        csv: enrichmentResultsToCsv(overlapPayload),
      });
    }
    goto(resolve('/enrichment/overlap'));
  }

  async function copyShareLink() {
    if (ids.length === 0) return;
    const query = await buildIdsQuery(ids);
    const url = `${location.origin}/enrichment?${query}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Share link copied', {
        description: `${ids.length} genes, ${url.length} char URL`,
      });
    } catch (e) {
      toast.error('Copy failed', { description: String(e) });
    }
  }
</script>

<svelte:head><title>Over-representation · wormie.rs.ht</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <div class="flex items-center justify-between">
    <Button variant="ghost" size="sm" href="/" class="self-start">
      <ArrowLeft />
      Back
    </Button>
    <Button
      variant="outline"
      size="sm"
      onclick={goToOverlap}
      title={overlapPayload
        ? 'Open Enrichment overlap with the current result table already in a slot'
        : 'Compare which terms are significant across several enrichment runs'}
    >
      {overlapPayload ? 'Send results to overlap' : 'Compare overlaps (UpSet)'}
    </Button>
  </div>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Over-representation</h1>
    <p class="text-sm text-muted-foreground">
      Annotations that turn up more often than expected by chance
    </p>
  </header>

  <PageHint id="enrichment" title="What this step does">
    You have a list of genes worth explaining: the ones that changed, or hits from a screen. Genes
    carry annotations describing what they do (GO terms), what happens when they break (phenotypes),
    which tissue they act in, and which WormCat category they fall under. This asks whether any of
    those labels turns up in your list more often than drawing the same number of genes at random
    would give. Each label gets a <b>fold enrichment</b> (how many times more often than expected)
    and a <b>q-value</b>, the false discovery rate across all labels tested; q ≤ 0.05 is the usual
    cutoff. Paste gene names, or a differential expression table from DESeq2, edgeR or limma and
    choose which genes to test. If nothing in your list passes a significance cutoff, try
    <a href={resolve('/gsea')} class="text-primary hover:underline">ranked-list enrichment</a>,
    which needs no cutoff.
  </PageHint>

  <Card>
    <CardHeader>
      <CardTitle class="text-xl">Enrichment analysis</CardTitle>
      <div class="text-sm text-muted-foreground">
        Hypergeometric (Fisher's exact) test against the genome-wide background of annotated genes,
        with Benjamini-Hochberg FDR.
      </div>
    </CardHeader>
    <CardContent class="space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        {#if urlIds.length > 0}
          <button
            type="button"
            onclick={() => (mode = 'url')}
            class="rounded-md px-3 py-1.5 text-sm transition-colors {mode === 'url'
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50'}"
          >
            From URL ({urlIds.length})
          </button>
        {/if}
        <button
          type="button"
          onclick={() => (mode = 'selection')}
          class="rounded-md px-3 py-1.5 text-sm transition-colors {mode === 'selection'
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50'}"
        >
          From selection ({selection.ids.length})
        </button>
        <button
          type="button"
          onclick={() => (mode = 'paste')}
          class="rounded-md px-3 py-1.5 text-sm transition-colors {mode === 'paste'
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50'}"
        >
          Paste gene list
        </button>
        <button
          type="button"
          onclick={() => (mode = 'deseq2')}
          class="rounded-md px-3 py-1.5 text-sm transition-colors {mode === 'deseq2'
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50'}"
          title="Paste a DESeq2 / per-gene DE table to filter via volcano + run ORA on the DE subset"
        >
          DE table / volcano
        </button>
        <button
          type="button"
          onclick={() => (mode = 'results')}
          class="rounded-md px-3 py-1.5 text-sm transition-colors {mode === 'results'
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50'}"
          title="Render existing clusterProfiler / GSEApy / topGO output as a dot plot"
        >
          Imported results
        </button>
        <Button
          variant="outline"
          size="sm"
          class="ml-auto"
          onclick={copyShareLink}
          disabled={ids.length < 2}
          title="Copy a self-contained URL anyone can open"
        >
          <Link2 class="h-3 w-3" />
          Copy share link
        </Button>
      </div>

      {#if mode === 'paste'}
        <div class="space-y-2">
          {#if rankedAll.length > 0}
            <div
              class="flex flex-wrap items-center gap-3 rounded-md border bg-card p-2 text-xs text-muted-foreground"
            >
              <span>
                <span class="font-semibold text-foreground">Ranked dataset:</span>
                top
                <span class="font-mono tabular-nums text-foreground"
                  >{Math.min(rankedTopN, rankedAll.length).toLocaleString()}</span
                >
                of
                <span class="font-mono tabular-nums text-foreground"
                  >{rankedAll.length.toLocaleString()}</span
                >
                by |score|
              </span>
              <input
                type="range"
                min="10"
                max={Math.min(rankedAll.length, 5000)}
                step="10"
                bind:value={rankedTopN}
                onchange={refreshTopN}
                oninput={refreshTopN}
                class="flex-1 accent-primary"
              />
              <input
                type="number"
                min="2"
                max={rankedAll.length}
                bind:value={rankedTopN}
                onchange={refreshTopN}
                class="w-20 rounded border bg-background px-1 py-0.5 font-mono text-xs"
              />
              <button
                type="button"
                onclick={() => {
                  rankedAll = [];
                }}
                class="rounded border border-dashed px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
                title="Drop the ranked-dataset filter; edit paste freely."
              >
                clear
              </button>
            </div>
          {/if}
          <textarea
            bind:value={pasteText}
            rows="6"
            placeholder="daf-16, daf-2, age-1&#10;hsf-1&#10;WBGene00000898&#10;&#10;or drop a gene-list file here"
            class={cn(
              'w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-ring',
              pasteDragOver && 'ring-2 ring-primary',
            )}
            ondragover={(e: DragEvent) => {
              if (e.dataTransfer?.items?.[0]?.kind === 'file') {
                e.preventDefault();
                pasteDragOver = true;
              }
            }}
            ondragleave={() => (pasteDragOver = false)}
            ondrop={onPasteDrop}
          ></textarea>
          <div class="flex flex-wrap items-center gap-2">
            <SaveDatasetButton
              type="gene-list"
              body={() => pasteText}
              disabled={!pasteText.trim()}
            />
            <SaveSessionButton
              disabled={!pasteText.trim()}
              build={() =>
                ({
                  v: 1,
                  tool: 'enrichment',
                  inputs: { primary: pasteText },
                  params: { mode: 'paste', rankedTopN },
                }) satisfies Session}
              getResults={() =>
                Object.keys(latestResults).length > 0
                  ? (latestResults as Record<string, unknown>)
                  : null}
            />
            <LoadDatasetPicker
              type={['gene-list', 'ranked', 'deseq2']}
              onload={(ds) => {
                // Extract gene column for non-gene-list types to avoid feeding numeric junk to bulkLookup.
                pasteText = ds.type === 'gene-list' ? ds.body : extractGeneColumn(ds.body);
                toast.success('Loaded', { description: `${ds.name} (${ds.type})` });
              }}
            />
            <LoadLastButton type="gene-list" onload={(body) => (pasteText = body)} />
            <label class="flex items-center gap-1 text-xs">
              <span class="text-muted-foreground">Input species:</span>
              <select class="rounded border bg-background px-1 py-0.5" bind:value={inputSpecies}>
                <option value="celegans">C. elegans</option>
                <option value="human">Human</option>
                <option value="mouse">Mouse</option>
                <option value="rat">Rat</option>
                <option value="zebrafish">Zebrafish</option>
              </select>
            </label>
            <Button onclick={resolvePaste} disabled={resolving || !pasteText.trim()}>
              {resolving ? 'Resolving...' : 'Resolve & run'}
            </Button>
            {#if resolvedIds.length > 0}
              <span class="text-xs text-muted-foreground">
                {resolvedIds.length} unique genes resolved
              </span>
            {/if}
          </div>
        </div>
      {:else if mode === 'url'}
        <div class="break-all font-mono text-xs text-muted-foreground">
          {urlIds.slice(0, 30).join(', ')}{urlIds.length > 30 ? `, ...+${urlIds.length - 30}` : ''}
        </div>
      {:else if mode === 'deseq2' || mode === 'results'}
        <div class="space-y-2">
          {#if mode === 'deseq2'}
            <div class="text-xs text-muted-foreground">
              Paste a per-gene DE table (CSV or TSV) from DESeq2, edgeR or limma. Needs a gene
              column plus a fold change and an adjusted p-value under any of their usual names (<span
                class="font-mono">log2FoldChange</span
              >/<span class="font-mono">logFC</span>,
              <span class="font-mono">padj</span>/<span class="font-mono">FDR</span>/<span
                class="font-mono">adj.P.Val</span
              >). Renders a volcano + DE filter so you pick a subset before ORA. Auto-falls-back to
              the clusterProfiler renderer if the body actually contains term-level results.
            </div>
          {:else}
            <div class="text-xs text-muted-foreground">
              Paste clusterProfiler / GSEApy / topGO term-level output (CSV or TSV). Auto-detects
              <span class="font-mono"
                >ID, Description, GeneRatio, BgRatio, pvalue, p.adjust, geneID, Count, ontology</span
              >. No recomputation, just renders the dot plot and lets you export.
              <button
                type="button"
                onclick={loadImportExample}
                class="ml-1 text-primary hover:underline"
              >
                Try example
              </button>
            </div>
          {/if}
          <textarea
            bind:value={importText}
            rows="9"
            placeholder="ID,Description,GeneRatio,BgRatio,pvalue,p.adjust,geneID,Count,ontology&#10;GO:0006952,defense response,42/199,180/9826,1.2e-12,3.4e-10,...&#10;&#10;or drop a .csv/.tsv file here"
            class={cn(
              'w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-ring',
              importDragOver && 'ring-2 ring-primary',
            )}
            ondragover={(e: DragEvent) => {
              if (e.dataTransfer?.items?.[0]?.kind === 'file') {
                e.preventDefault();
                importDragOver = true;
              }
            }}
            ondragleave={() => (importDragOver = false)}
            ondrop={onImportDrop}
          ></textarea>
          <div class="flex flex-wrap items-center gap-2">
            <SaveDatasetButton
              type="deseq2"
              body={() => importText}
              disabled={!importText.trim()}
            />
            <SaveSessionButton
              disabled={!importText.trim()}
              build={() =>
                ({
                  v: 1,
                  tool: 'enrichment',
                  inputs: { primary: importText },
                  params: { mode, padjMax, lfcMin, deDirection },
                }) satisfies Session}
              getResults={() => {
                // importedResults is canonical in deseq2/results modes; fall back to latestResults
                // if the user ran further DE-filter drilling.
                const r = (importedResults as Record<string, unknown> | null) ?? latestResults;
                return r && Object.keys(r).length > 0 ? (r as Record<string, unknown>) : null;
              }}
            />
            <LoadDatasetPicker
              type={['deseq2', 'ranked', 'gene-list']}
              onload={(ds) => {
                importText = ds.body;
                toast.success('Loaded', { description: `${ds.name} (${ds.type})` });
              }}
            />
            <LoadLastButton type="deseq2" onload={(body) => (importText = body)} />
            <Button onclick={parseImport} disabled={!importText.trim()}>Render</Button>
            {#if importStats}
              <span class="text-xs text-muted-foreground">
                {importStats.total - importStats.dropped} parsed
                {#if importStats.dropped > 0}({importStats.dropped} dropped){/if}
              </span>
            {/if}
          </div>

          {#if deseqRows && deseqHasPadj && deseqHasLog2fc}
            <div class="mt-3">
              {#if highlightLabel}
                <div class="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Highlighting: <span class="font-mono">{highlightLabel}</span></span>
                  <button
                    type="button"
                    onclick={() => highlightTerm(null)}
                    class="text-primary hover:underline"
                  >
                    clear
                  </button>
                </div>
              {/if}
              <VolcanoPlot
                rows={deseqRows}
                highlight={volcanoHighlight}
                qThreshold={padjMax}
                lfcThreshold={lfcMin || 1}
              />
            </div>
          {/if}

          {#if deseqRows}
            <div class="mt-3 space-y-2 rounded-md border bg-muted/30 p-3">
              <div class="text-xs font-semibold">DE filter (DESeq2 detected)</div>
              <div class="text-[0.7rem] text-muted-foreground">
                Pasting the whole DESeq2 table tests the universe against itself, which is why every
                term came back at fold = 1.0×. Pick a DE subset:
              </div>
              <div class="flex flex-wrap items-end gap-3">
                {#if deseqHasPadj}
                  <label class="block">
                    <span
                      class="mb-1 block text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      padj ≤
                    </span>
                    <Input
                      bind:value={padjMax}
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      class="h-8 w-24 text-sm"
                    />
                  </label>
                {/if}
                {#if deseqHasLog2fc}
                  <label class="block">
                    <span
                      class="mb-1 block text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      |log2FC| ≥
                    </span>
                    <Input
                      bind:value={lfcMin}
                      type="number"
                      step="0.1"
                      min="0"
                      class="h-8 w-24 text-sm"
                    />
                  </label>
                  <label class="block">
                    <span
                      class="mb-1 block text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      direction
                    </span>
                    <select
                      bind:value={deDirection}
                      class="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="all">all</option>
                      <option value="up">up only</option>
                      <option value="down">down only</option>
                    </select>
                  </label>
                {/if}
                <div class="text-xs text-muted-foreground">
                  <span class="font-semibold tabular-nums text-foreground">
                    {dePassing.length.toLocaleString()}
                  </span>
                  of {deseqRows.length.toLocaleString()} pass
                </div>
                <Button onclick={runOnDeSubset} disabled={resolving || dePassing.length === 0}>
                  {resolving ? 'Resolving...' : 'Run enrichment on DE subset'}
                </Button>
                <ControlHint id="enrich-de-subset" title="DE-subset ORA">
                  Runs hypergeometric over-representation on the filtered subset against GO /
                  Phenotype / WormCat / Tissue. The universe is set to the genes in your
                  differential expression table ({deseqRows ? deseqRows.length.toLocaleString() : 0} of
                  them), not the whole genome, so terms whose members were never expressed in this experiment
                  don't inflate the background. A directional run keeps that same universe, so up- and
                  down-regulated genes are each tested against every tested row. The universe in force
                  is shown on the results card and can be cleared there.
                </ControlHint>
              </div>
              <div class="text-[0.7rem] text-muted-foreground">
                For ranked-list enrichment on the Wald stat (uses all rows, no threshold), go to <a
                  href={resolve('/gsea')}
                  class="text-primary hover:underline">/gsea</a
                >.
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </CardContent>
  </Card>

  {#if (mode === 'deseq2' || mode === 'results') && importedResults}
    <EnrichmentResults ids={[]} imported={importedResults} onResults={(r) => (latestResults = r)} />
  {:else if ids.length > 0 && geneMeta.length > 0}
    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="text-base">
          Input genes
          <span class="ml-2 text-xs font-normal text-muted-foreground">
            {geneMeta.length.toLocaleString()} of {ids.length.toLocaleString()} resolved
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent class="pt-0">
        <InputGeneList genes={geneMeta} />
      </CardContent>
    </Card>
  {/if}

  {#if mode !== 'deseq2' && mode !== 'results'}
    <div class="flex justify-end">
      <MethodsButton
        ctx={{
          tool: 'enrichment',
          params: { kind: 'multi' },
          inputSummary: `${ids.length} input genes`,
        }}
      />
    </div>
    <EnrichmentResults
      {ids}
      imported={importedResults ?? undefined}
      onHighlight={highlightTerm}
      onResults={(r) => (latestResults = r)}
      initialBackground={deBackground}
    />
  {/if}
</div>
