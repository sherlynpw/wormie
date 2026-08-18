<script lang="ts">
  import { runCustomSsgsea, type CustomTermSet, type SsgseaScores } from '$lib/db/client';
  import SsgseaResults from '$lib/components/SsgseaResults.svelte';
  import MethodsButton from '$lib/components/MethodsButton.svelte';
  import PageHint from '$lib/components/PageHint.svelte';
  import ControlHint from '$lib/components/ControlHint.svelte';
  import { toast } from 'svelte-sonner';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { handoff } from '$lib/pipeline-handoff';

  let exprText = $state('');
  let exprSource = $state('');

  onMount(() => {
    if (page.url.searchParams.get('from') !== 'de') return;
    const h = handoff.ssgsea.consume();
    if (!h) return;
    exprText = h.tsv;
    exprSource = h.label;
    toast.success('Loaded expression matrix from /de', { description: h.label });
  });
  let gmtText = $state('');
  let alpha = $state(0.25);
  let normalize = $state(true);
  let running = $state(false);
  let results = $state<SsgseaScores[]>([]);
  let sampleNames = $state<string[]>([]);
  let elapsed = $state<number | null>(null);

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
      const f = lines[i].split(/\t|,/);
      if (f.length < samples.length + 1) continue;
      genes.push(f[0]);
      for (let j = 1; j <= samples.length; j++) buf.push(Number(f[j]));
    }
    return { genes, samples, matrix: Float64Array.from(buf) };
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
    const expr = parseExpr(exprText);
    const sets = parseGmt(gmtText);
    if (!expr || expr.genes.length === 0) {
      toast.error('No expression matrix detected');
      return;
    }
    if (sets.length === 0) {
      toast.error('No gene sets parsed');
      return;
    }
    running = true;
    const t0 = performance.now();
    try {
      const res = await runCustomSsgsea(expr, sets, { alpha, normalize });
      results = res.results;
      sampleNames = res.sampleNames;
      elapsed = performance.now() - t0;
      toast.success(`ssGSEA: ${res.results.length} sets · ${(elapsed / 1000).toFixed(1)}s`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      running = false;
    }
  }
</script>

<svelte:head><title>Single-sample GSEA · wormie.rs.ht</title></svelte:head>

<div class="container mx-auto max-w-6xl space-y-6 p-4">
  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Single-sample GSEA</h1>
    <p class="text-sm text-muted-foreground">One score per gene set, per sample</p>
  </header>

  <PageHint id="ssgsea.intro" title="What you get, and what to do with it">
    Each sample is scored on its own: its genes are sorted from highest to lowest expression, and
    the score says how near the top of that sample's ranking a gene set's members sit. Positive
    means concentrated near the top, negative near the bottom. Nothing is compared, so this is the
    method to reach for when there are no two groups to contrast: a time course, a panel of strains,
    single worms. Every set scored in every sample gives one matrix:
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
    <b>The scores are descriptive, not a test.</b> There are no p-values here, so a difference between
    0.44 and 0.30 is a starting point rather than a result. To make a claim, export the matrix and test
    the scores across replicates, a t-test per set or limma on the set-by-sample matrix, just as you would
    with expression values. With one sample per condition no test is possible and the plot is the whole
    story.
  </PageHint>

  <div class="grid gap-4 md:grid-cols-2">
    <section class="space-y-2">
      <label class="block text-sm font-medium" for="expr">
        Expression matrix (genes × samples)
        <ControlHint id="ssgsea-expr" title="Which values to paste">
          Genes down the rows, samples across the columns, one expression value per cell, tab or
          comma separated with a header row of sample names. The <b>Continue to ssGSEA</b> button on
          the differential expression page sends one of these for you.
          <br /><br />
          Use values that are comparable between genes within a sample: TPM, RPKM, or a variance-stabilised
          matrix. Genes are ranked inside each sample, so library size does not matter and normalising
          across samples changes nothing. Raw counts do work, but longer genes then rank above shorter
          ones at the same expression level, because nothing has corrected for gene length.
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
        Gene sets (GMT)
        <ControlHint id="ssgsea-gmt" title="Where gene sets come from">
          One set per line: its name, a description, then its genes, separated by tabs. MSigDB
          publishes ready-made collections, or write your own in a spreadsheet and save as
          tab-separated text. Sets much smaller than about fifteen genes give noisy scores.
        </ControlHint>
      </label>
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
    </section>
  </div>

  <section class="flex flex-wrap items-center gap-3 text-sm">
    <label>
      α
      <input
        type="number"
        step="0.05"
        class="ml-1 w-20 rounded border bg-background px-1 py-0.5"
        bind:value={alpha}
      />
    </label>
    <label class="inline-flex items-center gap-1">
      <input type="checkbox" bind:checked={normalize} /> normalize
    </label>
    <button
      class="rounded bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      onclick={run}
      disabled={running}
    >
      {running ? 'Running…' : 'Run ssGSEA'}
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
  {/if}
</div>
