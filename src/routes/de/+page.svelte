<script lang="ts">
  // /de: featureCounts counts.tsv -> DESeq2 (WebR, in-browser) -> results table / handoff to /enrichment.
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Badge } from '$lib/components/ui/badge';
  import PageHint from '$lib/components/PageHint.svelte';
  import ControlHint from '$lib/components/ControlHint.svelte';
  import SaveDatasetButton from '$lib/components/SaveDatasetButton.svelte';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import ArrowRight from 'lucide-svelte/icons/arrow-right';
  import Download from 'lucide-svelte/icons/download';
  import Package from 'lucide-svelte/icons/package';
  import ImageIcon from 'lucide-svelte/icons/image';
  import Play from 'lucide-svelte/icons/play';
  import { exportSvgBundle } from '$lib/export-plot';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { toast } from 'svelte-sonner';
  import { cn } from '$lib/utils';
  import { db } from '$lib/stores/db.svelte';
  import {
    runFit,
    runOneContrast,
    runAllContrasts,
    rehydrateFromDdsBlob,
    clearBundleCache,
    prewarmWebR,
    restartWebR,
    subscribeRSession,
    type RSessionSnapshot,
  } from '$lib/deseq2/client';
  import { getBundleManifest } from '$lib/deseq2/webr-instance';
  import type {
    DESeq2FitResult,
    DESeq2Contrast,
    DESeq2DesignRow,
    ContrastSpec,
  } from '$lib/deseq2/types';
  import { handoff } from '$lib/pipeline-handoff';
  import VolcanoPlot, { type DeRow } from '$lib/components/VolcanoPlot.svelte';
  import PValueHistogram from '$lib/components/PValueHistogram.svelte';
  import DeGeneTable from '$lib/components/DeGeneTable.svelte';
  import PCAScatter from '$lib/components/PCAScatter.svelte';
  import DispersionPlot from '$lib/components/DispersionPlot.svelte';
  import SampleDistanceHeatmap from '$lib/components/SampleDistanceHeatmap.svelte';
  import CountsBoxplot from '$lib/components/CountsBoxplot.svelte';
  import GeneDetailPanel from '$lib/components/GeneDetailPanel.svelte';
  import CountsQcPanel from '$lib/components/CountsQcPanel.svelte';
  import { parseFeatureCountsTsv } from '$lib/qc';
  import { countsSamples, parseCountsTable } from '$lib/deseq2/counts-table';
  import { deseq2ErrorHint } from '$lib/deseq2/error-hints';
  import MethodsButton from '$lib/components/MethodsButton.svelte';
  import {
    parsePca,
    parseDispersions,
    computeBaseMeanFromNormalizedCounts,
    computeSampleDistances,
    hclustOrder,
    reorderDistance,
    summarizeCountsToBoxes,
    summarizeRawCountsFromFeatureCountsTsv,
    geneRowFromCountsTsv,
  } from '$lib/deseq2/parse-tsv';
  import { getGeneNames, getCengenExpressionFor, type CengenExpressionRow } from '$lib/queries';
  import { prettySample } from '$lib/sample-names';

  type GeneNameMap = Map<
    string,
    {
      wormbase_gene: string;
      gene_name: string | null;
      sequence_name: string | null;
      gene_type: string | null;
    }
  >;
  function displayName(id: string, m: GeneNameMap | null): string {
    if (!m) return id;
    const e = m.get(id);
    return e?.gene_name || e?.sequence_name || id;
  }

  let countsText = $state('');
  let countsName = $state('');
  let countsInput: HTMLInputElement | null = $state(null);

  const samples = $derived(countsSamples(countsText));
  let design = $state<DESeq2DesignRow[]>([]);
  // Re-seed design rows when samples change; preserve existing conditions. untrack avoids self-trigger.
  // Conditions and reference set on /counts, applied once the handed-off samples appear.
  let prefill = new Map<string, string>();
  let prefillReference = '';
  $effect(() => {
    const newSamples = samples;
    const existing = new Map(untrack(() => design.map((d) => [d.sample, d.condition])));
    design = newSamples.map((sample) => ({
      sample,
      condition: existing.get(sample) ?? prefill.get(sample) ?? '',
    }));
  });

  const conditions = $derived(Array.from(new Set(design.map((d) => d.condition).filter(Boolean))));
  let reference = $state('');
  // shrinkage: global default for "Compute all". contrastShrinkage: per-chip override for single clicks.
  let shrinkage = $state<'apeglm' | 'ashr' | 'none'>('apeglm');
  // The pre-fit choice is the default for single chips too; the per-contrast
  // selector only overrides it afterwards.
  let contrastShrinkage = $derived<'apeglm' | 'ashr' | 'none'>(shrinkage);
  let showBatch = $state(false);
  let minCount = $state(10);
  let alpha = $state(0.05);
  // padj depends on alpha through independent filtering, so a cached contrast
  // computed at another alpha has to be re-extracted rather than reused.
  const contrastAlpha = new SvelteMap<string, number>();
  let bundleSizeLabel = $state('');
  let pairwiseMode = $state<'vs-reference' | 'all-pairwise'>('vs-reference');
  $effect(() => {
    const cs = conditions;
    untrack(() => {
      if (prefillReference && cs.includes(prefillReference)) {
        reference = prefillReference;
        prefillReference = '';
      } else if (!cs.includes(reference)) reference = cs[0] ?? '';
    });
  });

  // vs-reference: N-1 contrasts; all-pairwise: N*(N-1) (each level as denominator).
  const contrastPreview = $derived.by(() => {
    if (!reference || conditions.length < 2) return [] as string[];
    const others = conditions.filter((c) => c !== reference);
    if (pairwiseMode === 'all-pairwise') {
      const labels: string[] = [];
      const all = [reference, ...others];
      for (const t of all) for (const r of all) if (t !== r) labels.push(`${t}_vs_${r}`);
      return labels;
    }
    return others.map((c) => `${c}_vs_${reference}`);
  });

  let running = $state(false);
  let extracting = $state(false);
  let runningAll = $state(false);
  let fitLog = $state<string[]>([]);
  // A failed fit stays on the page until the next run, not only in a passing toast.
  let fitError = $state<{ title: string; message: string; hint: string | null } | null>(null);
  function failFit(title: string, e: unknown) {
    const message = (e as Error)?.message ?? String(e);
    fitError = { title, message, hint: deseq2ErrorHint(message) };
    appendFitLog(`[error] ${title}: ${message}`);
    toast.error(title, { description: message });
  }
  let fitLogEl: HTMLPreElement | null = $state(null);
  let contrastLog = $state<string[]>([]);
  let contrastLogEl: HTMLPreElement | null = $state(null);

  function defaultAutoSize(): number {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    return Math.max(1, Math.min(4, Math.floor(cores / 2)));
  }
  let workerSetting = $state(
    typeof localStorage !== 'undefined'
      ? (localStorage.getItem('wb.deseq.workers') ?? 'auto')
      : 'auto',
  );
  $effect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('wb.deseq.workers', workerSetting);
    }
  });
  let poolSize = $derived(
    workerSetting === 'auto' ? defaultAutoSize() : Math.max(1, Number(workerSetting) || 1),
  );
  $effect(() => {
    void fitLog.length;
    const el = fitLogEl;
    if (el) el.scrollTop = el.scrollHeight;
  });
  $effect(() => {
    void contrastLog.length;
    const el = contrastLogEl;
    if (el) el.scrollTop = el.scrollHeight;
  });
  const appendFitLog = (line: string) => {
    fitLog = [...fitLog, line];
  };
  // The R session is module-level and outlives this page, so its state and
  // start-up log are read back through a subscription rather than owned here.
  let rSession = $state<RSessionSnapshot>({ state: 'idle', since: 0, error: null, log: [] });
  let rElapsed = $state(0);
  $effect(() => {
    if (rSession.state !== 'starting') return;
    const since = rSession.since;
    const tick = () => (rElapsed = Math.max(0, Math.round((Date.now() - since) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  });
  const appendContrastLog = (line: string) => {
    contrastLog = [...contrastLog, line];
  };
  let fit = $state<DESeq2FitResult | null>(null);
  let geneMeta = $state<GeneNameMap | null>(null);
  let geneMetaForContrast = $state<string | null>(null);
  let selectedGene = $state<string | null>(null);
  let qcTab = $state<'pca' | 'distance' | 'dispersion' | 'boxplots'>('pca');
  let vizTab = $state<'volcano' | 'ma' | 'phist' | 'table'>('volcano');
  // Contrasts cached by name; chips appear for all pairs, empty until clicked or batch-computed.
  let contrasts: SvelteMap<string, DESeq2Contrast> = new SvelteMap();
  let activeContrast = $state('');
  const activeContrastObj = $derived(contrasts.get(activeContrast) ?? null);
  // Pairs from fit.levels; fit.levels[0] is the reference.
  const allPairs = $derived.by<ContrastSpec[]>(() => {
    if (!fit) return [];
    const ref = fit.levels[0];
    if (pairwiseMode === 'all-pairwise') {
      const ps: ContrastSpec[] = [];
      for (const t of fit.levels)
        for (const r of fit.levels) if (t !== r) ps.push({ treatment: t, reference: r });
      return ps;
    }
    return fit.levels.slice(1).map((t) => ({ treatment: t, reference: ref }));
  });

  onMount(() => {
    if (page.url.searchParams.get('from') === 'counts') {
      const h = handoff.counts.consume();
      if (h) {
        if (h.conditions) prefill = new Map(h.samples.map((s, i) => [s, h.conditions![i] ?? '']));
        prefillReference = h.reference ?? '';
        countsText = h.tsv;
        countsName = 'counts.tsv (from /counts)';
        toast.success('Loaded counts from /counts');
      }
    }
    void getBundleManifest().then((m) => {
      if (m?.dataBytes) bundleSizeLabel = `${(m.dataBytes / 1024 / 1024).toFixed(0)} MB`;
    });
    const unsubscribe = subscribeRSession({
      onStatus: (s) => {
        rSession = s;
        if (s.state !== 'ready' && fitLog.length === 0 && s.log.length) fitLog = [...s.log];
      },
      onLine: appendFitLog,
    });
    prewarmWebR();
    return unsubscribe;
  });

  async function loadCountsFile(f: File) {
    const t = await f.text();
    countsText = t;
    countsName = f.name;
  }
  function onUpload(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) loadCountsFile(f);
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
    if (running) return;
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (!/\.(tsv|txt|csv)$/i.test(f.name)) {
      toast.error('Drop a .tsv / .txt / .csv counts file');
      return;
    }
    loadCountsFile(f);
  }

  // Why Run is disabled, shown next to the button so a blank cell is not a silent block.
  const runBlocker = $derived.by((): string | null => {
    if (!countsText.trim() || samples.length === 0) return 'Load a counts table first.';
    const noCond = design.filter((d) => !d.condition.trim()).length;
    if (noCond > 0) return `Give every sample a condition (${noCond} empty).`;
    if (!reference) return 'Pick a reference level.';
    if (contrastPreview.length === 0) return 'Needs at least two conditions to compare.';
    const noBatch = showBatch ? design.filter((d) => !(d.batch ?? '').trim()).length : 0;
    if (noBatch > 0) {
      return `Fill in the batch for every sample (${noBatch} empty), or untick the batch covariate.`;
    }
    return null;
  });
  const canRun = $derived(!running && runBlocker === null);

  async function rehydrate(file: File) {
    running = true;
    fit = null;
    contrasts.clear();
    activeContrast = '';
    fitLog = [];
    contrastLog = [];
    fitError = null;
    try {
      const blob = new Uint8Array(await file.arrayBuffer());
      fit = await rehydrateFromDdsBlob(blob, appendFitLog);
      // Restore reference from recovered factor levels so contrast extraction works immediately.
      reference = fit.levels[0];
      toast.success(`dds restored (${fit.levels.length} levels)`);
    } catch (e) {
      failFit('Could not load dds.rds', e);
    } finally {
      running = false;
    }
  }

  let ddsInput: HTMLInputElement | null = $state(null);
  function onDdsUpload(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) rehydrate(f);
    (e.target as HTMLInputElement).value = '';
  }

  // Quiet input repairs are worth a line in the log and a toast, not a refusal.
  function noteInputRepairs() {
    const { nonNumeric, duplicates } = parseCountsTable(countsText);
    if (nonNumeric > 0) {
      const msg = `${nonNumeric.toLocaleString()} empty or non-numeric cells were read as 0`;
      appendFitLog(`[input] ${msg}`);
      toast.warning('Counts table repaired', { description: msg });
    }
    if (duplicates > 0) {
      const msg = `${duplicates.toLocaleString()} gene ids appear more than once; DESeq2 suffixes the repeats (.1, .2)`;
      appendFitLog(`[input] ${msg}`);
      toast.warning('Duplicate gene ids', { description: msg });
    }
  }

  async function run() {
    running = true;
    fit = null;
    contrasts.clear();
    activeContrast = '';
    fitLog =
      rSession.state === 'starting'
        ? [...rSession.log, '[webr] waiting for the R session ...']
        : [];
    noteInputRepairs();
    contrastLog = [];
    fitError = null;
    try {
      const designOut = design.map((d) => ({
        sample: d.sample,
        condition: d.condition,
        ...(showBatch && d.batch ? { batch: d.batch } : {}),
      }));
      fit = await runFit(
        { countsTsv: countsText, design: designOut, reference, minCount },
        appendFitLog,
      );
      toast.success(`Fit done in ${fit.elapsedSec.toFixed(1)}s`);
    } catch (e) {
      failFit('DESeq2 fit failed', e);
    } finally {
      running = false;
    }
  }

  function warnShrinkFailure(c: DESeq2Contrast) {
    if (!c.shrinkError) return;
    toast.warning(`Shrinkage failed for ${c.name}`, {
      description: `${c.shrinkError.replace(/[.\s]+$/, '')}. Showing unshrunken log2 fold changes.`,
      duration: 10_000,
    });
  }

  async function extractOne(pair: ContrastSpec) {
    if (!fit || extracting || runningAll) return;
    const name = `${pair.treatment}_vs_${pair.reference}`;
    activeContrast = name;
    // Recompute if cached version used a different shrinkage method.
    const existing = contrasts.get(name);
    const effective =
      pair.reference === fit.levels[0]
        ? contrastShrinkage
        : contrastShrinkage === 'apeglm'
          ? 'ashr'
          : contrastShrinkage;
    const existingRequested = existing?.shrinkageRequested ?? existing?.shrinkage;
    if (existing && existingRequested === effective && contrastAlpha.get(name) === alpha) return;
    extracting = true;
    try {
      const c = await runOneContrast(
        pair,
        contrastShrinkage,
        fit.levels[0],
        appendContrastLog,
        alpha,
      );
      contrastAlpha.set(name, alpha);
      contrasts.set(name, c);
      warnShrinkFailure(c);
    } catch (e) {
      toast.error('Contrast failed', { description: (e as Error)?.message ?? String(e) });
    } finally {
      extracting = false;
    }
  }

  async function computeAll() {
    if (!fit || runningAll || extracting) return;
    const pending = allPairs.filter((p) => {
      const name = `${p.treatment}_vs_${p.reference}`;
      return !contrasts.has(name) || contrastAlpha.get(name) !== alpha;
    });
    if (pending.length === 0) {
      toast.message('All contrasts already computed');
      return;
    }
    runningAll = true;
    try {
      const out = await runAllContrasts(
        fit.ddsBlob,
        pending,
        shrinkage,
        fit.levels[0],
        appendContrastLog,
        (_i, c) => {
          contrasts.set(c.name, c);
          contrastAlpha.set(c.name, alpha);
          warnShrinkFailure(c);
        },
        poolSize,
        alpha,
      );
      appendContrastLog(`[pool] all ${out.length} contrast(s) done`);
      if (!activeContrast && out[0]) activeContrast = out[0].name;
    } catch (e) {
      toast.error('Parallel run failed', { description: (e as Error)?.message ?? String(e) });
    } finally {
      runningAll = false;
    }
  }

  function downloadBlob(name: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  function downloadTsv(name: string, content: string) {
    downloadBlob(name, new Blob([content], { type: 'text/tab-separated-values' }));
  }
  async function downloadAllZip() {
    if (!fit) return;
    const { zipSync, strToU8 } = await import('fflate');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const files: Record<string, Uint8Array> = {
      'dds.rds': fit.ddsBlob,
      'design.tsv': strToU8(fit.designTsv),
      'dispersions.tsv': strToU8(fit.dispersionsTsv),
      'normalized_counts.tsv': strToU8(fit.normalizedCountsTsv),
      'vst_counts.tsv': strToU8(fit.vstCountsTsv),
      'size_factors.tsv': strToU8(fit.sizeFactorsTsv),
      'pca.tsv': strToU8(fit.pcaTsv),
      'pca_var.tsv': strToU8(fit.pcaVarTsv),
    };
    for (const c of contrasts.values()) {
      files[`results/${c.name}.tsv`] = strToU8(c.tsv);
    }
    const zipped = zipSync(files);
    downloadBlob(
      `deseq2-ref_${reference}-${stamp}.zip`,
      new Blob([zipped], { type: 'application/zip' }),
    );
  }
  function downloadDds() {
    if (!fit) return;
    // WebR's Uint8Array uses ArrayBufferLike; wrap in new Uint8Array for Blob compatibility.
    const bytes = new Uint8Array(fit.ddsBlob);
    downloadBlob('dds.rds', new Blob([bytes], { type: 'application/octet-stream' }));
  }

  async function continueToEnrichment() {
    if (!activeContrastObj) return;
    handoff.deseq2.set({ tsv: activeContrastObj.tsv });
    await goto(resolve('/enrichment') + '?from=de');
  }

  async function continueToGsea() {
    if (!activeContrastObj) return;
    const rows = activeContrastObj.rows
      .filter((r) => Number.isFinite(r.stat))
      .map((r) => ({ gene: r.gene, score: r.stat }));
    if (rows.length === 0) {
      toast.error('No usable rows', { description: 'All stat values are NA in this contrast.' });
      return;
    }
    handoff.gsea.set({ contrastName: activeContrastObj.name, rows });
    await goto(resolve('/gsea') + '?from=de');
  }

  async function continueToSsgsea() {
    if (!fit?.normalizedCountsTsv) return;
    // ssGSEA ranks genes within each sample, so any per-sample monotone transform
    // gives identical scores. Normalized counts are sent rather than VST so that
    // VST stays confined to visualization (the PCA and the sample-distance heatmap).
    handoff.ssgsea.set({
      tsv: fit.normalizedCountsTsv,
      label: 'Normalized counts from /de',
      designTsv: fit.designTsv,
    });
    await goto(resolve('/ssgsea') + '?from=de');
  }

  let diffA = $state<string>('');
  let diffB = $state<string>('');
  const computedNames = $derived(Array.from(contrasts.keys()));
  $effect(() => {
    const names = computedNames;
    untrack(() => {
      if (!names.includes(diffA)) diffA = '';
      if (!names.includes(diffB)) diffB = '';
    });
  });
  async function continueToDiff() {
    const a = contrasts.get(diffA);
    const b = contrasts.get(diffB);
    if (!a || !b || a.name === b.name) return;
    handoff.deseqDiff.set({
      a: { name: a.name, tsv: a.tsv },
      b: { name: b.name, tsv: b.tsv },
    });
    await goto(resolve('/de/diff') + '?from=de');
  }

  const nSig = $derived.by(() => {
    if (!activeContrastObj) return 0;
    return activeContrastObj.rows.filter((r) => Number.isFinite(r.padj) && r.padj < alpha).length;
  });

  $effect(() => {
    const c = activeContrastObj;
    if (!c) return;
    if (db.phase !== 'ready') return;
    if (geneMetaForContrast === c.name) return;
    geneMetaForContrast = c.name;
    const ids = Array.from(new Set(c.rows.map((r) => r.gene)));
    getGeneNames(ids)
      .then((m) => {
        if (geneMetaForContrast === c.name) geneMeta = m;
      })
      .catch((e) => {
        console.warn('[de] getGeneNames failed', e);
      });
  });
  $effect(() => {
    void activeContrast;
    untrack(() => {
      selectedGene = null;
    });
  });

  // VolcanoPlot/MA needs { gene, padj, log2fc }; MA mode also needs baseMean.
  const deRows = $derived.by<DeRow[]>(() => {
    if (!activeContrastObj) return [];
    return activeContrastObj.rows.map((r) => ({
      gene: r.gene,
      padj: Number.isFinite(r.padj) ? r.padj : null,
      log2fc: Number.isFinite(r.log2FoldChange) ? r.log2FoldChange : null,
    }));
  });
  const baseMeanMap = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const m = new Map<string, number>();
    if (!activeContrastObj) return m;
    for (const r of activeContrastObj.rows) {
      if (Number.isFinite(r.baseMean)) m.set(r.gene, r.baseMean);
    }
    return m;
  });
  const pvals = $derived.by(() => {
    if (!activeContrastObj) return [] as number[];
    return activeContrastObj.rows.map((r) => r.pvalue);
  });

  const selectedDisplay = $derived(selectedGene ? displayName(selectedGene, geneMeta) : '');
  const selectedRow = $derived.by(() => {
    if (!selectedGene || !activeContrastObj) return null;
    return activeContrastObj.rows.find((r) => r.gene === selectedGene) ?? null;
  });
  const selectedCounts = $derived.by(() => {
    if (!selectedGene || !fit) return null;
    return geneRowFromCountsTsv(fit.normalizedCountsTsv, selectedGene);
  });
  const selectedWbgene = $derived.by(() => {
    if (!selectedGene) return null;
    if (selectedGene.startsWith('WBGene')) return selectedGene;
    const meta = geneMeta?.get(selectedGene);
    return meta?.wormbase_gene ?? null;
  });
  let cengenForSelected = $state<CengenExpressionRow[] | null>(null);
  let cengenForGene = $state<string | null>(null);
  $effect(() => {
    const wb = selectedWbgene;
    if (!wb) {
      cengenForSelected = null;
      cengenForGene = null;
      return;
    }
    if (cengenForGene === wb) return;
    cengenForGene = wb;
    getCengenExpressionFor(wb)
      .then((rows) => {
        if (cengenForGene === wb) cengenForSelected = rows;
      })
      .catch(() => {
        if (cengenForGene === wb) cengenForSelected = null;
      });
  });

  // QC derivers are per-tab: only the active tab computes, avoiding upfront cost of all views.
  // Heavy bits (sample-distance, boxes) are memoized per fit; contrast changes don't recompute.
  const qcPca = $derived.by(() => {
    if (!fit || qcTab !== 'pca') return null;
    const pca = parsePca(fit.pcaTsv, fit.pcaVarTsv);
    pca.points = pca.points.map((p) => ({ ...p, sample: prettySample(p.sample) }));
    return pca;
  });
  const qcDist = $derived.by(() => {
    if (!fit || qcTab !== 'distance') return null;
    const raw = computeSampleDistances(fit.vstCountsTsv);
    if (raw.samples.length <= 2) {
      return { samples: raw.samples.map(prettySample), matrix: raw.matrix };
    }
    const order = hclustOrder(raw.matrix);
    const reordered = reorderDistance(raw.samples, raw.matrix, order);
    return { samples: reordered.samples.map(prettySample), matrix: reordered.matrix };
  });
  const qcDispersion = $derived.by(() => {
    if (!fit || qcTab !== 'dispersion') return null;
    const baseMean = computeBaseMeanFromNormalizedCounts(fit.normalizedCountsTsv);
    return parseDispersions(fit.dispersionsTsv, baseMean);
  });
  const qcBoxes = $derived.by(() => {
    if (!fit || qcTab !== 'boxplots') return null;
    const conditionOf = new Map(design.map((d) => [d.sample, d.condition]));
    const normBoxes = summarizeCountsToBoxes(fit.normalizedCountsTsv, true).map((b) => ({
      ...b,
      condition: conditionOf.get(b.sample) ?? null,
      sample: prettySample(b.sample),
    }));
    const rawBoxes = countsText
      ? summarizeRawCountsFromFeatureCountsTsv(countsText, true).map((b) => ({
          ...b,
          condition: conditionOf.get(b.sample) ?? null,
          sample: prettySample(b.sample),
        }))
      : [];
    return { normBoxes, rawBoxes };
  });
