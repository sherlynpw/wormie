<script lang="ts">
  import { untrack } from 'svelte';
  import type { OntologyNode } from '$lib/queries';
  import { Badge } from '$lib/components/ui/badge';
  import { Input } from '$lib/components/ui/input';
  import { cn } from '$lib/utils';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';

  let {
    loadRoots,
    loadChildren,
    search,
    href,
    placeholder = 'Filter by name...',
    noun = 'terms',
  }: {
    loadRoots: () => Promise<OntologyNode[]>;
    loadChildren: (id: string) => Promise<OntologyNode[]>;
    search: (term: string) => Promise<OntologyNode[]>;
    href: (id: string) => string;
    placeholder?: string;
    noun?: string;
  } = $props();

  let roots = $state<OntologyNode[] | null>(null);
  // Children by parent id and expansion by path, since a term can sit under several parents.
  let children = $state<Record<string, OntologyNode[]>>({});
  let expanded = $state<Record<string, boolean>>({});
  let filter = $state('');
  let results = $state<OntologyNode[]>([]);
  let searching = $state(false);
  let token = 0;

  // Roots start open so the first level of the tree is visible without a click.
  $effect(() => {
    untrack(async () => {
      const r = await loadRoots();
      const kids = await Promise.all(
        r.map((n) => (n.n_children > 0 ? loadChildren(n.id) : Promise.resolve([]))),
      );
      r.forEach((n, i) => {
        children[n.id] = kids[i];
        expanded[`>${n.id}`] = n.n_children > 0;
      });
      roots = r;
    });
  });

  $effect(() => {
    const f = filter.trim();
    const my = ++token;
    if (!f) {
      results = [];
      searching = false;
      return;
    }
    searching = true;
    const timer = setTimeout(async () => {
      const r = await search(f);
      if (my !== token) return;
      results = r;
      searching = false;
    }, 200);
    return () => clearTimeout(timer);
  });

  async function toggle(path: string, node: OntologyNode) {
    expanded[path] = !expanded[path];
    if (expanded[path] && node.n_children > 0 && !children[node.id]) {
      children[node.id] = await loadChildren(node.id);
    }
  }
</script>

{#snippet label(n: OntologyNode)}
  <a href={href(n.id)} class="truncate hover:text-primary hover:underline">{n.name}</a>
  <span class="shrink-0 font-mono text-[0.65rem] text-muted-foreground">{n.id}</span>
  {#if n.rel_type === 'part_of'}
    <span class="shrink-0 text-[0.65rem] italic text-muted-foreground">part of</span>
  {/if}
  <Badge
    variant="muted"
    class="ml-auto shrink-0 tabular-nums"
    title={`${n.n_genes.toLocaleString()} genes annotated to this term or a more specific one`}
  >
    {n.n_genes.toLocaleString()}
  </Badge>
{/snippet}

{#snippet row(n: OntologyNode, parentPath: string, depth: number)}
  {@const path = `${parentPath}>${n.id}`}
  {@const open = expanded[path]}
  <div>
    <div
      class="flex w-full items-center gap-2 py-1.5 pr-3 text-sm transition-colors hover:bg-muted/50"
      style="padding-left: {0.75 + depth * 1.5}rem"
    >
      <button
        type="button"
        class={cn(
          'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded transition-transform',
          n.n_children === 0 && 'opacity-20',
          open && 'rotate-90',
        )}
        disabled={n.n_children === 0}
        onclick={() => toggle(path, n)}
        aria-label={open ? `Collapse ${n.name}` : `Expand ${n.name}`}
        aria-expanded={open}
      >
        <ChevronRight class="h-4 w-4 text-muted-foreground" />
      </button>
      {@render label(n)}
    </div>
    {#if open}
      {#each children[n.id] ?? [] as c (c.id)}
        {@render row(c, path, depth + 1)}
      {/each}
    {/if}
  </div>
{/snippet}

<div class="space-y-3">
  <Input bind:value={filter} {placeholder} class="max-w-md" />

  {#if filter.trim()}
    <div class="text-xs text-muted-foreground">
      {searching ? 'Searching...' : `${results.length} ${noun} matching "${filter.trim()}"`}
    </div>
    <div class="divide-y rounded-lg border bg-card">
      {#each results as n (n.id)}
        <div class="flex items-center gap-2 px-3 py-1.5 text-sm">{@render label(n)}</div>
      {:else}
        {#if !searching}
          <div class="py-10 text-center text-sm text-muted-foreground">No matching {noun}.</div>
        {/if}
      {/each}
    </div>
  {:else if roots === null}
    <div class="py-6 text-sm text-muted-foreground">Loading...</div>
  {:else}
    <div class="divide-y rounded-lg border bg-card">
      {#each roots as n (n.id)}
        {@render row(n, '', 0)}
      {:else}
        <div class="py-10 text-center text-sm text-muted-foreground">No {noun} found.</div>
      {/each}
    </div>
  {/if}
</div>
