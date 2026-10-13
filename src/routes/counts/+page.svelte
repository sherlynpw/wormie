<script lang="ts">
  // /counts: BAM to counts via subread featureCounts (WASM, pthread). Output is a counts.tsv for download or handoff to /de.
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Badge } from '$lib/components/ui/badge';
  import PageHint from '$lib/components/PageHint.svelte';
  import ControlHint from '$lib/components/ControlHint.svelte';
  import { onMount, untrack } from 'svelte';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import ArrowRight from 'lucide-svelte/icons/arrow-right';
  import Download from 'lucide-svelte/icons/download';
  import Play from 'lucide-svelte/icons/play';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { toast } from 'svelte-sonner';
  import { onDestroy } from 'svelte';
  import { createFeatureCountsClient, prefetchFeatureCounts } from '$lib/featurecounts/client';
  import type { FeatureCountsResult } from '$lib/featurecounts/types';
  import { handoff } from '$lib/pipeline-handoff';
  import { parseFeatureCountsTsv } from '$lib/qc';
  import { inferGroups } from '$lib/sample-names';
  import CountsQcPanel from '$lib/components/CountsQcPanel.svelte';

  let bamFiles = $state<File[]>([]);
  let gtfFile = $state<File | null>(null);
  // featureCounts is genuinely multithreaded here, so start at the machine's core
  // count. Capped at 8 because the input caps there and memory grows per worker.
  const DEFAULT_THREADS = Math.max(
    1,
    Math.min(8, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4),
  );
  let threads = $state(DEFAULT_THREADS);
  let isPaired = $state(false);
  let strand = $state<0 | 1 | 2>(0);

  let bamInput: HTMLInputElement | null = $state(null);
  let gtfInput: HTMLInputElement | null = $state(null);

  let running = $state(false);
  let progressLines = $state<string[]>([]);
  let result = $state<FeatureCountsResult | null>(null);

  let activeClient: ReturnType<typeof createFeatureCountsClient> | null = null;
  onDestroy(() => activeClient?.terminate());

  const totalBytes = $derived(bamFiles.reduce((s, f) => s + f.size, 0) + (gtfFile?.size ?? 0));
  const canRun = $derived(bamFiles.length > 0 && gtfFile && !running);
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + ' MB';

  function addBams(incoming: File[]) {
    const seen = new Set(bamFiles.map((f) => `${f.name}:${f.size}`));
    const additions = incoming.filter((f) => !seen.has(`${f.name}:${f.size}`));
    if (additions.length === 0) return;
    bamFiles = [...bamFiles, ...additions];
  }
  function onBamPick(e: Event) {
    const input = e.target as HTMLInputElement;
    addBams(input.files ? Array.from(input.files) : []);
    // Reset so re-picking the same file still fires change.
    input.value = '';
  }
  function removeBam(f: File) {
    bamFiles = bamFiles.filter((b) => !(b.name === f.name && b.size === f.size));
  }
  function clearBams() {
    bamFiles = [];
  }

  let dragOver = $state(false);
  function onDragOver(e: DragEvent) {
    if (running) return;
    e.preventDefault();
    dragOver = true;
  }
  function onDragLeave() {
    dragOver = false;
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    if (running || !e.dataTransfer) return;
    const files = Array.from(e.dataTransfer.files);
    const bams = files.filter((f) => /\.bam$/i.test(f.name));
    const annot = files.find((f) => /\.(gtf|saf|tsv)$/i.test(f.name));
    if (bams.length) addBams(bams);
    if (annot) gtfFile = annot;
    // featureCounts here reads GTF or SAF only; GFF3 lacks the gene_id attribute it groups by.
    if (files.some((f) => /\.gff3?$/i.test(f.name))) {
      toast.error('GFF3 is not supported', {
        description: 'Use the GTF from the same release; WormBase publishes both.',
      });
    }
    const skipped = files.length - bams.length - (annot ? 1 : 0);
    if (skipped > 0) {
      toast.message(`Ignored ${skipped} file(s) (only .bam / .gtf / .saf accepted)`);
    }
  }
  // The bundled annotation is the WormBase canonical geneset for the release the
  // database was built from, fetched on demand rather than shipped in the DB.
  let bundled = $state<{ file: string; release: string; gz_size: number; format?: string } | null>(
    null,
  );
  let bundledLoading = $state(false);

  onMount(async () => {
    void prefetchFeatureCounts();
    try {
      const r = await fetch('/data/version.json', { cache: 'no-cache' });
      if (!r.ok) return;
      const v = (await r.json()) as {
        annotation?: { file: string; release: string; gz_size: number; format?: string };
      };
      if (v.annotation?.file) bundled = v.annotation;
    } catch {
      // no bundled annotation; the file picker still works
    }
  });

  async function useBundledAnnotation() {
    if (!bundled || bundledLoading) return;
    bundledLoading = true;
    try {
      const res = await fetch(`/data/${bundled.file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // featureCounts reads plain text, so unzip before staging it. A server that sends
      // Content-Encoding: gzip (the Vite dev server does for .gz) has the browser unzip it
      // already, so only bytes that still carry the gzip magic number are decompressed.
      // The extension decides how the wrapper parses it, so it has to match the format.
      const raw = new Uint8Array(await res.arrayBuffer());
      const gzipped = raw[0] === 0x1f && raw[1] === 0x8b;
      const bytes = gzipped
        ? new Uint8Array(
            await new Response(
              new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip')),
            ).arrayBuffer(),
          )
        : raw;
      const ext = bundled.format === 'saf' ? 'saf' : 'gtf';
      gtfFile = new File([bytes], `c_elegans.${bundled.release}.canonical_geneset.${ext}`, {
        type: 'text/plain',
      });
      toast.success(`Using WormBase ${bundled.release} annotation`);
    } catch (e) {
      toast.error('Could not load the bundled annotation', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      bundledLoading = false;
    }
  }

  function onGtfPick(e: Event) {
    const input = e.target as HTMLInputElement;
    gtfFile = input.files?.[0] ?? null;
    input.value = '';
  }

  async function readAll(files: File[]) {
    return Promise.all(
      files.map(async (f) => ({
        name: f.name,
        bytes: new Uint8Array(await f.arrayBuffer()),
      })),
    );
  }

  async function run() {
    if (!gtfFile || bamFiles.length === 0) return;
    running = true;
    result = null;
    progressLines = [];
    activeClient?.terminate();
    activeClient = createFeatureCountsClient();

    try {
      const [bams, annotation] = await Promise.all([
        readAll(bamFiles),
        readAll([gtfFile]).then((a) => a[0]),
      ]);
      result = await activeClient.run({ bams, annotation, threads, isPaired, strand }, (line) => {
        progressLines = [...progressLines, line];
      });
      toast.success(`featureCounts complete (${result.elapsedSec.toFixed(1)}s)`);
      warnIfStrandLooksWrong(result.summaryTsv);
    } catch (e) {
      toast.error('featureCounts failed', { description: (e as Error)?.message ?? String(e) });
    } finally {
      running = false;
    }
  }

  // Counting a stranded library the wrong way round does not fail; it just leaves most
  // reads unassigned. A typical library assigns well over half its reads, so a stranded run
  // that assigns under a fifth in some sample points at the strand setting.
  function warnIfStrandLooksWrong(summaryTsv: string) {
    if (strand === 0) return;
    const lines = summaryTsv.split('\n').filter(Boolean);
    const totals: number[] = [];
    let assigned: number[] = [];
    for (const l of lines.slice(1)) {
      const cells = l.split('\t');
      const vals = cells.slice(1).map((v) => Number(v) || 0);
      vals.forEach((v, i) => (totals[i] = (totals[i] ?? 0) + v));
      if (cells[0] === 'Assigned') assigned = vals;
    }
    const fractions = assigned.map((a, i) => (totals[i] ? a / totals[i] : 1));
    const lowest = Math.min(...fractions);
    if (fractions.length && lowest < 0.2) {
      toast.warning(`Only ${(lowest * 100).toFixed(0)}% of reads were assigned in some samples`, {
        description: `That is typical of counting with the wrong strandedness. Try ${strand === 1 ? 'reversely stranded' : 'stranded (forward)'} or unstranded, and compare the summary table.`,
        duration: 15_000,
      });
    }
  }

  function downloadTsv(name: string, content: string) {
    const blob = new Blob([content], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  const qcMatrix = $derived(result ? parseFeatureCountsTsv(result.countsTsv) : null);
  // Optional per-sample labels: colour the QC plots and pre-fill the design on /de.
  let sampleMeta = $state<{ condition: string; replicate: string }[]>([]);
  let qcReference = $state('');
  $effect(() => {
    const n = qcMatrix?.samples.length ?? 0;
    untrack(() => {
      if (sampleMeta.length !== n) {
        sampleMeta = Array.from({ length: n }, () => ({ condition: '', replicate: '' }));
      }
    });
  });
  const qcConditions = $derived([...new Set(sampleMeta.map((m) => m.condition).filter(Boolean))]);
  $effect(() => {
    const cs = qcConditions;
    untrack(() => {
      if (!cs.includes(qcReference)) qcReference = cs[0] ?? '';
    });
  });
  function guessFromNames() {
    if (!qcMatrix) return;
    const groups = inferGroups(qcMatrix.samples);
    if (!groups) {
      toast.error('Could not guess from the sample names', {
        description: 'Type the condition for each sample instead.',
      });
      return;
    }
    const seen: Record<string, number> = {};
    sampleMeta = groups.map((g) => {
      seen[g] = (seen[g] ?? 0) + 1;
      return { condition: g, replicate: String(seen[g]) };
    });
  }

  async function continueToDe() {
    if (!result) return;
    handoff.counts.set({
      tsv: result.countsTsv,
      samples: qcMatrix?.samples ?? result.matrix.samples,
      conditions: sampleMeta.some((m) => m.condition)
        ? sampleMeta.map((m) => m.condition)
        : undefined,
      reference: qcReference || undefined,
    });
    await goto(resolve('/de') + '?from=counts');
  }

  const summaryRows = $derived.by(() => {
    if (!result) return null;
    const lines = result.summaryTsv.split('\n').filter(Boolean);
    if (lines.length < 2) return null;
    const header = lines[0].split('\t');
    const samples = header.slice(1);
    const rows = lines.slice(1).map((l) => {
      const cells = l.split('\t');
      return { name: cells[0], values: cells.slice(1).map((v) => Number(v) || 0) };
    });
    return { samples, rows };
  });
</script>

<svelte:head><title>Read counting · wormie.rs.ht</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href={resolve('/')} class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Read counting</h1>
    <p class="text-sm text-muted-foreground">From aligned reads to a counts table</p>
  </header>

  <PageHint id="counts.intro" title="What this step does">
    A BAM file is what an aligner (STAR, HISAT2, bowtie2) writes after matching your sequencing
    reads to the genome: one entry per read, saying where it landed. Counting turns that into a
    table of how many reads fell inside each gene, one column per sample. That table is the input
    every differential expression method expects. Drop your BAM files here and featureCounts, the
    standard counting tool, builds it. If a collaborator already sent you a counts table, skip
    straight to differential expression.
  </PageHint>

  <Card
    role="region"
    aria-label="Inputs"
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    ondrop={onDrop}
    class={dragOver ? 'ring-2 ring-primary ring-offset-2 transition' : ''}
  >
    <CardHeader>
      <CardTitle class="flex items-center justify-between text-lg">
        <span>Inputs</span>
        <span class="text-xs font-normal text-muted-foreground">
          drag &amp; drop BAM/GTF anywhere on this card
        </span>
      </CardTitle>
    </CardHeader>
    <CardContent class="space-y-4">
      <input
        bind:this={bamInput}
        type="file"
        accept=".bam"
        multiple
        onchange={onBamPick}
        class="hidden"
      />
      <input
        bind:this={gtfInput}
        type="file"
        accept=".gtf,.saf,.tsv"
        onchange={onGtfPick}
        class="hidden"
      />

      <div class="grid gap-2">
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" onclick={() => bamInput?.click()} disabled={running}>
            {bamFiles.length ? 'Add more BAMs' : 'Choose BAM file(s)'}
          </Button>
          <ControlHint id="counts-bam" title="What a BAM file is">
            The file your aligner writes after matching sequencing reads to the genome: one record
            per read, saying which chromosome and position it landed on. STAR, HISAT2 and bowtie2
            all produce them, and a sequencing core will usually return them alongside the FASTQ
            files. Pick one BAM per sample; sorting is not required and the <code>.bai</code> index is
            not needed. If you only have FASTQ files, they have to be aligned first, which is not something
            this page can do.
          </ControlHint>
          <span class="text-xs text-muted-foreground">
            {bamFiles.length
              ? `${bamFiles.length} file${bamFiles.length === 1 ? '' : 's'}`
              : 'one BAM per sample (pick multiple folders by clicking again)'}
          </span>
          {#if bamFiles.length}
            <button
              type="button"
              onclick={clearBams}
              disabled={running}
              class="ml-auto text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              Clear all
            </button>
          {/if}
        </div>
        {#if bamFiles.length}
          <div class="flex flex-wrap gap-1">
            {#each bamFiles as f (f.name + f.size)}
              <span
                class="inline-flex items-center gap-1 rounded-md bg-secondary py-0.5 pl-2 pr-1 font-mono text-xs text-secondary-foreground"
              >
                {f.name} · {mb(f.size)}
                <button
                  type="button"
                  onclick={() => removeBam(f)}
                  disabled={running}
                  aria-label={`Remove ${f.name}`}
                  class="rounded px-1 hover:bg-background/40 disabled:opacity-50">×</button
                >
              </span>
            {/each}
          </div>
        {/if}
      </div>

      <div class="grid gap-2">
        <div class="flex items-center gap-2">
          {#if bundled}
            <Button
              variant="outline"
              size="sm"
              onclick={useBundledAnnotation}
              disabled={running || bundledLoading}
            >
              {bundledLoading ? 'Loading...' : `Use WormBase ${bundled.release}`}
            </Button>
          {/if}
          <Button variant="outline" size="sm" onclick={() => gtfInput?.click()} disabled={running}>
            {bundled ? 'Or choose your own' : 'Choose annotation'}
          </Button>
          <span class="text-xs text-muted-foreground">GTF or SAF</span>
          <ControlHint id="counts-gtf" title="What the annotation is and where to get one">
            The BAM says where each read landed; the annotation says where the genes are, so the two
            together give a count per gene. The <b>Use WormBase</b> button loads the canonical gene
            models for the release this site was built from, which is the right choice unless you
            aligned to something else. Otherwise download
            <code class="break-all">c_elegans.PRJNA13758.WSxxx.canonical_geneset.gtf.gz</code> from
            the WormBase FTP site, or the matching release from Ensembl Genomes.
            <br /><br />
            It must match the genome your reads were aligned to. Two mismatches cause almost all zero-count
            results: a different assembly, or different chromosome naming where the annotation says
            <code>I, II, III</code>
            and the BAM says <code>chrI, chrII</code>. If every gene comes back at zero, that is the
            first thing to check.
          </ControlHint>
        </div>
        {#if gtfFile}
          <Badge variant="secondary" class="w-fit font-mono text-xs">
            {gtfFile.name} · {mb(gtfFile.size)}
          </Badge>
        {/if}
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="grid gap-1.5">
          <label for="threads" class="inline-flex items-center gap-1.5 text-sm font-medium">
            Threads
            <ControlHint id="counts-threads" title="How many reads are counted at once">
              Counting splits across this many parallel workers. More is faster up to the number of
              cores your machine has; beyond that they queue and memory use keeps rising. The
              default matches your browser's reported core count, which is usually the right answer.
              Lower it if the tab becomes unresponsive on a large run.
            </ControlHint>
          </label>
          <Input
            id="threads"
            type="number"
            min="1"
            max="8"
            bind:value={threads}
            disabled={running}
            class="max-w-24"
          />
        </div>
        <label
          for="paired"
          class="flex cursor-pointer select-none items-center gap-2 self-end text-sm"
        >
          <input
            id="paired"
            type="checkbox"
            bind:checked={isPaired}
            disabled={running}
            class="h-4 w-4 cursor-pointer"
          />
          Paired-end reads (count fragments)
        </label>
        <div class="grid gap-1.5">
          <label for="strand" class="inline-flex items-center gap-1.5 text-sm font-medium">
            Strandedness
            <ControlHint id="counts-strand" title="Which strand the reads come from">
              Most library kits keep track of which DNA strand each RNA came from, and counting can
              use that to tell apart genes that overlap on opposite strands. Check your kit or ask
              the sequencing core.
              <br /><br />
              <b>Unstranded</b> counts a read on either strand. It never loses reads, and is the
              right choice for unstranded kits or when unsure.
              <br />
              <b>Stranded</b> (featureCounts <code>-s 1</code>, htseq-count
              <code>--stranded yes</code>, its default): read 1 lies on the gene's own strand, as in
              Lexogen QuantSeq FWD.
              <br />
              <b>Reversely stranded</b> (<code>-s 2</code>, htseq-count
              <code>--stranded reverse</code>): read 1 lies on the opposite strand, as in dUTP kits
              such as Illumina TruSeq Stranded and NEBNext Ultra II Directional.
              <br /><br />
              The wrong stranded setting does not fail; it leaves most reads unassigned, which the summary
              table shows and WormIE flags.
            </ControlHint>
          </label>
          <select
            id="strand"
            bind:value={strand}
            disabled={running}
            class="h-9 max-w-56 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value={0}>Unstranded</option>
            <option value={1}>Stranded (forward)</option>
            <option value={2}>Reversely stranded</option>
          </select>
        </div>
      </div>

      <div class="flex items-center justify-between border-t pt-4">
        <div class="text-xs text-muted-foreground">
          {#if totalBytes > 0}Total: {mb(totalBytes)}{/if}
        </div>
        <Button onclick={run} disabled={!canRun}>
          <Play class="h-4 w-4" />
          {running ? 'Running...' : 'Run featureCounts'}
        </Button>
      </div>
    </CardContent>
  </Card>

  {#if running || progressLines.length}
    <Card>
      <CardHeader>
        <CardTitle>Progress</CardTitle>
      </CardHeader>
      <CardContent>
        <pre
          class="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{progressLines.join(
            '\n',
          )}</pre>
      </CardContent>
    </Card>
  {/if}

  {#if result}
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center justify-between">
          <span>Result</span>
          <span class="text-sm font-normal text-muted-foreground">
            {result.elapsedSec.toFixed(1)}s · {result.matrix.genes.length} genes × {result.matrix
              .samples.length}
            samples
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        {#if summaryRows}
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b text-left">
                  <th class="py-1 pr-3">Category</th>
                  {#each summaryRows.samples as s (s)}
                    <th class="py-1 pr-3">{s.replace(/^\//, '')}</th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each summaryRows.rows as row (row.name)}
                  <tr class="border-b last:border-b-0">
                    <td class="py-1 pr-3 font-mono">{row.name}</td>
                    {#each row.values as v, i (i)}
                      <td class="py-1 pr-3 font-mono">{v.toLocaleString()}</td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        <div class="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onclick={() => downloadTsv('counts.tsv', result?.countsTsv ?? '')}
          >
            <Download class="mr-2 h-4 w-4" /> counts.tsv
          </Button>
          <Button
            variant="outline"
            onclick={() => downloadTsv('counts.summary.tsv', result?.summaryTsv ?? '')}
          >
            <Download class="mr-2 h-4 w-4" /> summary.tsv
          </Button>
          <Button onclick={continueToDe}>
            Continue to DESeq2 <ArrowRight class="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Sample QC (pre-DE)</CardTitle></CardHeader>
      <CardContent>
        {#if qcMatrix}
          <div class="mb-4 space-y-2">
            <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                Optional: label each sample to colour the PCA by condition. The labels carry over to
                the differential expression step.
              </span>
              <Button variant="outline" size="sm" onclick={guessFromNames}>
                Guess from sample names
              </Button>
            </div>
            <table class="text-xs">
              <thead>
                <tr class="border-b text-left">
                  <th class="py-1 pr-3 font-medium">Sample</th>
                  <th class="py-1 pr-3 font-medium">Condition</th>
                  <th class="py-1 pr-3 font-medium">Replicate</th>
                </tr>
              </thead>
              <tbody>
                {#each qcMatrix.samples as s, i (s)}
                  {#if sampleMeta[i]}
                    <tr class="border-b last:border-b-0">
                      <td class="py-1 pr-3 font-mono">{s}</td>
                      <td class="py-1 pr-3">
                        <Input
                          bind:value={sampleMeta[i].condition}
                          placeholder="e.g. WT"
                          class="h-7 max-w-40"
                        />
                      </td>
                      <td class="py-1 pr-3">
                        <Input
                          bind:value={sampleMeta[i].replicate}
                          placeholder="e.g. 1"
                          class="h-7 max-w-20"
                        />
                      </td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
            {#if qcConditions.length > 1}
              <label class="inline-flex items-center gap-2 text-xs">
                Reference (shown in purple)
                <select bind:value={qcReference} class="rounded border bg-card px-1 py-0.5">
                  {#each qcConditions as c (c)}
                    <option value={c}>{c}</option>
                  {/each}
                </select>
              </label>
            {/if}
          </div>
          <CountsQcPanel
            matrix={qcMatrix}
            conditions={sampleMeta.map((m) => m.condition)}
            replicates={sampleMeta.map((m) => m.replicate)}
            reference={qcReference}
          />
        {/if}
      </CardContent>
    </Card>
  {/if}
</div>
