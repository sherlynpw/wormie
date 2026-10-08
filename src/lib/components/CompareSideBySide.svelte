<script lang="ts">
  // Side-by-side cards for 2-N genes. Annotations shared by ≥2 genes are
  // highlighted per-row (row-level view, vs the /compare UpSet/Jaccard set-level view).
  import type {
    GeneRow,
    WormcatAssignment,
    NeuronalAssignment,
    GoAnnotation,
    PhenotypeRow,
    AnatomyRow,
    Ortholog,
  } from '$lib/queries';
  import { Card, CardContent } from '$lib/components/ui/card';
  import GenePill from '$lib/components/GenePill.svelte';
  import TermHover from '$lib/components/TermHover.svelte';
  import CengenHeatmap from '$lib/components/CengenHeatmap.svelte';
  import { resolve } from '$app/paths';

  type Row = GeneRow & {
    wormcat: WormcatAssignment | null;
    neuronal: NeuronalAssignment[];
    go: GoAnnotation[];
    phenotypes: PhenotypeRow[];
    anatomy: AnatomyRow[];
    orthologs: Ortholog[];
  };

  let { rows }: { rows: Row[] } = $props();

  // Rows can repeat per gene (multiple evidence codes). Dedupe so each term appears once per column.
  function dedupeBy<T>(arr: T[], keyOf: (x: T) => string): T[] {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const seen = new Set<string>();
    const out: T[] = [];
    for (const x of arr) {
      const k = keyOf(x);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(x);
    }
    return out;
  }

  // Count how many genes share each annotation id, used to color shared vs unique cells.
  function buildCounts<T>(items: T[][], keyOf: (x: T) => string): Map<string, number> {
    /* eslint-disable svelte/prefer-svelte-reactivity */
    const counts = new Map<string, number>();
    for (const list of items) {
      const seen = new Set<string>();
      for (const x of list) seen.add(keyOf(x));
      for (const k of seen) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    /* eslint-enable svelte/prefer-svelte-reactivity */
    return counts;
  }

  const goCounts = $derived(
    buildCounts(
      rows.map((r) => r.go),
      (a) => a.go_id,
    ),
  );
  const phenoCounts = $derived(
    buildCounts(
      rows.map((r) => r.phenotypes),
      (a) => a.term_id,
    ),
  );
  const anatomyCounts = $derived(
    buildCounts(
      rows.map((r) => r.anatomy),
      (a) => a.term_id,
    ),
  );
  const orthoCounts = $derived(
    buildCounts(
      rows.map((r) => r.orthologs.filter((o) => o.species === 'Homo sapiens')),
      (o) => o.ortholog_symbol,
    ),
  );
  const N = $derived(rows.length);

  function sharedClass(count: number): string {
    if (count >= N && N > 1)
      return 'bg-[hsl(var(--plot-down)/0.15)] border-[hsl(var(--plot-down)/0.5)]';
    if (count >= 2) return 'bg-[hsl(var(--plot-up)/0.12)] border-[hsl(var(--plot-up)/0.5)]';
    return 'bg-card border-border';
  }
</script>

<div
  class={'grid gap-3 ' +
    (N === 2
      ? 'sm:grid-cols-2'
      : N === 3
        ? 'lg:grid-cols-3'
        : N === 4
          ? 'lg:grid-cols-4'
          : 'lg:grid-cols-5')}
>
  {#each rows as r (r.wormbase_gene)}
    <Card class="border-l-4 border-l-primary">
      <CardContent class="space-y-3 pt-4">
        <div>
          <GenePill id={r.wormbase_gene} name={r.gene_name} />
          <div class="mt-1 font-mono text-[0.65rem] text-muted-foreground">{r.wormbase_gene}</div>
          {#if r.concise_description}
            <div class="mt-1 line-clamp-3 text-xs text-muted-foreground">
              {r.concise_description}
            </div>
          {/if}
        </div>

        {#if r.wormcat?.category_1}
          <div>
            <div
              class="mb-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              WormCat
            </div>
            <div class="text-xs">
              {r.wormcat.category_1}
              {#if r.wormcat.category_2 && r.wormcat.category_2 !== r.wormcat.category_1}
                <span class="text-muted-foreground"> › </span>{r.wormcat.category_2}
              {/if}
            </div>
          </div>
        {/if}

        {@const humanOrthos = dedupeBy(
          r.orthologs.filter((o) => o.species === 'Homo sapiens'),
          (o) => o.ortholog_symbol,
        )}
        {#if humanOrthos.length > 0}
          <div>
            <div
              class="mb-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Human orthologs
            </div>
            <div class="flex flex-wrap gap-1">
              {#each humanOrthos.slice(0, 6) as o (o.ortholog_symbol)}
                <span
                  class={'inline-flex items-center rounded border px-1.5 py-0.5 text-[0.7rem] ' +
                    sharedClass(orthoCounts.get(o.ortholog_symbol) ?? 1)}
                >
                  {o.ortholog_symbol}
                </span>
              {/each}
            </div>
          </div>
        {/if}

        {@const goU = dedupeBy(r.go, (a) => a.go_id)}
        {#if goU.length > 0}
          <div>
            <div
              class="mb-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              GO ({goU.length})
            </div>
            <div class="flex flex-wrap gap-1">
              {#each goU.slice(0, 12) as a (a.go_id)}
                <TermHover kind="go" id={a.go_id}>
                  <a
                    href={resolve(`/go/${a.go_id}`)}
                    class={'inline-flex rounded border px-1.5 py-0.5 text-[0.7rem] transition-colors hover:bg-accent ' +
                      sharedClass(goCounts.get(a.go_id) ?? 1)}
                  >
                    {a.name}
                  </a>
                </TermHover>
              {/each}
            </div>
          </div>
        {/if}

        {@const phU = dedupeBy(r.phenotypes, (p) => p.term_id)}
        {#if phU.length > 0}
          <div>
            <div
              class="mb-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Phenotypes ({phU.length})
            </div>
            <div class="flex flex-wrap gap-1">
              {#each phU.slice(0, 10) as p (p.term_id)}
                <TermHover kind="phenotype" id={p.term_id}>
                  <a
                    href={resolve(`/phenotype/${p.term_id}`)}
                    class={'inline-flex rounded border px-1.5 py-0.5 text-[0.7rem] transition-colors hover:bg-accent ' +
                      sharedClass(phenoCounts.get(p.term_id) ?? 1)}
                  >
                    {p.name}
                  </a>
                </TermHover>
              {/each}
            </div>
          </div>
        {/if}

        {@const anU = dedupeBy(r.anatomy, (t) => t.term_id)}
        {#if anU.length > 0}
          <div>
            <div
              class="mb-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Tissues ({anU.length})
            </div>
            <div class="flex flex-wrap gap-1">
              {#each anU.slice(0, 8) as t (t.term_id)}
                <span
                  class={'inline-flex rounded border px-1.5 py-0.5 text-[0.7rem] ' +
                    sharedClass(anatomyCounts.get(t.term_id) ?? 1)}
                >
                  {t.name}
                </span>
              {/each}
            </div>
          </div>
        {/if}
      </CardContent>
    </Card>
  {/each}
</div>

{#if rows.length >= 2}
  <Card>
    <CardContent class="space-y-2 pt-4">
      <div class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        CeNGEN L4 neuronal expression
      </div>
      <CengenHeatmap ids={rows.map((r) => r.wormbase_gene)} exportName="compare-cengen" />
    </CardContent>
  </Card>
{/if}

<div class="flex items-center gap-3 border-t pt-1 text-[0.65rem] text-muted-foreground">
  <span class="inline-flex items-center gap-1">
    <span
      class="inline-block h-2.5 w-2.5 rounded-sm border border-[hsl(var(--plot-down)/0.5)] bg-[hsl(var(--plot-down)/0.15)]"
    ></span>
    shared by all {N}
  </span>
  <span class="inline-flex items-center gap-1">
    <span
      class="inline-block h-2.5 w-2.5 rounded-sm border border-[hsl(var(--plot-up)/0.5)] bg-[hsl(var(--plot-up)/0.12)]"
    ></span>
    shared by ≥ 2
  </span>
  <span class="inline-flex items-center gap-1">
    <span class="inline-block h-2.5 w-2.5 rounded-sm border border-border bg-card"></span>
    unique
  </span>
</div>
