<script lang="ts">
  // DE contrast diff: intersects two DESeq2 CSVs on gene, plots log2FC(A) vs log2FC(B).
  // Surfaces direction-flipping genes (opposite signs, both |LFC| > 0.5). Sister to /gsea/intersect at gene level.
  import { detectDeseqTable } from '$lib/import-enrichment';
  import { getGeneNames } from '$lib/queries';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { buildIdsQuery } from '$lib/share';
  import LoadDatasetPicker from '$lib/components/LoadDatasetPicker.svelte';
  import SaveDatasetButton from '$lib/components/SaveDatasetButton.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import GenePill from '$lib/components/GenePill.svelte';
  import PageHint from '$lib/components/PageHint.svelte';
  import PlotExportMenu from '$lib/components/PlotExportMenu.svelte';
  import VennDiagram from '$lib/components/VennDiagram.svelte';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import { toast } from 'svelte-sonner';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { handoff } from '$lib/pipeline-handoff';
  import { downloadTsv } from '$lib/download';
  import { niceTicks } from '$lib/nice-ticks';
  import {
    CATEGORICAL_PALETTE,
    DOWN_COLOR,
    UP_COLOR,
    downAlpha,
    signedText,
    upAlpha,
  } from '$lib/plot-colors';

  type DeRow = { gene: string; padj: number | null; log2fc: number | null };

  let textA = $state('');
  let textB = $state('');
  let labelA = $state('A');
  let labelB = $state('B');
  let rowsA = $state<DeRow[] | null>(null);
  let rowsB = $state<DeRow[] | null>(null);

  onMount(() => {
    if (page.url.searchParams.get('from') !== 'de') return;
    const h = handoff.deseqDiff.consume();
    if (!h) return;
    textA = h.a.tsv;
    labelA = h.a.name;
    textB = h.b.tsv;
    labelB = h.b.name;
    rowsA = parse(textA, labelA);
    rowsB = parse(textB, labelB);
    toast.success('Loaded contrasts from /de', {
      description: `${h.a.name} vs ${h.b.name}`,
    });
  });

  function parse(text: string, label: string): DeRow[] | null {
    const d = detectDeseqTable(text);
    if (!d) {
      toast.error(`${label}: not a DESeq2 table`, {
        description: 'Need a CSV/TSV with at minimum a gene column and log2FoldChange or padj.',
      });
      return null;
    }
    return d.rows;
  }

  // Single button matches "compare these two" mental model; if only one side has text the other stays untouched.
  function parseBoth() {
    if (textA.trim()) rowsA = parse(textA, labelA);
    if (textB.trim()) rowsB = parse(textB, labelB);
  }

  type Joined = {
    gene: string;
    lfcA: number;
    lfcB: number;
    padjA: number | null;
    padjB: number | null;
  };

  // DESeq2's convention: significant means padj strictly below the cutoff.
  let alpha = $state(0.05);
  // Optional title shared by the Venn and the scatter, e.g. "L4 → D6".
  let plotTitle = $state('');
  const isSig = (p: number | null) => p !== null && p < alpha;

  // DESeq2 leaves log2FC NA for all-zero and outlier genes; they cannot be placed on
  // the scatter, so they are counted rather than dropped silently.
  const missingLfc = $derived({
    a: rowsA?.filter((r) => r.log2fc === null).length ?? 0,
    b: rowsB?.filter((r) => r.log2fc === null).length ?? 0,
  });

  const joined = $derived.by<Joined[]>(() => {
    if (!rowsA || !rowsB) return [];
    const ma = new Map(rowsA.filter((r) => r.log2fc !== null).map((r) => [r.gene, r]));
    const out: Joined[] = [];
    for (const rb of rowsB) {
      if (rb.log2fc === null) continue;
      const ra = ma.get(rb.gene);
      if (!ra || ra.log2fc === null) continue;
      out.push({
        gene: rb.gene,
        lfcA: ra.log2fc,
        lfcB: rb.log2fc,
        padjA: ra.padj,
        padjB: rb.padj,
      });
    }
    return out;
  });

  const pearson = $derived.by(() => {
    if (joined.length < 3) return null;
    let sa = 0,
      sb = 0;
    for (const j of joined) {
      sa += j.lfcA;
      sb += j.lfcB;
    }
    const ma = sa / joined.length,
      mb = sb / joined.length;
    let num = 0,
      da = 0,
      db = 0;
    for (const j of joined) {
      const xa = j.lfcA - ma,
        xb = j.lfcB - mb;
      num += xa * xb;
      da += xa * xa;
      db += xb * xb;
    }
    return num / Math.sqrt(Math.max(1e-12, da * db));
  });

  // Categories match the Venn's regions: significant in both and up, significant in both and
  // down, significant in both with opposite signs ("flipped"), significant in one, or neither.
  // Flipped genes are open rings in the palette's periwinkle: they stand out from the pale up and
  // down clouds without a dark fill, and periwinkle avoids the orange-green clash for red-green
  // colour-vision deficiency. The fill is the page background so the rings hold in dark mode.
  const FLIPPED = CATEGORICAL_PALETTE[6];
  const FLIPPED_FILL = 'hsl(var(--background))';
  const OTHER = 'hsl(0 0% 70% / 0.45)';
  const W = 720,
    H = 460,
    PAD_L = 56,
    PAD_R = 14,
    PAD_B = 40;
  // Room for an optional title at the top of the exported plot.
  const PAD_T = $derived(plotTitle.trim() ? 34 : 14);
  const range = $derived.by(() => {
    if (joined.length === 0) return 5;
    let m = 0;
    for (const j of joined) {
      if (Math.abs(j.lfcA) > m) m = Math.abs(j.lfcA);
      if (Math.abs(j.lfcB) > m) m = Math.abs(j.lfcB);
    }
    return Math.max(1, m * 1.05);
  });
  const lfcTicks = $derived(niceTicks(-range, range, 6));
  function xFor(v: number): number {
    const inner = W - PAD_L - PAD_R;
    return PAD_L + ((v + range) / (2 * range)) * inner;
  }
  function yFor(v: number): number {
    const inner = H - PAD_T - PAD_B;
    return PAD_T + ((range - v) / (2 * range)) * inner;
  }
  type Cat = 'up' | 'down' | 'flipped' | 'aOnly' | 'bOnly' | 'ns';
  // Each gene falls in exactly one category; tab counts sum to joined.length.
  function catOf(j: Joined): Cat {
    const sigA = isSig(j.padjA);
    const sigB = isSig(j.padjB);
    if (sigA && sigB) {
      if (j.lfcA > 0 && j.lfcB > 0) return 'up';
      if (j.lfcA < 0 && j.lfcB < 0) return 'down';
      return 'flipped';
    }
    if (sigA) return 'aOnly';
    if (sigB) return 'bOnly';
    return 'ns';
  }
  // Up and down are the bulk of the plot, so they take light tints of the direction pair;
  // flipped, the minority worth finding, stays at full strength on top.
  const UP_TINT = upAlpha(0.45);
  const DOWN_TINT = downAlpha(0.45);
  const CAT_COLOR: Record<'up' | 'down' | 'flipped', string> = {
    up: UP_TINT,
    down: DOWN_TINT,
    flipped: FLIPPED_FILL,
  };
  const byCat = $derived.by(() => {
    const m: Record<Cat, Joined[]> = {
      up: [],
      down: [],
      flipped: [],
      aOnly: [],
      bOnly: [],
      ns: [],
    };
    for (const j of joined) m[catOf(j)].push(j);
    return m;
  });
  const flipped = $derived(byCat.flipped);
  // Off by default, as in a figure: only genes significant in both are drawn.
  let showAll = $state(false);

  // Per quadrant: genes of that quadrant's category over all genes in the quadrant.
  // Genes with a fold change of exactly 0 belong to no quadrant.
  const quadrants = $derived.by(() => {
    const q = [
      { key: 'ur', n: 0, total: 0, x: 1, y: 1 },
      { key: 'ul', n: 0, total: 0, x: -1, y: 1 },
      { key: 'll', n: 0, total: 0, x: -1, y: -1 },
      { key: 'lr', n: 0, total: 0, x: 1, y: -1 },
    ];
    for (const j of joined) {
      if (j.lfcA === 0 || j.lfcB === 0) continue;
      const qq = q.find((x) => x.x === Math.sign(j.lfcA) && x.y === Math.sign(j.lfcB))!;
      qq.total++;
      const c = catOf(j);
      if (c === 'up' || c === 'down' || c === 'flipped') qq.n++;
    }
    return q;
  });
  const pct = (n: number, d: number) =>
    d === 0
      ? '0%'
      : n / d < 0.01 && n > 0
        ? `${((100 * n) / d).toFixed(1)}%`
        : `${Math.round((100 * n) / d)}%`;

  async function sendFlipped(to: 'enrichment' | 'nta') {
    const q = await buildIdsQuery(flipped.map((j) => j.gene));
    await goto(resolve(`/${to}`) + `?${q}`);
  }
  // The Venn is drawn from the two significant sets; its shared region splits into the
  // up, down and flipped categories above.
  const isSigA = (j: Joined) => isSig(j.padjA);
  const isSigB = (j: Joined) => isSig(j.padjB);
  const vennOnlyA = $derived(joined.filter((j) => isSigA(j) && !isSigB(j)));
  const vennOnlyB = $derived(joined.filter((j) => isSigB(j) && !isSigA(j)));
  const vennA = $derived({
    label: labelA,
    up: vennOnlyA.filter((j) => j.lfcA > 0).length,
    down: vennOnlyA.filter((j) => j.lfcA < 0).length,
  });
  const vennB = $derived({
    label: labelB,
    up: vennOnlyB.filter((j) => j.lfcB > 0).length,
    down: vennOnlyB.filter((j) => j.lfcB < 0).length,
  });
  const vennShared = $derived({
    up: byCat.up.length,
    down: byCat.down.length,
    discordant: byCat.flipped.length,
  });
  let vennSvg = $state<SVGSVGElement | null>(null);

  type TabKey = Cat;
  let activeTab = $state<TabKey>('flipped');
  const tabs = $derived<
    { key: TabKey; label: string; rows: Joined[]; color: string; border: string }[]
  >([
    { key: 'up', label: 'Up in both', rows: byCat.up, color: UP_TINT, border: UP_COLOR },
    { key: 'down', label: 'Down in both', rows: byCat.down, color: DOWN_TINT, border: DOWN_COLOR },
    {
      key: 'flipped',
      label: 'Flipped',
      rows: byCat.flipped,
      color: FLIPPED_FILL,
      border: FLIPPED,
    },
    {
      key: 'aOnly',
      label: `Only in ${labelA}`,
      rows: byCat.aOnly,
      color: 'hsl(0 0% 55%)',
      border: 'hsl(0 0% 30%)',
    },
    {
      key: 'bOnly',
      label: `Only in ${labelB}`,
      rows: byCat.bOnly,
      color: 'hsl(0 0% 55%)',
      border: 'hsl(0 0% 30%)',
    },
    {
      key: 'ns',
      label: 'Not significant',
      rows: byCat.ns,
      color: 'hsl(0 0% 80%)',
      border: 'hsl(0 0% 60%)',
    },
  ]);
  const activeBucket = $derived(tabs.find((t) => t.key === activeTab) ?? tabs[0]);

  // The on-page list is capped for rendering speed; the download always carries the whole group.
  const LIST_CAP = 200;
  function downloadGroup() {
    const b = activeBucket;
    const safe = (x: string) => x.replace(/[^a-z0-9._-]+/gi, '_');
    downloadTsv(
      `${safe(labelA)}_vs_${safe(labelB)}_${b.key}.tsv`,
      [
        { header: 'gene', get: (j) => j.gene },
        { header: 'gene_name', get: (j) => nameMap.get(j.gene) ?? '' },
        { header: `log2FC_${labelA}`, get: (j) => j.lfcA },
        { header: `padj_${labelA}`, get: (j) => j.padjA ?? 'NA' },
        { header: `log2FC_${labelB}`, get: (j) => j.lfcB },
        { header: `padj_${labelB}`, get: (j) => j.padjB ?? 'NA' },
      ],
      b.rows,
    );
  }

  // Resolve gene tokens (WBGene, symbol, or sequence name) to display names; batched once per joined-set, cached in map.
  let nameMap = $state<Map<string, string | null>>(new Map());
  $effect(() => {
    const ids = joined.map((j) => j.gene);
    if (ids.length === 0) return;
    const missing = ids.filter((g) => !nameMap.has(g));
    if (missing.length === 0) return;
    void (async () => {
      const res = await getGeneNames(missing);
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const next = new Map(nameMap);
      for (const id of missing) {
        const m = res.get(id);
        next.set(id, m?.gene_name || m?.sequence_name || null);
      }
      nameMap = next;
    })();
  });

  function displayName(g: string): string {
    const resolved = nameMap.get(g);
    return resolved ?? g;
  }

  let hover = $state<{ gene: string; lfcA: number; lfcB: number; x: number; y: number } | null>(
    null,
  );
  function onSvgMove(e: MouseEvent) {
    const t = e.target as Element | null;
    const c = t && t.closest('[data-gene]');
    if (!c) {
      hover = null;
      return;
    }
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    hover = {
      gene: c.getAttribute('data-gene') ?? '',
      lfcA: Number(c.getAttribute('data-lfca')),
      lfcB: Number(c.getAttribute('data-lfcb')),
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }
  function onSvgLeave() {
    hover = null;
  }

  let svgEl: SVGSVGElement | null = $state(null);
</script>

<svelte:head>
  <title>Contrast comparison · wormie.bio</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Contrast comparison</h1>
    <p class="text-sm text-muted-foreground">
      Two differential expression outputs compared against each other
    </p>
  </header>

  <PageHint id="de-diff" title="What this step does">
    Paste or load the results of two differential expression comparisons from the same study, for
    example a mutant against wild type at two timepoints, or two mutants against one control. Each
    gene is one dot. Its log2 fold change (log2FC) in the first comparison is on one axis and in the
    second comparison on the other. Genes along the diagonal change by the same amount in both.
    Genes significant in both comparisons are coloured as up in both, down in both, or flipped (up
    in one and down in the other). The number in each corner is the genes of that corner's category
    over all genes in that corner. Pearson r (correlation coefficient) is a single number for how
    closely the two log2FC values agree across all shared genes: 1 is perfect agreement, 0 is none.
    Result tables from DESeq2, edgeR or limma all work.
  </PageHint>

  <div class="grid gap-3 sm:grid-cols-2">
    <Card>
      <CardHeader class="pb-2">
        <div class="flex items-baseline gap-2">
          <CardTitle class="text-base">Contrast A</CardTitle>
          {#if rowsA}
            <Badge variant="muted" class="text-[0.6rem]">{rowsA.length.toLocaleString()} rows</Badge
            >
          {/if}
        </div>
      </CardHeader>
      <CardContent class="space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <input
            bind:value={labelA}
            placeholder="Label for contrast A"
            class="min-w-40 flex-1 rounded border bg-background px-2 py-1 text-sm"
          />
          <LoadDatasetPicker
            type="deseq2"
            label="Load"
            onload={(ds) => {
              textA = ds.body;
              if (!labelA) labelA = ds.name;
            }}
          />
          <SaveDatasetButton
            type="deseq2"
            body={() => textA}
            defaultName={labelA || 'contrast A'}
            disabled={!textA.trim()}
          />
        </div>
        <textarea
          bind:value={textA}
          rows="6"
          placeholder="gene_id,baseMean,log2FoldChange,lfcSE,stat,pvalue,padj&#10;..."
          class="w-full resize-y rounded border bg-background px-2 py-1.5 font-mono text-xs"
        ></textarea>
      </CardContent>
    </Card>
    <Card>
      <CardHeader class="pb-2">
        <div class="flex items-baseline gap-2">
          <CardTitle class="text-base">Contrast B</CardTitle>
          {#if rowsB}
            <Badge variant="muted" class="text-[0.6rem]">{rowsB.length.toLocaleString()} rows</Badge
            >
          {/if}
        </div>
      </CardHeader>
      <CardContent class="space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <input
            bind:value={labelB}
            placeholder="Label for contrast B"
            class="min-w-40 flex-1 rounded border bg-background px-2 py-1 text-sm"
          />
          <LoadDatasetPicker
            type="deseq2"
            label="Load"
            onload={(ds) => {
              textB = ds.body;
              if (!labelB) labelB = ds.name;
            }}
          />
          <SaveDatasetButton
            type="deseq2"
            body={() => textB}
            defaultName={labelB || 'contrast B'}
            disabled={!textB.trim()}
          />
        </div>
        <textarea
          bind:value={textB}
          rows="6"
          placeholder="gene_id,baseMean,log2FoldChange,lfcSE,stat,pvalue,padj&#10;..."
          class="w-full resize-y rounded border bg-background px-2 py-1.5 font-mono text-xs"
        ></textarea>
      </CardContent>
    </Card>
  </div>

  <div class="flex items-center gap-2">
    <Button onclick={parseBoth} disabled={!textA.trim() || !textB.trim()}>Parse</Button>
    <span class="text-xs text-muted-foreground">
      Both contrasts are needed. Each pasted comma-separated or tab-separated table is read on its
      own.
    </span>
    <label class="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
      Plot title
      <Input bind:value={plotTitle} placeholder="optional, e.g. L4 → D6" class="h-8 w-44" />
    </label>
    <label
      class="flex items-center gap-1.5 text-xs text-muted-foreground"
      title="padj is the adjusted p-value (false discovery rate) from each contrast table"
    >
      Significant at padj &lt;
      <Input type="number" min="0.001" max="0.5" step="0.01" bind:value={alpha} class="h-8 w-20" />
    </label>
  </div>

  {#if rowsA && rowsB && joined.length > 0}
    <Card>
      <CardHeader class="flex flex-row items-baseline justify-between pb-3">
        <CardTitle class="text-base">Genes changed in each contrast</CardTitle>
        <PlotExportMenu getSvg={() => vennSvg} baseName={`venn-${labelA}-vs-${labelB}`} />
      </CardHeader>
      <CardContent class="flex justify-center pt-0">
        <VennDiagram
          a={vennA}
          b={vennB}
          shared={vennShared}
          title={plotTitle.trim()}
          bind:svgEl={vennSvg}
        />
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="pb-2">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle class="text-base">log2FC scatter</CardTitle>
          <div class="flex items-center gap-3">
            <div class="space-x-3 text-xs text-muted-foreground">
              <span><b>{joined.length.toLocaleString()}</b> shared genes</span>
              {#if missingLfc.a + missingLfc.b > 0}
                <span
                  title="DESeq2 reports no log2 fold change for genes with all-zero counts or flagged outliers, so they cannot be placed on the plot."
                  >{missingLfc.a.toLocaleString()} / {missingLfc.b.toLocaleString()} without a fold change
                  left out</span
                >
              {/if}
              {#if pearson !== null}
                <span>Pearson <span class="font-mono">{pearson.toFixed(3)}</span></span>
              {/if}
              <span>Flipped: <b>{flipped.length}</b></span>
              {#if flipped.length > 0}
                <button
                  type="button"
                  onclick={() => sendFlipped('enrichment')}
                  class="rounded border px-1.5 py-0.5 transition-colors hover:bg-accent"
                >
                  Test for enrichment
                </button>
                <button
                  type="button"
                  onclick={() => sendFlipped('nta')}
                  class="rounded border px-1.5 py-0.5 transition-colors hover:bg-accent"
                >
                  Test connectivity
                </button>
              {/if}
            </div>
            <PlotExportMenu getSvg={() => svgEl} baseName={`de-diff-${labelA}-vs-${labelB}`} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div class="relative">
          <svg
            bind:this={svgEl}
            viewBox="0 0 {W} {H}"
            class="w-full"
            width={W}
            height={H}
            role="img"
            aria-label="log2FC diff scatter"
            onmousemove={onSvgMove}
            onmouseleave={onSvgLeave}
          >
            <!-- Axes -->
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={H - PAD_B}
              y2={H - PAD_B}
              stroke="hsl(var(--border))"
            />
            <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={H - PAD_B} stroke="hsl(var(--border))" />
            {#each lfcTicks.values as t (t)}
              <line
                x1={xFor(t)}
                x2={xFor(t)}
                y1={H - PAD_B}
                y2={H - PAD_B + 3}
                stroke="hsl(var(--muted-foreground))"
              />
              <text
                x={xFor(t)}
                y={H - PAD_B + 14}
                font-size="9"
                text-anchor="middle"
                fill="hsl(var(--muted-foreground))">{lfcTicks.format(t)}</text
              >
              <line
                x1={PAD_L - 3}
                x2={PAD_L}
                y1={yFor(t)}
                y2={yFor(t)}
                stroke="hsl(var(--muted-foreground))"
              />
              <text
                x={PAD_L - 5}
                y={yFor(t) + 3}
                font-size="9"
                text-anchor="end"
                fill="hsl(var(--muted-foreground))">{lfcTicks.format(t)}</text
              >
            {/each}
            <!-- diagonal y=x -->
            <line
              x1={xFor(-range)}
              y1={yFor(-range)}
              x2={xFor(range)}
              y2={yFor(range)}
              stroke="hsl(var(--muted-foreground))"
              stroke-dasharray="3,3"
              opacity="0.4"
            />
            <!-- zero lines -->
            <line
              x1={xFor(0)}
              y1={PAD_T}
              x2={xFor(0)}
              y2={H - PAD_B}
              stroke="hsl(var(--muted-foreground))"
              stroke-dasharray="2,2"
              opacity="0.4"
            />
            <line
              x1={PAD_L}
              y1={yFor(0)}
              x2={W - PAD_R}
              y2={yFor(0)}
              stroke="hsl(var(--muted-foreground))"
              stroke-dasharray="2,2"
              opacity="0.4"
            />
            <!-- points: other genes (optional) first, then up, down and flipped on top -->
            {#snippet dot(j: Joined, fill: string, r: number, stroke = 'none')}
              <a
                href={resolve(`/gene/${nameMap.get(j.gene) ?? j.gene}`)}
                target="_blank"
                rel="noopener"
                aria-label={`Open ${displayName(j.gene)} in a new tab`}
              >
                <circle
                  cx={xFor(j.lfcA)}
                  cy={yFor(j.lfcB)}
                  {r}
                  {fill}
                  {stroke}
                  stroke-width="1.3"
                  data-gene={j.gene}
                  data-lfca={j.lfcA}
                  data-lfcb={j.lfcB}
                />
              </a>
            {/snippet}
            {#if showAll}
              <g>
                {#each [...byCat.aOnly, ...byCat.bOnly, ...byCat.ns] as j (j.gene)}
                  {@render dot(j, OTHER, 1.8)}
                {/each}
              </g>
            {/if}
            {#each ['up', 'down', 'flipped'] as const as c (c)}
              <g>
                {#each byCat[c] as j (j.gene)}
                  {@render dot(
                    j,
                    CAT_COLOR[c],
                    c === 'flipped' ? 3 : 2.4,
                    c === 'flipped' ? FLIPPED : 'none',
                  )}
                {/each}
              </g>
            {/each}
            <!-- quadrant counts: genes of the quadrant's category / all genes in the quadrant -->
            {#each quadrants as q (q.key)}
              <text
                x={q.x > 0 ? W - PAD_R - 6 : PAD_L + 6}
                y={q.y > 0 ? PAD_T + 14 : H - PAD_B - 20}
                font-size="11"
                text-anchor={q.x > 0 ? 'end' : 'start'}
                class="fill-foreground"
              >
                <tspan x={q.x > 0 ? W - PAD_R - 6 : PAD_L + 6}
                  >{q.n.toLocaleString()} / {q.total.toLocaleString()}</tspan
                >
                <tspan x={q.x > 0 ? W - PAD_R - 6 : PAD_L + 6} dy="13">({pct(q.n, q.total)})</tspan>
              </text>
            {/each}
            {#if plotTitle.trim()}
              <text x={PAD_L} y="20" font-size="15" font-weight="700" class="fill-foreground"
                >{plotTitle.trim()}</text
              >
            {/if}
            <!-- Axis labels -->
            <text
              x={(W - PAD_R + PAD_L) / 2}
              y={H - 6}
              font-size="12"
              text-anchor="middle"
              class="fill-foreground"
            >
              log<tspan font-size="9" dy="3">2</tspan><tspan dy="-3"> FC, {labelA}</tspan>
            </text>
            <text
              x={PAD_L - 38}
              y={(H - PAD_B + PAD_T) / 2}
              font-size="12"
              class="fill-foreground"
              text-anchor="middle"
              transform={`rotate(-90 ${PAD_L - 38} ${(H - PAD_B + PAD_T) / 2})`}
            >
              log<tspan font-size="9" dy="3">2</tspan><tspan dy="-3"> FC, {labelB}</tspan>
            </text>
          </svg>
          {#if hover}
            <div
              class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[120%] whitespace-nowrap rounded border bg-popover px-2 py-1 font-mono text-[0.7rem] shadow"
              style="left: {hover.x}px; top: {hover.y}px;"
            >
              <span class="font-semibold">{displayName(hover.gene)}</span>
              <span class="text-muted-foreground">·</span>
              {labelA} <span class="tabular-nums">{hover.lfcA.toFixed(2)}</span>
              <span class="text-muted-foreground">·</span>
              {labelB} <span class="tabular-nums">{hover.lfcB.toFixed(2)}</span>
            </div>
          {/if}
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-3 text-[0.7rem] text-muted-foreground">
          {#each [{ c: UP_TINT, l: 'up in both' }, { c: DOWN_TINT, l: 'down in both' }, { c: FLIPPED_FILL, b: FLIPPED, l: 'flipped' }] as k (k.l)}
            <span class="inline-flex items-center gap-1"
              ><span
                class="inline-block h-2.5 w-2.5 rounded-full"
                style="background: {k.c}; border: 1.5px solid {'b' in k ? k.b : k.c};"
              ></span>
              {k.l}</span
            >
          {/each}
          <span>(significant in both at padj &lt; {alpha})</span>
          <label class="ml-auto inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" bind:checked={showAll} class="h-3.5 w-3.5" />
            show genes significant in one or neither
          </label>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="pb-2">
        <CardTitle class="text-base">Gene list</CardTitle>
        <div class="mt-2 flex flex-wrap items-center gap-1">
          {#each tabs as t (t.key)}
            <button
              type="button"
              onclick={() => (activeTab = t.key)}
              class={'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ' +
                (activeTab === t.key
                  ? 'border-accent bg-accent text-accent-foreground'
                  : 'border-input bg-card hover:bg-muted/50')}
            >
              <span
                class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={`background: ${t.color}; border: 1px solid ${t.border};`}
              ></span>
              {t.label}
              <span class="font-mono text-[0.65rem] tabular-nums text-muted-foreground">
                {t.rows.length.toLocaleString()}
              </span>
            </button>
          {/each}
        </div>
      </CardHeader>
      <CardContent class="pt-0">
        {#if activeBucket.rows.length === 0}
          <div class="py-2 text-xs italic text-muted-foreground">No genes in this group.</div>
        {:else}
          <div
            class="grid grid-cols-[auto_auto_auto_auto_1fr] items-center gap-x-3 gap-y-1 text-xs"
          >
            {#each activeBucket.rows.slice(0, LIST_CAP) as j (j.gene)}
              <!-- Bullet color matches the active bucket so each row ties back to the plot at a glance. -->
              <span
                class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={`background: ${activeBucket.color}; border: 1px solid ${activeBucket.border};`}
                title={activeBucket.label}
              ></span>
              <GenePill
                id={j.gene}
                name={nameMap.get(j.gene) ?? (j.gene.startsWith('WBGene') ? null : j.gene)}
              />
              <span class={`font-mono tabular-nums ${signedText(j.lfcA)}`}>
                {labelA}
                {j.lfcA.toFixed(2)}
              </span>
              <span class={`font-mono tabular-nums ${signedText(j.lfcB)}`}>
                {labelB}
                {j.lfcB.toFixed(2)}
              </span>
              <span class="font-mono text-muted-foreground">
                Δ = {(j.lfcB - j.lfcA).toFixed(2)}
              </span>
            {/each}
          </div>
          <div
            class="mt-2 flex flex-wrap items-center gap-2 border-t pt-2 text-[0.65rem] text-muted-foreground"
          >
            {#if activeBucket.rows.length > LIST_CAP}
              <span class="italic">
                Showing the first {LIST_CAP} of {activeBucket.rows.length.toLocaleString()} genes. Download
                this group for the complete list.
              </span>
            {/if}
            <Button variant="outline" size="sm" class="ml-auto" onclick={downloadGroup}>
              Download this group (TSV)
            </Button>
          </div>
        {/if}
      </CardContent>
    </Card>
  {:else if rowsA && rowsB}
    <div class="text-sm text-muted-foreground">
      No genes appear in both contrasts. Check that both tables use the same type of gene ID.
    </div>
  {/if}
</div>
