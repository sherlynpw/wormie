<script lang="ts">
  // /counts: BAM to counts via subread featureCounts (WASM, pthread). Output is a counts.tsv for download or handoff to /de.
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Badge } from '$lib/components/ui/badge';
  import PageHint from '$lib/components/PageHint.svelte';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import ArrowRight from 'lucide-svelte/icons/arrow-right';
  import Download from 'lucide-svelte/icons/download';
  import Play from 'lucide-svelte/icons/play';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { toast } from 'svelte-sonner';
  import { onDestroy } from 'svelte';
  import { createFeatureCountsClient } from '$lib/featurecounts/client';
  import type { FeatureCountsResult } from '$lib/featurecounts/types';
  import { handoff } from '$lib/pipeline-handoff';
  import { parseFeatureCountsTsv } from '$lib/qc';
  import CountsQcPanel from '$lib/components/CountsQcPanel.svelte';

  let bamFiles = $state<File[]>([]);
  let gtfFile = $state<File | null>(null);
  let threads = $state(4);
  let isPaired = $state(false);

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
    const annot = files.find((f) => /\.(gtf|gff|gff3|saf|tsv)$/i.test(f.name));
    if (bams.length) addBams(bams);
    if (annot) gtfFile = annot;
    const skipped = files.length - bams.length - (annot ? 1 : 0);
    if (skipped > 0) {
      toast.message(`Ignored ${skipped} file(s) (only .bam / .gtf / .gff / .saf accepted)`);
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
      result = await activeClient.run({ bams, annotation, threads, isPaired }, (line) => {
        progressLines = [...progressLines, line];
      });
      toast.success(`featureCounts complete (${result.elapsedSec.toFixed(1)}s)`);
    } catch (e) {
      toast.error('featureCounts failed', { description: (e as Error)?.message ?? String(e) });
    } finally {
      running = false;
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

  async function continueToDe() {
    if (!result) return;
    handoff.counts.set({ tsv: result.countsTsv, samples: result.matrix.samples });
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

<div class="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href={resolve('/')} class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <PageHint id="counts.intro" title="Counts (featureCounts)">
    Compile a counts matrix from one or more BAM files in your browser using subread's
    featureCounts. The BAM bytes never leave your machine. After counting, continue to DESeq2 →
    enrichment, or download the matrix for offline use.
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
        accept=".gtf,.gff,.gff3,.saf,.tsv"
        onchange={onGtfPick}
        class="hidden"
      />

      <div class="grid gap-2">
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" onclick={() => bamInput?.click()} disabled={running}>
            {bamFiles.length ? 'Add more BAMs' : 'Choose BAM file(s)'}
          </Button>
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
          <Button variant="outline" size="sm" onclick={() => gtfInput?.click()} disabled={running}>
            Choose annotation
          </Button>
          <span class="text-xs text-muted-foreground">GTF, GFF3, or SAF</span>
        </div>
        {#if gtfFile}
          <Badge variant="secondary" class="w-fit font-mono text-xs">
            {gtfFile.name} · {mb(gtfFile.size)}
          </Badge>
        {/if}
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="grid gap-1.5">
          <label for="threads" class="text-sm font-medium">Threads</label>
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
        <CountsQcPanel matrix={parseFeatureCountsTsv(result.countsTsv)} />
      </CardContent>
    </Card>
  {/if}
</div>
