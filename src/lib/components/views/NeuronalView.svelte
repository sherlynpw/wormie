<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import {
    getNeuronalTree,
    getNeuronalGenes,
    type NeuronalCount,
    type CatGene,
  } from '$lib/queries';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import ChevronsDown from 'lucide-svelte/icons/chevrons-down';
  import ChevronsUp from 'lucide-svelte/icons/chevrons-up';
  import GenePill from '$lib/components/GenePill.svelte';

  let { term, meta }: { term: string; meta?: Snippet } = $props();

  let tree = $state<NeuronalCount[]>([]);
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
    const result = await getNeuronalTree(t);
    if (my !== loadToken) return;
    tree = result;
    if (t.trim()) {
      expanded = Object.fromEntries(grouped.map((g) => [`1:${g.supercat}`, true]));
    } else {
      expanded = {};
    }
    leafGenes = {};
    loading = false;
  }

  type CatNode = { cat: string | null; n: number };
  type SupercatNode = { supercat: string; n: number; cats: CatNode[] };

  const grouped = $derived.by<SupercatNode[]>(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<string, SupercatNode>();
    for (const r of tree) {
      let node = map.get(r.supercategory);
      if (!node) {
        node = { supercat: r.supercategory, n: 0, cats: [] };
        map.set(r.supercategory, node);
      }
      node.cats.push({ cat: r.category, n: r.n });
      node.n += r.n;
    }
    return Array.from(map.values()).sort((a, b) => a.supercat.localeCompare(b.supercat));
  });

  async function toggleLeaf(key: string, supercat: string, cat: string | null) {
    expanded[key] = !expanded[key];
    if (expanded[key] && !leafGenes[key]) {
      leafGenes[key] = await getNeuronalGenes(term, supercat, cat);
    }
  }

  function toggle(key: string) {
    expanded[key] = !expanded[key];
  }

  async function expandAll() {
    const next: Record<string, boolean> = {};
    const leafTasks: Promise<unknown>[] = [];
    for (const sc of grouped) {
      next[`1:${sc.supercat}`] = true;
      for (const c of sc.cats) {
        const k2 = `2:${sc.supercat}|${c.cat}`;
        next[k2] = true;
        if (!leafGenes[k2]) {
          leafTasks.push(
            getNeuronalGenes(term, sc.supercat, c.cat).then((r) => {
              leafGenes[k2] = r;
            }),
          );
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
  <div class="py-6 text-sm text-muted-foreground">Loading neuronal genes...</div>
{:else if grouped.length === 0}
  <div class="py-10 text-center text-sm text-muted-foreground">No matching categories.</div>
{:else}
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-1">
      <Button variant="outline" size="sm" onclick={expandAll}>
        <ChevronsDown class="h-3 w-3" />
        Expand all
      </Button>
      <Button variant="outline" size="sm" onclick={collapseAll}>
        <ChevronsUp class="h-3 w-3" />
        Collapse all
      </Button>
      {#if meta}
        <div class="ml-auto">{@render meta()}</div>
      {/if}
    </div>
    <div class="divide-y rounded-lg border bg-card">
      {#each grouped as sc (sc.supercat)}
        {@const k1 = `1:${sc.supercat}`}
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
            <span class="font-semibold">{sc.supercat}</span>
            <Badge variant="muted" class="ml-auto tabular-nums">{sc.n.toLocaleString()}</Badge>
          </button>
          {#if expanded[k1]}
            <div class="border-t bg-background">
              {#each sc.cats as c (c.cat ?? '')}
                {@const k2 = `2:${sc.supercat}|${c.cat}`}
                <div class="pl-8">
                  <button
                    type="button"
                    onclick={() => toggleLeaf(k2, sc.supercat, c.cat)}
                    class="flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm transition-colors hover:bg-muted/50"
                  >
                    <ChevronRight
                      class={cn(
                        'h-3.5 w-3.5 text-muted-foreground transition-transform',
                        expanded[k2] && 'rotate-90',
                      )}
                    />
                    <span>{c.cat ?? '(unset)'}</span>
                    <Badge variant="outline" class="ml-auto tabular-nums">
                      {c.n.toLocaleString()}
                    </Badge>
                  </button>
                  {#if expanded[k2]}
                    <div class="flex flex-wrap gap-1 py-1.5 pl-6">
                      {#if leafGenes[k2]}
                        {#each leafGenes[k2] as g, i (`${g.wormbase_gene}:${i}`)}
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
  </div>
{/if}
