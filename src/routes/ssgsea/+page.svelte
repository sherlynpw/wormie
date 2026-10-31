<script lang="ts">
  import { runCustomSsgsea, type CustomTermSet, type SsgseaScores } from '$lib/db/client';
  import SsgseaResults from '$lib/components/SsgseaResults.svelte';
  import MethodsButton from '$lib/components/MethodsButton.svelte';
  import PageHint from '$lib/components/PageHint.svelte';
  import ControlHint from '$lib/components/ControlHint.svelte';
  import { toast } from 'svelte-sonner';
  import { getTermSets, bulkLookup } from '$lib/queries';
  import { ENRICHMENT_KINDS, type EnrichmentKind } from '$lib/enrichment';
  import { resolve } from '$app/paths';
  import { Button } from '$lib/components/ui/button';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { handoff } from '$lib/pipeline-handoff';
  import SsgseaTrendResults from '$lib/components/SsgseaTrendResults.svelte';
  import {
    parseSampleTable,
    isNumericColumn,
    checkDesign,
    runTrendTest,
    type TrendModel,
    type TrendResult,
  } from '$lib/ssgsea-trend';

  let exprText = $state('');
  let exprSource = $state('');

  onMount(async () => {
    const params = page.url.searchParams;
    if (params.get('from') === 'de') {
      const h = handoff.ssgsea.consume();
      if (!h) return;
      exprText = h.tsv;
      exprSource = h.label;
      if (h.designTsv) {
        sampleText = h.designTsv;
        sampleSource = 'design from /de';
      }
      toast.success('Loaded expression matrix from /de', { description: h.label });
      return;
    }
    const id = params.get('id');
    if (params.get('load') === 'counts' && id) {
      const { datasets } = await import('$lib/stores/datasets.svelte');
      const ds = await datasets.getById(id);
      if (ds) {
        exprText = ds.body;
        exprSource = ds.name;
        toast.success('Loaded', { description: ds.name });
      }
    }
  });
  let gmtText = $state('');
  // Sets can come from the shipped annotations or a GMT; the maths is identical,
  // only the definition of a set differs.
  let setSource = $state<'builtin' | 'gmt'>('builtin');
  let builtinKind = $state<EnrichmentKind>('wormcat');
  // Same collections as over-representation and ranked-list enrichment.
  const BUILTIN_KINDS = ENRICHMENT_KINDS;
  let minSize = $state(15);
  let maxSize = $state(500);
  let alpha = $state(0.25);
  let normalize = $state(true);
  let running = $state(false);
  let results = $state<SsgseaScores[]>([]);
  let sampleNames = $state<string[]>([]);
  let elapsed = $state<number | null>(null);

  // Trend test on the score matrix (limma, in WebR).
  let sampleText = $state('');
  let sampleSource = $state('');
  let variable = $state('');
  let trendModel = $state<TrendModel>('linear');
  let splineDf = $state(3);
  let testing = $state(false);
  let trend = $state<TrendResult | null>(null);
  let trendLog = $state<string[]>([]);
  const sampleTable = $derived(parseSampleTable(sampleText));
  $effect(() => {
    const t = sampleTable;
    if (t && !t.columns.includes(variable)) variable = t.columns[0] ?? '';
  });
  // A numeric column defaults to the linear model, text to the factor model.
  $effect(() => {
    const t = sampleTable;
    if (!t || !variable) return;
    const numeric = isNumericColumn(t, variable);
    if (!numeric) trendModel = 'factor';
    else if (trendModel === 'factor') trendModel = 'linear';
  });
  const designCheck = $derived.by(() => {
    const t = sampleTable;
    if (!t || !variable || sampleNames.length === 0) return null;
    const valueOf = new Map(t.samples.map((s, i) => [s, t.rows[i][variable]]));
    const missing = sampleNames.filter((s) => !valueOf.has(s));
    if (missing.length)
      return { ok: false as const, reason: `no row for sample ${missing[0]} in the sample table` };
    return checkDesign(
      sampleNames.map((s) => valueOf.get(s)!),
      trendModel,
      splineDf,
    );
  });

  async function testTrend() {
    const t = sampleTable;
    if (!t) {
      toast.error('No sample table detected', {
        description: 'A header row, then one line per sample: its name, then the variable.',
      });
      return;
    }
    if (designCheck && !designCheck.ok) {
      toast.error('Cannot test', { description: designCheck.reason + '.' });
      return;
    }
    testing = true;
    trendLog = [];
    try {
      trend = await runTrendTest({
        scores: results,
        sampleNames,
        table: t,
        variable,
        model: trendModel,
        splineDf,
        onLine: (s) => (trendLog = [...trendLog.slice(-7), s]),
      });
      const n = trend.rows.filter((r) => r.adjP < 0.05).length;
      toast.success(`Trend test: ${n} of ${trend.rows.length} sets at adjusted p < 0.05`, {
        description: `${(trend.elapsedMs / 1000).toFixed(1)}s`,
      });
    } catch (e) {
      toast.error('Trend test failed', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      testing = false;
    }
  }

  function parseExpr(
    text: string,
  ): { genes: string[]; samples: string[]; matrix: Float64Array } | null {
    const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    if (lines.length < 2) return null;
    const header = lines[0].split(/\t|,/);
    const samples = header.slice(1);
    const genes: string[] = [];
    const buf: number[] = [];
    for (let i = 1; i < lines.length; i++) {
      const f = lines[i].split(/\t|,/).map((x) => x.trim().replace(/^"+|"+$/g, ''));
      if (f.length < samples.length + 1) continue;
      const vals = f.slice(1, samples.length + 1).map(Number);
      // An NA cell would make the per-sample ranking undefined; drop the gene instead.
      if (!vals.every(Number.isFinite)) continue;
      genes.push(f[0]);
      buf.push(...vals);
    }
    return { genes, samples, matrix: Float64Array.from(buf) };
  }

  // Built-in gene sets are keyed by WBGene ID, so a matrix keyed by names, sequence
  // names or aliases is resolved first. Two rows resolving to one gene keep the row
  // with the higher mean expression.
  async function resolveExprGenes(expr: {
    genes: string[];
    samples: string[];
    matrix: Float64Array;
  }): Promise<{ genes: string[]; samples: string[]; matrix: Float64Array; unmatched: number }> {
    if (expr.genes.every((g) => /^WBGene\d+$/.test(g))) return { ...expr, unmatched: 0 };
    const { hits } = await bulkLookup(expr.genes);
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const toWb = new Map<string, string>();
    for (const h of hits)
      if (!toWb.has(h.input.toLowerCase())) toWb.set(h.input.toLowerCase(), h.wormbase_gene);
    const S = expr.samples.length;
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const best = new Map<string, { row: number; mean: number }>();
    let unmatched = 0;
    expr.genes.forEach((g, i) => {
      const wb = toWb.get(g.toLowerCase());
      if (!wb) {
        unmatched++;
        return;
      }
      let sum = 0;
      for (let s = 0; s < S; s++) sum += expr.matrix[i * S + s];
      const prev = best.get(wb);
      if (!prev || sum / S > prev.mean) best.set(wb, { row: i, mean: sum / S });
    });
    const genes = [...best.keys()];
    const matrix = new Float64Array(genes.length * S);
    genes.forEach((wb, k) => {
      const i = best.get(wb)!.row;
      matrix.set(expr.matrix.subarray(i * S, i * S + S), k * S);
    });
    return { genes, samples: expr.samples, matrix, unmatched };
  }

  function parseGmt(text: string): CustomTermSet[] {
    return text
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#'))
      .map((l) => {
        const f = l.split('\t');
        return { term_id: f[0], name: f[1] || f[0], genes: f.slice(2).filter(Boolean) };
      })
      .filter((s) => s.genes.length > 0);
  }

  async function pickFile(target: 'expr' | 'gmt') {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.tsv,.csv,.txt,.gmt';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const text = await f.text();
      if (target === 'expr') exprText = text;
      else gmtText = text;
    };
    input.click();
  }

  async function run() {
    const parsed = parseExpr(exprText);
    if (!parsed || parsed.genes.length === 0) {
      toast.error('No expression matrix detected');
      return;
    }
    running = true;
    const expr = setSource === 'gmt' ? { ...parsed, unmatched: 0 } : await resolveExprGenes(parsed);
    if (expr.genes.length === 0) {
      running = false;
      toast.error('No genes in the matrix were recognized', {
        description: 'The first column should hold gene names, sequence names or WormBase IDs.',
      });
      return;
    }
    if (expr.unmatched > 0) {
      toast.warning(`${expr.unmatched} of ${parsed.genes.length} genes not recognized`, {
        description: 'They are left out of the scores.',
      });
    }
    let sets: CustomTermSet[];
    try {
      // Size limits apply to the genes each set has in the matrix, as GSVA filters them,
      // so the built-in sets are fetched unfiltered and sized in the worker.
      sets =
        setSource === 'gmt'
          ? parseGmt(gmtText)
          : await getTermSets(builtinKind, { minSize: 1, maxSize: Number.MAX_SAFE_INTEGER });
    } catch (e) {
      running = false;
      toast.error('Could not build gene sets', {
        description: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    if (sets.length === 0) {
      running = false;
      toast.error(setSource === 'gmt' ? 'No gene sets parsed' : 'No sets in that size range');
      return;
    }
    const t0 = performance.now();
    try {
      const res = await runCustomSsgsea(
        { genes: expr.genes, samples: expr.samples, matrix: expr.matrix },
        sets,
        setSource === 'gmt' ? { alpha, normalize } : { alpha, normalize, minSize, maxSize },
      );
      results = res.results;
      sampleNames = res.sampleNames;
      elapsed = performance.now() - t0;
      if (res.results.length === 0) {
        toast.error('No gene set shares genes with the matrix', {
          description:
            setSource === 'gmt'
              ? 'Check that the GMT and the matrix use the same gene identifiers.'
              : `Each set needs ${minSize} to ${maxSize} of its genes present in the matrix.`,
        });
      } else {
        toast.success(
          `Per-sample gene set scoring: ${res.results.length} sets · ${(elapsed / 1000).toFixed(1)}s`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      running = false;
    }
  }
</script>

<svelte:head><title>Per-sample gene set scoring · wormie.rs.ht</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href={resolve('/')} class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Per-sample gene set scoring</h1>
    <p class="text-sm text-muted-foreground">One score per gene set, per sample</p>
  </header>

  <PageHint id="ssgsea.intro" title="What this step does">
    The method is single-sample gene set enrichment analysis (ssGSEA). Each sample is scored on its
    own: its genes are sorted from highest to lowest expression, and the score says how near the top
    of that sample's ranking a gene set's members sit. Positive means concentrated near the top,
    negative near the bottom. Nothing is compared between samples, so use this when there are no two
    groups to contrast: a time course, a panel of strains, single worms. Every set scored in every
    sample gives one matrix:
    <pre
      class="my-2 overflow-x-auto rounded bg-background/60 p-2 font-mono text-[0.65rem] leading-relaxed">                 WT.D1  WT.D3  WT.D7  mut.D1  mut.D3  mut.D7
neuronal          0.31   0.28   0.19    0.30    0.44    0.52
mitochondrial     0.12   0.15   0.14    0.11    0.09    0.07</pre>
    One row per gene set, one column per sample, with replicates as their own columns.
    <br /><br />
    <b>Run every sample you mean to compare in one go.</b> Scores are divided by the range across
    the whole matrix, so adding a sample or a gene set shifts every number. Two separate runs cannot
    be compared, even for the same set.
    <br /><br />
    <b>The scores are descriptive, not a test.</b> There are no p-values in the matrix, so a
    difference between 0.44 and 0.30 is a starting point rather than a result. To make a claim, use
    the <b>Test a trend</b> step below the scores: it fits one linear model per set across the samples.
    The authors of gene set variation analysis (GSVA) recommend this for testing per-sample scores. With
    one sample per condition no test is possible, so read the plot as a description only.
  </PageHint>

  <div class="grid gap-4 md:grid-cols-2">
    <section class="space-y-2">
      <label class="block text-sm font-medium" for="expr">
        Expression matrix (genes × samples)
        <ControlHint id="ssgsea-expr" title="Which values to paste">
          Genes down the rows, samples across the columns, one expression value per cell, tab or
          comma separated with a header row of sample names. The <b
            >Continue to per-sample gene set scoring</b
          >
          button on the differential expression page sends one of these for you.
          <br /><br />
          Genes are ranked inside each sample, so library size does not matter and normalizing across
          samples changes nothing: counts, normalized counts and a variance-stabilized matrix all give
          the same scores. What matters is whether two genes in the same sample can be compared with each
          other, which means correcting for gene length. Transcripts per million (TPM) and reads per kilobase
          per million (RPKM) do that. Counts do not, so a longer gene ranks above a shorter one at the
          same expression level. The same holds for normalized counts and for a variance-stabilized matrix,
          since neither corrects for gene length. The bias is the same in every sample, so it has little
          effect when you compare one sample with another. It matters when one set's score is read against
          a different set's.
        </ControlHint>
        {#if exprSource}
          <span class="ml-1 font-normal text-muted-foreground">· {exprSource}</span>
        {/if}
      </label>
      <textarea
        id="expr"
        class="h-48 w-full rounded border bg-background p-2 font-mono text-xs"
        placeholder="gene&#9;s1&#9;s2&#9;s3&#10;WBGene00000001&#9;5.2&#9;6.1&#9;4.8&#10;..."
        bind:value={exprText}
      ></textarea>
      <button
        class="rounded border px-2 py-1 text-xs hover:bg-accent"
        onclick={() => pickFile('expr')}>Upload TSV</button
      >
    </section>

    <section class="space-y-2">
      <label class="block text-sm font-medium" for="gmt">
        Gene sets
        <ControlHint id="ssgsea-gmt" title="Where gene sets come from">
          A gene set is just a named group of genes. Use the annotations built into the site:
          WormCat categories, Gene Ontology (GO) terms, phenotypes, tissues. Or supply your own as a
          Gene Matrix Transposed (GMT) file: one set per line, its name, a description, then its
          genes, separated by tabs. The Molecular Signatures Database (MSigDB) publishes ready-made
          collections, and a spreadsheet saved as tab-separated text works too.
          <br /><br />
          Very small sets score noisily and very large ones say little about any one sample, so the size
          range removes both. The size counts only the genes of the set that are in your matrix. The score
          is always computed the same way: how near the top of a sample's ranking the genes of the set
          sit.
        </ControlHint>
      </label>

      <div class="inline-flex overflow-hidden rounded-md border text-xs">
        {#each [{ key: 'builtin', label: 'Built-in annotations' }, { key: 'gmt', label: 'My own GMT' }] as opt (opt.key)}
          <button
            type="button"
            onclick={() => (setSource = opt.key as typeof setSource)}
            class={setSource === opt.key
              ? 'bg-accent px-2 py-1 text-accent-foreground'
              : 'bg-card px-2 py-1 text-muted-foreground hover:bg-accent/50'}
          >
            {opt.label}
          </button>
        {/each}
      </div>

      {#if setSource === 'builtin'}
        <div class="flex flex-wrap items-end gap-2 text-xs">
          <label class="block">
            <span class="mb-1 block text-[0.65rem] uppercase tracking-wider text-muted-foreground">
              Annotation
            </span>
            <select
              bind:value={builtinKind}
              class="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              {#each BUILTIN_KINDS as k (k.key)}
                <option value={k.key}>{k.label}</option>
              {/each}
            </select>
          </label>
          <label class="block">
            <span class="mb-1 block text-[0.65rem] uppercase tracking-wider text-muted-foreground">
              Min genes
            </span>
            <input
              type="number"
              min="2"
              bind:value={minSize}
              class="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>
          <label class="block">
            <span class="mb-1 block text-[0.65rem] uppercase tracking-wider text-muted-foreground">
              Max genes
            </span>
            <input
              type="number"
              min="10"
              bind:value={maxSize}
              class="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>
        </div>
      {/if}
      {#if setSource === 'gmt'}
        <textarea
          id="gmt"
          class="h-48 w-full rounded border bg-background p-2 font-mono text-xs"
          placeholder="SET01&#9;Description&#9;WBGene00000001&#9;WBGene00000002&#9;...&#10;SET02&#9;..."
          bind:value={gmtText}
        ></textarea>
        <button
          class="rounded border px-2 py-1 text-xs hover:bg-accent"
          onclick={() => pickFile('gmt')}>Upload GMT</button
        >
      {/if}
    </section>
  </div>

  <section class="flex flex-wrap items-center gap-3 text-sm">
    <label
      title="Exponent that weights each gene in a set by its rank in the sample. 0 gives every member equal weight. Higher values give more weight to genes near the top. Default 0.25."
    >
      α
      <input
        type="number"
        step="0.05"
        class="ml-1 w-20 rounded border bg-background px-1 py-0.5"
        bind:value={alpha}
      />
    </label>
    <label
      class="inline-flex items-center gap-1"
      title="Divide all scores by the range (highest minus lowest) across the whole matrix"
    >
      <input type="checkbox" bind:checked={normalize} /> normalize
    </label>
    <button
      class="rounded bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      onclick={run}
      disabled={running}
    >
      {running ? 'Running…' : 'Run scoring'}
    </button>
    {#if elapsed !== null}
      <span class="text-muted-foreground">{(elapsed / 1000).toFixed(2)}s</span>
    {/if}
  </section>

  {#if results.length > 0}
    <div class="flex justify-end">
      <MethodsButton
        ctx={{
          tool: 'ssgsea',
          params: { alpha, normalize },
          inputSummary: `${results.length} sets, ${sampleNames.length} samples`,
        }}
      />
    </div>
    <SsgseaResults {results} {sampleNames} />

    <section class="space-y-3 rounded-md border p-3">
      <h2 class="inline-flex items-center gap-1.5 text-base font-semibold">
        Test a trend
        <ControlHint id="ssgsea-trend" title="What the trend test does">
          For every gene set, its scores across the samples are fitted to a linear model on one
          column of the sample table. A number such as day or dose gives a slope and a t-test on it.
          A label such as condition or timepoint gives an F-test across its levels, which catches a
          rise and fall as well as a steady change. A natural spline (a smooth curve built from
          several pieces) of the number does the same for a curved time course; it needs five or
          more distinct values. The fit uses limma (an R package for linear models; functions lmFit
          and eBayes), which shares variance information across sets. P-values are adjusted across
          sets by the Benjamini-Hochberg method, which controls the false discovery rate (FDR). The
          authors of gene set variation analysis (GSVA) recommend this design for per-sample scores
          (Hanzelmann et al. 2013). It runs in the browser through WebR (R compiled to run in the
          browser); the first run of a session starts R, which takes about a minute.
          <br /><br />
          When every level has one sample there is no variance to test against. The step then says so
          instead of fitting.
        </ControlHint>
      </h2>
      <div class="grid gap-4 md:grid-cols-2">
        <div class="space-y-2">
          <label class="block text-sm font-medium" for="sample-table">
            Sample table
            {#if sampleSource}
              <span class="ml-1 font-normal text-muted-foreground">· {sampleSource}</span>
            {/if}
          </label>
          <textarea
            id="sample-table"
            class="h-32 w-full rounded border bg-background p-2 font-mono text-xs"
            placeholder="sample&#9;day&#9;condition&#10;WT.D1&#9;1&#9;WT&#10;WT.D3&#9;3&#9;WT&#10;..."
            bind:value={sampleText}
          ></textarea>
          <p class="text-xs text-muted-foreground">
            One line per sample in the matrix, its name first, then one column per variable.
          </p>
        </div>
        <div class="space-y-2 text-sm">
          <label class="block">
            <span class="mb-1 block text-[0.65rem] uppercase tracking-wider text-muted-foreground">
              Variable
            </span>
            <select
              bind:value={variable}
              class="h-8 rounded-md border border-input bg-background px-2 text-sm"
              disabled={!sampleTable}
            >
              {#each sampleTable?.columns ?? [] as c (c)}
                <option value={c}>{c}</option>
              {/each}
            </select>
          </label>
          <label class="block">
            <span class="mb-1 block text-[0.65rem] uppercase tracking-wider text-muted-foreground">
              Model
            </span>
            <select
              bind:value={trendModel}
              class="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="linear">Linear in the variable (slope)</option>
              <option value="factor">Factor: F-test across levels</option>
              <option value="spline">Natural spline in the variable (time course)</option>
            </select>
          </label>
          {#if trendModel === 'spline'}
            <label class="block">
              <span
                class="mb-1 block text-[0.65rem] uppercase tracking-wider text-muted-foreground"
              >
                Spline df
              </span>
              <input
                type="number"
                min="2"
                max="6"
                title="Degrees of freedom (df) of the spline. Higher values allow a more flexible curve."
                bind:value={splineDf}
                class="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm"
              />
            </label>
          {/if}
          {#if designCheck}
            {#if designCheck.ok}
              <p class="text-xs text-muted-foreground">
                {designCheck.residualDf} residual degrees of freedom{designCheck.levels.length
                  ? ` · levels: ${designCheck.levels.join(', ')}`
                  : ''}
              </p>
            {:else}
              <p class="text-xs text-destructive">Cannot test: {designCheck.reason}.</p>
            {/if}
          {/if}
          <button
            class="rounded bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onclick={testTrend}
            disabled={testing ||
              !sampleTable ||
              !variable ||
              (designCheck ? !designCheck.ok : false)}
          >
            {testing ? 'Testing…' : 'Test trend'}
          </button>
          {#if testing && trendLog.length}
            <pre
              class="max-h-24 overflow-auto rounded bg-muted/40 p-2 font-mono text-[0.65rem]">{trendLog.join(
                '\n',
              )}</pre>
          {/if}
        </div>
      </div>
      {#if trend}
        <div class="flex justify-end">
          <MethodsButton
            ctx={{
              tool: 'ssgsea',
              params: {
                alpha,
                normalize,
                trend: {
                  model: trend.model,
                  variable: trend.variable,
                  splineDf,
                  sets: trend.rows.length,
                  samples: sampleNames.length,
                },
              },
              inputSummary: `${results.length} sets, ${sampleNames.length} samples`,
            }}
          />
        </div>
        <SsgseaTrendResults result={trend} />
      {/if}
    </section>
  {/if}
</div>
