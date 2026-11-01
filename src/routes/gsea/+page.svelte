<script lang="ts">
  import { resolve } from '$app/paths';
  import { bulkLookup } from '$lib/queries';
  import type { GseaInput, GseaKind, GseaResult } from '$lib/db/client';
  import GseaResults from '$lib/components/GseaResults.svelte';
  import MethodsButton from '$lib/components/MethodsButton.svelte';
  import RecentRunsList from '$lib/components/RecentRunsList.svelte';
  import SaveDatasetButton from '$lib/components/SaveDatasetButton.svelte';
  import SaveSessionButton from '$lib/components/SaveSessionButton.svelte';
  import LoadDatasetPicker from '$lib/components/LoadDatasetPicker.svelte';
  import LoadLastButton from '$lib/components/LoadLastButton.svelte';
  import { decodeSession, type Session } from '$lib/session';
  import { lastInputs } from '$lib/stores/lastInputs.svelte';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Share from 'lucide-svelte/icons/share-2';
  import PageHint from '$lib/components/PageHint.svelte';
  import ControlHint from '$lib/components/ControlHint.svelte';
  import { toast } from 'svelte-sonner';
  import { detectDeseqTable } from '$lib/import-enrichment';
  import { onMount } from 'svelte';
  import {
    encodeBundle,
    decodeBundle,
    readBundleFromHash,
    buildShareUrl,
    clearBundleHash,
  } from '$lib/bundle';
  import { handoff } from '$lib/pipeline-handoff';

  type GseaBundle = { v: 1; ranked: GseaInput[]; geneCol?: string; scoreCol?: string };

  let pasteText = $state('');
  let ranked = $state<GseaInput[]>([]);
  // Latest GSEA results bubbled up from GseaResults for session capture.
  let latestResults = $state<Record<string, unknown>>({});
  let gseaParams = $state<Record<string, unknown>>({ nperm: 1000, multilevel: true });
  // Session-restored results to seed GseaResults on mount; ignored once a live ranked list is resolved.
  let importedFromSession = $state<Partial<Record<GseaKind, GseaResult[]>> | undefined>(undefined);
  let resolving = $state(false);

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('from') === 'de') {
      const h = handoff.gsea.consume();
      if (h && h.rows.length > 0) {
        pasteText = ['gene\tstat', ...h.rows.map((r) => `${r.gene}\t${r.score}`)].join('\n');
        geneCol = '1';
        scoreCol = '2';
        toast.success('Loaded ranked list from /de', {
          description: `${h.rows.length.toLocaleString()} genes (Wald stat from ${h.contrastName})`,
        });
      }
    }
    const id = params.get('id');
    if (params.get('load') === 'ranked' && id) {
      const { datasets } = await import('$lib/stores/datasets.svelte');
      const ds = await datasets.getById(id);
      if (ds) {
        pasteText = ds.body;
        toast.success('Loaded', { description: ds.name });
      }
    } else if (params.get('load') === 'session' && id) {
      const { datasets } = await import('$lib/stores/datasets.svelte');
      const ds = await datasets.getById(id);
      if (ds) {
        const session = decodeSession(ds.body);
        if (session && session.tool === 'gsea') {
          pasteText = session.inputs.ranked ?? '';
          // bind:value on <input type="number"> coerces to number at runtime, so saved JSON may be string or number.
          const p = session.params as { geneCol?: string | number; scoreCol?: string | number };
          if (p.geneCol !== undefined) geneCol = String(p.geneCol);
          if (p.scoreCol !== undefined) scoreCol = String(p.scoreCol);
          // Restore saved results so the page lands on the previous view without recomputing.
          if (session.results) {
            importedFromSession = session.results as Partial<Record<GseaKind, GseaResult[]>>;
          }
          toast.success('Session restored', { description: ds.name });
        } else {
          toast.error('Could not restore session', { description: ds.name });
        }
      }
    }
    const { encoded, term, kind } = readBundleFromHash();
    if (encoded) {
      const bundle = await decodeBundle<GseaBundle>(encoded);
      if (bundle?.v === 1 && Array.isArray(bundle.ranked)) {
        ranked = bundle.ranked;
        if (bundle.geneCol) geneCol = bundle.geneCol;
        if (bundle.scoreCol) scoreCol = bundle.scoreCol;
        if (kind) deeplinkKind = kind;
        if (term) deeplinkTerm = term;
        clearBundleHash();
        toast.success('Restored analysis', { description: `${bundle.ranked.length} ranked genes` });
      } else {
        toast.error('Bundle did not decode');
      }
    }
  });

  // Passed to GseaResults to auto-switch kind, expand, and scroll the matching row into view.
  let deeplinkKind = $state<string | null>(null);
  let deeplinkTerm = $state<string | null>(null);

  async function shareAnalysis() {
    if (ranked.length === 0) {
      toast.error('Nothing to share', { description: 'Resolve a ranked list first.' });
      return;
    }
    try {
      const enc = await encodeBundle<GseaBundle>({ v: 1, ranked, geneCol, scoreCol });
      const url = buildShareUrl(enc);
      if (url.length > 64000) {
        toast.warning('Share link is very long', {
          description:
            'Some browsers reject URLs over ~64KB. Consider saving as a Dataset instead.',
        });
      }
      await navigator.clipboard.writeText(url);
      toast.success('Share link copied', {
        description: `${ranked.length} ranked genes · ${(enc.length / 1024).toFixed(1)} KB encoded`,
      });
    } catch (e) {
      toast.error('Could not build share link', { description: String(e) });
    }
  }
  let geneCol = $state<string>('1');
  let scoreCol = $state<string>('2');

  // CSV-aware splitter: handles quoted fields (escaped "" inside) and bare values separated by comma, tab, or whitespace.
  function splitRow(line: string): string[] {
    const out: string[] = [];
    let buf = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') {
          buf += '"';
          i++;
        } else if (c === '"') {
          inQuotes = false;
        } else {
          buf += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',' || c === '\t') {
        out.push(buf);
        buf = '';
      } else if (/\s/.test(c)) {
        if (buf.length === 0 && out.length === 0) {
          // skip leading whitespace
        } else {
          out.push(buf);
          buf = '';
        }
      } else {
        buf += c;
      }
    }
    out.push(buf);
    return out.map((s) => s.replace(/^"+|"+$/g, '').trim());
  }

  function parseLine(line: string): { gene: string; score: number } | null {
    const parts = splitRow(line);
    const gi = Math.max(0, parseInt(geneCol, 10) - 1);
    const si = Math.max(0, parseInt(scoreCol, 10) - 1);
    if (parts.length <= Math.max(gi, si)) return null;
    const gene = parts[gi];
    const score = parseFloat(parts[si]);
    if (!gene || !Number.isFinite(score)) return null;
    return { gene, score };
  }

  function detectColumns(
    headerLine: string,
  ): { gene: number; score: number; scoreName: string } | null {
    const cols = splitRow(headerLine).map((c) => c.toLowerCase());
    const geneCandidates = [
      'gene_id',
      'wormbase_gene',
      'wbgene',
      'gene',
      'id',
      'gene_name',
      'symbol',
    ];
    // Preference order: stat (DESeq2 Wald) > log2FC
    const scoreCandidates = [
      'stat',
      'wald',
      't',
      'log2foldchange',
      'log2fc',
      'logfc',
      'score',
      'rank',
    ];

    let gi = -1;
    for (const cand of geneCandidates) {
      gi = cols.indexOf(cand);
      if (gi >= 0) break;
    }
    let si = -1;
    for (const cand of scoreCandidates) {
      si = cols.indexOf(cand);
      if (si >= 0) break;
    }
    if (gi < 0 || si < 0) return null;
    return { gene: gi + 1, score: si + 1, scoreName: cols[si] };
  }

  // A full DE table goes through the same importer as Over-representation and Contrast
  // comparison, which knows the DESeq2 / edgeR / limma column names and unnamed row-name
  // columns; a plain gene + score list falls back to the column pickers.
  function rowsFromPaste(): { gene: string; score: number }[] {
    const de = detectDeseqTable(pasteText);
    if (de?.stats) {
      toast.success('Differential expression table detected', {
        description: `Ranked by ${de.statSource}`,
      });
      return de.stats;
    }
    // Only trailing whitespace is trimmed: a leading tab marks an empty row-name header.
    const lines = pasteText
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+$/, ''))
      .filter((l) => l.trim() && !l.startsWith('#'));
    if (lines.length === 0) return [];
    const detected = detectColumns(lines[0]);
    if (detected) {
      geneCol = String(detected.gene);
      scoreCol = String(detected.score);
      toast.success('Header detected', {
        description: `gene column ${detected.gene}, score column ${detected.score} (${detected.scoreName})`,
      });
    }
    // Skip first line if it isn't numeric in the score column (i.e., it's a header)
    const startIdx = parseLine(lines[0]) === null ? 1 : 0;
    const raw: { gene: string; score: number }[] = [];
    for (let i = startIdx; i < lines.length; i++) {
      const p = parseLine(lines[i]);
      if (p) raw.push(p);
    }
    return raw;
  }

  async function parsePaste() {
    if (!pasteText.trim()) {
      ranked = [];
      return;
    }
    const raw = rowsFromPaste();
    if (raw.length === 0) {
      toast.error('No parseable rows', {
        description: 'Check column indices and that the score column is numeric.',
      });
      return;
    }

    resolving = true;
    try {
      const tokens = raw.map((r) => r.gene);
      const lookup = await bulkLookup(tokens);
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const lowerToWb = new Map<string, string>();
      for (const h of lookup.hits) lowerToWb.set(h.input.toLowerCase(), h.wormbase_gene);
      const resolved: GseaInput[] = [];
      const dropped: string[] = [];
      for (const r of raw) {
        const wb = lowerToWb.get(r.gene.toLowerCase());
        if (wb) resolved.push({ gene: wb, score: r.score });
        else dropped.push(r.gene);
      }
      ranked = resolved;
      if (resolved.length > 0) lastInputs.stash('ranked', pasteText);
      const repeated = resolved.length - new Set(resolved.map((r) => r.gene)).size;
      if (repeated > 0) {
        toast.warning(`${repeated} gene${repeated === 1 ? '' : 's'} listed more than once`, {
          description: 'Each keeps its strongest score (largest absolute value) in the ranking.',
        });
      }
      if (dropped.length) {
        toast.warning(`${dropped.length} gene${dropped.length === 1 ? '' : 's'} not resolved`, {
          description: dropped.slice(0, 5).join(', ') + (dropped.length > 5 ? '...' : ''),
        });
      } else {
        toast.success('Resolved', {
          description: `${resolved.length} ranked genes ready for GSEA`,
        });
      }

      // Warn if scores look unsigned (all positive/negative) or heavily zero-tied: GSEA needs
      // signed scores (e.g. DESeq2 Wald stat); abs(stat)/-log10(padj)/padj produces one-sided nonsense.
      if (resolved.length >= 10) {
        let negs = 0,
          pos = 0,
          zeros = 0,
          max = -Infinity,
          min = Infinity;
        for (const r of resolved) {
          if (r.score > 0) pos++;
          else if (r.score < 0) negs++;
          else zeros++;
          if (r.score > max) max = r.score;
          if (r.score < min) min = r.score;
        }
        if (negs === 0 && pos > 0) {
          toast.warning('All scores are positive', {
            description: `Ranked-list enrichment needs signed scores, for example the DESeq2 stat. Absolute values, -log10(padj) and padj give no meaningful result. Range: ${min.toFixed(2)} to ${max.toFixed(2)}`,
          });
        } else if (pos === 0 && negs > 0) {
          toast.warning('All scores are negative', {
            description: `The scores need both positive and negative values. Did you negate the score column? Range: ${min.toFixed(2)} to ${max.toFixed(2)}`,
          });
        } else if (zeros > resolved.length * 0.3) {
          toast.warning(`${zeros} of ${resolved.length} scores are zero`, {
            description:
              'Genes tied at 0 keep the order you pasted them in. Rank by the DESeq2 Wald statistic (stat), which has fewer ties than the adjusted p-value (padj).',
          });
        }
      }
    } finally {
      resolving = false;
    }
  }

  function loadExample() {
    // Synthetic ranking around insulin/IIS genes for a sanity check
    pasteText = [
      'gene\tstat',
      'daf-16\t8.5',
      'daf-2\t-7.2',
      'age-1\t-5.6',
      'akt-1\t-4.9',
      'sgk-1\t-4.2',
      'hsf-1\t3.8',
      'skn-1\t3.5',
      'sod-3\t6.1',
      'mtl-1\t5.4',
      'hsp-16.2\t4.7',
      'unc-22\t0.2',
      'myo-3\t-0.1',
      'lin-3\t1.2',
      'let-60\t-0.8',
      'lin-1\t-1.4',
      'col-19\t2.1',
      'rol-6\t-2.3',
    ].join('\n');
  }
