<script lang="ts">
  // DE contrast diff: intersects two DESeq2 CSVs on gene, plots log2FC(A) vs log2FC(B).
  // Surfaces direction-flipping genes (opposite signs, both |LFC| > 0.5). Sister to /gsea/intersect at gene level.
  import { detectDeseqTable } from '$lib/import-enrichment';
  import { getGeneNames } from '$lib/queries';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
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
    flipped: boolean;
  };

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
        flipped:
          ra.log2fc * rb.log2fc < 0 && Math.min(Math.abs(ra.log2fc), Math.abs(rb.log2fc)) > 0.5,
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

  const W = 720,
    H = 460,
    PAD_L = 56,
    PAD_R = 14,
    PAD_T = 14,
    PAD_B = 36;
  const range = $derived.by(() => {
    if (joined.length === 0) return 5;
    let m = 0;
    for (const j of joined) {
      if (Math.abs(j.lfcA) > m) m = Math.abs(j.lfcA);
      if (Math.abs(j.lfcB) > m) m = Math.abs(j.lfcB);
    }
    return Math.max(1, m * 1.05);
  });
  function xFor(v: number): number {
    const inner = W - PAD_L - PAD_R;
    return PAD_L + ((v + range) / (2 * range)) * inner;
  }
  function yFor(v: number): number {
    const inner = H - PAD_T - PAD_B;
    return PAD_T + ((range - v) / (2 * range)) * inner;
  }
  function colorFor(j: Joined): string {
    if (j.flipped) return 'hsl(280 70% 50%)';
    const sigA = j.padjA !== null && j.padjA <= 0.05;
    const sigB = j.padjB !== null && j.padjB <= 0.05;
    if (sigA && sigB) return 'hsl(0 0% 25%)';
    if (sigA || sigB) return 'hsl(0 0% 55%)';
    return 'hsl(0 0% 80% / 0.5)';
  }
  const flipped = $derived(joined.filter((j) => j.flipped));

  async function sendFlipped(to: 'enrichment' | 'nta') {
    const q = await buildIdsQuery(flipped.map((j) => j.gene));
    await goto(resolve(`/${to}`) + `?${q}`);
  }
  // Each gene falls in exactly one bucket; tab counts sum to joined.length.
  function sigOf(j: Joined): 'flipped' | 'both' | 'aOnly' | 'bOnly' | 'ns' {
    if (j.flipped) return 'flipped';
    const sigA = j.padjA !== null && j.padjA <= 0.05;
    const sigB = j.padjB !== null && j.padjB <= 0.05;
    if (sigA && sigB) return 'both';
    if (sigA) return 'aOnly';
    if (sigB) return 'bOnly';
    return 'ns';
  }
  const sigBoth = $derived(joined.filter((j) => sigOf(j) === 'both'));
  const sigA = $derived(joined.filter((j) => sigOf(j) === 'aOnly'));
  const sigB = $derived(joined.filter((j) => sigOf(j) === 'bOnly'));
  const sigNS = $derived(joined.filter((j) => sigOf(j) === 'ns'));

  const vennA = $derived({
    label: labelA,
    up: sigA.filter((j) => j.lfcA > 0).length,
    down: sigA.filter((j) => j.lfcA < 0).length,
  });
  const vennB = $derived({
    label: labelB,
    up: sigB.filter((j) => j.lfcB > 0).length,
    down: sigB.filter((j) => j.lfcB < 0).length,
  });
  const vennShared = $derived({
    up: sigBoth.filter((j) => j.lfcA > 0 && j.lfcB > 0).length,
    down: sigBoth.filter((j) => j.lfcA < 0 && j.lfcB < 0).length,
    discordant:
      sigBoth.filter((j) => j.lfcA * j.lfcB < 0).length +
      joined.filter((j) => sigOf(j) === 'flipped').length,
  });
  let vennSvg = $state<SVGSVGElement | null>(null);

  type TabKey = 'flipped' | 'both' | 'aOnly' | 'bOnly' | 'ns';
  let activeTab = $state<TabKey>('flipped');
  const tabs = $derived<
    { key: TabKey; label: string; rows: Joined[]; color: string; border: string }[]
  >([
    {
      key: 'flipped',
      label: 'Flipped',
      rows: flipped,
      color: 'hsl(280 70% 50%)',
      border: 'hsl(280 70% 30%)',
    },
    {
      key: 'both',
      label: 'Sig in both',
      rows: sigBoth,
      color: 'hsl(0 0% 25%)',
      border: 'hsl(0 0% 15%)',
    },
    {
      key: 'aOnly',
      label: `Sig in ${labelA} only`,
      rows: sigA,
      color: 'hsl(0 0% 55%)',
      border: 'hsl(0 0% 30%)',
    },
    {
      key: 'bOnly',
      label: `Sig in ${labelB} only`,
      rows: sigB,
      color: 'hsl(0 0% 55%)',
      border: 'hsl(0 0% 30%)',
    },
    {
      key: 'ns',
      label: 'Not significant',
      rows: sigNS,
      color: 'hsl(0 0% 80%)',
      border: 'hsl(0 0% 60%)',
    },
  ]);
  const activeBucket = $derived(tabs.find((t) => t.key === activeTab) ?? tabs[0]);

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
  <title>Contrast comparison · wormie.rs.ht</title>
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
    Two comparisons from the same study — a mutant against wild type at two timepoints, say, or two
    mutants against one control — plotted against each other, one dot per gene, its fold change in
    the first comparison on one axis and in the second on the other. Genes along the diagonal behave
    the same way in both. Genes in purple reverse: up in one comparison, down in the other, and by
    more than a half on a log2 scale in both, which is usually the interesting minority. Pearson r
    summarises how closely the two agree overall. Result tables from DESeq2, edgeR or limma all
    work.
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
      Both contrasts are needed for the diff. Each pasted CSV/TSV is parsed independently.
    </span>
  </div>

  {#if rowsA && rowsB && joined.length > 0}
    <Card>
      <CardHeader class="flex flex-row items-baseline justify-between pb-3">
        <CardTitle class="text-base">Genes changed in each contrast</CardTitle>
        <PlotExportMenu getSvg={() => vennSvg} baseName={`venn-${labelA}-vs-${labelB}`} />
      </CardHeader>
      <CardContent class="flex justify-center pt-0">
        <VennDiagram a={vennA} b={vennB} shared={vennShared} bind:svgEl={vennSvg} />
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="pb-2">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle class="text-base">log2FC scatter</CardTitle>
          <div class="flex items-center gap-3">
            <div class="space-x-3 text-xs text-muted-foreground">
              <span><b>{joined.length.toLocaleString()}</b> shared genes</span>
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
            <!-- points: non-flipped first, flipped on top -->
            <g>
              {#each joined.filter((j) => !j.flipped) as j (j.gene)}
                <a
                  href={resolve(`/gene/${nameMap.get(j.gene) ?? j.gene}`)}
                  target="_blank"
                  rel="noopener"
                  aria-label={`Open ${displayName(j.gene)} in a new tab`}
                >
                  <circle
                    cx={xFor(j.lfcA)}
                    cy={yFor(j.lfcB)}
                    r="2"
                    fill={colorFor(j)}
                    stroke="none"
                    data-gene={j.gene}
                    data-lfca={j.lfcA}
                    data-lfcb={j.lfcB}
                  />
                </a>
              {/each}
            </g>
            <g>
              {#each flipped as j (j.gene)}
                <a
                  href={resolve(`/gene/${nameMap.get(j.gene) ?? j.gene}`)}
                  target="_blank"
                  rel="noopener"
                  aria-label={`Open ${displayName(j.gene)} in a new tab`}
                >
                  <circle
                    cx={xFor(j.lfcA)}
                    cy={yFor(j.lfcB)}
                    r="3.5"
                    fill={colorFor(j)}
                    stroke="hsl(280 70% 30%)"
                    stroke-width="0.8"
                    data-gene={j.gene}
                    data-lfca={j.lfcA}
                    data-lfcb={j.lfcB}
                  />
                </a>
              {/each}
            </g>
            <!-- Axis labels -->
            <text
              x={(W - PAD_R + PAD_L) / 2}
              y={H - 6}
              font-size="10"
              text-anchor="middle"
              fill="hsl(var(--muted-foreground))"
            >
              log2FC ({labelA})
            </text>
            <text
              x={PAD_L - 38}
              y={(H - PAD_B + PAD_T) / 2}
              font-size="10"
              fill="hsl(var(--muted-foreground))"
              text-anchor="middle"
              transform={`rotate(-90 ${PAD_L - 38} ${(H - PAD_B + PAD_T) / 2})`}
            >
              log2FC ({labelB})
            </text>
            <text x={PAD_L + 4} y={PAD_T + 12} font-size="9" fill="hsl(var(--muted-foreground))"
              >{labelB} up</text
            >
            <text
              x={W - PAD_R - 4}
              y={H - PAD_B - 4}
              font-size="9"
              text-anchor="end"
              fill="hsl(var(--muted-foreground))">{labelA} up</text
            >
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
        <div class="mt-2 flex flex-wrap items-center gap-3 text-[0.65rem] text-muted-foreground">
          <span
            ><span class="inline-block h-2 w-2 rounded-full" style="background: hsl(280 70% 50%)"
            ></span> flipped direction</span
          >
          <span
            ><span class="inline-block h-2 w-2 rounded-full" style="background: hsl(0 0% 25%)"
            ></span> sig in both (q ≤ 0.05)</span
          >
          <span
            ><span class="inline-block h-2 w-2 rounded-full" style="background: hsl(0 0% 55%)"
            ></span> sig in one</span
          >
          <span><span class="inline-block h-2 w-2 rounded-full bg-muted"></span> ns in both</span>
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
          <div class="py-2 text-xs italic text-muted-foreground">No genes in this bucket.</div>
        {:else}
          <div
            class="grid grid-cols-[auto_auto_auto_auto_1fr] items-center gap-x-3 gap-y-1 text-xs"
          >
            {#each activeBucket.rows.slice(0, 200) as j (j.gene)}
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
              <span
                class={`font-mono tabular-nums ${j.lfcA > 0 ? 'text-rose-600' : 'text-sky-600'}`}
              >
                {labelA}
                {j.lfcA.toFixed(2)}
              </span>
              <span
                class={`font-mono tabular-nums ${j.lfcB > 0 ? 'text-rose-600' : 'text-sky-600'}`}
              >
                {labelB}
                {j.lfcB.toFixed(2)}
              </span>
              <span class="font-mono text-muted-foreground">
                Δ = {(j.lfcB - j.lfcA).toFixed(2)}
              </span>
            {/each}
          </div>
          {#if activeBucket.rows.length > 200}
            <div class="mt-2 border-t pt-2 text-[0.65rem] italic text-muted-foreground">
              Showing first 200 of {activeBucket.rows.length.toLocaleString()}.
            </div>
          {/if}
        {/if}
      </CardContent>
    </Card>
  {:else if rowsA && rowsB}
    <div class="text-sm text-muted-foreground">
      No shared genes between the two contrasts. Check that both use the same gene IDs.
    </div>
  {/if}
</div>
