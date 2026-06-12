<script lang="ts">
  // Volcano/MA plot for DESeq2. log2FC on x (-log10(padj) on y for volcano; log10(baseMean+1)
  // on x / log2FC on y for MA). Sig: q < qThreshold AND |LFC| >= lfcThreshold, colored red/blue.
  // Optional highlight set (amber, drawn on top) spotlights a term's leading edge.
  import { onMount, untrack } from 'svelte';
  import { getGeneNames } from '$lib/queries';
  import { resolve } from '$app/paths';
  import PlotExportMenu from './PlotExportMenu.svelte';

  export type DeRow = {
    gene: string; // gene name or WBGene
    padj: number | null;
    log2fc: number | null;
  };

  // Pre-resolved metadata: skips the internal getGeneNames() fetch (useful when /de or /enrichment
  // has already resolved names for the contrast).
  export type GeneNameInfo = {
    wormbase_gene?: string;
    gene_name: string | null;
    sequence_name: string | null;
  };

  type Props = {
    rows: DeRow[];
    mode?: 'volcano' | 'ma';
    baseMean?: Map<string, number>; // optional for MA mode; otherwise we infer from order
    highlight?: Set<string> | null;
    qThreshold?: number;
    lfcThreshold?: number;
    title?: string;
    /** Pre-resolved WBGene → { gene_name, sequence_name }. Skips internal fetch. */
    nameMap?: Map<string, GeneNameInfo> | null;
    exportName?: string;
  };

  let {
    rows,
    mode = 'volcano',
    baseMean,
    highlight = null,
    qThreshold = 0.05,
    lfcThreshold = 1,
    title,
    nameMap: externalNameMap = null,
    exportName,
  }: Props = $props();

  const W = 720;
  const H = 360;
  const PAD_L = 56;
  const PAD_R = 14;
  const PAD_T = 14;
  const PAD_B = 36;

  // Clamp padj to 1e-300 before log to avoid -Infinity.
  const points = $derived.by(() => {
    const out: { x: number; y: number; lfc: number; padj: number; gene: string }[] = [];
    for (const r of rows) {
      if (r.padj === null || r.log2fc === null) continue;
      if (!Number.isFinite(r.padj) || !Number.isFinite(r.log2fc)) continue;
      const p = Math.max(r.padj, 1e-300);
      const y = -Math.log10(p);
      out.push({ x: r.log2fc, y, lfc: r.log2fc, padj: p, gene: r.gene });
    }
    return out;
  });

  const xRange = $derived.by(() => {
    if (points.length === 0) return [-5, 5];
    let lo = 0,
      hi = 0;
    for (const p of points) {
      const v = mode === 'ma' ? Math.log10((baseMean?.get(p.gene) ?? 1) + 1) : p.lfc;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    // Expand range 5% outward for padding.
    if (mode === 'volcano') {
      const m = Math.max(Math.abs(lo), Math.abs(hi));
      return [-m * 1.05, m * 1.05];
    }
    return [lo - 0.1, hi + 0.1];
  });
  const yRange = $derived.by(() => {
    if (points.length === 0) return [0, 10];
    let hi = 0;
    for (const p of points) if (p.y > hi) hi = p.y;
    return [0, hi * 1.05];
  });

  function xFor(p: { x: number; gene: string }): number {
    const lo = xRange[0],
      hi = xRange[1];
    const innerW = W - PAD_L - PAD_R;
    if (mode === 'ma') {
      const v = Math.log10((baseMean?.get(p.gene) ?? 1) + 1);
      return PAD_L + ((v - lo) / Math.max(1e-9, hi - lo)) * innerW;
    }
    return PAD_L + ((p.x - lo) / Math.max(1e-9, hi - lo)) * innerW;
  }
  function yFor(p: { y: number; lfc: number }): number {
    const lo = yRange[0],
      hi = yRange[1];
    const innerH = H - PAD_T - PAD_B;
    if (mode === 'ma') {
      // MA y-axis is log2FC; recompute symmetric range from points directly.
      const lfcMax = Math.max(Math.abs(xRange[0]), Math.abs(xRange[1])); // not used; recompute
      let lo2 = 0,
        hi2 = 0;
      for (const pt of points) {
        if (pt.lfc < lo2) lo2 = pt.lfc;
        if (pt.lfc > hi2) hi2 = pt.lfc;
      }
      void lfcMax;
      const m = Math.max(Math.abs(lo2), Math.abs(hi2)) * 1.05;
      return PAD_T + ((m - p.lfc) / Math.max(1e-9, 2 * m)) * innerH;
    }
    return PAD_T + ((hi - p.y) / Math.max(1e-9, hi - lo)) * innerH;
  }

  function colorFor(p: { lfc: number; padj: number; gene: string }): string {
    const isHighlight = highlight && (highlight.has(p.gene) || highlight.has(p.gene.toLowerCase()));
    if (isHighlight) return 'hsl(45 95% 50%)'; // amber; overlay pass ensures always on top
    const sig = p.padj <= qThreshold && Math.abs(p.lfc) >= lfcThreshold;
    if (!sig) return 'hsl(0 0% 75% / 0.5)';
    return p.lfc > 0 ? 'hsl(0 72% 45%)' : 'hsl(220 70% 50%)';
  }

  function radiusFor(p: { gene: string }): number {
    const isHighlight = highlight && (highlight.has(p.gene) || highlight.has(p.gene.toLowerCase()));
    return isHighlight ? 4 : 2;
  }

  // Two-pass render: baseline first, then highlights on top.
  const baseline = $derived(
    points.filter(
      (p) => !(highlight && (highlight.has(p.gene) || highlight.has(p.gene.toLowerCase()))),
    ),
  );
  const overlay = $derived(
    points.filter(
      (p) => highlight && (highlight.has(p.gene) || highlight.has(p.gene.toLowerCase())),
    ),
  );

  // Resolve gene tokens to canonical names.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const nameMap = new Map<string, string>();
  let nameMapVersion = $state(0);
  function applyMeta(m: Map<string, GeneNameInfo>) {
    for (const [k, v] of m) nameMap.set(k, v.gene_name || v.sequence_name || k);
    nameMapVersion++;
  }
  $effect(() => {
    const m = externalNameMap;
    if (m) untrack(() => applyMeta(m));
  });
  onMount(async () => {
    if (externalNameMap) return; // caller already resolved.
    const names = rows.map((r) => r.gene).slice(0, 5000);
    const m = await getGeneNames(names);
    applyMeta(m);
  });
  function displayName(g: string): string {
    void nameMapVersion;
    return nameMap.get(g) ?? g;
  }

  // Index lfc/padj by gene for hover lookup, avoiding per-circle data-attribute writes.
  const pointIndex = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const m = new Map<string, { lfc: number; padj: number }>();
    for (const p of points) m.set(p.gene, { lfc: p.lfc, padj: p.padj });
    return m;
  });

  const innerW = $derived(W - PAD_L - PAD_R);
  const innerH = $derived(H - PAD_T - PAD_B);

  // 5 x-ticks and up to 6 y-ticks.
  function xTicks() {
    const lo = xRange[0],
      hi = xRange[1];
    return Array.from({ length: 5 }, (_, i) => lo + (i / 4) * (hi - lo));
  }
  function yTicks() {
    const hi = yRange[1];
    if (hi < 4) return [0, 1, 2, 3];
    const step = Math.ceil(hi / 5);
    return Array.from({ length: 6 }, (_, i) => i * step).filter((v) => v <= hi);
  }

  // Hover via SVG event delegation (not per-circle handlers; critical at 20k+ points).
  let hover = $state<{ gene: string; lfc: number; padj: number; x: number; y: number } | null>(
    null,
  );
  function onSvgMove(e: MouseEvent) {
    const t = e.target as Element | null;
    const c = t && t.closest('[data-gene]');
    if (!c) {
      hover = null;
      return;
    }
    const gene = c.getAttribute('data-gene') ?? '';
    const idx = pointIndex.get(gene);
    if (!idx) {
      hover = null;
      return;
    }
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    hover = {
      gene,
      lfc: idx.lfc,
      padj: idx.padj,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }
  function onSvgLeave() {
    hover = null;
  }

  let svgEl: SVGSVGElement | null = $state(null);
  export function getSvg() {
    return svgEl;
  }
</script>

<div class="overflow-x-auto rounded-lg border bg-card p-3">
  {#if title || exportName}
    <div class="mb-2 flex items-center justify-between gap-2">
      <div class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {title ?? ''}
      </div>
      {#if exportName}
        <PlotExportMenu getSvg={() => svgEl} baseName={exportName} />
      {/if}
    </div>
  {/if}
  <div class="relative inline-block">
    <svg
      bind:this={svgEl}
      viewBox="0 0 {W} {H}"
      class="block"
      width={W}
      height={H}
      role="img"
      aria-label="Volcano plot"
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
        stroke-width="1"
      />
      <line
        x1={PAD_L}
        x2={PAD_L}
        y1={PAD_T}
        y2={H - PAD_B}
        stroke="hsl(var(--border))"
        stroke-width="1"
      />

      {#if mode === 'ma'}
        <!-- MA reference lines: y = 0 and y = ±lfcThreshold -->
        {#each [0, lfcThreshold, -lfcThreshold] as v (v)}
          {@const y = yFor({ y: 0, lfc: v })}
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={y}
            y2={y}
            stroke="hsl(var(--muted-foreground))"
            stroke-width={v === 0 ? 0.8 : 0.6}
            stroke-dasharray={v === 0 ? '0' : '3,3'}
            opacity={v === 0 ? 0.6 : 0.4}
          />
        {/each}
      {/if}
      {#if mode === 'volcano'}
        <!-- significance thresholds -->
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={yFor({ y: -Math.log10(qThreshold), lfc: 0 })}
          y2={yFor({ y: -Math.log10(qThreshold), lfc: 0 })}
          stroke="hsl(var(--muted-foreground))"
          stroke-width="0.6"
          stroke-dasharray="3,3"
          opacity="0.5"
        />
        <line
          x1={xFor({ x: -lfcThreshold, gene: '' })}
          x2={xFor({ x: -lfcThreshold, gene: '' })}
          y1={PAD_T}
          y2={H - PAD_B}
          stroke="hsl(var(--muted-foreground))"
          stroke-width="0.6"
          stroke-dasharray="3,3"
          opacity="0.5"
        />
        <line
          x1={xFor({ x: lfcThreshold, gene: '' })}
          x2={xFor({ x: lfcThreshold, gene: '' })}
          y1={PAD_T}
          y2={H - PAD_B}
          stroke="hsl(var(--muted-foreground))"
          stroke-width="0.6"
          stroke-dasharray="3,3"
          opacity="0.5"
        />
      {/if}

      <!-- Tick labels -->
      {#each xTicks() as t (t)}
        {@const x = PAD_L + (innerW * (t - xRange[0])) / Math.max(1e-9, xRange[1] - xRange[0])}
        <line
          x1={x}
          x2={x}
          y1={H - PAD_B}
          y2={H - PAD_B + 3}
          stroke="hsl(var(--muted-foreground))"
        />
        <text
          {x}
          y={H - PAD_B + 14}
          font-size="9"
          text-anchor="middle"
          fill="hsl(var(--muted-foreground))">{t.toFixed(1)}</text
        >
      {/each}
      {#each yTicks() as t (t)}
        {@const y = PAD_T + ((yRange[1] - t) / Math.max(1e-9, yRange[1] - yRange[0])) * innerH}
        <line x1={PAD_L - 3} x2={PAD_L} y1={y} y2={y} stroke="hsl(var(--muted-foreground))" />
        <text
          x={PAD_L - 5}
          y={y + 3}
          font-size="9"
          text-anchor="end"
          fill="hsl(var(--muted-foreground))">{t}</text
        >
      {/each}

      <!-- Axis titles -->
      <text
        x={(W - PAD_R + PAD_L) / 2}
        y={H - 6}
        font-size="10"
        text-anchor="middle"
        fill="hsl(var(--muted-foreground))"
      >
        {mode === 'ma' ? 'log10(baseMean + 1)' : 'log2 fold change'}
      </text>
      <text
        x={PAD_L - 38}
        y={(H - PAD_B + PAD_T) / 2}
        font-size="10"
        fill="hsl(var(--muted-foreground))"
        text-anchor="middle"
        transform={`rotate(-90 ${PAD_L - 38} ${(H - PAD_B + PAD_T) / 2})`}
      >
        {mode === 'ma' ? 'log2 fold change' : '-log10(padj)'}
      </text>

      <!-- Baseline points -->
      <g>
        {#each baseline as p (p.gene)}
          <!-- svelte-ignore a11y_consider_explicit_label -->
          <a
            href={resolve(`/gene/${nameMap.get(p.gene) ?? p.gene}`)}
            target="_blank"
            rel="noopener"
          >
            <circle
              cx={xFor(p)}
              cy={yFor(p)}
              r={radiusFor(p)}
              fill={colorFor(p)}
              stroke="none"
              data-gene={p.gene}
            />
          </a>
        {/each}
      </g>
      <!-- Highlight overlay -->
      <g>
        {#each overlay as p (p.gene)}
          <!-- svelte-ignore a11y_consider_explicit_label -->
          <a
            href={resolve(`/gene/${nameMap.get(p.gene) ?? p.gene}`)}
            target="_blank"
            rel="noopener"
          >
            <circle
              cx={xFor(p)}
              cy={yFor(p)}
              r={radiusFor(p)}
              fill={colorFor(p)}
              stroke="hsl(40 90% 30%)"
              stroke-width="1"
              data-gene={p.gene}
            />
          </a>
        {/each}
      </g>
    </svg>
    {#if hover}
      <div
        class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[120%] whitespace-nowrap rounded border bg-popover px-2 py-1 font-mono text-[0.7rem] shadow"
        style="left: {hover.x}px; top: {hover.y}px;"
      >
        <span class="font-semibold">{displayName(hover.gene)}</span>
        <span class="text-muted-foreground">·</span>
        log2FC <span class="tabular-nums">{hover.lfc.toFixed(2)}</span>
        <span class="text-muted-foreground">·</span>
        padj <span class="tabular-nums">{hover.padj.toExponential(1)}</span>
      </div>
    {/if}
  </div>
  <div class="mt-2 flex flex-wrap items-center gap-3 text-[0.65rem] text-muted-foreground">
    <span class="inline-flex items-center gap-1">
      <span class="inline-block h-2 w-2 rounded-full" style="background: hsl(0 72% 45%)"></span>
      up (q ≤ {qThreshold}, log2FC ≥ {lfcThreshold})
    </span>
    <span class="inline-flex items-center gap-1">
      <span class="inline-block h-2 w-2 rounded-full" style="background: hsl(220 70% 50%)"></span>
      down (q ≤ {qThreshold}, log2FC ≤ −{lfcThreshold})
    </span>
    <span class="inline-flex items-center gap-1">
      <span class="inline-block h-2 w-2 rounded-full bg-muted"></span>
      not significant
    </span>
    {#if overlay.length > 0}
      <span class="inline-flex items-center gap-1">
        <span class="inline-block h-2 w-2 rounded-full" style="background: hsl(45 95% 50%)"></span>
        highlighted ({overlay.length})
      </span>
    {/if}
    <span class="ml-auto font-mono">{points.length.toLocaleString()} genes</span>
  </div>
</div>
