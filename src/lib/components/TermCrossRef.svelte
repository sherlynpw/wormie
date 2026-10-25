<script lang="ts">
  // Mini hypergeometric enrichment of every saved gene-list dataset vs this term's
  // member set. One row per dataset, sorted by significance.
  import { onMount } from 'svelte';
  import { datasets, type Dataset } from '$lib/stores/datasets.svelte';
  import { query } from '$lib/db/client';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { resolve } from '$app/paths';
  import { parseGeneList } from '$lib/gene-parse';

  type Props = {
    // WBGene member set (K side of the hypergeometric).
    members: string[];
    // Universe size N: distinct annotated-gene count for the term kind (GO/phenotype/disease).
    N: number;
    title?: string;
  };

  let {
    members,
    N,
    title = 'Your saved lists, ranked by enrichment for this term',
  }: Props = $props();

  type Row = {
    dataset: Dataset;
    k: number;
    n: number; // WBGene-resolved dataset size
    fold: number;
    p: number;
  };

  let rows = $state<Row[]>([]);
  let loading = $state(false);
  const memberSet = $derived(new Set(members));
  const K = $derived(members.length);

  // Inline log-gamma (same algorithm as the worker) to avoid a worker round-trip;
  // cheap here: a handful of datasets, one logChoose each.
  function logGamma(x: number): number {
    const g = 7;
    const c = [
      0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
      1.5056327351493116e-7,
    ];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  function logChoose(n: number, k: number) {
    if (k < 0 || k > n) return -Infinity;
    return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
  }
  function hyperUpper(k: number, KK: number, n: number, NN: number) {
    if (k > KK || k > n) return 0;
    const lc = logChoose(NN, n);
    let sum = -Infinity;
    const top = Math.min(KK, n);
    for (let i = k; i <= top; i++) {
      const lp = logChoose(KK, i) + logChoose(NN - KK, n - i) - lc;
      if (sum === -Infinity) sum = lp;
      else
        sum = lp > sum ? lp + Math.log1p(Math.exp(sum - lp)) : sum + Math.log1p(Math.exp(lp - sum));
    }
    return Math.exp(sum);
  }

  function parseGeneTokens(body: string): string[] {
    return [...new Set(parseGeneList(body))];
  }

  async function compute() {
    const gl = datasets.byType('gene-list');
    if (gl.length === 0 || members.length === 0) {
      rows = [];
      return;
    }
    loading = true;
    try {
      // Resolve tokens to WBGene IDs via annotations; unmatched tokens are silently dropped.
      const next: Row[] = [];
      for (const d of gl) {
        const tokens = parseGeneTokens(d.body);
        if (tokens.length === 0) continue;
        const placeholders = tokens.map(() => '?').join(',');
        const lowered = tokens.map((t) => t.toLowerCase());
        const lowerPh = lowered.map(() => '?').join(',');
        const resolved = await query<{ wormbase_gene: string }>(
          `SELECT DISTINCT wormbase_gene FROM annotations
					 WHERE wormbase_gene IN (${placeholders})
					    OR LOWER(gene_name) IN (${lowerPh})
					    OR LOWER(sequence_name) IN (${lowerPh})`,
          [...tokens, ...lowered, ...lowered],
        );
        const wbs = resolved.map((r) => r.wormbase_gene);
        if (wbs.length === 0) continue;
        let k = 0;
        for (const w of wbs) if (memberSet.has(w)) k++;
        if (k === 0) {
          next.push({
            dataset: d,
            k: 0,
            n: wbs.length,
            fold: 0,
            p: 1,
          });
          continue;
        }
        const n = wbs.length;
        const p = hyperUpper(k, K, n, N);
        const fold = k / n / Math.max(1e-9, K / N);
        next.push({ dataset: d, k, n, fold, p });
      }
      next.sort((a, b) => a.p - b.p || b.k - a.k);
      rows = next;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void members.length;
    void N;
    void datasets.items.length;
    void compute();
  });

  onMount(async () => {
    await datasets.init();
    compute();
  });
</script>

{#if rows.length > 0}
  <Card>
    <CardHeader class="pb-2">
      <CardTitle class="text-base">{title}</CardTitle>
      <div class="text-xs text-muted-foreground">
        Hypergeometric test of each saved gene list against the {K.toLocaleString()} genes with this term,
        out of {N.toLocaleString()} genes in the background (all annotated genes).
      </div>
    </CardHeader>
    <CardContent class="pt-0">
      <table class="w-full text-sm">
        <thead class="border-b">
          <tr class="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
            <th class="py-1.5 text-left">Gene list</th>
            <th class="text-right">k</th>
            <th class="text-right">n</th>
            <th class="text-right">fold</th>
            <th class="text-right">p</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.dataset.id)}
            <tr class="border-b last:border-b-0 hover:bg-muted/30">
              <td class="py-1.5">
                <a href={resolve('/datasets')} class="hover:text-primary">{r.dataset.name}</a>
                {#if r.p <= 0.01}
                  <Badge
                    variant="default"
                    class="ml-2 bg-accent px-1 py-0 text-[0.55rem] text-accent-foreground hover:bg-accent"
                    >enriched</Badge
                  >
                {:else if r.p <= 0.05}
                  <Badge variant="outline" class="ml-2 px-1 py-0 text-[0.55rem]">marginal</Badge>
                {/if}
              </td>
              <td class="text-right font-mono text-xs tabular-nums">{r.k}</td>
              <td class="text-right font-mono text-xs tabular-nums text-muted-foreground">{r.n}</td>
              <td
                class="text-right font-mono text-xs tabular-nums {r.fold >= 1
                  ? ''
                  : 'text-muted-foreground'}"
              >
                {r.fold === 0 ? '–' : r.fold.toFixed(2)}
              </td>
              <td
                class="whitespace-nowrap text-right font-mono text-xs tabular-nums {r.p <= 0.05
                  ? 'font-semibold'
                  : 'text-muted-foreground'}"
              >
                {r.p < 0.001 ? r.p.toExponential(1) : r.p.toFixed(3)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <div class="mt-2 text-[0.65rem] text-muted-foreground">
        k = genes in your list that have this term. n = size of your list (genes that were matched).
        K = genes with this term in the background. N = all genes in the background. p = chance of
        seeing k or more genes by luck (hypergeometric test). No correction for testing many terms
        is applied, because only one term is tested.
      </div>
    </CardContent>
  </Card>
{:else if loading}
  <div class="text-xs text-muted-foreground">Testing your saved lists...</div>
{/if}
