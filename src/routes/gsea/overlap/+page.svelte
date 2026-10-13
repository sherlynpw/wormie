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
  import { exportSvgBundle } from '$lib/export-plot';
  import ImageIcon from 'lucide-svelte/icons/image';
  import CoOccurrenceHeatmap, {
    type HeatmapTerm,
  } from '$lib/components/CoOccurrenceHeatmap.svelte';
  import { toast } from 'svelte-sonner';
  import { resolve } from '$app/paths';
  import { parseGseaTsv, type ParsedGseaRow } from '$lib/parse-gsea-tsv';
  import { computeUpSet, type UpSetInput } from '$lib/upset';
  import { datasets } from '$lib/stores/datasets.svelte';
  import { decodeSession } from '$lib/session';
  import { gseaResultsToTsv } from '$lib/results-to-paste';
  import type { GseaResult } from '$lib/db/client';
  import { onMount } from 'svelte';
  import { CONDITION_PALETTE } from '$lib/plot-colors';

  onMount(() => datasets.init());

  const gseaSessions = $derived(
    datasets.items.filter(
      (d) => d.type === 'session' && d.meta?.tool === 'gsea' && d.meta?.hasResults,
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
    slot.body = gseaResultsToTsv(session.results as Partial<Record<string, GseaResult[]>>);
    recompute();
    toast.success('Loaded session results', { description: ds.name });
  }

  type Slot = { id: number; name: string; body: string; dragOver: boolean };

  let nextId = 3;
  let slots = $state<Slot[]>([
    { id: 1, name: 'Contrast A', body: '', dragOver: false },
    { id: 2, name: 'Contrast B', body: '', dragOver: false },
  ]);
  let qCutoff = $state<number>(0.05);
  let direction = $state<'both' | 'pos' | 'neg'>('both');

  type Parsed = { slotId: number; name: string; rows: ParsedGseaRow[]; total: number };
  let parsed = $state<Parsed[]>([]);
  let parseError = $state<string | null>(null);

  function recompute() {
    parseError = null;
    const out: Parsed[] = [];
    for (const s of slots) {
      if (!s.body.trim()) continue;
      try {
        const { rows } = parseGseaTsv(s.body);
        out.push({ slotId: s.id, name: s.name || `Slot ${s.id}`, rows, total: rows.length });
      } catch (e) {
        parseError = `${s.name || `Slot ${s.id}`}: ${(e as Error).message}`;
        return;
      }
    }
    parsed = out;
  }

  // Per slot: union of leading-edge genes from rows passing q cutoff + direction filter; compared across contrasts via UpSet.
  const leadingEdgePerSlot = $derived(
    parsed.map((p) => {
      const passing = p.rows.filter((r) => {
        if (r.q > qCutoff) return false;
        if (direction === 'pos' && r.nes <= 0) return false;
        if (direction === 'neg' && r.nes >= 0) return false;
        return true;
      });
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const genes = new Set<string>();
      for (const r of passing) for (const g of r.leading_edge) genes.add(g);
      return {
        name: p.name,
        ids: [...genes],
        passingTerms: passing.length,
        total: p.total,
      };
    }),
  );

  // Per-gene index of which significant terms it drove per slot; shown when the user expands an intersection row.
  const geneDrivers = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const m = new Map<string, Map<string, string[]>>();
    for (const p of parsed) {
      const passing = p.rows.filter((r) => {
        if (r.q > qCutoff) return false;
        if (direction === 'pos' && r.nes <= 0) return false;
        if (direction === 'neg' && r.nes >= 0) return false;
        return true;
      });
      for (const r of passing) {
        for (const g of r.leading_edge) {
          let bySlot = m.get(g);
          if (!bySlot) {
            // eslint-disable-next-line svelte/prefer-svelte-reactivity
            bySlot = new Map();
            m.set(g, bySlot);
          }
          let terms = bySlot.get(p.name);
          if (!terms) {
            terms = [];
            bySlot.set(p.name, terms);
          }
          if (!terms.includes(r.name)) terms.push(r.name);
        }
      }
    }
    return m;
  });

  const upsetInputs = $derived<UpSetInput[]>(
    leadingEdgePerSlot.map((s) => ({ label: s.name, members: s.ids })),
  );
  const upsetData = $derived(computeUpSet(upsetInputs));

  let selectedMask = $state<number | null>(null);
  let viewMode = $state<'upset' | 'heatmap'>('upset');
  let minTermsPerGene = $state<number>(2);

  // Same palette as /enrichment/overlap; term tinted by first slot it appears in (all-blue = contrast A, mixed = shared).
  const SLOT_COLORS = CONDITION_PALETTE;

  // Heatmap: significant GSEA terms with leading-edge gene lists (always populated in the wormie.rs.ht export format).
  const heatmapTerms = $derived.by<HeatmapTerm[]>(() => {
    const out: HeatmapTerm[] = [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const seen = new Set<string>();
    parsed.forEach((p, slotIdx) => {
      const passing = p.rows.filter((r) => {
        if (r.q > qCutoff) return false;
        if (direction === 'pos' && r.nes <= 0) return false;
        if (direction === 'neg' && r.nes >= 0) return false;
        if (!r.leading_edge || r.leading_edge.length === 0) return false;
        return true;
      });
      for (const r of passing) {
        if (seen.has(r.term_id)) continue;
        seen.add(r.term_id);
        out.push({
          term_id: r.term_id,
          name: r.name || r.term_id,
          genes: r.leading_edge,
          color: SLOT_COLORS[slotIdx % SLOT_COLORS.length],
        });
      }
    });
    return out;
  });

  function addSlot() {
    slots = [
      ...slots,
      { id: nextId++, name: `Contrast ${slots.length + 1}`, body: '', dragOver: false },
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
</script>

<svelte:head><title>Leading-edge overlap · wormie.rs.ht</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/gsea" class="self-start">
    <ArrowLeft />
    Back to Ranked-list enrichment
  </Button>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Leading-edge overlap</h1>
    <p class="text-sm text-muted-foreground">Driver genes shared across GSEA runs</p>
  </header>

  <PageHint id="gsea-overlap" title="GSEA leading-edge overlap (UpSet)">
    Paste 2+ GSEA result TSVs (the wormie.rs.ht export format with a
    <code>leading_edge</code> column) and see which driver genes are shared across contrasts. Each slot's
    gene set is the union of leading-edge genes across its significant terms (q ≤ cutoff, direction filter
    applied). Useful for "does the same module light up in two analyses?"
  </PageHint>

  <Card>
    <CardHeader>
      <CardTitle class="text-lg">Inputs</CardTitle>
      <div class="text-sm text-muted-foreground">
        One GSEA result TSV per slot. Columns: <code
          >term_id, name, namespace, size, es, nes, p, q, leading_edge</code
        >
        (the
        <a href={resolve('/gsea')} class="text-primary hover:underline">/gsea</a> export format).
      </div>
    </CardHeader>
    <CardContent class="space-y-3">
      {#each slots as slot (slot.id)}
        <div class="rounded-md border bg-card p-3">
          <div class="mb-2 flex items-center gap-2">
            <Input bind:value={slot.name} placeholder="Slot name" class="h-8 max-w-xs text-sm" />
            <span class="text-xs text-muted-foreground">
              {slot.body.trim() ? `${slot.body.length.toLocaleString()} chars` : 'empty'}
            </span>
            <div class="ml-auto flex items-center gap-2">
              {#if gseaSessions.length > 0}
                <select
                  value=""
                  onchange={(e) => {
                    const v = (e.currentTarget as HTMLSelectElement).value;
                    if (v) loadSessionIntoSlot(slot.id, v);
                    (e.currentTarget as HTMLSelectElement).value = '';
                  }}
                  class="h-8 rounded border bg-background px-2 text-xs"
                  title="Load from a saved GSEA session with results"
                >
                  <option value="">Load saved session…</option>
                  {#each gseaSessions as s (s.id)}
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
            placeholder="term_id&#9;name&#9;namespace&#9;size&#9;es&#9;nes&#9;p&#9;q&#9;leading_edge&#10;GO:0006952&#9;defense response&#9;BP&#9;42&#9;0.45&#9;1.8&#9;0.001&#9;0.01&#9;daf-16|daf-2|...&#10;&#10;or drop a .tsv file here"
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
        </div>
      {/each}
      <Button variant="outline" size="sm" onclick={addSlot}>
        <Plus class="h-3 w-3" />
        Add input
      </Button>

      {#if parseError}
        <div
          class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {parseError}
        </div>
      {/if}
    </CardContent>
  </Card>

  {#if nonEmptySlots >= 2 && !parseError}
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Leading-edge overlap</CardTitle>
        <div class="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <label class="flex items-center gap-2">
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
          <div class="inline-flex overflow-hidden rounded-md border text-xs">
            {#each [{ key: 'both', label: 'Both' }, { key: 'pos', label: 'NES > 0' }, { key: 'neg', label: 'NES < 0' }] as opt (opt.key)}
              <button
                type="button"
                onclick={() => (direction = opt.key as 'both' | 'pos' | 'neg')}
                class="border-l px-2.5 py-1 first:border-l-0 {direction === opt.key
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-card hover:bg-muted/50'}"
              >
                {opt.label}
              </button>
            {/each}
          </div>
          <div class="flex flex-wrap items-center gap-2">
            {#each leadingEdgePerSlot as s (s.name)}
              <Badge variant="muted" class="text-[0.65rem]">
                {s.name}: {s.ids.length} genes / {s.passingTerms} terms
              </Badge>
            {/each}
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        {#if leadingEdgePerSlot.length >= 2}
          <JaccardHeatmap
            sets={leadingEdgePerSlot.map((s) => ({ name: s.name, ids: s.ids }))}
            title="Leading-edge Jaccard between contrasts"
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
              <span>Min terms per gene</span>
              <Input type="number" min="1" max="20" bind:value={minTermsPerGene} class="h-7 w-16" />
            </label>
          {/if}
          <Button
            variant="outline"
            size="sm"
            class="ml-auto"
            onclick={async () => {
              const n = await exportSvgBundle('gsea-overlap-plots');
              if (n === 0) toast.message('No plots to export');
              else toast.success(`Exported ${n} plot${n === 1 ? '' : 's'} as SVG`);
            }}
            title="Snapshot every visible plot on this page and zip them"
          >
            <ImageIcon class="h-4 w-4" /> Snapshot plots (zip)
          </Button>
        </div>

        {#if viewMode === 'upset'}
          <UpSetPlot
            title="Leading-edge gene overlap across contrasts"
            sets={leadingEdgePerSlot.map((s) => ({ name: s.name, ids: s.ids }))}
            maxGroups={30}
            exportName="gsea-overlap-upset"
            setNoun="contrast"
          />
        {:else}
          <CoOccurrenceHeatmap
            terms={heatmapTerms}
            minTermsPerRow={minTermsPerGene}
            exportName="gsea-overlap-cooccurrence"
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
                    Genes
                  </th>
                  <th
                    class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    Drivers
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
                          {#each combo.members.slice(0, 200) as gene (gene)}
                            <div class="text-xs">
                              <a
                                href={resolve(`/?q=${encodeURIComponent(gene)}`)}
                                class="font-mono text-primary hover:underline"
                              >
                                {gene}
                              </a>
                              {#if geneDrivers.get(gene)}
                                {@const slotMap = geneDrivers.get(gene)}
                                <span class="ml-1 text-[0.65rem] text-muted-foreground">
                                  {#each [...(slotMap?.entries() ?? [])] as [slotName, terms], i (slotName)}
                                    {i > 0 ? ' · ' : ''}{slotName}: {terms.length} term{terms.length ===
                                    1
                                      ? ''
                                      : 's'}
                                  {/each}
                                </span>
                              {/if}
                            </div>
                          {/each}
                          {#if combo.members.length > 200}
                            <div class="text-[0.65rem] italic text-muted-foreground">
                              +{combo.members.length - 200} more (truncated)
                            </div>
                          {/if}
                        </div>
                      {:else}
                        <span class="text-xs text-muted-foreground">
                          {combo.members.slice(0, 8).join(', ')}
                          {#if combo.members.length > 8}
                            , <span class="italic">+{combo.members.length - 8} more</span>
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
  {:else if nonEmptySlots < 2}
    <div class="rounded-md border bg-card px-3 py-4 text-sm text-muted-foreground">
      Add GSEA result TSVs to at least two slots to see the leading-edge overlap.
    </div>
  {/if}
</div>
