<script lang="ts">
  // Lists recent GSEA runs from the localStorage index. "Resume" restores the
  // ranked list and result table from OPFS (keyed by hash + params); parent handles the data.
  import { onMount } from 'svelte';
  import { listRecentRuns, loadRanked, deleteRecentRun, type RecentRun } from '$lib/gsea-cache';
  import type { GseaInput } from '$lib/db/client';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import { toast } from 'svelte-sonner';

  let { onResume }: { onResume: (ranked: GseaInput[], run: RecentRun) => void } = $props();

  let runs = $state<RecentRun[]>([]);
  onMount(() => {
    runs = listRecentRuns();
  });

  function fmtAgo(ms: number): string {
    const delta = Date.now() - ms;
    const s = Math.round(delta / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(ms).toLocaleDateString();
  }

  async function resume(r: RecentRun) {
    const ranked = await loadRanked(r.rankedHash);
    if (!ranked || ranked.length === 0) {
      toast.error('Ranked list not in cache', {
        description: 'OPFS may have been cleared. Re-paste the ranked list.',
      });
      return;
    }
    onResume(ranked, r);
  }

  function remove(cacheKey: string) {
    deleteRecentRun(cacheKey);
    runs = listRecentRuns();
  }
</script>

{#if runs.length > 0}
  <Card>
    <CardHeader>
      <CardTitle class="text-base">Recent runs</CardTitle>
      <div class="text-xs text-muted-foreground">
        Last {runs.length} gene set enrichment analysis (GSEA) runs, kept in this browser. Click
        <b>Resume</b> to restore the ranked list and result table without running the analysis again.
      </div>
    </CardHeader>
    <CardContent class="space-y-1 pt-0">
      {#each runs as r (r.cacheKey)}
        <div class="flex items-baseline gap-2 border-b py-1.5 text-xs last:border-b-0">
          <Badge variant="muted" class="py-0 text-[0.6rem]">{r.kind}</Badge>
          <span class="font-mono tabular-nums">{r.n_genes.toLocaleString()} genes</span>
          <span class="text-muted-foreground">
            {r.n_significant} significant of {r.n_results}
          </span>
          <span class="font-mono text-muted-foreground">
            term size {r.params.minSize}-{r.params.maxSize}, {r.params.nperm} permutations
          </span>
          <span class="ml-auto text-muted-foreground">{fmtAgo(r.at)}</span>
          <Button variant="outline" size="sm" onclick={() => resume(r)}>Resume</Button>
          <button
            type="button"
            onclick={() => remove(r.cacheKey)}
            class="text-muted-foreground hover:text-destructive"
            aria-label="Forget this run"
          >
            <Trash2 class="h-3 w-3" />
          </button>
        </div>
      {/each}
    </CardContent>
  </Card>
{/if}
