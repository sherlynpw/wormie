<script lang="ts">
  // Aggregate stats for the selection: top-K WormCat/GO/phenotype/disease/tissue terms
  // plus ortholog and description coverage, one round-trip each. Quick "what is this set" check.
  import { selection } from '$lib/stores/selection.svelte';
  import { query } from '$lib/db/client';
  import { Card, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import X from 'lucide-svelte/icons/x';
  import CengenHeatmap from '$lib/components/CengenHeatmap.svelte';
  import { resolve } from '$app/paths';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  type Overview = {
    n_selected: number;
    n_with_concise: number;
    n_with_legacy: number;
    n_with_ortho_human: number;
    n_with_go: number;
    median_go: number;
  };

  type TopRow = { term_id: string; name: string; k: number };

  let loading = $state(false);
  let overview = $state<Overview | null>(null);
  let topWormcat = $state<TopRow[]>([]);
  let topGo = $state<TopRow[]>([]);
  let topPheno = $state<TopRow[]>([]);
  let topDisease = $state<TopRow[]>([]);
  let topTissue = $state<TopRow[]>([]);

  $effect(() => {
    if (!open) return;
    const ids = selection.ids;
    if (ids.length === 0) return;
    void load(ids);
  });

  async function load(ids: string[]) {
    loading = true;
    try {
      const placeholders = ids.map(() => '?').join(',');

      const ovRows = await query<{
        n_total: number;
        n_concise: number;
        n_legacy: number;
        n_human: number;
      }>(
        `SELECT
					(SELECT COUNT(*) FROM annotations WHERE wormbase_gene IN (${placeholders})) AS n_total,
					(SELECT COUNT(*) FROM annotations WHERE wormbase_gene IN (${placeholders}) AND concise_description IS NOT NULL) AS n_concise,
					(SELECT COUNT(*) FROM annotations WHERE wormbase_gene IN (${placeholders}) AND legacy_description IS NOT NULL) AS n_legacy,
					(SELECT COUNT(DISTINCT wormbase_gene) FROM orthologs WHERE wormbase_gene IN (${placeholders}) AND species = 'Homo sapiens') AS n_human`,
        [...ids, ...ids, ...ids, ...ids],
      );

      const goCountRows = await query<{ wormbase_gene: string; n_go: number }>(
        `SELECT wormbase_gene, COUNT(DISTINCT go_id) AS n_go
				 FROM gene_go WHERE wormbase_gene IN (${placeholders}) AND evidence_code != 'IEA-PROP'
				 GROUP BY wormbase_gene`,
        ids,
      );
      const goCounts = goCountRows.map((r) => r.n_go).sort((a, b) => a - b);
      const median = goCounts.length === 0 ? 0 : goCounts[Math.floor(goCounts.length / 2)];

      overview = {
        n_selected: ovRows[0]?.n_total ?? 0,
        n_with_concise: ovRows[0]?.n_concise ?? 0,
        n_with_legacy: ovRows[0]?.n_legacy ?? 0,
        n_with_ortho_human: ovRows[0]?.n_human ?? 0,
        n_with_go: goCountRows.length,
        median_go: median,
      };

      topWormcat = await query<TopRow>(
        `SELECT category AS term_id, category AS name, COUNT(DISTINCT wormbase_gene) AS k FROM (
					SELECT wormbase_gene, category_1 AS category FROM wormcat WHERE category_1 IS NOT NULL AND wormbase_gene IN (${placeholders})
					UNION ALL SELECT wormbase_gene, category_2 FROM wormcat WHERE category_2 IS NOT NULL AND wormbase_gene IN (${placeholders})
				 ) GROUP BY category ORDER BY k DESC LIMIT 8`,
        [...ids, ...ids],
      );

      topGo = await query<TopRow>(
        `SELECT t.go_id AS term_id, t.name, COUNT(DISTINCT gg.wormbase_gene) AS k
				 FROM gene_go gg JOIN go_terms t ON t.go_id = gg.go_id
				 WHERE gg.wormbase_gene IN (${placeholders}) AND gg.evidence_code != 'IEA-PROP'
				 GROUP BY t.go_id ORDER BY k DESC LIMIT 10`,
        ids,
      );

      topPheno = await query<TopRow>(
        `SELECT gp.term_id, COALESCE(pt.name, gp.term_id) AS name, COUNT(DISTINCT gp.wormbase_gene) AS k
				 FROM gene_phenotype gp LEFT JOIN phenotype_terms pt ON pt.term_id = gp.term_id
				 WHERE gp.wormbase_gene IN (${placeholders})
				 GROUP BY gp.term_id ORDER BY k DESC LIMIT 10`,
        ids,
      );

      try {
        topDisease = await query<TopRow>(
          `SELECT do_id AS term_id, do_name AS name, COUNT(DISTINCT wormbase_gene) AS k
					 FROM gene_disease WHERE wormbase_gene IN (${placeholders})
					 GROUP BY do_id, do_name ORDER BY k DESC LIMIT 10`,
          ids,
        );
      } catch {
        topDisease = [];
      }

      try {
        topTissue = await query<TopRow>(
          `SELECT ga.term_id, COALESCE(at.name, ga.term_id) AS name, COUNT(DISTINCT ga.wormbase_gene) AS k
					 FROM gene_anatomy ga LEFT JOIN anatomy_terms at ON at.term_id = ga.term_id
					 WHERE ga.wormbase_gene IN (${placeholders})
					 GROUP BY ga.term_id ORDER BY k DESC LIMIT 10`,
          ids,
        );
      } catch {
        topTissue = [];
      }
    } finally {
      loading = false;
    }
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/60 p-4 backdrop-blur-sm"
    role="dialog"
  >
    <Card class="my-8 w-full max-w-3xl shadow-xl">
      <CardContent class="space-y-4 pt-5">
        <div class="flex items-baseline justify-between gap-3">
          <div>
            <div class="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">
              Selection summary
            </div>
            <h2 class="text-lg font-semibold">
              {selection.ids.length.toLocaleString()} gene{selection.ids.length === 1 ? '' : 's'}
            </h2>
          </div>
          <button
            type="button"
            onclick={() => (open = false)}
            class="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        {#if loading && !overview}
          <div class="py-6 text-sm text-muted-foreground">Computing summary…</div>
        {:else if overview}
          <div class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div class="rounded border p-2.5">
              <div
                class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Concise desc.
              </div>
              <div class="font-semibold">{overview.n_with_concise} / {overview.n_selected}</div>
            </div>
            <div class="rounded border p-2.5">
              <div
                class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                With GO
              </div>
              <div class="font-semibold">{overview.n_with_go} / {overview.n_selected}</div>
              <div class="text-[0.65rem] text-muted-foreground">
                median {overview.median_go} terms
              </div>
            </div>
            <div class="rounded border p-2.5">
              <div
                class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Human ortholog
              </div>
              <div class="font-semibold">{overview.n_with_ortho_human} / {overview.n_selected}</div>
            </div>
            <div class="rounded border p-2.5">
              <div
                class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Legacy desc.
              </div>
              <div class="font-semibold">{overview.n_with_legacy} / {overview.n_selected}</div>
            </div>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            {#each [{ title: 'Top WormCat', rows: topWormcat, prefix: '' }, { title: 'Top GO', rows: topGo, prefix: '' }, { title: 'Top phenotypes', rows: topPheno, prefix: '/phenotype/' }, { title: 'Top diseases', rows: topDisease, prefix: 'https://www.disease-ontology.org/?id=' }, { title: 'Top tissues', rows: topTissue, prefix: '' }] as block (block.title)}
              {#if block.rows.length > 0}
                <div class="rounded border p-2.5">
                  <div
                    class="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {block.title}
                  </div>
                  <div class="space-y-0.5 text-xs">
                    {#each block.rows as r (r.term_id)}
                      <div class="flex items-baseline justify-between gap-2">
                        <span class="truncate">
                          {#if block.prefix}
                            <!-- eslint-disable svelte/no-navigation-without-resolve -->
                            <a
                              href={block.prefix.startsWith('http')
                                ? `${block.prefix}${r.term_id}`
                                : resolve(`${block.prefix}${r.term_id}` as '/')}
                              target={block.prefix.startsWith('http') ? '_blank' : null}
                              rel={block.prefix.startsWith('http') ? 'noopener' : null}
                              class="hover:text-primary">{r.name}</a
                            >
                            <!-- eslint-enable svelte/no-navigation-without-resolve -->
                          {:else}
                            {r.name}
                          {/if}
                        </span>
                        <Badge
                          variant="muted"
                          class="px-1 py-0 font-mono text-[0.55rem] tabular-nums">{r.k}</Badge
                        >
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            {/each}
          </div>
        {/if}

        {#if selection.ids.length <= 100 && selection.ids.length >= 1}
          <div class="border-t pt-3">
            <CengenHeatmap
              ids={selection.ids}
              title="CeNGEN L4 neuronal expression"
              exportName="cengen-heatmap-selection"
            />
          </div>
        {:else if selection.ids.length > 100}
          <div class="border-t pt-3 text-xs italic text-muted-foreground">
            CeNGEN heatmap omitted (selection has >100 genes; render would be cramped).
          </div>
        {/if}

        <div class="flex items-center justify-end gap-2 border-t pt-2">
          <Button variant="outline" size="sm" onclick={() => (open = false)}>Close</Button>
        </div>
      </CardContent>
    </Card>
  </div>
{/if}