</script>

<svelte:head><title>Ranked-list enrichment · wormie.bio</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <div class="flex items-center justify-between">
    <Button variant="ghost" size="sm" href="/" class="self-start">
      <ArrowLeft />
      Back
    </Button>
    <div class="flex gap-2">
      <Button variant="outline" size="sm" href={resolve('/gsea/overlap')}>
        Leading-edge overlap (UpSet)
      </Button>
      <Button
        variant="outline"
        size="sm"
        href={resolve('/gsea/intersect')}
        title="Gene sets that pass in several saved ranked-list runs (bundles) with the same direction"
      >
        Ranked-list consensus
      </Button>
    </div>
  </div>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Ranked-list enrichment</h1>
    <p class="text-sm text-muted-foreground">
      Gene sets whose members sit near the top or bottom of a ranked gene list
    </p>
  </header>

  <PageHint id="gsea" title="What this step does">
    Over-representation needs you to draw a line: a gene is in your list or it is not. That throws
    away everything just below the line, and a real but modest response often leaves no single gene
    significant. Ranked-list enrichment (preranked GSEA) draws no line. Order every gene by a
    statistic (usually the one from a differential expression run, where the largest positive values
    are the most convincingly up and the largest negative the most convincingly down). Then, for
    each gene set, ask whether its members cluster near one end of that ordering or are scattered
    through it. A set whose genes all shift a little together will show up here and not in an
    over-representation test. Each set gets a <b>normalized enrichment score (NES)</b> (positive means
    shifted toward the top of your ranking, negative toward the bottom) and a q-value (p-value adjusted
    for testing many sets, the false discovery rate). For gene set enrichment analysis (GSEA), a q-value
    of 0.25 or lower is the usual cutoff, looser than the 0.05 used elsewhere. Click any set to see where
    its genes fell.
  </PageHint>

  <Card>
    <CardHeader>
      <CardTitle class="text-xl">Ranked-list enrichment</CardTitle>
      <div class="text-sm text-muted-foreground">
        Paste a ranked list with one gene and one score per line. Each gene set gets a running
        enrichment score (Subramanian et al. 2005): a sum that steps up at each member of the set
        and down at each non-member. P-values come from permutations, as in fgsea (an R package for
        fast preranked GSEA). The score is typically the Wald statistic from a DESeq2 contrast
        (recommended) or the log2 fold change.
      </div>
    </CardHeader>
    <CardContent class="space-y-3">
      <div class="flex flex-wrap items-end gap-3">
        <label class="block">
          <span
            class="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Gene column (1-based)
          </span>
          <Input bind:value={geneCol} type="number" min="1" class="h-8 w-20 text-sm" />
        </label>
        <label class="block">
          <span
            class="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Score column
          </span>
          <Input bind:value={scoreCol} type="number" min="1" class="h-8 w-20 text-sm" />
        </label>
        <div class="ml-auto text-xs text-muted-foreground">
          Tab-, comma-, or whitespace-separated. A header row is detected automatically.
          <button type="button" onclick={loadExample} class="ml-2 text-primary hover:underline">
            Try example
          </button>
        </div>
      </div>
      <textarea
        bind:value={pasteText}
        rows="9"
        placeholder="gene&#9;stat&#10;daf-16&#9;8.5&#10;daf-2&#9;-7.2&#10;age-1&#9;-5.6&#10;..."
        class="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      ></textarea>
      <div class="flex flex-wrap items-center gap-2">
        <SaveDatasetButton type="ranked" body={() => pasteText} disabled={!pasteText.trim()} />
        <SaveSessionButton
          disabled={!pasteText.trim()}
          build={() =>
            ({
              v: 1,
              tool: 'gsea',
              inputs: { ranked: pasteText },
              params: { geneCol, scoreCol },
            }) satisfies Session}
          getResults={() => (Object.keys(latestResults).length > 0 ? latestResults : null)}
        />
        <LoadDatasetPicker
          type={['ranked', 'deseq2', 'gene-list']}
          onload={async (ds) => {
            pasteText = ds.body;
            toast.success('Loaded', { description: `${ds.name} (${ds.type})` });
            // Auto-run. gene-list datasets sometimes contain DESeq2 CSVs (the /enrichment pane
            // saves under gene-list regardless of content); parser finds the stat column if present.
            await parsePaste();
          }}
        />
        <LoadLastButton type="ranked" onload={(body) => (pasteText = body)} />
        <Button onclick={parsePaste} disabled={resolving || !pasteText.trim()}>
          {resolving ? 'Resolving...' : 'Resolve & run'}
        </Button>
        <ControlHint id="gsea-resolve" title="Resolve & run">
          Maps gene names to WormBase gene IDs (WBGene), then runs gene set enrichment analysis
          (GSEA) on the active term kind. Switching to another tab (GO, Phenotype, WormCat, ...)
          reuses the same ranked list. Results are cached, so an identical run returns at once.
        </ControlHint>
        {#if ranked.length > 0}
          <span class="text-xs text-muted-foreground">
            {ranked.length} ranked genes ready
          </span>
          <Button variant="outline" size="sm" onclick={shareAnalysis}>
            <Share class="h-3.5 w-3.5" />
            Share link
          </Button>
          <ControlHint id="gsea-share" title="Share link">
            Copies a URL that holds your ranked list in its <code>#b=...</code> part (compressed with
            gzip, then written as base64 text). Opening the URL restores the analysis. The browser never
            sends that part to a server.
          </ControlHint>
        {/if}
      </div>
    </CardContent>
  </Card>

  {#if ranked.length === 0}
    <RecentRunsList
      onResume={(r, run) => {
        ranked = r;
        deeplinkKind = run.kind;
        toast.success('Resumed analysis', {
          description: `${r.length} ranked genes · ${run.kind}`,
        });
      }}
    />
  {/if}

  <div class="flex justify-end">
    <MethodsButton
      ctx={{ tool: 'gsea', params: gseaParams, inputSummary: `${ranked.length} ranked genes` }}
    />
  </div>
  <GseaResults
    {ranked}
    {deeplinkKind}
    {deeplinkTerm}
    imported={importedFromSession}
    onResults={(r) => (latestResults = r as Record<string, unknown>)}
    onParams={(p) => (gseaParams = p)}
  />
</div>
