<script lang="ts">
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Badge } from '$lib/components/ui/badge';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Plus from 'lucide-svelte/icons/plus';
  import X from 'lucide-svelte/icons/x';
  import PageHint from '$lib/components/PageHint.svelte';
  import UpSetPlot from '$lib/components/UpSetPlot.svelte';
  import JaccardHeatmap from '$lib/components/JaccardHeatmap.svelte';
  import CoOccurrenceHeatmap, {
    type HeatmapTerm,
  } from '$lib/components/CoOccurrenceHeatmap.svelte';
  import { exportSvgBundle } from '$lib/export-plot';
  import ImageIcon from 'lucide-svelte/icons/image';
  import { toast } from 'svelte-sonner';
  import { ENRICHMENT_KINDS, type EnrichmentKind, type EnrichmentResult } from '$lib/enrichment';
  import {
    looksLikeResultsTable,
    parseTableSlot,
    runGeneListSlot,
    type SlotSource,
  } from '$lib/enrichment-overlap-input';
  import LoadDatasetPicker from '$lib/components/LoadDatasetPicker.svelte';
  import { selection } from '$lib/stores/selection.svelte';
  import { computeUpSet, type UpSetInput } from '$lib/upset';
  import { datasets } from '$lib/stores/datasets.svelte';
  import { decodeSession } from '$lib/session';
  import { enrichmentResultsToCsv } from '$lib/results-to-paste';
  import { handoff } from '$lib/pipeline-handoff';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { CONDITION_PALETTE } from '$lib/plot-colors';

  onMount(() => {
    datasets.init();
    const h = handoff.enrichmentOverlap.consume();
    if (h) {
      const slot = slots.find((s) => !s.body.trim()) ?? slots[0];
      slot.name = h.name;
      slot.body = h.csv;
      recompute();
      toast.success('Results loaded from Over-representation', { description: h.name });
    }
    // The Datasets page sends "Open in -> Enrichment overlap" as ?load=list&id=.
    const params = page.url.searchParams;
    const loadId = params.get('load') === 'list' ? params.get('id') : null;
    if (loadId) {
      void datasets.getById(loadId).then((ds) => {
        if (!ds) return;
        const slot = slots.find((s) => !s.body.trim()) ?? slots[0];
        fillSlot(slot, ds.name, ds.body);
        toast.success('Loaded', { description: ds.name });
      });
    }
  });

  // Sessions with a results blob; re-derived at render time so the dropdown reflects new saves.
  const enrichmentSessions = $derived(
    datasets.items.filter(
      (d) => d.type === 'session' && d.meta?.tool === 'enrichment' && d.meta?.hasResults,
    ),
  );

  function loadSessionIntoSlot(slotId: number, datasetId: string) {
    const ds = datasets.items.find((d) => d.id === datasetId);
    if (!ds) return;
    const session = decodeSession(ds.body);
    if (!session || !session.results) {
      toast.error('Session has no saved results', { description: ds.name });
      return;
    }
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) return;
    slot.name = ds.name;
    slot.body = enrichmentResultsToCsv(
      session.results as Partial<Record<string, EnrichmentResult[]>>,
    );
    recompute();
    toast.success('Loaded session results', { description: ds.name });
  }

  type Slot = { id: number; name: string; body: string; dragOver: boolean };

  let nextId = 3;
  let slots = $state<Slot[]>([
    { id: 1, name: 'List A', body: '', dragOver: false },
    { id: 2, name: 'List B', body: '', dragOver: false },
  ]);
  let qCutoff = $state<number>(0.05);
  // Every slot is compared on one annotation kind: gene lists are tested on it, tables filtered to it.
  let annotationKind = $state<EnrichmentKind>('go');
  const kindLabel = $derived(
    ENRICHMENT_KINDS.find((k) => k.key === annotationKind)?.label ?? annotationKind,
  );

  // key = kind + body, so an unchanged slot is not re-run when another slot is edited.
  type SlotState =
    | { status: 'running'; key: string }
    | { status: 'ok'; key: string; source: SlotSource }
    | { status: 'error'; key: string; error: string };
  let slotState = $state<Record<number, SlotState>>({});
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  // Debounced so typing into a gene-list slot does not launch a run per keystroke.
  function recompute() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 400);
  }

  async function refresh() {
    const kind = annotationKind;
    const live = new Set(slots.map((s) => s.id));
    for (const id of Object.keys(slotState).map(Number)) {
      if (!live.has(id)) delete slotState[id];
    }
    await Promise.all(
      slots.map(async (s) => {
        const body = s.body;
        if (!body.trim()) {
          delete slotState[s.id];
          return;
        }
        const key = `${kind}\u0000${body}`;
        if (slotState[s.id]?.key === key) return;
        if (looksLikeResultsTable(body)) {
          try {
            slotState[s.id] = { status: 'ok', key, source: parseTableSlot(body, kind) };
          } catch (e) {
            slotState[s.id] = { status: 'error', key, error: (e as Error).message };
          }
          return;
        }
        slotState[s.id] = { status: 'running', key };
        try {
          const source = await runGeneListSlot(body, kind);
          if (slotState[s.id]?.key === key) slotState[s.id] = { status: 'ok', key, source };
        } catch (e) {
          if (slotState[s.id]?.key === key) {
            slotState[s.id] = { status: 'error', key, error: (e as Error).message };
          }
        }
      }),
    );
  }

  type Parsed = { slotId: number; name: string; rows: EnrichmentResult[]; total: number };
  const parsed = $derived<Parsed[]>(
    slots.flatMap((s) => {
      const st = slotState[s.id];
      if (st?.status !== 'ok') return [];
      return [
        {
          slotId: s.id,
          name: s.name || `Slot ${s.id}`,
          rows: st.source.rows,
          total: st.source.total,
        },
      ];
    }),
  );
  const anyRunning = $derived(Object.values(slotState).some((st) => st.status === 'running'));

  function slotStatus(st: SlotState | undefined): string {
    if (!st) return 'empty';
    if (st.status === 'running') return 'gene list: running over-representation...';
    if (st.status === 'error') return st.error;
    const src = st.source;
    if (src.kind === 'genes') {
      const missed = src.misses.length ? `, ${src.misses.length} not recognized` : '';
      return `gene list: ${src.nGenes} genes${missed}; ${src.total} ${kindLabel} terms tested`;
    }
    if (src.total === 0) {
      const has = ENRICHMENT_KINDS.filter((k) => src.byKind[k.key])
        .map((k) => `${src.byKind[k.key]} ${k.label}`)
        .join(', ');
      return `results table: no ${kindLabel} terms${has ? ` (it has ${has})` : ''}`;
    }
    return `results table: ${src.total} ${kindLabel} terms`;
  }

  const significantPerSlot = $derived(
    parsed.map((p) => ({
      slotId: p.slotId,
      name: p.name,
      ids: p.rows.filter((r) => r.q <= qCutoff).map((r) => r.term_id),
      total: p.total,
    })),
  );

  // term_id -> display name from the first slot that carries the term; used in the intersection table.
  const termName = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const m = new Map<string, string>();
    for (const p of parsed) for (const r of p.rows) if (!m.has(r.term_id)) m.set(r.term_id, r.name);
    return m;
  });

  const upsetInputs = $derived<UpSetInput[]>(
    significantPerSlot.map((s) => ({ label: s.name, members: s.ids })),
  );
  const upsetData = $derived(computeUpSet(upsetInputs));

  let selectedMask = $state<number | null>(null);
  let viewMode = $state<'upset' | 'heatmap'>('upset');
  let minTermsPerGene = $state<number>(2);

  // Categorical palette for per-slot heatmap tints; cycled when slots exceed color count.
  const SLOT_COLORS = CONDITION_PALETTE;

  // Heatmap: union of significant terms (q <= cutoff, non-empty clusterProfiler geneID).
  // Each term tinted by first slot it appears in (approximation, avoids per-cell stacking).
  const heatmapTerms = $derived.by<HeatmapTerm[]>(() => {
    const out: HeatmapTerm[] = [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const seen = new Set<string>();
    parsed.forEach((p, slotIdx) => {
      const sig = p.rows.filter((r) => r.q <= qCutoff && r.overlap && r.overlap.length > 0);
      for (const r of sig) {
        if (seen.has(r.term_id)) continue;
        seen.add(r.term_id);
        out.push({
          term_id: r.term_id,
          name: r.name || r.term_id,
          genes: r.overlap,
          color: SLOT_COLORS[slotIdx % SLOT_COLORS.length],
        });
      }
    });
    return out;
  });

  function addSlot() {
    slots = [
      ...slots,
      {
        id: nextId++,
        name: `List ${String.fromCharCode(65 + slots.length)}`,
        body: '',
        dragOver: false,
      },
    ];
  }
  function removeSlot(id: number) {
    slots = slots.filter((s) => s.id !== id);
    recompute();
  }
  async function onDrop(e: DragEvent, slotId: number) {
    e.preventDefault();
    const slot = slots.find((s) => s.id === slotId);
    if (slot) slot.dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (!file || !slot) return;
    try {
      slot.body = await file.text();
      recompute();
      toast.success('Loaded', { description: file.name, duration: 1500 });
    } catch (err) {
      toast.error('Could not read file', { description: String(err) });
    }
  }

  const nonEmptySlots = $derived(slots.filter((s) => s.body.trim().length > 0).length);

  function fillSlot(slot: Slot, name: string, body: string) {
    slot.name = name;
    slot.body = body;
    recompute();
  }
</script>

<svelte:head><title>Enrichment overlap · wormie.bio</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/enrichment" class="self-start">
    <ArrowLeft />
    Back to Over-representation
  </Button>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Enrichment overlap</h1>
    <p class="text-sm text-muted-foreground">
      Compares the enriched terms of two or more gene lists
    </p>
  </header>

  <PageHint id="overlap" title="Enrichment overlap (UpSet)">
    Input: a gene list in each slot, pasted or loaded from a saved list. The tool runs
    over-representation analysis (ORA) on each list separately. It uses the same test as the
    Over-representation page, with the whole annotated genome as the background (the set of genes
    that counts as possible hits). It then compares the significant terms across lists. Two lists
    can share few genes and still share many terms. Choose the annotation type to compare and a
    q-value cutoff (the p-value corrected for testing many terms). The UpSet plot shows how many
    terms each combination of lists shares. Click a bar to list the terms in that combination. A
    slot also accepts a finished enrichment result table (CSV from clusterProfiler, topGO or
    GSEApy). You can also send a result from the Over-representation page with its &ldquo;Send
    results to overlap&rdquo; button.
  </PageHint>

  <Card>
    <CardHeader>
      <CardTitle class="text-lg">Inputs</CardTitle>
      <div class="text-sm text-muted-foreground">
        One gene list per slot, in any identifiers (gene names, sequence names, WormBase or Entrez
        IDs). A slot can instead hold an enrichment result table (<code
          >ID, Description, GeneRatio, BgRatio, pvalue, p.adjust, ...</code
        >), which is used as is.
      </div>
      <label class="flex items-center gap-2 pt-1 text-sm">
        <span class="text-muted-foreground">Compare on</span>
        <select
          bind:value={annotationKind}
          onchange={recompute}
          class="h-8 rounded border bg-background px-2 text-sm"
        >
          {#each ENRICHMENT_KINDS as k (k.key)}
            <option value={k.key}>{k.label}</option>
          {/each}
        </select>
      </label>
    </CardHeader>
    <CardContent class="space-y-3">
      {#each slots as slot (slot.id)}
        <div class="rounded-md border bg-card p-3">
          <div class="mb-2 flex items-center gap-2">
            <Input bind:value={slot.name} placeholder="List name" class="h-8 max-w-xs text-sm" />
            <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
              {#if selection.ids.length > 0}
                <Button
                  variant="ghost"
                  size="sm"
                  title="Fill this slot with the genes you selected on another page"
                  onclick={() => fillSlot(slot, slot.name, selection.ids.join('\n'))}
                >
                  From selection ({selection.ids.length})
                </Button>
              {/if}
              <LoadDatasetPicker
                type="gene-list"
                label="From saved list"
                onload={(ds) => fillSlot(slot, ds.name, ds.body)}
              />
              {#if enrichmentSessions.length > 0}
                <select
                  value=""
                  onchange={(e) => {
                    const v = (e.currentTarget as HTMLSelectElement).value;
                    if (v) loadSessionIntoSlot(slot.id, v);
                    (e.currentTarget as HTMLSelectElement).value = '';
                  }}
                  class="h-8 rounded border bg-background px-2 text-xs"
                  title="Load the gene list and results from a saved enrichment session"
                >
                  <option value="">Load saved session…</option>
                  {#each enrichmentSessions as s (s.id)}
                    <option value={s.id}>{s.name}</option>
                  {/each}
                </select>
              {/if}
              {#if slots.length > 1}
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => removeSlot(slot.id)}
                  title="Remove slot"
                >
                  <X class="h-3 w-3" />
                </Button>
              {/if}
            </div>
          </div>
          <textarea
            bind:value={slot.body}
            oninput={recompute}
            rows="6"
            placeholder="daf-16&#10;lys-7&#10;WBGene00000912&#10;&#10;or an enrichment result table, or drop a file here"
            class="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring {slot.dragOver
              ? 'ring-2 ring-primary'
              : ''}"
            ondragover={(e: DragEvent) => {
              if (e.dataTransfer?.items?.[0]?.kind === 'file') {
                e.preventDefault();
                slot.dragOver = true;
              }
            }}
            ondragleave={() => (slot.dragOver = false)}
            ondrop={(e) => onDrop(e, slot.id)}
          ></textarea>
          {#if slot.body.trim()}
            {@const st = slotState[slot.id]}
            <div
              class="mt-1 text-xs {st?.status === 'error'
                ? 'text-destructive'
                : 'text-muted-foreground'}"
              title={st?.status === 'ok' && st.source.kind === 'genes' && st.source.misses.length
                ? `Not recognized: ${st.source.misses.slice(0, 20).join(', ')}`
                : undefined}
            >
              {slotStatus(st)}
            </div>
          {/if}
        </div>
      {/each}
      <Button variant="outline" size="sm" onclick={addSlot}>
        <Plus class="h-3 w-3" />
        Add input
      </Button>
    </CardContent>
  </Card>

  {#if parsed.length >= 2}
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Overlap</CardTitle>
        <div class="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <label
            class="flex items-center gap-2"
            title="A term counts as significant when its q-value (corrected p-value) is at or below this cutoff"
          >
            <span>q ≤</span>
            <Input
              type="number"
              step="0.005"
              min="0"
              max="1"
              bind:value={qCutoff}
              class="h-8 w-24"
            />
          </label>
          <div class="flex flex-wrap items-center gap-2">
            {#each significantPerSlot as s (s.slotId)}
              <Badge variant="muted" class="text-[0.65rem]">
                {s.name}: {s.ids.length}/{s.total}
              </Badge>
            {/each}
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        {#if significantPerSlot.length >= 2}
          <JaccardHeatmap
            sets={significantPerSlot.map((s) => ({ name: s.name, ids: s.ids }))}
            title="Overlap of significant terms between lists (Jaccard index: shared terms divided by all terms in either list)"
            labels={termName}
          />
        {/if}

        <div class="flex flex-wrap items-center gap-3">
          <div class="inline-flex overflow-hidden rounded-md border text-xs">
            <button
              type="button"
              onclick={() => (viewMode = 'upset')}
              class="px-3 py-1 {viewMode === 'upset'
                ? 'bg-accent text-accent-foreground'
                : 'bg-card hover:bg-muted/50'}"
            >
              UpSet
            </button>
            <button
              type="button"
              onclick={() => (viewMode = 'heatmap')}
              class="border-l px-3 py-1 {viewMode === 'heatmap'
                ? 'bg-accent text-accent-foreground'
                : 'bg-card hover:bg-muted/50'}"
            >
              Genes × terms heatmap
            </button>
          </div>
          {#if viewMode === 'heatmap'}
            <label class="flex items-center gap-2 text-xs text-muted-foreground">
              <span title="Show only genes that belong to at least this many significant terms"
                >Min terms per gene</span
              >
              <Input type="number" min="1" max="20" bind:value={minTermsPerGene} class="h-7 w-16" />
            </label>
          {/if}
          <Button
            variant="outline"
            size="sm"
            class="ml-auto"
            onclick={async () => {
              const n = await exportSvgBundle('enrichment-overlap-plots');
              if (n === 0) toast.message('No plots to export');
              else toast.success(`Exported ${n} plot${n === 1 ? '' : 's'} as SVG`);
            }}
            title="Save every plot on this page as an SVG image, in one zip file"
          >
            <ImageIcon class="h-4 w-4" /> Snapshot plots (zip)
          </Button>
        </div>

        {#if viewMode === 'upset'}
          <UpSetPlot
            title="Significant terms across inputs"
            sets={significantPerSlot.map((s) => ({ name: s.name, ids: s.ids }))}
            maxGroups={30}
            exportName="enrichment-overlap-upset"
            labels={termName}
            setNoun="list"
          />
        {:else}
          <CoOccurrenceHeatmap
            terms={heatmapTerms}
            minTermsPerRow={minTermsPerGene}
            exportName="enrichment-overlap-cooccurrence"
          />
        {/if}

        <div class="space-y-2">
          <div class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Intersections
          </div>
          <div class="overflow-x-auto rounded-md border bg-card">
            <table class="w-full text-sm">
              <thead class="border-b bg-card">
                <tr>
                  <th
                    class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    Combination
                  </th>
                  <th
                    class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    Size
                  </th>
                  <th
                    class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    Terms
                  </th>
                </tr>
              </thead>
              <tbody>
                {#each upsetData.combos.slice(0, 30) as combo (combo.mask)}
                  <tr
                    class="cursor-pointer border-b last:border-b-0 hover:bg-muted/30 {selectedMask ===
                    combo.mask
                      ? 'bg-accent/30'
                      : ''}"
                    onclick={() => (selectedMask = selectedMask === combo.mask ? null : combo.mask)}
                  >
                    <td class="px-3 py-2 align-top">
                      <div class="flex flex-wrap gap-1">
                        {#each combo.indices as ix (ix)}
                          <Badge variant="muted" class="text-[0.6rem]">
                            {upsetData.sets[ix].label}
                          </Badge>
                        {/each}
                      </div>
                    </td>
                    <td class="px-3 py-2 text-right align-top font-mono tabular-nums">
                      {combo.size}
                    </td>
                    <td class="px-3 py-2 align-top">
                      {#if selectedMask === combo.mask}
                        <div class="space-y-0.5">
                          {#each combo.members as termId (termId)}
                            <div class="text-xs">
                              <span class="font-mono text-muted-foreground">{termId}</span>
                              {#if termName.get(termId)}
                                <span class="ml-1">{termName.get(termId)}</span>
                              {/if}
                            </div>
                          {/each}
                        </div>
                      {:else}
                        <span class="text-xs text-muted-foreground">
                          {combo.members
                            .slice(0, 3)
                            .map((id) => termName.get(id) ?? id)
                            .join(', ')}
                          {#if combo.members.length > 3}
                            , <span class="italic">+{combo.members.length - 3} more</span>
                          {/if}
                        </span>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if upsetData.combos.length > 30}
            <div class="text-[0.7rem] text-muted-foreground">
              Showing 30 of {upsetData.combos.length} intersections (sorted by size).
            </div>
          {/if}
        </div>
      </CardContent>
    </Card>
  {:else if anyRunning}
    <div class="rounded-md border bg-card px-3 py-4 text-sm text-muted-foreground">
      Running over-representation analysis...
    </div>
  {:else if nonEmptySlots < 2}
    <div class="rounded-md border bg-card px-3 py-4 text-sm text-muted-foreground">
      Add a gene list or a result table to at least two slots to see the overlap.
    </div>
  {/if}
</div>
