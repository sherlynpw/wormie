<script lang="ts" module>
  let openState = $state(false);
  export function openPalette() {
    openState = true;
  }
  export function closePalette() {
    openState = false;
  }
  export function paletteIsOpen() {
    return openState;
  }
</script>

<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import { Command as CommandPrimitive } from 'bits-ui';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { recents, type Recent } from '$lib/stores/recents.svelte';
  import { theme } from '$lib/stores/theme.svelte';
  import { selection } from '$lib/stores/selection.svelte';
  import { pwaInstall } from '$lib/stores/pwa-install.svelte';
  import Download from 'lucide-svelte/icons/download';
  import { presets, resolveListIds } from '$lib/stores/presets.svelte';
  import { suggestGenes, type SuggestRow } from '$lib/queries';
  import { openHelp } from '$lib/components/ShortcutsHelp.svelte';
  import { toast } from 'svelte-sonner';
  import { cn } from '$lib/utils';
  import { onMount } from 'svelte';
  import Sun from 'lucide-svelte/icons/sun';
  import Moon from 'lucide-svelte/icons/moon';
  import LayoutGrid from 'lucide-svelte/icons/layout-grid';
  import Table from 'lucide-svelte/icons/table';
  import FolderTree from 'lucide-svelte/icons/folder-tree';
  import Network from 'lucide-svelte/icons/network';
  import Brain from 'lucide-svelte/icons/brain';
  import Cable from 'lucide-svelte/icons/cable';
  import History from 'lucide-svelte/icons/history';
  import Trash from 'lucide-svelte/icons/trash';
  import Dna from 'lucide-svelte/icons/dna';
  import Keyboard from 'lucide-svelte/icons/keyboard';
  import Folder from 'lucide-svelte/icons/folder';
  import FileSearch from 'lucide-svelte/icons/file-search';
  import Info from 'lucide-svelte/icons/info';
  import BarChart from 'lucide-svelte/icons/bar-chart-3';
  import TrendingUp from 'lucide-svelte/icons/trending-up';
  import GitCompare from 'lucide-svelte/icons/git-compare';

  let query = $state('');
  let geneResults = $state<SuggestRow[]>([]);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const q = query.trim();
    if (searchTimer) clearTimeout(searchTimer);
    if (!q || q.length < 2) {
      geneResults = [];
      return;
    }
    searchTimer = setTimeout(async () => {
      // suggestGenes uses tier-ranked autocomplete (exact name/seq/wbgene, then
      // starts-with, then other_names, then bm25). searchGenes returns pure bm25
      // order, which mis-ranks common genes like "daf-2" behind FTS description hits.
      geneResults = await suggestGenes(q, 8);
    }, 150);
  });

  function navigate(url: string) {
    closePalette();
    goto(resolve(url as '/'));
  }

  function viewUrl(view: string): string {
    return `/?view=${view}`;
  }

  const VIEWS = [
    { key: 'cards', label: 'Cards', icon: LayoutGrid },
    { key: 'table', label: 'Table', icon: Table },
    { key: 'wormcat', label: 'WormCat', icon: FolderTree },
    { key: 'go', label: 'GO terms', icon: Network },
    { key: 'neuronal', label: 'Neuronal class', icon: Brain },
    { key: 'synaptogenesis', label: 'Synapse panel', icon: Cable },
  ] as const;

  function recentHref(r: Recent): string {
    if (r.kind === 'search') return `/?q=${encodeURIComponent(r.value)}`;
    if (r.kind === 'gene') return `/gene/${r.value}`;
    return `/go/${r.value}`;
  }

  function bind(open: boolean) {
    openState = open;
    if (!open) {
      query = '';
      geneResults = [];
    }
  }

  onMount(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'k') {
        e.preventDefault();
        openState = !openState;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<DialogPrimitive.Root bind:open={() => openState, bind}>
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
    />
    <DialogPrimitive.Content
      class="fixed left-1/2 top-[15%] z-50 w-full max-w-lg -translate-x-1/2 rounded-lg border bg-popover shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
    >
      <DialogPrimitive.Title class="sr-only">Command palette</DialogPrimitive.Title>
      <DialogPrimitive.Description class="sr-only"
        >Quick actions and navigation</DialogPrimitive.Description
      >
      <CommandPrimitive.Root class="flex flex-col" shouldFilter={false}>
        <div class="flex items-center gap-2 border-b px-3">
          <CommandPrimitive.Input
            bind:value={query}
            placeholder="Type a command, gene, or search..."
            class="flex h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd class="rounded border px-1 py-0.5 text-[0.6rem] text-muted-foreground">ESC</kbd>
        </div>
        <CommandPrimitive.List class="max-h-[60vh] overflow-y-auto p-1">
          <CommandPrimitive.Empty class="py-6 text-center text-sm text-muted-foreground">
            No results.
          </CommandPrimitive.Empty>

          {#if geneResults.length > 0}
            <CommandPrimitive.Group>
              <div
                class="px-2 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Genes
              </div>
              {#each geneResults as g (g.wormbase_gene)}
                <CommandPrimitive.Item
                  value="gene-{g.wormbase_gene}"
                  onSelect={() => {
                    recents.push('gene', g.wormbase_gene, g.gene_name ?? g.wormbase_gene);
                    navigate(`/gene/${g.wormbase_gene}`);
                  }}
                  class={cn(
                    'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                    'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
                  )}
                >
                  <Dna class="h-4 w-4 text-muted-foreground" />
                  <span class="font-medium">{g.gene_name ?? g.wormbase_gene}</span>
                  <span class="ml-auto font-mono text-xs text-muted-foreground">
                    {g.wormbase_gene}
                  </span>
                </CommandPrimitive.Item>
              {/each}
            </CommandPrimitive.Group>
          {/if}

          {#if query.trim().length >= 2}
            <CommandPrimitive.Item
              value="run-search"
              onSelect={() => {
                recents.push('search', query.trim(), query.trim());
                navigate(`/?q=${encodeURIComponent(query.trim())}`);
              }}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <History class="h-4 w-4 text-muted-foreground" />
              Search "{query.trim()}"
            </CommandPrimitive.Item>
          {/if}

          <CommandPrimitive.Group>
            <div
              class="px-2 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Views
            </div>
            {#each VIEWS as v (v.key)}
              {@const Icon = v.icon}
              <CommandPrimitive.Item
                value="view-{v.key}"
                onSelect={() => navigate(viewUrl(v.key))}
                class={cn(
                  'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                  'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
                )}
              >
                <Icon class="h-4 w-4 text-muted-foreground" />
                Go to {v.label}
              </CommandPrimitive.Item>
            {/each}
          </CommandPrimitive.Group>

          <CommandPrimitive.Group>
            <div
              class="px-2 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Tools
            </div>
            <CommandPrimitive.Item
              value="bulk-lookup gene name resolver ids"
              onSelect={() => navigate('/lookup')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <FileSearch class="h-4 w-4 text-muted-foreground" />
              Gene name resolver
            </CommandPrimitive.Item>
            <CommandPrimitive.Item
              value="enrichment over-representation ora"
              onSelect={() => navigate('/enrichment')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <BarChart class="h-4 w-4 text-muted-foreground" />
              Over-representation
            </CommandPrimitive.Item>
            <CommandPrimitive.Item
              value="read counting counts featurecounts bam"
              onSelect={() => navigate('/counts')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <TrendingUp class="h-4 w-4 text-muted-foreground" />
              Read counting
            </CommandPrimitive.Item>
            <CommandPrimitive.Item
              value="differential expression deseq2 de"
              onSelect={() => navigate('/de')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <TrendingUp class="h-4 w-4 text-muted-foreground" />
              Differential expression
            </CommandPrimitive.Item>
            <CommandPrimitive.Item
              value="contrast comparison compare contrasts de diff"
              onSelect={() => navigate('/de/diff')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <TrendingUp class="h-4 w-4 text-muted-foreground" />
              Contrast comparison
            </CommandPrimitive.Item>
            <CommandPrimitive.Item
              value="custom gene sets gmt"
              onSelect={() => navigate('/gmt')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <TrendingUp class="h-4 w-4 text-muted-foreground" />
              Custom gene sets
            </CommandPrimitive.Item>
            <CommandPrimitive.Item
              value="datasets saved inputs"
              onSelect={() => navigate('/datasets')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <Folder class="h-4 w-4 text-muted-foreground" />
              Datasets
            </CommandPrimitive.Item>
            <CommandPrimitive.Item
              value="marked genes bookmarks starred"
              onSelect={() => navigate('/bookmarks')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <Folder class="h-4 w-4 text-muted-foreground" />
              Marked genes
            </CommandPrimitive.Item>
            <CommandPrimitive.Item
              value="annotation overlap compare genes shared annotations"
              onSelect={() => navigate('/compare')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <GitCompare class="h-4 w-4 text-muted-foreground" />
              Annotation overlap
            </CommandPrimitive.Item>
            <CommandPrimitive.Item
              value="gene overlap compare gene lists venn membership"
              onSelect={() => navigate('/compare/lists')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <GitCompare class="h-4 w-4 text-muted-foreground" />
              Gene overlap
            </CommandPrimitive.Item>
            <CommandPrimitive.Item
              value="enrichment overlap upset terms"
              onSelect={() => navigate('/enrichment/overlap')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <BarChart class="h-4 w-4 text-muted-foreground" />
              Enrichment overlap
            </CommandPrimitive.Item>
            <CommandPrimitive.Item
              value="leading-edge overlap gsea upset genes"
              onSelect={() => navigate('/gsea/overlap')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <BarChart class="h-4 w-4 text-muted-foreground" />
              Leading-edge overlap
            </CommandPrimitive.Item>
            <CommandPrimitive.Item
              value="ranked-list consensus gsea intersect recurring terms saved runs bundles"
              onSelect={() => navigate('/gsea/intersect')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <BarChart class="h-4 w-4 text-muted-foreground" />
              Ranked-list consensus
            </CommandPrimitive.Item>
            <CommandPrimitive.Item
              value="gsea preranked ranked-list enrichment"
              onSelect={() => navigate('/gsea')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <TrendingUp class="h-4 w-4 text-muted-foreground" />
              Ranked-list enrichment
            </CommandPrimitive.Item>
            <CommandPrimitive.Item
              value="ssgsea single-sample per-sample set scores"
              onSelect={() => navigate('/ssgsea')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <TrendingUp class="h-4 w-4 text-muted-foreground" />
              Per-sample set scores
            </CommandPrimitive.Item>
            <CommandPrimitive.Item
              value="nta network topology connectivity"
              onSelect={() => navigate('/nta')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <TrendingUp class="h-4 w-4 text-muted-foreground" />
              Network connectivity
            </CommandPrimitive.Item>
            <CommandPrimitive.Item
              value="cell-type"
              onSelect={() => navigate('/cell-type')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <Brain class="h-4 w-4 text-muted-foreground" />
              Neurons (CeNGEN)
            </CommandPrimitive.Item>
            <CommandPrimitive.Item
              value="about"
              onSelect={() => navigate('/about')}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <Info class="h-4 w-4 text-muted-foreground" />
              Data sources & credits
            </CommandPrimitive.Item>
          </CommandPrimitive.Group>

          <CommandPrimitive.Group>
            <div
              class="px-2 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Actions
            </div>
            {#if pwaInstall.available}
              <CommandPrimitive.Item
                value="install-app"
                onSelect={async () => {
                  closePalette();
                  await pwaInstall.install();
                }}
                class={cn(
                  'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                  'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
                )}
              >
                <Download class="h-4 w-4 text-muted-foreground" />
                Install app
              </CommandPrimitive.Item>
            {/if}
            <CommandPrimitive.Item
              value="toggle-theme"
              onSelect={() => {
                theme.toggle();
                closePalette();
              }}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              {#if theme.mode === 'dark'}
                <Sun class="h-4 w-4 text-muted-foreground" />
                Switch to light mode
              {:else}
                <Moon class="h-4 w-4 text-muted-foreground" />
                Switch to dark mode
              {/if}
            </CommandPrimitive.Item>
            {#if selection.ids.length > 0}
              <CommandPrimitive.Item
                value="clear-selection"
                onSelect={() => {
                  selection.clear();
                  closePalette();
                }}
                class={cn(
                  'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                  'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
                )}
              >
                <Trash class="h-4 w-4 text-muted-foreground" />
                Clear selection ({selection.ids.length})
              </CommandPrimitive.Item>
            {/if}
            <CommandPrimitive.Item
              value="keyboard-shortcuts"
              onSelect={() => {
                closePalette();
                openHelp();
              }}
              class={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
              )}
            >
              <Keyboard class="h-4 w-4 text-muted-foreground" />
              Keyboard shortcuts
              <kbd class="ml-auto rounded border px-1 py-0.5 text-[0.6rem] text-muted-foreground">
                ?
              </kbd>
            </CommandPrimitive.Item>
          </CommandPrimitive.Group>

          {#if presets.items.length > 0}
            <CommandPrimitive.Group>
              <div
                class="px-2 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Saved gene lists
              </div>
              {#each presets.items as p (p.id)}
                <CommandPrimitive.Item
                  value="preset-{p.id}"
                  onSelect={async () => {
                    closePalette();
                    const ids = await resolveListIds(p.ids);
                    selection.set(ids);
                    toast.success('Selection loaded', {
                      description: `${p.name} (${ids.length} gene${ids.length === 1 ? '' : 's'})`,
                    });
                  }}
                  class={cn(
                    'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                    'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
                  )}
                >
                  <Folder class="h-4 w-4 text-muted-foreground" />
                  Load: {p.name}
                  <span class="ml-auto text-xs tabular-nums text-muted-foreground">
                    {p.ids.length}
                  </span>
                </CommandPrimitive.Item>
              {/each}
            </CommandPrimitive.Group>
          {/if}

          {#if recents.items.length > 0}
            <CommandPrimitive.Group>
              <div
                class="px-2 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Recent
              </div>
              {#each recents.items as r (r.kind + ':' + r.value)}
                <CommandPrimitive.Item
                  value="recent-{r.kind}-{r.value}"
                  onSelect={() => navigate(recentHref(r))}
                  class={cn(
                    'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                    'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
                  )}
                >
                  <History class="h-4 w-4 text-muted-foreground" />
                  <span>{r.label}</span>
                  <span class="ml-auto text-[0.65rem] uppercase text-muted-foreground"
                    >{r.kind}</span
                  >
                </CommandPrimitive.Item>
              {/each}
            </CommandPrimitive.Group>
          {/if}
        </CommandPrimitive.List>
      </CommandPrimitive.Root>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