</script>

<svelte:head><title>Differential expression · wormie.rs.ht</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href={resolve('/')} class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Differential expression</h1>
    <p class="text-sm text-muted-foreground">Genes that change between conditions</p>
  </header>

  <PageHint id="de.intro" title="What this step does">
    Give it a counts table and say which samples are which condition. It then asks, gene by gene,
    whether the difference between conditions is larger than the variation between replicates of the
    same condition. Two numbers come back per gene. The <b>log2 fold change</b> (log2FC) is the size
    and direction of the change: 1 means doubled, -1 means halved, 0 means no change. The
    <b>adjusted p-value</b> (padj) corrects for testing thousands of genes at once, where some will look
    significant by chance. It is a false discovery rate (FDR), the expected share of false calls among
    the genes you call changed. padj &lt; 0.05 is the usual cutoff, meaning roughly 5% of the genes you
    call changed are expected to be false. The method is DESeq2, which runs in your browser through R
    (WebR). The first run spends 15-20 s starting R. Later runs take seconds.
  </PageHint>

  <Card
    role="region"
    aria-label="Counts"
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    ondrop={onDrop}
    class={dragOver ? 'ring-2 ring-primary ring-offset-2 transition' : ''}
  >
    <CardHeader>
      <CardTitle class="flex items-center justify-between text-lg">
        <span class="inline-flex items-center gap-1.5">
          Counts
          <ControlHint id="de-counts" title="Which table this needs">
            A table of raw read counts: genes down the rows, samples across the columns, whole
            numbers in the cells. It can come from the read counting page, from featureCounts or
            HTSeq at the command line, or from a pipeline such as nf-core/rnaseq.
            <br /><br />
            It must be raw counts, not transcripts per million (TPM), fragments per kilobase per million
            (FPKM) or anything else already normalised. Those are already adjusted for library size and
            gene length. DESeq2 does its own normalisation while modelling the counting noise, so it needs
            the untouched numbers. Normalised values may not cause an error, but the results will be wrong.
          </ControlHint>
        </span>
        <span class="text-xs font-normal text-muted-foreground">
          drag &amp; drop counts.tsv anywhere on this card
        </span>
      </CardTitle>
    </CardHeader>
    <CardContent class="space-y-3">
      <input
        bind:this={countsInput}
        type="file"
        accept=".tsv,.txt,.csv"
        onchange={onUpload}
        class="hidden"
      />
      <input bind:this={ddsInput} type="file" accept=".rds" onchange={onDdsUpload} class="hidden" />
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onclick={() => countsInput?.click()} disabled={running}>
          Upload counts.tsv
        </Button>
        <Button variant="outline" size="sm" onclick={() => ddsInput?.click()} disabled={running}>
          Upload dds.rds (skip fit)
        </Button>
        <ControlHint id="de-dds" title="What a dds.rds file is">
          Fitting is the slowest part of a run. After it finishes, the <b>dds.rds</b> download on
          this page saves the fitted model as one file. It holds the counts, the design and the
          dispersions DESeq2 estimated (dispersion is how much a gene's counts vary between
          replicates). Upload it here later to skip the fit and go straight to the contrasts, which
          takes seconds.
          <br /><br />
          It is also a standard R object. <code class="break-all">readRDS("dds.rds")</code> in R gives
          you the same DESeqDataSet. Use it to run tests this page does not offer, such as a likelihood
          ratio test across more than two levels.
        </ControlHint>
        <span class="text-xs text-muted-foreground">
          {countsName || 'or paste a featureCounts-style table below'}
        </span>
        {#if samples.length}
          <Badge variant="secondary" class="ml-auto font-mono text-xs">
            {samples.length} samples · {countsText.split('\n').length - 2} rows
          </Badge>
        {/if}
      </div>
      <textarea
        bind:value={countsText}
        disabled={running}
        rows="6"
        class="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
        placeholder={`# Program:featureCounts ...
Geneid\tChr\tStart\tEnd\tStrand\tLength\tsample1.bam\tsample2.bam
WBGene00000001\tI\t...\t...\t+\t1200\t12\t8
...`}
      ></textarea>
    </CardContent>
  </Card>

  {#if samples.length > 0 && !fit}
    {@const preFitMatrix = parseFeatureCountsTsv(countsText)}
    {#if preFitMatrix.genes.length > 0}
      <Card>
        <CardHeader><CardTitle>Sample QC (pre-fit)</CardTitle></CardHeader>
        <CardContent>
          <CountsQcPanel
            matrix={preFitMatrix}
            conditions={design.map((d) => d.condition)}
            {reference}
          />
        </CardContent>
      </Card>
    {/if}
  {/if}

  {#if samples.length > 0}
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Design</CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b text-left">
                <th class="py-1 pr-3">Sample</th>
                <th class="py-1 pr-3">Condition</th>
                {#if showBatch}
                  <th class="py-1 pr-3">Batch</th>
                {/if}
              </tr>
            </thead>
            <tbody>
              {#each design as row, i (row.sample)}
                <tr class="border-b last:border-b-0">
                  <td class="py-1 pr-3 font-mono">{prettySample(row.sample)}</td>
                  <td class="py-1 pr-3">
                    <Input
                      bind:value={design[i].condition}
                      placeholder="e.g. WT"
                      disabled={running}
                      class="h-7 max-w-48"
                    />
                  </td>
                  {#if showBatch}
                    <td class="py-1 pr-3">
                      <Input
                        bind:value={design[i].batch}
                        placeholder="e.g. run1"
                        disabled={running}
                        class="h-7 max-w-32"
                      />
                    </td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="grid gap-1.5">
            <label for="ref" class="text-sm font-medium">Reference level</label>
            <select
              id="ref"
              bind:value={reference}
              disabled={running || conditions.length === 0}
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {#each conditions as c (c)}
                <option value={c}>{c}</option>
              {/each}
            </select>
            <span class="text-xs text-muted-foreground">
              {contrastPreview.length} contrast{contrastPreview.length === 1 ? '' : 's'} will run
            </span>
          </div>
          <div class="grid gap-1.5">
            <span class="text-sm font-medium">Contrast mode</span>
            <div class="flex flex-col gap-1 text-sm">
              <label class="flex cursor-pointer select-none items-center gap-1.5">
                <input
                  type="radio"
                  bind:group={pairwiseMode}
                  value="vs-reference"
                  disabled={running}
                />
                vs reference (N-1)
              </label>
              <label class="flex cursor-pointer select-none items-center gap-1.5">
                <input
                  type="radio"
                  bind:group={pairwiseMode}
                  value="all-pairwise"
                  disabled={running}
                />
                all pairwise (N·(N-1))
              </label>
            </div>
          </div>
          <div class="grid gap-1.5">
            <label for="mincount" class="text-sm font-medium">Min rowSums (pre-filter)</label>
            <Input
              id="mincount"
              type="number"
              min="0"
              bind:value={minCount}
              disabled={running}
              class="h-9 max-w-24"
            />
            <span class="text-xs text-muted-foreground">
              drop genes whose counts summed over all samples are below this number; 0 = off
            </span>
          </div>
          <div class="grid gap-1.5">
            <label for="alpha" class="text-sm font-medium">FDR (alpha)</label>
            <Input
              id="alpha"
              type="number"
              min="0.001"
              max="0.5"
              step="0.01"
              bind:value={alpha}
              disabled={running}
              class="h-9 max-w-24"
            />
            <span class="text-xs text-muted-foreground">
              false discovery rate (FDR) cutoff for padj; also sets DESeq2's independent filtering
              (it sets aside genes with too few counts to reach significance)
            </span>
          </div>
          <div class="grid gap-1.5">
            <label for="shrink" class="text-sm font-medium">LFC shrinkage</label>
            <select
              id="shrink"
              bind:value={shrinkage}
              disabled={running}
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="apeglm">apeglm</option>
              <option value="ashr">ashr</option>
              <option value="none">none</option>
            </select>
            <span class="text-xs text-muted-foreground">
              shrinkage pulls noisy log2 fold changes of low-count genes toward 0
            </span>
          </div>
          <label class="flex cursor-pointer select-none items-center gap-2 self-end text-sm">
            <input
              type="checkbox"
              bind:checked={showBatch}
              disabled={running}
              class="h-4 w-4 cursor-pointer"
            />
            Batch covariate (~ batch + condition)
          </label>
        </div>

        <div class="flex items-center justify-between gap-2 border-t pt-4">
          <button
            type="button"
            onclick={async () => {
              await clearBundleCache();
              toast.success('Bundle cache cleared', {
                description: 'Next fit re-downloads the WASM bundle.',
              });
            }}
            disabled={running}
            class="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            title={`Frees browser storage (the origin private file system, OPFS). The next fit downloads the DESeq2 WebAssembly bundle again${bundleSizeLabel ? ` (${bundleSizeLabel})` : ''}. The gene database is not affected.`}
          >
            Clear bundle cache
          </button>
          <div class="flex items-center gap-2">
            <label for="deseq-workers" class="text-xs text-muted-foreground">workers</label>
            <select
              id="deseq-workers"
              bind:value={workerSetting}
              disabled={running}
              class="h-8 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50"
              title="Number of parallel R workers used to compute contrasts with apeglm shrinkage. 'auto' uses the smaller of half your CPU cores and 4. Each worker uses about 150 MB of memory."
            >
              <option value="auto">auto ({defaultAutoSize()})</option>
              <option value="1">1 (serial)</option>
              <option value="2">2</option>
              <option value="4">4</option>
              <option value="8">8</option>
            </select>
          </div>
          <div class="flex items-center gap-3">
            {#if rSession.state === 'starting'}
              <span class="text-xs text-muted-foreground">R session starting ({rElapsed}s)</span>
            {:else if rSession.state === 'failed'}
              <span class="text-xs text-destructive" title={rSession.error ?? undefined}>
                R session failed to start
              </span>
              <button
                type="button"
                onclick={restartWebR}
                disabled={running}
                class="text-xs underline underline-offset-2 hover:text-foreground disabled:opacity-50"
              >
                Restart R
              </button>
            {:else if rSession.state === 'ready'}
              <span class="text-xs text-muted-foreground">R session ready</span>
            {/if}
            <Button onclick={run} disabled={!canRun}>
              <Play class="h-4 w-4" />
              {running ? 'Running...' : 'Run DESeq2'}
            </Button>
          </div>
        </div>
        {#if !running && runBlocker}
          <p class="text-right text-xs text-muted-foreground">{runBlocker}</p>
        {/if}
      </CardContent>
    </Card>
  {/if}

  {#if running || fitLog.length || fitError}
    <Card>
      <CardContent class="space-y-3 pt-6">
        {#if fitError && !running}
          <div
            role="alert"
            class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
          >
            <div class="font-medium text-destructive">{fitError.title}</div>
            <div class="mt-0.5 whitespace-pre-wrap font-mono text-xs">{fitError.message}</div>
            {#if fitError.hint}
              <div class="mt-1.5 text-xs">{fitError.hint}</div>
            {/if}
          </div>
        {/if}
        <pre
          bind:this={fitLogEl}
          class="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{fitLog.join(
            '\n',
          )}</pre>
      </CardContent>
    </Card>
  {/if}

  {#if fit}
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Fit QC</CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="flex flex-wrap gap-1 border-b">
          {#each [{ k: 'pca', label: 'PCA' }, { k: 'distance', label: 'Sample distance' }, { k: 'dispersion', label: 'Dispersion' }, { k: 'boxplots', label: 'Counts' }] as t (t.k)}
            <button
              type="button"
              onclick={() => (qcTab = t.k as typeof qcTab)}
              class={cn(
                '-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors',
                qcTab === t.k
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          {/each}
        </div>
        {#if qcTab === 'pca' && qcPca}
          <PCAScatter
            points={qcPca.points}
            xLabel={`PC1${qcPca.varExp[0] != null ? ` (${(qcPca.varExp[0] * 100).toFixed(1)}%)` : ''}`}
            yLabel={`PC2${qcPca.varExp[1] != null ? ` (${(qcPca.varExp[1] * 100).toFixed(1)}%)` : ''}`}
            title="PCA (VST, all genes)"
            exportName="pca"
            {reference}
          />
        {:else if qcTab === 'distance' && qcDist}
          <SampleDistanceHeatmap
            samples={qcDist.samples}
            matrix={qcDist.matrix}
            title="Sample distance (Euclidean on VST)"
          />
        {:else if qcTab === 'dispersion' && qcDispersion}
          <DispersionPlot rows={qcDispersion} title="Dispersion" exportName="dispersion" />
        {:else if qcTab === 'boxplots' && qcBoxes}
          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {#if qcBoxes.rawBoxes.length > 0}
              <CountsBoxplot
                boxes={qcBoxes.rawBoxes}
                title="Raw counts (log10 + 1)"
                exportName="counts-raw"
                {reference}
              />
            {/if}
            <CountsBoxplot
              boxes={qcBoxes.normBoxes}
              title="Normalized counts (log10 + 1)"
              exportName="counts-normalized"
              {reference}
            />
          </div>
        {/if}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="flex items-center justify-between text-lg">
          <span>Results</span>
          <span class="text-sm font-normal text-muted-foreground">
            fit {fit.elapsedSec.toFixed(1)}s · {contrasts.size}/{allPairs.length} contrasts computed
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex flex-wrap items-center gap-2 border-b pb-3 text-sm">
          <label for="contrast-shrink" class="text-muted-foreground">Per-contrast shrinkage:</label>
          <select
            id="contrast-shrink"
            bind:value={contrastShrinkage}
            disabled={extracting || runningAll}
            class="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="apeglm">apeglm</option>
            <option value="ashr">ashr</option>
            <option value="none">none</option>
          </select>
          <span class="text-xs text-muted-foreground">
            used when you click one contrast; "Compute all" uses the shrinkage chosen above
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-1">
          {#each allPairs as p (p.treatment + '|' + p.reference)}
            {@const name = `${p.treatment}_vs_${p.reference}`}
            {@const existing = contrasts.get(name)}
            {@const computed = existing != null}
            <button
              type="button"
              onclick={() => extractOne(p)}
              disabled={extracting || runningAll}
              class={cn(
                'rounded-md border px-2 py-1 font-mono text-xs transition disabled:opacity-50',
                activeContrast === name
                  ? 'border-primary bg-primary text-primary-foreground'
                  : computed
                    ? 'bg-accent hover:bg-accent/80'
                    : 'bg-background text-muted-foreground hover:bg-accent',
              )}
              title={computed ? `computed (${existing?.shrinkage})` : 'click to compute'}
            >
              {computed ? '✓ ' : ''}{name}{computed ? ` [${existing?.shrinkage}]` : ''}
            </button>
          {/each}
          <div class="ml-auto flex items-center gap-2">
            <span
              class="text-xs text-muted-foreground"
              title="Configurable in the run section above"
            >
              {poolSize} worker{poolSize === 1 ? '' : 's'}
            </span>
            <Button
              size="sm"
              variant="outline"
              onclick={computeAll}
              disabled={runningAll || extracting || !fit}
            >
              {runningAll ? 'Computing...' : `Compute all (parallel, ${shrinkage})`}
            </Button>
          </div>
        </div>

        {#if computedNames.length >= 2}
          <div class="flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
            <span class="text-muted-foreground">Compare two contrasts:</span>
            <select
              bind:value={diffA}
              class="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">— pick A —</option>
              {#each computedNames as n (n)}
                <option value={n}>{n}</option>
              {/each}
            </select>
            <span class="text-muted-foreground">vs</span>
            <select
              bind:value={diffB}
              class="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">— pick B —</option>
              {#each computedNames as n (n)}
                <option value={n}>{n}</option>
              {/each}
            </select>
            <Button
              size="sm"
              variant="outline"
              onclick={continueToDiff}
              disabled={!diffA || !diffB || diffA === diffB}
            >
              Open in /de/diff <ArrowRight class="h-4 w-4" />
            </Button>
          </div>
        {/if}

        {#if extracting || runningAll || contrastLog.length}
          <pre
            bind:this={contrastLogEl}
            class="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{contrastLog.join(
              '\n',
            )}</pre>
        {/if}

        {#if activeContrastObj}
          <div class="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span
              ><span class="font-mono">{activeContrastObj.name}</span> · shrink: {activeContrastObj.shrinkage}
              · {activeContrastObj.rows.length} genes · {nSig} sig (padj &lt; {alpha})</span
            >
            {#if activeContrastObj.shrinkError}
              <span class="text-destructive"
                >Shrinkage ({activeContrastObj.shrinkageRequested}) failed: {activeContrastObj.shrinkError.replace(
                  /[.\s]+$/,
                  '',
                )}. Showing unshrunken log2 fold changes.</span
              >
            {/if}
            {#if selectedGene}
              <span>
                selected: <span class="font-mono">{selectedDisplay}</span>
                <button
                  type="button"
                  class="ml-1 underline hover:text-foreground"
                  onclick={() => (selectedGene = null)}>clear</button
                >
              </span>
            {/if}
          </div>
          <div class="flex flex-wrap gap-1 border-b">
            {#each [{ k: 'volcano', label: 'Volcano' }, { k: 'ma', label: 'MA plot' }, { k: 'phist', label: 'p-value hist' }, { k: 'table', label: 'Gene table' }] as t (t.k)}
              <button
                type="button"
                onclick={() => (vizTab = t.k as typeof vizTab)}
                class={cn(
                  '-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors',
                  vizTab === t.k
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            {/each}
          </div>
          {#if vizTab === 'volcano'}
            <VolcanoPlot
              rows={deRows}
              mode="volcano"
              title="Volcano"
              nameMap={geneMeta}
              qThreshold={alpha}
              exportName={`volcano-${activeContrastObj?.name ?? 'contrast'}`}
            />
          {:else if vizTab === 'ma'}
            <VolcanoPlot
              rows={deRows}
              mode="ma"
              baseMean={baseMeanMap}
              title="MA plot"
              nameMap={geneMeta}
              qThreshold={alpha}
              exportName={`ma-${activeContrastObj?.name ?? 'contrast'}`}
            />
          {:else if vizTab === 'phist'}
            <PValueHistogram
              values={pvals}
              title="p-value histogram"
              exportName={`pvalue-hist-${activeContrastObj?.name ?? 'contrast'}`}
            />
          {:else if vizTab === 'table'}
            <DeGeneTable rows={activeContrastObj.rows} {geneMeta} bind:selected={selectedGene} />
          {/if}
          {#if selectedGene}
            <div class="rounded-lg border bg-card p-3">
              <GeneDetailPanel
                gene={selectedGene}
                displayLabel={selectedDisplay}
                row={selectedRow}
                {design}
                {reference}
                countsBySample={selectedCounts}
                cengen={cengenForSelected}
                wormbaseGene={selectedWbgene}
                onClose={() => (selectedGene = null)}
              />
            </div>
          {/if}
        {:else if extracting}
          <div class="text-sm text-muted-foreground">Computing contrast...</div>
        {:else}
          <div class="text-sm text-muted-foreground">
            Click a contrast above to compute it, or click "Compute all" to compute every contrast
            at once.
          </div>
        {/if}

        <div class="flex flex-wrap items-center gap-2">
          {#if fit}
            <MethodsButton
              ctx={{
                tool: 'deseq2',
                params: {
                  reference,
                  batch: showBatch,
                  minCount,
                  shrinkage,
                },
                inputSummary: `${samples.length} samples, ${fit.levels.length} conditions`,
              }}
            />
          {/if}
          <Button
            variant="outline"
            disabled={!activeContrastObj}
            onclick={() =>
              activeContrastObj &&
              downloadTsv(`${activeContrastObj.name}.tsv`, activeContrastObj.tsv)}
          >
            <Download class="h-4 w-4" /> active contrast
          </Button>
          <Button
            variant="outline"
            onclick={() => downloadTsv('normalized_counts.tsv', fit?.normalizedCountsTsv ?? '')}
          >
            <Download class="h-4 w-4" /> normalized_counts.tsv
          </Button>
          <Button
            variant="outline"
            onclick={() => downloadTsv('vst_counts.tsv', fit?.vstCountsTsv ?? '')}
          >
            <Download class="h-4 w-4" /> vst_counts.tsv
          </Button>
          <Button
            variant="outline"
            onclick={() => downloadTsv('size_factors.tsv', fit?.sizeFactorsTsv ?? '')}
          >
            <Download class="h-4 w-4" /> size_factors.tsv
          </Button>
          <Button variant="outline" onclick={() => downloadTsv('design.tsv', fit?.designTsv ?? '')}>
            <Download class="h-4 w-4" /> design.tsv
          </Button>
          <Button
            variant="outline"
            onclick={() => downloadTsv('dispersions.tsv', fit?.dispersionsTsv ?? '')}
          >
            <Download class="h-4 w-4" /> dispersions.tsv
          </Button>
          <Button variant="outline" onclick={downloadDds}>
            <Download class="h-4 w-4" /> dds.rds
          </Button>
          <Button variant="outline" onclick={downloadAllZip}>
            <Package class="h-4 w-4" /> Download all (zip)
          </Button>
          <Button
            variant="outline"
            onclick={async () => {
              const n = await exportSvgBundle('de-plots');
              if (n === 0) toast.message('No plots to export');
              else toast.success(`Exported ${n} plot${n === 1 ? '' : 's'} as SVG`);
            }}
            title="Save every visible plot on this page as SVG files in one zip"
          >
            <ImageIcon class="h-4 w-4" /> Snapshot plots (zip)
          </Button>
          <SaveDatasetButton
            type="deseq2"
            body={() => activeContrastObj?.tsv ?? ''}
            defaultName={activeContrastObj?.name}
            disabled={!activeContrastObj}
            size="default"
          />
          <Button
            variant="outline"
            onclick={continueToSsgsea}
            disabled={!fit?.normalizedCountsTsv}
            title="Send the normalized count matrix (all samples) to the single-sample gene set enrichment analysis (ssGSEA) page"
          >
            Continue to per-sample gene set scoring <ArrowRight class="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onclick={continueToGsea}
            disabled={!activeContrastObj}
            title="Send this contrast's ranked gene list (gene and Wald statistic) to the gene set enrichment analysis (GSEA) page"
          >
            Continue to GSEA <ArrowRight class="h-4 w-4" />
          </Button>
          <Button onclick={continueToEnrichment} disabled={!activeContrastObj}>
            Continue to enrichment <ArrowRight class="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  {/if}
</div>
