<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { untrack } from 'svelte';
  import {
    getGenesByIds,
    getWormcatFor,
    getNeuronalFor,
    getGoFor,
    getPhenotypesFor,
    getAnatomyFor,
    getOrthologs,
    type GeneRow,
    type WormcatAssignment,
    type NeuronalAssignment,
    type GoAnnotation,
    type PhenotypeRow,
    type AnatomyRow,
    type Ortholog,
  } from '$lib/queries';
  import { selection } from '$lib/stores/selection.svelte';
  import { readIdsFromUrl, buildIdsQuery } from '$lib/share';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import JaccardHeatmap from '$lib/components/JaccardHeatmap.svelte';
  import UpSetPlot from '$lib/components/UpSetPlot.svelte';
  import CompareSideBySide from '$lib/components/CompareSideBySide.svelte';
  import CengenHeatmap from '$lib/components/CengenHeatmap.svelte';
  import PageHint from '$lib/components/PageHint.svelte';
  import ControlHint from '$lib/components/ControlHint.svelte';
  import { cn } from '$lib/utils';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import ExternalLink from 'lucide-svelte/icons/external-link';
  import X from 'lucide-svelte/icons/x';

  // Pairwise overlap card (only-A / both / only-B) shown when exactly 2 genes are loaded.
  type OverlapItem = { id: string; label: string };
  type Triptych = { onlyA: OverlapItem[]; both: OverlapItem[]; onlyB: OverlapItem[] };

  function diffSets(
    a: { id: string; label: string }[],
    b: { id: string; label: string }[],
  ): Triptych {
    // Dedupe by id first: gene_go returns multiple evidence rows per term.
    const aMap = new Map(a.map((x) => [x.id, x]));
    const bMap = new Map(b.map((x) => [x.id, x]));
    const onlyA: OverlapItem[] = [];
    const both: OverlapItem[] = [];
    const onlyB: OverlapItem[] = [];
    for (const [id, x] of aMap) {
      if (bMap.has(id)) both.push(x);
      else onlyA.push(x);
    }
    for (const [id, x] of bMap) {
      if (!aMap.has(id)) onlyB.push(x);
    }
    const cmp = (x: OverlapItem, y: OverlapItem) => x.label.localeCompare(y.label);
    onlyA.sort(cmp);
    both.sort(cmp);
    onlyB.sort(cmp);
    return { onlyA, both, onlyB };
  }

  type Row = GeneRow & {
    wormcat: WormcatAssignment | null;
    neuronal: NeuronalAssignment[];
    go: GoAnnotation[];
    phenotypes: PhenotypeRow[];
    anatomy: AnatomyRow[];
    orthologs: Ortholog[];
  };

  let rows = $state<Row[]>([]);
  let loading = $state(true);
  let loadToken = 0;

  let ids = $state<string[]>([]);
  // 'set': UpSet + Jaccard + region tables (overlap summary); 'side': per-gene cards with shared annotations highlighted.
  let viewMode = $state<'set' | 'side'>('set');
  function setViewSet() {
    viewMode = 'set';
  }
  function setViewSide() {
    viewMode = 'side';
  }

  $effect(() => {
    const u = page.url;
    untrack(async () => {
      const decoded = await readIdsFromUrl(u);
      ids = decoded;
      await load(decoded);
    });
  });

  async function load(toLoad: string[]) {
    const my = ++loadToken;
    loading = true;
    if (toLoad.length === 0) {
      rows = [];
      loading = false;
      return;
    }
    const genes = await getGenesByIds(toLoad);
    // Preserve URL order.
    const map = new Map(genes.map((g) => [g.wormbase_gene, g]));
    const ordered = toLoad.map((id) => map.get(id)).filter((g): g is GeneRow => !!g);

    const detail = await Promise.all(
      ordered.map(async (g) => {
        const [wc, neu, go, ph, an, ort] = await Promise.all([
          getWormcatFor(g.wormbase_gene),
          getNeuronalFor(g.wormbase_gene),
          getGoFor(g.wormbase_gene),
          getPhenotypesFor(g.wormbase_gene),
          getAnatomyFor(g.wormbase_gene),
          getOrthologs(g.wormbase_gene),
        ]);
        return {
          ...g,
          wormcat: wc,
          neuronal: neu,
          go,
          phenotypes: ph,
          anatomy: an,
          orthologs: ort,
        };
      }),
    );
    if (my !== loadToken) return;
    rows = detail;
    loading = false;
  }

  async function removeGene(id: string) {
    const next = ids.filter((x) => x !== id);
    const url = new URL(page.url);
    url.searchParams.delete('ids');
    url.searchParams.delete('gz');
    if (next.length) {
      const q = await buildIdsQuery(next);
      const newUrl = `${url.pathname}?${q}`;
      history.replaceState(null, '', newUrl);
    } else {
      history.replaceState(null, '', url.pathname);
    }
    ids = next;
    rows = rows.filter((r) => r.wormbase_gene !== id);
  }

  async function loadFromSelection() {
    if (selection.ids.length === 0) return;
    const q = await buildIdsQuery(selection.ids);
    location.href = `${page.url.pathname}?${q}`;
  }

  type FieldRow = { label: string; key?: keyof Row; render?: (r: Row) => string };
  const FIELDS: FieldRow[] = [
    { label: 'Name', render: (r) => r.gene_name ?? r.wormbase_gene },
    { label: 'WBGene', key: 'wormbase_gene' },
    { label: 'Entrez', render: (r) => r.entrez_id ?? '' },
    { label: 'Sequence', render: (r) => r.sequence_name ?? '' },
    { label: 'Type', render: (r) => r.gene_type ?? '' },
    { label: 'Status', render: (r) => r.status ?? '' },
    { label: 'Gene class', render: (r) => r.gene_class_description ?? '' },
    { label: 'Description', render: (r) => r.concise_description ?? '' },
    { label: 'Legacy', render: (r) => r.legacy_description ?? '' },
    { label: 'Other names', render: (r) => r.other_names ?? '' },
    {
      label: 'WormCat',
      render: (r) => {
        if (!r.wormcat) return '';
        return [r.wormcat.category_1, r.wormcat.category_2, r.wormcat.category_3]
          .filter((x, i, arr) => x && (i === 0 || x !== arr[i - 1]))
          .join(' › ');
      },
    },
    {
      label: 'Neuronal',
      render: (r) =>
        r.neuronal.map((n) => [n.supercategory, n.category].filter(Boolean).join(' › ')).join('; '),
    },
    { label: '# GO terms', render: (r) => String(r.go.length) },
  ];
