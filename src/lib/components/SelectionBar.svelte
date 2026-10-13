<script lang="ts">
  import { selection } from '$lib/stores/selection.svelte';
  import { presets, resolveListIds } from '$lib/stores/presets.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import {
    exportTsv,
    exportCsv,
    exportJson,
    exportWBList,
    exportGeneNames,
    exportGmt,
    clipboardWBList,
    clipboardGeneNames,
    clipboardTsv,
  } from '$lib/exports';
  import { buildIdsQuery } from '$lib/share';
  import Network from 'lucide-svelte/icons/network';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { toast } from 'svelte-sonner';
  import X from 'lucide-svelte/icons/x';
  import Download from 'lucide-svelte/icons/download';
  import Copy from 'lucide-svelte/icons/copy';
  import Save from 'lucide-svelte/icons/save';
  import Folder from 'lucide-svelte/icons/folder';
  import Trash from 'lucide-svelte/icons/trash';
  import GitCompare from 'lucide-svelte/icons/git-compare';
  import BarChart from 'lucide-svelte/icons/bar-chart-3';
  import FileSearch from 'lucide-svelte/icons/file-search';
  import Sigma from 'lucide-svelte/icons/sigma';
  import Send from 'lucide-svelte/icons/send';
  import ChevronUp from 'lucide-svelte/icons/chevron-up';
  import SelectionSummary from '$lib/components/SelectionSummary.svelte';

  let busy = $state(false);
  let summaryOpen = $state(false);
  let presetUiOpen = $state(false);
  let presetName = $state('');
  let sendOpen = $state(false);
  let copyOpen = $state(false);
  let barRef: HTMLDivElement | null = $state(null);

  // One outside-click listener closes whichever menu is open; the bar is a
  // single island, so containment against the wrapper covers both menus.
  $effect(() => {
    if (!sendOpen && !copyOpen) return;
    const onDown = (e: MouseEvent) => {
      if (barRef && !barRef.contains(e.target as Node)) {
        sendOpen = false;
        copyOpen = false;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        sendOpen = false;
        copyOpen = false;
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  });

  async function run(label: string, fn: () => Promise<void> | void) {
    busy = true;
    try {
      await fn();
      toast.success(`${label} exported`, {
        description: `${selection.ids.length} gene${selection.ids.length === 1 ? '' : 's'} saved.`,
      });
    } catch (e) {
      toast.error(`${label} failed`, { description: String(e) });
    } finally {
      busy = false;
    }
  }

  async function copy(label: string, fn: () => Promise<number>) {
    busy = true;
    try {
      const n = await fn();
      toast.success('Copied to clipboard', {
        description: `${n} item${n === 1 ? '' : 's'} as ${label}`,
      });
    } catch (e) {
      toast.error('Copy failed', { description: String(e) });
    } finally {
      busy = false;
    }
  }

  async function sendTo(path: string) {
    sendOpen = false;
    const q = await buildIdsQuery(selection.ids);
    goto(resolve(`${path}?${q}` as '/'));
  }

  function copyItem(label: string, fn: () => Promise<number>) {
    copyOpen = false;
    void copy(label, fn);
  }

  function exportItem(label: string, fn: () => Promise<void> | void) {
    copyOpen = false;
    void run(label, fn);
  }

  const genes = (n: number) => `${n} gene${n === 1 ? '' : 's'}`;

  // Clearing can throw away a hand-built selection, so it always offers an undo.
  function clearSelection() {
    const prev = [...selection.ids];
    selection.clear();
    toast('Selection cleared', {
      description: genes(prev.length),
      action: { label: 'Undo', onClick: () => selection.set(prev) },
    });
  }

  // Saving marks the set as done, so the selection is released for the next one.
  async function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    const prev = [...selection.ids];
    try {
      const p = await presets.save(name, prev);
      selection.clear();
      toast.success('Selection saved and cleared', {
        description: `${p.name} (${genes(p.ids.length)}). Find it under Datasets or in any "From saved list" picker.`,
        action: { label: 'Undo clear', onClick: () => selection.set(prev) },
      });
      presetName = '';
      presetUiOpen = false;
    } catch (e) {
      toast.error('Could not save', { description: String(e) });
    }
  }

  async function loadPreset(id: string) {
    const p = presets.get(id);
    if (!p) return;
    const ids = await resolveListIds(p.ids);
    if (ids.length === 0) {
      toast.error('No recognized genes in this list', { description: p.name });
      return;
    }
    selection.set(ids);
    toast.success('Selection loaded', { description: `${p.name} (${genes(ids.length)})` });
    presetUiOpen = false;
  }

  async function deletePreset(id: string, name: string) {
    if (!confirm(`Delete the saved list "${name}"?`)) return;
    await presets.remove(id);
    toast.success('Saved list deleted', { description: name });
  }

  const tooFew = $derived(selection.ids.length < 2);

  const menuItem =
    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50';
  const menuHeading =
    'px-2 pb-1 pt-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground';
</script>

{#if selection.ids.length > 0 || presetUiOpen}
  <div class="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4">
    <div
      bind:this={barRef}
      class="pointer-events-auto flex w-fit max-w-5xl flex-col rounded-lg border bg-card shadow-lg"
    >
      {#if presetUiOpen}
        <div class="space-y-2 border-b p-3">
          <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Saved gene lists
          </div>
          <form
            onsubmit={(e) => {
              e.preventDefault();
              savePreset();
            }}
            class="flex gap-2"
          >
            <Input
              bind:value={presetName}
              placeholder="Name this selection..."
              autofocus
              class="h-8 text-xs"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!presetName.trim() || selection.ids.length === 0}
            >
              <Save class="h-3 w-3" />
              Save {selection.ids.length}
            </Button>
          </form>
          {#if presets.items.length > 0}
            <div class="max-h-48 space-y-0.5 overflow-y-auto">
              {#each presets.items as p (p.id)}
                <div class="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50">
                  <button
                    type="button"
                    onclick={() => loadPreset(p.id)}
                    class="flex flex-1 items-center gap-2 text-left"
                  >
                    <Folder class="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span class="truncate">{p.name}</span>
                    <span class="text-xs tabular-nums text-muted-foreground">
                      {p.ids.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onclick={() => deletePreset(p.id, p.name)}
                    class="text-muted-foreground hover:text-destructive"
                    title="Delete saved list"
                  >
                    <Trash class="h-3 w-3" />
                  </button>
                </div>
              {/each}
            </div>
          {:else}
            <div class="text-xs italic text-muted-foreground">No saved gene lists yet.</div>
          {/if}
        </div>
      {/if}
      <div class="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          onclick={() => (summaryOpen = true)}
          class="rounded px-1.5 py-0.5 text-sm transition-colors hover:bg-muted/50"
          title="What is in this selection? Top WormCat, GO, phenotypes, diseases, tissues"
        >
          <span class="font-semibold tabular-nums">{selection.ids.length}</span>
          <span class="text-muted-foreground"> selected</span>
        </button>
        <div class="mx-1 h-5 w-px bg-border"></div>

        <Button
          variant="outline"
          size="sm"
          disabled={tooFew}
          title={tooFew ? 'Needs at least 2 genes' : 'Test this selection for enriched annotations'}
          onclick={() => sendTo('/enrichment')}
        >
          <BarChart class="h-3 w-3" />
          Over-representation
        </Button>

        <div class="relative">
          <Button
            variant="outline"
            size="sm"
            onclick={() => {
              copyOpen = false;
              sendOpen = !sendOpen;
            }}
          >
            <Send class="h-3 w-3" />
            Send to
            <ChevronUp class="h-3 w-3 text-muted-foreground" />
          </Button>
          {#if sendOpen}
            <div
              role="menu"
              class="absolute bottom-full left-0 z-50 mb-1 w-56 rounded-md border bg-popover p-1 shadow-md"
            >
              <button
                type="button"
                role="menuitem"
                class={menuItem}
                disabled={tooFew}
                title={tooFew ? 'Needs at least 2 genes' : undefined}
                onclick={() => sendTo('/compare')}
              >
                <GitCompare class="h-3.5 w-3.5 text-muted-foreground" />
                Annotation overlap
              </button>
              <button
                type="button"
                role="menuitem"
                class={menuItem}
                disabled={tooFew}
                title={tooFew ? 'Needs at least 2 genes' : undefined}
                onclick={() => sendTo('/nta')}
              >
                <Network class="h-3.5 w-3.5 text-muted-foreground" />
                Network connectivity
              </button>
              <button
                type="button"
                role="menuitem"
                class={menuItem}
                onclick={() => sendTo('/lookup')}
              >
                <FileSearch class="h-3.5 w-3.5 text-muted-foreground" />
                Gene name resolver
              </button>
            </div>
          {/if}
        </div>

        <div class="relative">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onclick={() => {
              sendOpen = false;
              copyOpen = !copyOpen;
            }}
          >
            <Copy class="h-3 w-3" />
            Copy
            <ChevronUp class="h-3 w-3 text-muted-foreground" />
          </Button>
          {#if copyOpen}
            <div
              role="menu"
              class="absolute bottom-full left-0 z-50 mb-1 w-56 rounded-md border bg-popover p-1 shadow-md"
            >
              <div class={menuHeading}>Copy to clipboard</div>
              <button
                type="button"
                role="menuitem"
                class={menuItem}
                onclick={() => copyItem('WBGene IDs', () => clipboardWBList(selection.ids))}
              >
                <Copy class="h-3.5 w-3.5 text-muted-foreground" />
                Gene IDs
              </button>
              <button
                type="button"
                role="menuitem"
                class={menuItem}
                onclick={() => copyItem('Gene names', () => clipboardGeneNames(selection.ids))}
              >
                <Copy class="h-3.5 w-3.5 text-muted-foreground" />
                Gene names
              </button>
              <button
                type="button"
                role="menuitem"
                class={menuItem}
                onclick={() => copyItem('TSV', () => clipboardTsv(selection.ids))}
              >
                <Copy class="h-3.5 w-3.5 text-muted-foreground" />
                Annotated TSV
              </button>
              <div class="my-1 h-px bg-border"></div>
              <div class={menuHeading}>Download as file</div>
              <button
                type="button"
                role="menuitem"
                class={menuItem}
                onclick={() => exportItem('TSV', () => exportTsv(selection.ids))}
              >
                <Download class="h-3.5 w-3.5 text-muted-foreground" />
                TSV table
              </button>
              <button
                type="button"
                role="menuitem"
                class={menuItem}
                onclick={() => exportItem('CSV', () => exportCsv(selection.ids))}
              >
                <Download class="h-3.5 w-3.5 text-muted-foreground" />
                CSV table
              </button>
              <button
                type="button"
                role="menuitem"
                class={menuItem}
                onclick={() => exportItem('JSON', () => exportJson(selection.ids))}
              >
                <Download class="h-3.5 w-3.5 text-muted-foreground" />
                JSON
              </button>
              <button
                type="button"
                role="menuitem"
                class={menuItem}
                onclick={() => exportItem('GMT', () => exportGmt(selection.ids))}
              >
                <Download class="h-3.5 w-3.5 text-muted-foreground" />
                GMT gene set
              </button>
              <button
                type="button"
                role="menuitem"
                class={menuItem}
                onclick={() => exportItem('WBGene list', () => exportWBList(selection.ids))}
              >
                <Download class="h-3.5 w-3.5 text-muted-foreground" />
                Gene ID list
              </button>
              <button
                type="button"
                role="menuitem"
                class={menuItem}
                onclick={() => exportItem('Gene names', () => exportGeneNames(selection.ids))}
              >
                <Download class="h-3.5 w-3.5 text-muted-foreground" />
                Gene name list
              </button>
            </div>
          {/if}
        </div>

        <Button
          variant="outline"
          size="sm"
          onclick={() => (summaryOpen = true)}
          title="Quick aggregate stats: top WormCat, GO, phenotypes, diseases, tissues for this selection"
        >
          <Sigma class="h-3 w-3" />
        </Button>
        <Button
          variant={presetUiOpen ? 'default' : 'outline'}
          size="sm"
          onclick={() => (presetUiOpen = !presetUiOpen)}
          title="Saved gene lists"
        >
          <Folder class="h-3 w-3" />
          {#if presets.items.length > 0}
            <span class="text-[0.65rem] tabular-nums">{presets.items.length}</span>
          {/if}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onclick={clearSelection}
          title="Unselect all genes"
          disabled={selection.ids.length === 0}
        >
          <X class="h-3 w-3" />
          Clear
        </Button>
      </div>
    </div>
  </div>
{/if}

<SelectionSummary bind:open={summaryOpen} />
