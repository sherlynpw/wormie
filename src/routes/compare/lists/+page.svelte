<script lang="ts">
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Badge } from '$lib/components/ui/badge';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Plus from 'lucide-svelte/icons/plus';
  import X from 'lucide-svelte/icons/x';
  import Copy from 'lucide-svelte/icons/copy';
  import BarChart from 'lucide-svelte/icons/bar-chart-3';
  import PageHint from '$lib/components/PageHint.svelte';
  import UpSetPlot from '$lib/components/UpSetPlot.svelte';
  import JaccardHeatmap from '$lib/components/JaccardHeatmap.svelte';
  import GenePill from '$lib/components/GenePill.svelte';
  import LoadDatasetPicker from '$lib/components/LoadDatasetPicker.svelte';
  import { toast } from 'svelte-sonner';
  import { bulkLookup } from '$lib/queries';
  import { parseGeneList } from '$lib/gene-parse';
  import { selection } from '$lib/stores/selection.svelte';
  import { computeUpSet, type UpSetInput } from '$lib/upset';
  import { buildIdsQuery } from '$lib/share';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';

  type Slot = { id: number; name: string; body: string; dragOver: boolean };

  let nextId = 3;
  let slots = $state<Slot[]>([
    { id: 1, name: 'List A', body: '', dragOver: false },
    { id: 2, name: 'List B', body: '', dragOver: false },
  ]);

  // The datasets page sends "Open in -> Gene overlap" as ?load=list&id=,
  // landing the saved list in the first empty slot. Open-in is a full reload,
  // so the second saved list arrives via each slot's own From dataset picker.
  onMount(async () => {
    const params = page.url.searchParams;
    const id = params.get('id');
    if (params.get('load') !== 'list' || !id) return;
    const { datasets } = await import('$lib/stores/datasets.svelte');
    const ds = await datasets.getById(id);
    if (!ds) return;
    const slot = slots.find((s) => !s.body.trim()) ?? slots[0];
    slot.name = ds.name;
    slot.body = ds.body;
    stale = true;
    toast.success('Loaded', { description: ds.name });
  });

  type Resolved = { slotId: number; name: string; ids: string[]; misses: string[] };
  let resolved = $state<Resolved[]>([]);
  let geneNames = $state<Record<string, string | null>>({});
  let busy = $state(false);
  // Inputs edited since the last run; results on screen describe the previous inputs.
  let stale = $state(false);

  async function compare() {
    busy = true;
    try {
      const out: Resolved[] = [];
      const names: Record<string, string | null> = {};
      for (const s of slots) {
        const tokens = parseGeneList(s.body);
        if (tokens.length === 0) continue;
        const { hits, misses } = await bulkLookup(tokens);
        for (const h of hits) if (!(h.wormbase_gene in names)) names[h.wormbase_gene] = h.gene_name;
        out.push({
          slotId: s.id,
          name: s.name || `List ${s.id}`,
          ids: [...new Set(hits.map((h) => h.wormbase_gene))],
          misses,
        });
      }
      resolved = out;
      geneNames = names;
      stale = false;
      selectedMask = null;
    } finally {
      busy = false;
    }
  }

  const upsetInputs = $derived<UpSetInput[]>(
    resolved.map((r) => ({ label: r.name, members: r.ids })),
  );
  const upsetData = $derived(computeUpSet(upsetInputs));

  let selectedMask = $state<number | null>(null);
  const EXPANDED_CAP = 100;

  function displayName(id: string): string {
    return geneNames[id] ?? id;
  }

  function copyCombo(members: string[]) {
    navigator.clipboard.writeText(members.map(displayName).join('\n')).then(() => {
      toast.success('Genes copied', {
        description: `${members.length} gene${members.length === 1 ? '' : 's'}`,
      });
    });
  }

  async function enrichCombo(members: string[]) {
    if (members.length < 2) {
      toast.error('Too few genes for enrichment', { description: 'Need at least 2 genes.' });
      return;
    }
    const q = await buildIdsQuery(members);
    goto(resolve(`/enrichment?${q}`));
  }

  function addSlot() {
    slots = [
      ...slots,
      { id: nextId++, name: `List ${slots.length + 1}`, body: '', dragOver: false },
    ];
  }
  function removeSlot(id: number) {
    slots = slots.filter((s) => s.id !== id);
    stale = true;
  }
  async function onDrop(e: DragEvent, slotId: number) {
    e.preventDefault();
    const slot = slots.find((s) => s.id === slotId);
    if (slot) slot.dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (!file || !slot) return;
    try {
      slot.body = await file.text();
      stale = true;
      toast.success('Loaded', { description: file.name, duration: 1500 });
    } catch (err) {
      toast.error('Could not read file', { description: String(err) });
    }
  }

  const nonEmptySlots = $derived(slots.filter((s) => s.body.trim().length > 0).length);
