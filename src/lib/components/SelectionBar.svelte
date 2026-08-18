<script lang="ts">
  import { selection } from '$lib/stores/selection.svelte';
  import { presets } from '$lib/stores/presets.svelte';
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
  import TrendingUp from 'lucide-svelte/icons/trending-up';
  import FileSearch from 'lucide-svelte/icons/file-search';
  import Sigma from 'lucide-svelte/icons/sigma';
  import SelectionSummary from '$lib/components/SelectionSummary.svelte';

  let busy = $state(false);
  let summaryOpen = $state(false);
  let presetUiOpen = $state(false);
  let presetName = $state('');

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

  async function gotoEnrich() {
    const q = await buildIdsQuery(selection.ids);
    goto(resolve(`/enrichment?${q}`));
  }

  async function gotoCompare() {
    const q = await buildIdsQuery(selection.ids);
    goto(resolve(`/compare?${q}`));
  }

  async function gotoGsea() {
    const q = await buildIdsQuery(selection.ids);
    goto(resolve(`/gsea?${q}`));
  }

  async function gotoNta() {
    const q = await buildIdsQuery(selection.ids);
    goto(resolve(`/nta?${q}`));
  }

  async function gotoLookup() {
    const q = await buildIdsQuery(selection.ids);
    goto(resolve(`/lookup?${q}`));
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

  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    const p = presets.save(name, selection.ids);
    toast.success('Selection saved', {
      description: `${p.name} (${p.ids.length} gene${p.ids.length === 1 ? '' : 's'})`,
    });
    presetName = '';
    presetUiOpen = false;
  }

  function loadPreset(id: string) {
    const p = presets.get(id);
    if (!p) return;
    selection.ids = [...p.ids];
    try {
      localStorage.setItem('wb_selection', JSON.stringify(p.ids));
    } catch {
      // noop
    }
    toast.success('Selection loaded', {
      description: `${p.name} (${p.ids.length} gene${p.ids.length === 1 ? '' : 's'})`,
    });
    presetUiOpen = false;
  }

  function deletePreset(id: string, name: string) {
    presets.remove(id);
    toast.success('Preset deleted', { description: name });
  }
</script>

{#if selection.ids.length > 0 || presetUiOpen}
  <div class="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4">
    <div
      class="pointer-events-auto flex w-fit max-w-5xl flex-col rounded-lg border bg-card shadow-lg"
    >
      {#if presetUiOpen}
        <div class="space-y-2 border-b p-3">
          <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Saved selections
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
                    title="Delete preset"
                  >
                    <Trash class="h-3 w-3" />
                  </button>
                </div>
              {/each}
            </div>
          {:else}
            <div class="text-xs italic text-muted-foreground">No saved selections yet.</div>
          {/if}
        </div>
      {/if}
      <div class="flex flex-wrap items-center gap-2 px-3 py-2">
        <div class="text-sm">
          <span class="font-semibold tabular-nums">{selection.ids.length}</span>
          <span class="text-muted-foreground"> selected</span>
        </div>
        <div class="mx-1 h-5 w-px bg-border"></div>

        <!-- Clipboard actions -->
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onclick={() => copy('WBGene IDs', () => clipboardWBList(selection.ids))}
        >
          <Copy class="h-3 w-3" />
          IDs
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onclick={() => copy('Gene names', () => clipboardGeneNames(selection.ids))}
        >
          <Copy class="h-3 w-3" />
          Names
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onclick={() => copy('TSV', () => clipboardTsv(selection.ids))}
        >
          <Copy class="h-3 w-3" />
          TSV
        </Button>

        <div class="mx-1 h-5 w-px bg-border"></div>

        <!-- File exports -->
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onclick={() => run('TSV', () => exportTsv(selection.ids))}
        >
          <Download class="h-3 w-3" />
          TSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onclick={() => run('CSV', () => exportCsv(selection.ids))}
        >
          <Download class="h-3 w-3" />
          CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onclick={() => run('JSON', () => exportJson(selection.ids))}
        >
          <Download class="h-3 w-3" />
          JSON
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onclick={() => run('GMT', () => exportGmt(selection.ids))}
        >
          <Download class="h-3 w-3" />
          GMT
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onclick={() => run('WBGene list', () => exportWBList(selection.ids))}
        >
          <Download class="h-3 w-3" />
          List
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onclick={() => run('Gene names', () => exportGeneNames(selection.ids))}
        >
          <Download class="h-3 w-3" />
          Names
        </Button>

        <div class="mx-1 h-5 w-px bg-border"></div>

        <Button
          variant="outline"
          size="sm"
          disabled={selection.ids.length < 2}
          onclick={gotoCompare}
        >
          <GitCompare class="h-3 w-3" />
          Compare
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={selection.ids.length < 2}
          onclick={gotoEnrich}
        >
          <BarChart class="h-3 w-3" />
          Enrich
        </Button>
        <Button variant="outline" size="sm" disabled={selection.ids.length < 2} onclick={gotoGsea}>
          <TrendingUp class="h-3 w-3" />
          GSEA
        </Button>
        <Button variant="outline" size="sm" disabled={selection.ids.length < 2} onclick={gotoNta}>
          <Network class="h-3 w-3" />
          Network
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={selection.ids.length < 1}
          onclick={gotoLookup}
        >
          <FileSearch class="h-3 w-3" />
          Lookup
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={selection.ids.length < 1}
          onclick={() => (summaryOpen = true)}
          title="Quick aggregate stats: top WormCat, GO, phenotypes, diseases, tissues for this selection"
        >
          <Sigma class="h-3 w-3" />
          Summary
        </Button>
        <Button
          variant={presetUiOpen ? 'default' : 'outline'}
          size="sm"
          onclick={() => (presetUiOpen = !presetUiOpen)}
        >
          <Folder class="h-3 w-3" />
          {presets.items.length > 0 ? `Presets (${presets.items.length})` : 'Presets'}
        </Button>
        <Button variant="ghost" size="sm" onclick={() => selection.clear()}>
          <X class="h-3 w-3" />
          Clear
        </Button>
      </div>
    </div>
  </div>
{/if}

<SelectionSummary bind:open={summaryOpen} />
