<script lang="ts">
  import { untrack } from 'svelte';
  import { getWormcatTree, getWormcatGenes, type CatCount, type CatGene } from '$lib/queries';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import ChevronsDown from 'lucide-svelte/icons/chevrons-down';
  import ChevronsUp from 'lucide-svelte/icons/chevrons-up';
  import GenePill from '$lib/components/GenePill.svelte';

  let { term }: { term: string } = $props();

  let tree = $state<CatCount[]>([]);
  let loading = $state(true);

  let expanded = $state<Record<string, boolean>>({});
  let leafGenes = $state<Record<string, CatGene[]>>({});

  let loadToken = 0;

  $effect(() => {
    const t = term;
    untrack(() => load(t));
  });

  async function load(t: string) {
    const my = ++loadToken;
    loading = true;
    const result = await getWormcatTree(t);
    if (my !== loadToken) return;
    tree = result;
    if (t.trim()) {
      expanded = Object.fromEntries(grouped.keys.map((k) => [k, true]));
    } else {
      expanded = {};
    }
    leafGenes = {};
    loading = false;
  }

  type Cat3Node = { cat3: string | null; n: number };
  type Cat2Node = { cat2: string | null; n: number; cat3s: Cat3Node[] };
  type Cat1Node = { cat1: string; n: number; cat2s: Cat2Node[] };

  const grouped = $derived.by<{ nodes: Cat1Node[]; keys: string[] }>(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<string, Cat1Node>();
    for (const r of tree) {
      let n1 = map.get(r.category_1);
      if (!n1) {
        n1 = { cat1: r.category_1, n: 0, cat2s: [] };
        map.set(r.category_1, n1);
      }
      n1.n += r.n;
      let n2 = n1.cat2s.find((c) => c.cat2 === r.category_2);
      if (!n2) {
        n2 = { cat2: r.category_2, n: 0, cat3s: [] };
        n1.cat2s.push(n2);
      }
      n2.n += r.n;
      n2.cat3s.push({ cat3: r.category_3, n: r.n });
    }
    const nodes = Array.from(map.values()).sort((a, b) => a.cat1.localeCompare(b.cat1));
    return { nodes, keys: nodes.map((n) => `1:${n.cat1}`) };
  });

  async function toggleLeaf(key: string, cat1: string, cat2: string | null, cat3: string | null) {
    expanded[key] = !expanded[key];
    if (expanded[key] && !leafGenes[key]) {
      leafGenes[key] = await getWormcatGenes(term, cat1, cat2, cat3);
    }
  }

  function toggle(key: string) {
    expanded[key] = !expanded[key];
  }

  async function expandAll() {
    const next: Record<string, boolean> = {};
    const leafTasks: Promise<unknown>[] = [];
    for (const n1 of grouped.nodes) {
      next[`1:${n1.cat1}`] = true;
      for (const n2 of n1.cat2s) {
        next[`2:${n1.cat1}|${n2.cat2}`] = true;
        for (const n3 of n2.cat3s) {
          const k3 = `3:${n1.cat1}|${n2.cat2}|${n3.cat3}`;
          next[k3] = true;
          if (!leafGenes[k3]) {
            leafTasks.push(
              getWormcatGenes(term, n1.cat1, n2.cat2, n3.cat3).then((r) => {
                leafGenes[k3] = r;
              }),
            );
          }
        }
      }
    }
    expanded = next;
    await Promise.all(leafTasks);
  }

  function collapseAll() {
    expanded = {};
  }
</script>

{#if loading}
  <div class="py-6 text-sm text-muted-foreground">Loading WormCat tree...</div>
{:else if grouped.nodes.length === 0}
  <div class="py-10 text-center text-sm text-muted-foreground">No matching categories.</div>
{:else}
  <div class="mb-2 flex gap-1">
    <Button variant="outline" size="sm" onclick={expandAll}>
      <ChevronsDown class="h-3 w-3" />
      Expand all
    </Button>
    <Button variant="outline" size="sm" onclick={collapseAll}>
      <ChevronsUp class="h-3 w-3" />
      Collapse all
    </Button>
  </div>
  <div class="divide-y rounded-lg border bg-card">
    {#each grouped.nodes as n1 (n1.cat1)}
      {@const k1 = `1:${n1.cat1}`}
      <div>
        <button
          type="button"
          onclick={() => toggle(k1)}
          class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
        >
          <ChevronRight
            class={cn(
              'h-4 w-4 text-muted-foreground transition-transform',
              expanded[k1] && 'rotate-90',
            )}
          />
          <span class="font-semibold">{n1.cat1}</span>
          <Badge variant="muted" class="ml-auto tabular-nums">{n1.n.toLocaleString()}</Badge>
        </button>
        {#if expanded[k1]}
          <div class="border-t bg-background">
            {#each n1.cat2s as n2 (n2.cat2 ?? '')}
              {@const k2 = `2:${n1.cat1}|${n2.cat2}`}
              <div class="pl-8">
                <button
                  type="button"
                  onclick={() => toggle(k2)}
                  class="flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm transition-colors hover:bg-muted/50"
                >
                  <ChevronRight
                    class={cn(
                      'h-3.5 w-3.5 text-muted-foreground transition-transform',
                      expanded[k2] && 'rotate-90',
                    )}
                  />
                  <span>{n2.cat2 ?? '(unset)'}</span>
                  <Badge variant="muted" class="ml-auto tabular-nums">{n2.n.toLocaleString()}</Badge
                  >
                </button>
                {#if expanded[k2]}
                  <div class="ml-1.5 border-l pl-6">
                    {#each n2.cat3s as n3 (n3.cat3 ?? '')}
                      {@const k3 = `3:${n1.cat1}|${n2.cat2}|${n3.cat3}`}
                      <div>
                        <button
                          type="button"
                          onclick={() => toggleLeaf(k3, n1.cat1, n2.cat2, n3.cat3)}
                          class="flex w-full items-center gap-2 py-1 pr-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50"
                        >
                          <ChevronRight
                            class={cn(
                              'h-3.5 w-3.5 transition-transform',
                              expanded[k3] && 'rotate-90',
                            )}
                          />
                          <span>{n3.cat3 ?? '(unset)'}</span>
                          <Badge variant="outline" class="ml-auto tabular-nums">
                            {n3.n.toLocaleString()}
                          </Badge>
                        </button>
                        {#if expanded[k3]}
                          <div class="flex flex-wrap gap-1 py-1.5 pl-6">
                            {#if leafGenes[k3]}
                              {#each leafGenes[k3] as g, i (`${g.wormbase_gene}:${i}`)}
                                <GenePill id={g.wormbase_gene} name={g.gene_name} />
                              {/each}
                            {:else}
                              <span class="text-xs text-muted-foreground">Loading...</span>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