</script>

<svelte:head><title>Gene overlap · wormie.rs.ht</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/compare" class="self-start">
    <ArrowLeft />
    Back to Annotation overlap
  </Button>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Gene overlap</h1>
    <p class="text-sm text-muted-foreground">Two or more gene lists compared by membership</p>
  </header>

  <PageHint id="compare-lists" title="What this step does">
    Paste two or more gene lists, one per slot, in whatever identifiers each arrived with: gene
    names, sequence names, aliases, WormBase or Entrez IDs, mixed freely. Each entry is resolved to
    its WormBase identifier the way the
    <a href={resolve('/lookup')} class="underline underline-offset-2">Gene name resolver</a> does
    it, so the same gene spelled two ways in two lists still counts as shared. The overlap is then
    pure set membership: which genes are in both lists, which in only one. No annotation or
    expression data is involved in computing it, but any segment of the overlap, the shared genes
    included, is itself a gene list that can be tested like any other: every combination row under
    the plot carries a button that sends its genes straight to over-representation, so the terms
    enriched among the hits two screens share are one click away. To ask what a set of genes has in
    common biologically, send it to
    <a href={resolve('/compare')} class="underline underline-offset-2">Annotation overlap</a>; to
    ask whether two lists turn up the same biology at the level of enriched terms, run
    over-representation on each and compare the results in
    <a href={resolve('/enrichment/overlap')} class="underline underline-offset-2"
      >Enrichment overlap</a
    >.
  </PageHint>

  <Card>
    <CardHeader>
      <CardTitle class="text-lg">Inputs</CardTitle>
      <div class="text-sm text-muted-foreground">
        One gene list per slot, separated by whitespace, commas or newlines.
      </div>
    </CardHeader>
    <CardContent class="space-y-3">
      {#each slots as slot (slot.id)}
        <div class="rounded-md border bg-card p-3">
          <div class="mb-2 flex items-center gap-2">
            <Input bind:value={slot.name} placeholder="List name" class="h-8 max-w-xs text-sm" />
            <span class="text-xs text-muted-foreground">
              {slot.body.trim()
                ? `${parseGeneList(slot.body).length.toLocaleString()} entries`
                : 'empty'}
            </span>
            {#if selection.ids.length > 0}
              <Button
                variant="ghost"
                size="sm"
                title="Fill this slot with your current selection"
                onclick={() => {
                  slot.body = selection.ids.join('\n');
                  stale = true;
                }}
              >
                From selection ({selection.ids.length})
              </Button>
            {/if}
            <LoadDatasetPicker
              type="gene-list"
              label="From dataset"
              onload={(ds) => {
                slot.name = ds.name;
                slot.body = ds.body;
                stale = true;
              }}
            />
            {#if slots.length > 2}
              <Button
                variant="ghost"
                size="sm"
                class="ml-auto"
                onclick={() => removeSlot(slot.id)}
                title="Remove slot"
              >
                <X class="h-3 w-3" />
              </Button>
            {/if}
          </div>
          <textarea
            bind:value={slot.body}
            oninput={() => (stale = true)}
            rows="6"
            placeholder="daf-2&#10;daf-16&#10;WBGene00000912&#10;&#10;or drop a .txt/.csv file here"
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
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" onclick={addSlot}>
          <Plus class="h-3 w-3" />
          Add list
        </Button>
        <Button size="sm" onclick={compare} disabled={busy || nonEmptySlots < 2}>
          {busy ? 'Resolving…' : 'Compare'}
        </Button>
        {#if stale && resolved.length > 0}
          <span class="text-xs text-muted-foreground">Inputs changed; re-run to update.</span>
        {/if}
      </div>
    </CardContent>
  </Card>

  {#if resolved.length >= 2}
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Overlap</CardTitle>
        <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {#each resolved as r (r.slotId)}
            <Badge variant="muted" class="text-[0.65rem]">
              {r.name}: {r.ids.length} gene{r.ids.length === 1 ? '' : 's'}{r.misses.length > 0
                ? ` · ${r.misses.length} unresolved`
                : ''}
            </Badge>
          {/each}
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        {#each resolved.filter((r) => r.misses.length > 0) as r (r.slotId)}
          <details class="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            <summary class="cursor-pointer">
              {r.name}: {r.misses.length} entr{r.misses.length === 1 ? 'y' : 'ies'} matched nothing
            </summary>
            <div class="mt-1 break-words font-mono">{r.misses.join(', ')}</div>
          </details>
        {/each}

        <JaccardHeatmap
          sets={resolved.map((r) => ({ name: r.name, ids: r.ids }))}
          title="Jaccard similarity between lists"
        />

        <UpSetPlot
          title="Genes across lists"
          sets={resolved.map((r) => ({ name: r.name, ids: r.ids }))}
          maxGroups={30}
          exportName="compare-lists-upset"
        />

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
                    Genes
                  </th>
                  <th class="px-3 py-2"></th>
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
                        {#if combo.indices.length === resolved.length}
                          <Badge class="text-[0.6rem]">shared by all</Badge>
                        {/if}
                      </div>
                    </td>
                    <td class="px-3 py-2 text-right align-top font-mono tabular-nums">
                      {combo.size}
                    </td>
                    <td class="px-3 py-2 align-top">
                      {#if selectedMask === combo.mask}
                        <div class="flex flex-wrap gap-1">
                          {#each combo.members.slice(0, EXPANDED_CAP) as id (id)}
                            <GenePill {id} name={geneNames[id]} />
                          {/each}
                          {#if combo.members.length > EXPANDED_CAP}
                            <span class="self-center text-xs text-muted-foreground">
                              +{combo.members.length - EXPANDED_CAP} more (use Copy for the full list)
                            </span>
                          {/if}
                        </div>
                      {:else}
                        <span class="text-xs text-muted-foreground">
                          {combo.members.slice(0, 5).map(displayName).join(', ')}
                          {#if combo.members.length > 5}
                            , <span class="italic">+{combo.members.length - 5} more</span>
                          {/if}
                        </span>
                      {/if}
                    </td>
                    <td class="px-3 py-2 text-right align-top">
                      <div class="inline-flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Copy these gene names"
                          onclick={(e: MouseEvent) => {
                            e.stopPropagation();
                            copyCombo(combo.members);
                          }}
                        >
                          <Copy class="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Run over-representation on these genes"
                          onclick={(e: MouseEvent) => {
                            e.stopPropagation();
                            enrichCombo(combo.members);
                          }}
                        >
                          <BarChart class="h-3 w-3" />
                        </Button>
                      </div>
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
  {:else if nonEmptySlots >= 2 && !busy}
    <div class="rounded-md border bg-card px-3 py-4 text-sm text-muted-foreground">
      Press <span class="font-semibold text-foreground">Compare</span> to resolve both lists and see the
      overlap.
    </div>
  {:else}
    <div class="rounded-md border bg-card px-3 py-4 text-sm text-muted-foreground">
      Add genes to at least two slots to compare.
    </div>
  {/if}
</div>