</script>

<svelte:head><title>Annotation overlap · wormie.rs.ht</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <div class="flex items-center justify-between gap-2">
    <Button variant="ghost" size="sm" href="/" class="self-start">
      <ArrowLeft />
      Back
    </Button>
  </div>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Annotation overlap</h1>
    <p class="text-sm text-muted-foreground">
      What a set of genes has in common, and what sets each one apart
    </p>
  </header>

  <PageHint id="compare" title="What this step does">
    You have a handful of genes and want to know what they have in common: are they annotated to the
    same GO terms, do they give the same phenotypes, are they expressed in the same tissues, do they
    share orthologs? Select the genes from the cards or table view and send them here. Every gene is
    compared against every other one, annotation by annotation. With two genes you get a
    three-column split, unique to the first / shared / unique to the second. With three or more you
    get an UpSet plot per category showing which combinations of genes share terms, a Jaccard
    heatmap of how similar each pair is overall, and the list of annotations common to all of them.
    Note this compares genes to each other, not one list against another list: to see which genes
    two lists share, use
    <a href={resolve('/compare/lists')} class="underline underline-offset-2">Gene overlap</a>; to
    ask whether two separate gene lists turn up the same biology, run
    <a href={resolve('/enrichment')} class="underline underline-offset-2">over-representation</a>
    on each and put the results side by side in
    <a href={resolve('/enrichment/overlap')} class="underline underline-offset-2"
      >enrichment overlap</a
    >.
  </PageHint>

  <div class="-mt-3 flex items-center justify-between gap-2">
    <span></span>
    {#if selection.ids.length > 0}
      <Button variant="outline" size="sm" onclick={loadFromSelection}>
        Load {selection.ids.length} from selection
      </Button>
    {/if}
  </div>

  {#if loading}
    <div class="text-sm text-muted-foreground">Loading comparison...</div>
  {:else if rows.length === 0}
    <Card>
      <CardContent class="space-y-2 pt-6">
        <div class="font-medium">No genes to compare</div>
        <div class="text-sm text-muted-foreground">
          Pick at least two genes via the
          <a class="text-primary hover:underline" href={resolve('/?view=cards')}>cards</a>
          or
          <a class="text-primary hover:underline" href={resolve('/?view=table')}>table</a>
          view (click the + on each), then click "Compare selection" in the bottom bar.
        </div>
      </CardContent>
    </Card>
  {:else}
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onclick={setViewSet}
        class={cn(
          'h-8 rounded-md border px-3 text-xs transition-colors',
          viewMode === 'set'
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-input bg-background hover:bg-accent',
        )}
        title="UpSet + Jaccard + intersection tables (set-level overlap)"
      >
        Set overlaps
      </button>
      <button
        type="button"
        onclick={setViewSide}
        class={cn(
          'h-8 rounded-md border px-3 text-xs transition-colors',
          viewMode === 'side'
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-input bg-background hover:bg-accent',
        )}
        title="Per-gene cards side-by-side with shared annotations highlighted"
      >
        Side-by-side
      </button>
    </div>

    {#if viewMode === 'side'}
      <CompareSideBySide {rows} />
    {/if}
    {#if viewMode === 'set'}
      <Card>
        <CardHeader class="pb-3">
          <CardTitle class="text-base">Compare {rows.length} genes</CardTitle>
        </CardHeader>
        <CardContent class="overflow-x-auto pt-0">
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr class="border-b">
                <th
                  class="sticky left-0 z-10 min-w-[120px] bg-card px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Field
                </th>
                {#each rows as r (r.wormbase_gene)}
                  <th class="min-w-[260px] max-w-[360px] px-3 py-2 text-left align-bottom">
                    <div class="flex items-start justify-between gap-2">
                      <div class="flex flex-col gap-0.5">
                        <a
                          href={resolve(`/gene/${r.wormbase_gene}`)}
                          class="font-semibold hover:text-primary"
                        >
                          {r.gene_name ?? r.wormbase_gene}
                        </a>
                        <a
                          href="https://www.wormbase.org/species/c_elegans/gene/{r.wormbase_gene}"
                          target="_blank"
                          rel="noopener"
                          class="inline-flex items-center gap-0.5 font-mono text-[0.65rem] text-muted-foreground hover:text-primary"
                        >
                          {r.wormbase_gene}
                          <ExternalLink class="h-2.5 w-2.5" />
                        </a>
                      </div>
                      <button
                        type="button"
                        onclick={() => removeGene(r.wormbase_gene)}
                        aria-label="Remove from comparison"
                        class="text-muted-foreground hover:text-destructive"
                      >
                        <X class="h-3 w-3" />
                      </button>
                    </div>
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each FIELDS as f (f.label)}
                <tr class="border-b">
                  <th
                    class="sticky left-0 z-10 bg-card px-3 py-2 text-left align-top text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {f.label}
                  </th>
                  {#each rows as r (r.wormbase_gene)}
                    {@const val = f.render
                      ? f.render(r)
                      : ((r[f.key as keyof Row] as string) ?? '')}
                    <td class="px-3 py-2 align-top text-xs">
                      {#if val}
                        <div class="group flex items-start gap-1">
                          <span class="flex-1 break-words">{val}</span>
                          <CopyButton
                            text={val}
                            class="opacity-0 transition-opacity group-hover:opacity-100"
                          />
                        </div>
                      {:else}
                        <span class="text-muted-foreground/40">—</span>
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {#if rows.length === 2}
        {@const A = rows[0]}
        {@const B = rows[1]}
        {@const goOverlap = diffSets(
          A.go.map((a) => ({ id: a.go_id, label: a.name })),
          B.go.map((a) => ({ id: a.go_id, label: a.name })),
        )}
        {@const phOverlap = diffSets(
          A.phenotypes.map((p) => ({ id: p.term_id, label: p.name })),
          B.phenotypes.map((p) => ({ id: p.term_id, label: p.name })),
        )}
        {@const anOverlap = diffSets(
          A.anatomy.map((t) => ({ id: t.term_id, label: t.name })),
          B.anatomy.map((t) => ({ id: t.term_id, label: t.name })),
        )}
        {@const orOverlap = diffSets(
          A.orthologs.map((o) => ({
            id: `${o.taxon_id}|${o.ortholog_symbol}`,
            label: `${o.ortholog_symbol} (${o.species})`,
          })),
          B.orthologs.map((o) => ({
            id: `${o.taxon_id}|${o.ortholog_symbol}`,
            label: `${o.ortholog_symbol} (${o.species})`,
          })),
        )}

        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="text-base">Pairwise overlap</CardTitle>
            <div class="text-xs text-muted-foreground">
              Set differences and intersection between
              <span class="font-semibold text-foreground">{A.gene_name ?? A.wormbase_gene}</span>
              and
              <span class="font-semibold text-foreground">{B.gene_name ?? B.wormbase_gene}</span>.
            </div>
          </CardHeader>
          <CardContent class="space-y-4 pt-0">
            {#each [{ k: 'GO terms', d: goOverlap }, { k: 'Phenotypes', d: phOverlap }, { k: 'Tissues', d: anOverlap }, { k: 'Orthologs', d: orOverlap }] as section (section.k)}
              {#if section.d.onlyA.length + section.d.both.length + section.d.onlyB.length > 0}
                <div>
                  <div
                    class="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {section.k}
                    <span class="ml-2 text-muted-foreground/60">
                      {section.d.onlyA.length} only A · {section.d.both.length} both · {section.d
                        .onlyB.length} only B
                    </span>
                  </div>
                  <div class="grid grid-cols-3 gap-2">
                    <div class="rounded-md border bg-card p-2">
                      <div
                        class="mb-1 text-[0.65rem] font-semibold text-rose-600 dark:text-rose-400"
                      >
                        Only {A.gene_name ?? A.wormbase_gene}
                      </div>
                      <div class="flex max-h-48 flex-wrap gap-1 overflow-y-auto">
                        {#each section.d.onlyA.slice(0, 50) as item (item.id)}
                          <span class="rounded border bg-card px-1.5 py-0.5 text-[0.7rem]"
                            >{item.label}</span
                          >
                        {/each}
                        {#if section.d.onlyA.length > 50}
                          <span class="self-center text-[0.65rem] text-muted-foreground"
                            >+{section.d.onlyA.length - 50}</span
                          >
                        {/if}
                      </div>
                    </div>
                    <div class="rounded-md border-2 border-accent bg-accent/20 p-2">
                      <div class="mb-1 text-[0.65rem] font-semibold text-accent-foreground">
                        Both
                      </div>
                      <div class="flex max-h-48 flex-wrap gap-1 overflow-y-auto">
                        {#each section.d.both.slice(0, 50) as item (item.id)}
                          <span class="rounded border bg-card px-1.5 py-0.5 text-[0.7rem]"
                            >{item.label}</span
                          >
                        {/each}
                        {#if section.d.both.length > 50}
                          <span class="self-center text-[0.65rem] text-muted-foreground"
                            >+{section.d.both.length - 50}</span
                          >
                        {/if}
                      </div>
                    </div>
                    <div class="rounded-md border bg-card p-2">
                      <div
                        class="mb-1 text-[0.65rem] font-semibold text-emerald-600 dark:text-emerald-400"
                      >
                        Only {B.gene_name ?? B.wormbase_gene}
                      </div>
                      <div class="flex max-h-48 flex-wrap gap-1 overflow-y-auto">
                        {#each section.d.onlyB.slice(0, 50) as item (item.id)}
                          <span class="rounded border bg-card px-1.5 py-0.5 text-[0.7rem]"
                            >{item.label}</span
                          >
                        {/each}
                        {#if section.d.onlyB.length > 50}
                          <span class="self-center text-[0.65rem] text-muted-foreground"
                            >+{section.d.onlyB.length - 50}</span
                          >
                        {/if}
                      </div>
                    </div>
                  </div>
                </div>
              {/if}
            {/each}
          </CardContent>
        </Card>
      {/if}

      {#if rows.length >= 3}
        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              UpSet (intersection groups)
              <ControlHint id="compare-upset" title="UpSet plots">
                Visualizes term-set intersections across all selected genes. Each row is a gene;
                dots connected by a line mark genes that share that intersection. The bar is the
                size of the intersection. Use this when a Venn diagram would become unreadable past
                ~4 sets.
              </ControlHint>
            </CardTitle>
            <div class="text-xs text-muted-foreground">
              Top intersection groups across {rows.length} genes for each category. Bars = group size;
              connected dots = which genes share that group. Sorted by size, top 18 groups per category.
            </div>
          </CardHeader>
          <CardContent class="grid gap-4 pt-0 md:grid-cols-2">
            <UpSetPlot
              title="GO terms"
              sets={rows.map((r) => ({
                name: r.gene_name ?? r.wormbase_gene,
                ids: r.go.map((a) => a.go_id),
              }))}
              exportName="compare-upset-go"
            />
            <UpSetPlot
              title="Phenotypes"
              sets={rows.map((r) => ({
                name: r.gene_name ?? r.wormbase_gene,
                ids: r.phenotypes.map((p) => p.term_id),
              }))}
              exportName="compare-upset-phenotypes"
            />
            <UpSetPlot
              title="Tissues"
              sets={rows.map((r) => ({
                name: r.gene_name ?? r.wormbase_gene,
                ids: r.anatomy.map((t) => t.term_id),
              }))}
              exportName="compare-upset-tissues"
            />
            <UpSetPlot
              title="Orthologs"
              sets={rows.map((r) => ({
                name: r.gene_name ?? r.wormbase_gene,
                ids: r.orthologs.map((o) => `${o.taxon_id}|${o.ortholog_symbol}`),
              }))}
              exportName="compare-upset-orthologs"
            />
          </CardContent>
        </Card>
      {/if}

      {#if rows.length > 1}
        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="text-base">CeNGEN L4 neuronal expression</CardTitle>
          </CardHeader>
          <CardContent class="pt-0">
            <CengenHeatmap ids={rows.map((r) => r.wormbase_gene)} exportName="compare-cengen" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Pairwise similarity (Jaccard)
              <ControlHint id="compare-jaccard" title="Jaccard heatmap">
                N × N grid of <code>|A ∩ B| / |A ∪ B|</code> per term category. Robust to set-size differences
                (unlike raw overlap counts). Compare cell intensity across categories to see which dimension
                drives gene-to-gene similarity.
              </ControlHint>
            </CardTitle>
            <div class="text-xs text-muted-foreground">
              N × N similarity per category. Darker cells = more overlap. Numbers under each gene
              label are the set sizes.
            </div>
          </CardHeader>
          <CardContent class="grid gap-4 pt-0 md:grid-cols-2">
            <JaccardHeatmap
              title="GO terms"
              sets={rows.map((r) => ({
                name: r.gene_name ?? r.wormbase_gene,
                ids: r.go.map((a) => a.go_id),
              }))}
            />
            <JaccardHeatmap
              title="Phenotypes"
              sets={rows.map((r) => ({
                name: r.gene_name ?? r.wormbase_gene,
                ids: r.phenotypes.map((p) => p.term_id),
              }))}
            />
            <JaccardHeatmap
              title="Tissues"
              sets={rows.map((r) => ({
                name: r.gene_name ?? r.wormbase_gene,
                ids: r.anatomy.map((t) => t.term_id),
              }))}
            />
            <JaccardHeatmap
              title="Orthologs"
              sets={rows.map((r) => ({
                name: r.gene_name ?? r.wormbase_gene,
                ids: r.orthologs.map((o) => `${o.taxon_id}|${o.ortholog_symbol}`),
              }))}
            />
          </CardContent>
        </Card>

        {@const sharedAll = (() => {
          function intersect(perGene: { id: string; label: string }[][]): OverlapItem[] {
            if (perGene.length === 0) return [];
            const dedupedFirst = new Map(perGene[0].map((x) => [x.id, x]));
            const out: OverlapItem[] = [];
            outer: for (const [id, x] of dedupedFirst) {
              for (let i = 1; i < perGene.length; i++) {
                if (!perGene[i].some((y) => y.id === id)) continue outer;
              }
              out.push(x);
            }
            out.sort((x, y) => x.label.localeCompare(y.label));
            return out;
          }
          return {
            go: intersect(rows.map((r) => r.go.map((a) => ({ id: a.go_id, label: a.name })))),
            phenotypes: intersect(
              rows.map((r) => r.phenotypes.map((p) => ({ id: p.term_id, label: p.name }))),
            ),
            tissues: intersect(
              rows.map((r) => r.anatomy.map((t) => ({ id: t.term_id, label: t.name }))),
            ),
            orthologs: intersect(
              rows.map((r) =>
                r.orthologs.map((o) => ({
                  id: `${o.taxon_id}|${o.ortholog_symbol}`,
                  label: `${o.ortholog_symbol} (${o.species})`,
                })),
              ),
            ),
          };
        })()}

        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="text-base">Shared across all {rows.length} genes</CardTitle>
            <div class="text-xs text-muted-foreground">
              Strict intersection (an item must appear in every selected gene to land here).
            </div>
          </CardHeader>
          <CardContent class="space-y-4 pt-0">
            {#each [{ k: 'GO terms', items: sharedAll.go, href: (id: string) => `/go/${id}` }, { k: 'Phenotypes', items: sharedAll.phenotypes, href: (id: string) => `https://wormbase.org/species/all/phenotype/${id}` }, { k: 'Tissues', items: sharedAll.tissues, href: (id: string) => `https://wormbase.org/species/all/anatomy_term/${id}` }, { k: 'Orthologs', items: sharedAll.orthologs, href: null }] as section (section.k)}
              <div>
                <div
                  class="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {section.k}
                  <span class="ml-2 text-muted-foreground/60">{section.items.length}</span>
                </div>
                {#if section.items.length === 0}
                  <div class="text-xs italic text-muted-foreground">
                    No {section.k.toLowerCase()} in common.
                  </div>
                {:else}
                  <div class="flex flex-wrap gap-1">
                    {#each section.items.slice(0, 60) as item (item.id)}
                      {#if section.href}
                        <!-- eslint-disable svelte/no-navigation-without-resolve -->
                        <a
                          href={section.href(item.id)}
                          target={section.href(item.id).startsWith('http') ? '_blank' : undefined}
                          rel="noopener"
                          class="rounded border bg-card px-1.5 py-0.5 text-[0.7rem] transition-colors hover:bg-accent"
                        >
                          {item.label}
                        </a>
                        <!-- eslint-enable svelte/no-navigation-without-resolve -->
                      {:else}
                        <span class="rounded border bg-card px-1.5 py-0.5 text-[0.7rem]">
                          {item.label}
                        </span>
                      {/if}
                    {/each}
                    {#if section.items.length > 60}
                      <span class="self-center text-[0.65rem] text-muted-foreground">
                        +{section.items.length - 60}
                      </span>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </CardContent>
        </Card>
      {/if}
    {/if}
  {/if}
</div>
