<script lang="ts">
  // Disease term detail: C. elegans genes from the Alliance gene_disease table, plus cross-reference against saved gene lists.
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { query } from '$lib/db/client';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import GenePill from '$lib/components/GenePill.svelte';
  import PageHint from '$lib/components/PageHint.svelte';
  import ControlHint from '$lib/components/ControlHint.svelte';
  import TermCrossRef from '$lib/components/TermCrossRef.svelte';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import ExternalLink from 'lucide-svelte/icons/external-link';
  import ExpandMore from '$lib/components/ExpandMore.svelte';

  const ROW_LIMIT = 25;
  let expanded = $state(false);
  function isOrthologyInferred(g: {
    association_type: string | null;
    with_ortholog: string | null;
  }): boolean {
    return !!g.with_ortholog || (g.association_type ?? '').includes('orthology');
  }

  const id = $derived(page.params.id ?? '');

  type GeneRow = {
    wormbase_gene: string;
    gene_name: string | null;
    concise_description: string | null;
    association_type: string | null;
    with_ortholog: string | null;
    evidence_count: number;
  };

  let term = $state<{ do_id: string; do_name: string; n_genes: number } | null>(null);
  let genes = $state<GeneRow[]>([]);
  let allMembers = $state<string[]>([]);
  let universeN = $state<number>(0);
  let loading = $state(true);
  let notFound = $state(false);
  let loadToken = 0;

  $effect(() => {
    const cur = id;
    untrack(() => load(cur));
  });

  async function load(cur: string) {
    const my = ++loadToken;
    loading = true;
    notFound = false;
    try {
      const [meta, rows, mRows, nRows] = await Promise.all([
        query<{ do_id: string; do_name: string; n_genes: number }>(
          `SELECT do_id, do_name, COUNT(DISTINCT wormbase_gene) AS n_genes
					 FROM gene_disease WHERE do_id = ? GROUP BY do_id, do_name LIMIT 1`,
          [cur],
        ),
        query<GeneRow>(
          `SELECT gd.wormbase_gene, a.gene_name, a.concise_description,
					        gd.association_type, gd.with_ortholog, gd.evidence_count
					 FROM gene_disease gd
					 JOIN annotations a ON a.wormbase_gene = gd.wormbase_gene
					 WHERE gd.do_id = ?
					 ORDER BY gd.evidence_count DESC, a.gene_name`,
          [cur],
        ),
        query<{ wormbase_gene: string }>(
          'SELECT DISTINCT wormbase_gene FROM gene_disease WHERE do_id = ?',
          [cur],
        ),
        query<{ n: number }>('SELECT COUNT(DISTINCT wormbase_gene) AS n FROM gene_disease'),
      ]);
      if (my !== loadToken) return;
      if (meta.length === 0) {
        notFound = true;
        loading = false;
        return;
      }
      term = meta[0];
      genes = rows;
      allMembers = mRows.map((r) => r.wormbase_gene);
      universeN = nRows[0]?.n ?? 0;
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>{term?.do_name ?? id} · disease · wormie.rs.ht</title>
</svelte:head>

<div class="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/?view=cards" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <PageHint id="disease-term" title="Disease term">
    C. elegans genes linked to this Disease Ontology (DO) term by the Alliance of Genome Resources.
    Most links are inferred from a human ortholog (the matching human gene). For those genes, the
    text after the gene name shows the ortholog the link came from. The table below tests whether
    any of your saved gene lists has more genes with this term than expected by chance.
  </PageHint>

  {#if loading}
    <div class="text-sm text-muted-foreground">Loading disease...</div>
  {:else if notFound}
    <Card>
      <CardContent class="pt-6">
        <div class="mb-1 font-medium">Disease term not found</div>
        <div class="text-sm text-muted-foreground">
          No <span class="font-mono">{id}</span> in the gene_disease table. Either no C. elegans genes
          are linked to this term, or the database needs rebuilding.
        </div>
      </CardContent>
    </Card>
  {:else if term}
    <Card>
      <CardHeader>
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <CardTitle class="inline-flex flex-wrap items-center gap-2 text-xl">
            {term.do_name}
            <a
              class="inline-flex items-center gap-1 font-mono text-[0.7rem] text-muted-foreground hover:text-primary"
              href="https://www.disease-ontology.org/?id={term.do_id}"
              target="_blank"
              rel="noopener"
            >
              {term.do_id}
              <ExternalLink class="h-3 w-3" />
            </a>
          </CardTitle>
          <Badge variant="muted" class="text-xs">{term.n_genes.toLocaleString()} genes</Badge>
        </div>
      </CardHeader>
    </Card>

    <TermCrossRef members={allMembers} N={universeN} />

    <Card>
      <CardHeader class="flex flex-row items-baseline justify-between pb-2">
        <CardTitle class="inline-flex items-center gap-1.5 text-base">
          Implicated genes
          <ControlHint id="disease-genes" title="Implicated genes">
            Genes assigned directly by curators come first, then genes sorted by the number of
            evidence records. The <span class="font-mono">via ortho</span> label marks a link
            inferred from a human or mouse ortholog (the association type ends in
            <code>_via_orthology</code>, or an ortholog is listed). The text after the gene shows
            the association type and that ortholog.
          </ControlHint>
        </CardTitle>
        {@const orthoInferred = genes.filter(isOrthologyInferred).length}
        {@const direct = genes.length - orthoInferred}
        <span class="text-xs text-muted-foreground">
          {genes.length}{direct > 0 && orthoInferred > 0
            ? ` · ${direct} direct · ${orthoInferred} via ortholog`
            : ''}
        </span>
      </CardHeader>
      <CardContent class="pt-0">
        {@const sortedGenes = [...genes].sort((a, b) => {
          const ao = isOrthologyInferred(a) ? 1 : 0;
          const bo = isOrthologyInferred(b) ? 1 : 0;
          if (ao !== bo) return ao - bo;
          return b.evidence_count - a.evidence_count;
        })}
        {@const visibleGenes = expanded ? sortedGenes : sortedGenes.slice(0, ROW_LIMIT)}
        <div class="grid grid-cols-[auto_auto_auto_1fr] items-baseline gap-x-3 gap-y-1 text-xs">
          {#each visibleGenes as g (g.wormbase_gene)}
            {@const ortho = isOrthologyInferred(g)}
            <span
              class={'text-right font-mono tabular-nums ' +
                (ortho ? 'text-muted-foreground/70' : 'font-semibold')}
              title={ortho
                ? `${g.evidence_count} evidence records (inferred from an ortholog)`
                : `${g.evidence_count} evidence records (assigned directly)`}
            >
              {g.evidence_count}
            </span>
            <GenePill id={g.wormbase_gene} name={g.gene_name} />
            <span class="text-[0.7rem] text-muted-foreground">
              {#if ortho}
                <span
                  class="mr-1 font-mono text-[0.55rem] uppercase tracking-wider text-amber-700 dark:text-amber-400"
                  >via ortho</span
                >
              {/if}
              {g.association_type ?? ''}{g.with_ortholog ? ' · ' + g.with_ortholog : ''}
            </span>
            <span class="truncate text-muted-foreground">{g.concise_description ?? ''}</span>
          {/each}
        </div>
        <div class="mt-2 flex">
          <ExpandMore
            total={sortedGenes.length}
            shown={ROW_LIMIT}
            {expanded}
            onToggle={(v) => (expanded = v)}
            label="implicated genes"
          />
        </div>
      </CardContent>
    </Card>
  {/if}
</div>
