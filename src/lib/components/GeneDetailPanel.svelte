<script lang="ts">
  import { resolve } from '$app/paths';
  import StripPlot, { type StripPoint } from './StripPlot.svelte';
  import CengenStripPlot from './CengenStripPlot.svelte';
  import type { CengenExpressionRow } from '$lib/queries';
  import type { DESeq2Row, DESeq2DesignRow } from '$lib/deseq2/types';
  import { prettySample } from '$lib/sample-names';

  let {
    gene,
    displayLabel,
    row,
    design,
    countsBySample,
    cengen,
    wormbaseGene,
    onClose,
    reference,
  }: {
    gene: string;
    displayLabel: string;
    row: DESeq2Row | null;
    design: DESeq2DesignRow[];
    countsBySample: Map<string, number> | null;
    cengen?: CengenExpressionRow[] | null;
    wormbaseGene?: string | null;
    onClose?: () => void;
    reference?: string | null;
  } = $props();

  let scale = $state<'log' | 'linear'>('log');

  const points = $derived.by<StripPoint[]>(() => {
    if (!countsBySample) return [];
    return design.map((d) => ({
      id: prettySample(d.sample),
      group: d.condition || '?',
      value: countsBySample.get(d.sample) ?? NaN,
    }));
  });

  const fmt = (n: number | undefined, p = 3): string =>
    n === undefined || !Number.isFinite(n) ? 'NA' : n.toFixed(p);
  const fmtP = (n: number | undefined): string => {
    if (n === undefined || !Number.isFinite(n)) return 'NA';
    if (n === 0) return '0';
    if (n < 1e-3) return n.toExponential(2);
    return n.toFixed(3);
  };
</script>

<div class="space-y-3">
  <div class="flex items-baseline justify-between">
    <div class="flex items-baseline gap-2">
      <span class="text-base font-semibold">{displayLabel}</span>
      {#if displayLabel !== gene}
        <span class="font-mono text-xs text-muted-foreground">{gene}</span>
      {/if}
      {#if wormbaseGene}
        <a
          href={resolve(`/gene/${wormbaseGene}`)}
          target="_blank"
          rel="noopener"
          class="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >Gene page</a
        >
      {/if}
    </div>
    <div class="flex items-center gap-2 text-xs">
      <div class="inline-flex overflow-hidden rounded-md border text-[0.65rem]">
        <button
          type="button"
          onclick={() => (scale = 'log')}
          class={'px-2 py-0.5 transition-colors ' +
            (scale === 'log' ? 'bg-accent text-accent-foreground' : 'bg-card hover:bg-muted/50')}
          >log10</button
        >
        <button
          type="button"
          onclick={() => (scale = 'linear')}
          class={'px-2 py-0.5 transition-colors ' +
            (scale === 'linear' ? 'bg-accent text-accent-foreground' : 'bg-card hover:bg-muted/50')}
          >linear</button
        >
      </div>
      {#if onClose}
        <button
          type="button"
          onclick={onClose}
          class="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >close</button
        >
      {/if}
    </div>
  </div>

  {#if row}
    <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3 lg:grid-cols-6">
      <div>
        <span class="text-muted-foreground" title="Mean of the normalized counts over all samples"
          >baseMean</span
        >
        <span class="font-mono">{fmt(row.baseMean, 1)}</span>
      </div>
      <div>
        <span class="text-muted-foreground" title="log2 fold change between the two conditions"
          >log2FC</span
        >
        <span class="font-mono">{fmt(row.log2FoldChange)}</span>
      </div>
      <div>
        <span class="text-muted-foreground" title="Standard error of the log2 fold change"
          >lfcSE</span
        >
        <span class="font-mono">{fmt(row.lfcSE)}</span>
      </div>
      <div>
        <span class="text-muted-foreground">stat</span>
        <span class="font-mono">{fmt(row.stat)}</span>
      </div>
      <div>
        <span class="text-muted-foreground">pvalue</span>
        <span class="font-mono">{fmtP(row.pvalue)}</span>
      </div>
      <div>
        <span
          class="text-muted-foreground"
          title="p-value adjusted for testing many genes (Benjamini-Hochberg false discovery rate)"
          >padj</span
        >
        <span class="font-mono">{fmtP(row.padj)}</span>
      </div>
    </div>
  {/if}

  {#if countsBySample}
    <StripPlot
      {points}
      {reference}
      yLabel={scale === 'log' ? 'log10(normalized count + 1)' : 'normalized count'}
      logY={scale === 'log'}
      height={260}
      exportName={`counts-${gene}`}
    />
  {:else}
    <div class="rounded border border-dashed p-4 text-center text-xs italic text-muted-foreground">
      No normalized count row found for {gene}.
    </div>
  {/if}

  {#if cengen && wormbaseGene && cengen.length > 0}
    <div class="space-y-1">
      <div class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        CeNGEN reference expression
      </div>
      <CengenStripPlot gene={wormbaseGene} geneName={displayLabel} rows={cengen} />
    </div>
  {/if}
</div>
