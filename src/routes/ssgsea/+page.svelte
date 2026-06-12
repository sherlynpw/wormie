<script lang="ts">
  import { runCustomSsgsea, type CustomTermSet, type SsgseaScores } from '$lib/db/client';
  import SsgseaResults from '$lib/components/SsgseaResults.svelte';
  import MethodsButton from '$lib/components/MethodsButton.svelte';
  import { toast } from 'svelte-sonner';

  let exprText = $state('');
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

<svelte:head><title>ssGSEA · wormie.rs.ht</title></svelte:head>

<div class="container mx-auto max-w-6xl space-y-6 p-4">
  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Single-sample GSEA</h1>
    <p class="text-sm text-muted-foreground">
      Barbie 2009 / GSVA::ssgseaParam. Per-sample, per-set enrichment scores from an expression
      matrix and a custom GMT. Computation runs in a Web Worker; no data leaves the browser.
      Validated to <code>cor = 1.0000</code> against R GSVA on synthetic data.
    </p>
  </header>

  <div class="grid gap-4 md:grid-cols-2">
    <section class="space-y-2">
      <label class="block text-sm font-medium" for="expr">Expression matrix (genes × samples)</label
      >
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
      <label class="block text-sm font-medium" for="gmt">Gene sets (GMT)</label>
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
