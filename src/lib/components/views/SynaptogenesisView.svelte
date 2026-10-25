<script lang="ts">
  import { fmtTitle } from '$lib/format';
  import { untrack, type Snippet } from 'svelte';
  import {
    getSynaptogenesisTree,
    getSynaptogenesisGenes,
    type SynaptoCount,
    type SynaptoGene,
  } from '$lib/queries';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import ChevronsDown from 'lucide-svelte/icons/chevrons-down';
  import ChevronsUp from 'lucide-svelte/icons/chevrons-up';
  import GenePill from '$lib/components/GenePill.svelte';
  import {
    SYNAPTOGENESIS_REFERENCES,
    classById,
    refById,
    doiHref,
    prettySubclass,
    refShortLabel,
  } from '$lib/synaptogenesis-references';

  let { term, meta }: { term: string; meta?: Snippet } = $props();

  let tree = $state<SynaptoCount[]>([]);
  let loading = $state(true);
  let expanded = $state<Record<string, boolean>>({});
  let leafGenes = $state<Record<string, SynaptoGene[]>>({});

  let loadToken = 0;

  $effect(() => {
    const t = term;
    untrack(() => load(t));
  });

  async function load(t: string) {
    const my = ++loadToken;
    loading = true;
    const result = await getSynaptogenesisTree(t);
    if (my !== loadToken) return;
    tree = result;
    if (t.trim()) {
      expanded = Object.fromEntries(grouped.map((g) => [`1:${g.cls}`, true]));
    } else {
      expanded = {};
    }
    leafGenes = {};
    loading = false;
  }

  type SubclassNode = { subclass: string | null; n: number };
  type ClassNode = { cls: string; n: number; subclasses: SubclassNode[] };

  const grouped = $derived.by<ClassNode[]>(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<string, ClassNode>();
    for (const r of tree) {
      let node = map.get(r.class);
      if (!node) {
        node = { cls: r.class, n: 0, subclasses: [] };
        map.set(r.class, node);
      }
      node.subclasses.push({ subclass: r.subclass, n: r.n });
      node.n += r.n;
    }
    return Array.from(map.values()).sort((a, b) => a.cls.localeCompare(b.cls));
  });

  async function toggleLeaf(key: string, cls: string, subclass: string | null) {
    expanded[key] = !expanded[key];
    if (expanded[key] && !leafGenes[key]) {
      leafGenes[key] = await getSynaptogenesisGenes(term, cls, subclass);
    }
  }

  function toggle(key: string) {
    expanded[key] = !expanded[key];
  }

  async function expandAll() {
    const next: Record<string, boolean> = {};
    const leafTasks: Promise<unknown>[] = [];
    for (const c of grouped) {
      next[`1:${c.cls}`] = true;
      for (const sc of c.subclasses) {
        const k2 = `2:${c.cls}|${sc.subclass}`;
        next[k2] = true;
        if (!leafGenes[k2]) {
          leafTasks.push(
            getSynaptogenesisGenes(term, c.cls, sc.subclass).then((r) => {
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

  let showReferences = $state(false);
</script>

{#if loading}
  <div class="py-6 text-sm text-muted-foreground">Loading synapse panel...</div>
{:else if grouped.length === 0}
  <div class="py-10 text-center text-sm text-muted-foreground">No matching panel entries.</div>
{:else}
  <div class="space-y-3">
    <p class="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      The Richardson Lab curated this panel from the literature. Each assignment was checked against
      the cited references, but the panel is not complete and may contain errors. It is one example
      of a lab-curated gene list in this tool. Corrections and suggestions for more genes are
      welcome.
    </p>
    <div class="flex flex-wrap items-center gap-1">
      <Button variant="outline" size="sm" onclick={expandAll}>
        <ChevronsDown class="h-3 w-3" />
        Expand all
      </Button>
      <Button variant="outline" size="sm" onclick={collapseAll}>
        <ChevronsUp class="h-3 w-3" />
        Collapse all
      </Button>
      <Button variant="ghost" size="sm" onclick={() => (showReferences = !showReferences)}>
        {showReferences ? 'Hide' : 'Show'} references ({SYNAPTOGENESIS_REFERENCES.length})
      </Button>
      {#if meta}
        <div class="ml-auto">{@render meta()}</div>
      {/if}
    </div>

    <div class="divide-y rounded-lg border bg-card">
      {#each grouped as c (c.cls)}
        {@const k1 = `1:${c.cls}`}
        {@const meta = classById(c.cls)}
        <div>
          <button
            type="button"
            onclick={() => toggle(k1)}
            class="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
          >
            <ChevronRight
              class={cn(
                'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                expanded[k1] && 'rotate-90',
              )}
            />
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-baseline gap-2">
                <span class="font-semibold">{meta?.label ?? c.cls}</span>
                {#if meta?.note}
                  <Badge variant="outline" class="text-[0.6rem]">{meta.note}</Badge>
                {/if}
              </div>
              {#if meta?.description}
                <div class="mt-0.5 text-xs text-muted-foreground">{meta.description}</div>
              {/if}
              {#if meta?.refIds && meta.refIds.length > 0}
                <div class="mt-1 flex flex-wrap gap-1">
                  {#each meta.refIds as rid (rid)}
                    {@const r = refById(rid)}
                    {#if r}
                      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
                      <a
                        href={doiHref(r.doi)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`${r.authors} (${r.year}): ${fmtTitle(r.title)}. ${r.journal}`}
                        class="inline-block rounded border bg-background px-1.5 py-0.5 font-mono text-[0.6rem] text-muted-foreground hover:bg-accent"
                      >
                        {rid}
                      </a>
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
            <Badge variant="muted" class="ml-auto shrink-0 tabular-nums">
              {c.n.toLocaleString()}
            </Badge>
          </button>

          {#if expanded[k1]}
            <div class="border-t bg-background">
              {#each c.subclasses as sc (sc.subclass ?? '')}
                {@const k2 = `2:${c.cls}|${sc.subclass}`}
                <div class="pl-8">
                  <button
                    type="button"
                    onclick={() => toggleLeaf(k2, c.cls, sc.subclass)}
                    class="flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm transition-colors hover:bg-muted/50"
                  >
                    <ChevronRight
                      class={cn(
                        'h-3.5 w-3.5 text-muted-foreground transition-transform',
                        expanded[k2] && 'rotate-90',
                      )}
                    />
                    <span>{prettySubclass(sc.subclass) || '(no subclass)'}</span>
                    <Badge variant="outline" class="ml-auto tabular-nums">
                      {sc.n.toLocaleString()}
                    </Badge>
                  </button>
                  {#if expanded[k2]}
                    <div class="space-y-2 py-1.5 pl-6">
                      {#if leafGenes[k2]}
                        <div class="space-y-1.5">
                          {#each leafGenes[k2] as g, i (`${g.wormbase_gene}:${i}`)}
                            <div class="flex flex-wrap items-center gap-1.5">
                              <GenePill id={g.wormbase_gene} name={g.gene_name} />
                              {#if g.notes}
                                <span class="text-xs text-muted-foreground">({g.notes})</span>
                              {/if}
                              {#each (g.refs ?? '').split(';').filter(Boolean) as rid (rid)}
                                {@const r = refById(rid)}
                                {#if r}
                                  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
                                  <a
                                    href={doiHref(r.doi)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={`${r.authors} (${r.year}): ${fmtTitle(r.title)}. ${r.journal}`}
                                    class="inline-block rounded border bg-background px-1.5 py-0.5 text-[0.65rem] text-muted-foreground hover:bg-accent"
                                  >
                                    {refShortLabel(r)}
                                  </a>
                                {/if}
                              {/each}
                            </div>
                          {/each}
                        </div>
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

    {#if showReferences}
      <div class="mt-4 rounded-md border bg-card p-3">
        <div
          class="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          References ({SYNAPTOGENESIS_REFERENCES.length})
        </div>
        <ol class="space-y-2 text-xs">
          {#each SYNAPTOGENESIS_REFERENCES as r (r.id)}
            <li class="leading-snug">
              <span class="font-mono text-muted-foreground">[{r.id}]</span>
              <span class="ml-1">{r.authors} ({r.year}).</span>
              <span class="font-semibold">{fmtTitle(r.title)}.</span>
              <span class="italic">{r.journal}.</span>
              <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
              <a
                href={doiHref(r.doi)}
                target="_blank"
                rel="noopener noreferrer"
                class="ml-1 text-primary hover:underline"
              >
                doi:{r.doi}
              </a>
            </li>
          {/each}
        </ol>
      </div>
    {/if}
  </div>
{/if}
