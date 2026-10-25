<script lang="ts">
  import { datasets, type Dataset, type DatasetType, labelFor } from '$lib/stores/datasets.svelte';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import PageHint from '$lib/components/PageHint.svelte';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Download from 'lucide-svelte/icons/download';
  import Pencil from 'lucide-svelte/icons/pencil';
  import { toast } from 'svelte-sonner';
  import { parseGeneList } from '$lib/gene-parse';
  import { decodeSession, sessionToolLabel, sessionToolPath } from '$lib/session';
  import { selection } from '$lib/stores/selection.svelte';
  import { resolveListIds } from '$lib/stores/presets.svelte';

  type Param =
    | 'paste'
    | 'gmt'
    | 'ranked'
    | 'deseq2'
    | 'results'
    | 'counts'
    | 'session'
    | 'bundle'
    | 'list';
  type Target = { path: string; param: Param; label: string };
  // First entry is the default target; rest appear in "Open in ..." submenu.
  const TYPE_ROUTES: Record<DatasetType, Target[]> = {
    'gene-list': [
      { path: '/enrichment', param: 'paste', label: 'Over-representation' },
      { path: '/enrichment', param: 'deseq2', label: 'Over-representation (DE table / volcano)' },
      { path: '/compare/lists', param: 'list', label: 'Gene overlap' },
      { path: '/enrichment/overlap', param: 'list', label: 'Enrichment overlap' },
      { path: '/nta', param: 'list', label: 'Network connectivity' },
    ],
    ranked: [
      { path: '/gsea', param: 'ranked', label: 'Ranked-list enrichment' },
      { path: '/enrichment', param: 'ranked', label: 'Over-representation (gene list)' },
      { path: '/enrichment', param: 'deseq2', label: 'Over-representation (DE table / volcano)' },
      { path: '/nta', param: 'list', label: 'Network connectivity' },
    ],
    deseq2: [
      { path: '/enrichment', param: 'deseq2', label: 'Over-representation (DE subset)' },
      { path: '/gsea', param: 'ranked', label: 'Ranked-list enrichment' },
    ],
    gmt: [{ path: '/gmt', param: 'gmt', label: 'Custom gene sets' }],
    counts: [{ path: '/ssgsea', param: 'counts', label: 'Per-sample set scores' }],
    'gsea-bundle': [{ path: '/gsea/intersect', param: 'bundle', label: 'Ranked-list consensus' }],
    // Placeholder replaced by sessionTargets() at render time.
    session: [{ path: '', param: 'session', label: 'Open session' }],
  };

  function sessionTargets(ds: Dataset): Target[] {
    const s = decodeSession(ds.body);
    if (!s) return [];
    return [{ path: sessionToolPath(s.tool), param: 'session', label: sessionToolLabel(s.tool) }];
  }

  function targetsFor(ds: Dataset): Target[] {
    return ds.type === 'session' ? sessionTargets(ds) : TYPE_ROUTES[ds.type];
  }

  function openIn(ds: Dataset, t: Target) {
    // Pass id via URL; destination reads body from IndexedDB to avoid sessionStorage's ~5 MB quota.
    window.location.href = `${t.path}?load=${t.param}&id=${encodeURIComponent(ds.id)}`;
  }

  async function useAsSelection(ds: Dataset) {
    const ids = await resolveListIds(parseGeneList(ds.body));
    if (ids.length === 0) {
      toast.error('No recognized genes in this list', { description: ds.name });
      return;
    }
    const prev = [...selection.ids];
    selection.set(ids);
    toast.success('Selection loaded', {
      description: `${ds.name} (${ids.length} gene${ids.length === 1 ? '' : 's'})`,
      action: prev.length ? { label: 'Undo', onClick: () => selection.set(prev) } : undefined,
    });
  }

  function openInTool(ds: Dataset) {
    const targets = targetsFor(ds);
    if (targets.length === 0) {
      toast.error('Could not open', { description: 'Session is invalid or unsupported.' });
      return;
    }
    openIn(ds, targets[0]);
  }

  function downloadDataset(ds: Dataset) {
    const ext = ds.type === 'gmt' ? '.gmt' : ds.type === 'counts' ? '.tsv' : '.txt';
    const blob = new Blob([ds.body], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ds.name.replace(/[^a-z0-9._-]+/gi, '_') + ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  let renamingId = $state<string | null>(null);
  let renameValue = $state('');

  function startRename(ds: Dataset) {
    renamingId = ds.id;
    renameValue = ds.name;
  }

  async function commitRename() {
    if (!renamingId) return;
    await datasets.rename(renamingId, renameValue);
    renamingId = null;
  }

  async function deleteDataset(ds: Dataset) {
    if (!confirm(`Delete "${ds.name}"?`)) return;
    await datasets.remove(ds.id);
    toast.success('Deleted', { description: ds.name });
  }

  function fmtTime(ms: number): string {
    return new Date(ms).toLocaleString();
  }

  function fmtSize(s: number): string {
    if (s < 1024) return `${s} B`;
    if (s < 1024 * 1024) return `${(s / 1024).toFixed(1)} KB`;
    return `${(s / 1024 / 1024).toFixed(1)} MB`;
  }

  // Set-algebra on gene-list type only; DESeq2/GMT/ranked have row-level metadata incompatible with set ops.
  let setOpLeft = $state<string>('');
  let setOpRight = $state<string>('');
  let setOpKind = $state<'union' | 'intersect' | 'difference'>('union');
  let setOpName = $state<string>('');

  const geneListDatasets = $derived(datasets.items.filter((d) => d.type === 'gene-list'));

  function parseGeneTokens(body: string): string[] {
    return [...new Set(parseGeneList(body))];
  }

  async function runSetOp() {
    if (!setOpLeft || !setOpRight) {
      toast.error('Pick two gene lists first');
      return;
    }
    if (setOpLeft === setOpRight) {
      toast.error('Pick two different lists');
      return;
    }
    const left = await datasets.getById(setOpLeft);
    const right = await datasets.getById(setOpRight);
    if (!left || !right) {
      toast.error('Could not load both lists');
      return;
    }
    const A = parseGeneTokens(left.body);
    const B = new Set(parseGeneTokens(right.body));
    let result: string[];
    let label: string;
    if (setOpKind === 'union') {
      result = [...new Set([...A, ...B])];
      label = '∪';
    } else if (setOpKind === 'intersect') {
      result = A.filter((g) => B.has(g));
      label = '∩';
    } else {
      result = A.filter((g) => !B.has(g));
      label = '\\';
    }
    const name = setOpName.trim() || `${left.name} ${label} ${right.name}`;
    await datasets.add({
      name,
      type: 'gene-list',
      body: result.join('\n'),
      meta: {
        source: 'set-op',
        op: setOpKind,
        leftId: left.id,
        rightId: right.id,
        count: result.length,
      },
    });
    toast.success(`Saved (${result.length} genes)`, { description: name });
    setOpName = '';
  }
</script>

<svelte:head><title>Datasets · wormie.rs.ht</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Datasets</h1>
    <p class="text-sm text-muted-foreground">Gene lists and tables you saved in this browser</p>
  </header>

  <PageHint id="datasets" title="How saving works">
    You can name and keep here anything you paste into a tool: gene lists, ranked lists, counts
    tables, differential expression results, and Gene Matrix Transposed (GMT) files, a format for
    gene set collections. Tools with a <b>Save</b> button add their current input to this list. They also
    have a picker to load a saved item back. You can reuse a list in several analyses without pasting
    it again. Everything is stored in this browser only.
  </PageHint>

  <Card>
    <CardHeader>
      <CardTitle class="text-xl">Saved inputs</CardTitle>
      <div class="text-sm text-muted-foreground">
        Gene lists, ranked lists, differential expression results, Gene Matrix Transposed (GMT) gene
        set collections and counts matrices.
      </div>
    </CardHeader>
    <CardContent>
      {#if !datasets.loaded}
        <div class="text-sm text-muted-foreground">Loading...</div>
      {:else if datasets.items.length === 0}
        <div class="text-sm text-muted-foreground">
          No saved datasets. Use the <span class="font-semibold text-foreground">Save</span> button on
          any tool page (Over-representation, Ranked-list enrichment, Custom gene sets, Per-sample set
          scores) to add one here.
        </div>
      {:else}
        <div class="overflow-x-auto rounded-lg border bg-card">
          <table class="w-full text-sm">
            <thead class="border-b bg-card">
              <tr>
                <th
                  class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Name
                </th>
                <th
                  class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Type
                </th>
                <th
                  class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                  >Size</th
                >
                <th
                  class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Created
                </th>
                <th
                  class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {#each datasets.items as ds (ds.id)}
                <tr class="border-b last:border-b-0 hover:bg-muted/30">
                  <td class="px-3 py-2 align-middle">
                    {#if renamingId === ds.id}
                      <input
                        bind:value={renameValue}
                        onkeydown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') renamingId = null;
                        }}
                        onblur={commitRename}
                        class="w-full rounded border bg-background px-2 py-1 text-sm"
                      />
                    {:else}
                      <button
                        type="button"
                        class="text-left hover:underline"
                        onclick={() => openInTool(ds)}
                      >
                        {ds.name}
                      </button>
                    {/if}
                  </td>
                  <td class="px-3 py-2 align-middle">
                    <Badge variant="muted" class="text-[0.6rem]">{labelFor(ds.type)}</Badge>
                  </td>
                  <td
                    class="px-3 py-2 text-right align-middle font-mono text-xs tabular-nums text-muted-foreground"
                  >
                    {fmtSize(ds.body.length)}
                  </td>
                  <td class="px-3 py-2 align-middle text-xs text-muted-foreground"
                    >{fmtTime(ds.createdAt)}</td
                  >
                  <td class="space-x-1 whitespace-nowrap px-3 py-2 text-right align-middle">
                    {#if ds.type === 'gene-list'}
                      <Button
                        variant="ghost"
                        size="sm"
                        onclick={() => useAsSelection(ds)}
                        title="Use this list as the current gene selection (the genes you picked on the search page)"
                      >
                        Use as selection
                      </Button>
                    {/if}
                    {#if targetsFor(ds).length > 0}
                      {@const dsTargets = targetsFor(ds)}
                      {#each dsTargets as t (t.path + t.param)}
                        <Button
                          variant="ghost"
                          size="sm"
                          onclick={() => openIn(ds, t)}
                          title={`Open in ${t.label}`}
                        >
                          {ds.type === 'session' || dsTargets.length > 1 ? t.label : 'Open'}
                        </Button>
                      {/each}
                    {/if}
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => startRename(ds)}
                      title="Rename"
                    >
                      <Pencil class="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => downloadDataset(ds)}
                      title="Download"
                    >
                      <Download class="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => deleteDataset(ds)}
                      title="Delete"
                    >
                      <Trash2 class="h-3 w-3 text-destructive" />
                    </Button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </CardContent>
  </Card>

  {#if geneListDatasets.length >= 2}
    <Card>
      <CardHeader>
        <CardTitle class="text-base">Set algebra on gene lists</CardTitle>
        <div class="text-sm text-muted-foreground">
          Combine two saved gene lists into a new list. <b>Union</b> (A ∪ B) keeps every gene that
          is in either list, with no repeats. <b>Intersect</b>
          (A ∩ B) keeps genes that are in both lists. <b>Difference</b> (A \ B) keeps genes that are in
          A but not in B. Genes are compared by the exact text in the lists, so the same gene written
          as a name in one list and as a WormBase ID in the other is not matched. Use the Gene name resolver
          first if your lists mix names and IDs. The new list keeps the text as it was written in the
          source lists.
        </div>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="grid items-end gap-3 md:grid-cols-[1fr_auto_1fr]">
          <label class="space-y-1">
            <span
              class="block text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
              >A (left)</span
            >
            <select
              bind:value={setOpLeft}
              class="w-full rounded border bg-background px-2 py-1.5 text-sm"
            >
              <option value="" disabled>Pick a list</option>
              {#each geneListDatasets as d (d.id)}
                <option value={d.id}>{d.name}</option>
              {/each}
            </select>
          </label>
          <div class="inline-flex overflow-hidden rounded-md border text-sm">
            <button
              type="button"
              onclick={() => (setOpKind = 'union')}
              class="px-3 py-1.5 {setOpKind === 'union'
                ? 'bg-accent text-accent-foreground'
                : 'bg-card hover:bg-muted/50'}"
              title="Union: genes in A or B">∪</button
            >
            <button
              type="button"
              onclick={() => (setOpKind = 'intersect')}
              class="border-l px-3 py-1.5 {setOpKind === 'intersect'
                ? 'bg-accent text-accent-foreground'
                : 'bg-card hover:bg-muted/50'}"
              title="Intersect: genes in both A and B">∩</button
            >
            <button
              type="button"
              onclick={() => (setOpKind = 'difference')}
              class="border-l px-3 py-1.5 {setOpKind === 'difference'
                ? 'bg-accent text-accent-foreground'
                : 'bg-card hover:bg-muted/50'}"
              title="Difference: genes in A but not in B">\</button
            >
          </div>
          <label class="space-y-1">
            <span
              class="block text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
              >B (right)</span
            >
            <select
              bind:value={setOpRight}
              class="w-full rounded border bg-background px-2 py-1.5 text-sm"
            >
              <option value="" disabled>Pick a list</option>
              {#each geneListDatasets as d (d.id)}
                <option value={d.id}>{d.name}</option>
              {/each}
            </select>
          </label>
        </div>
        <div class="flex flex-wrap items-end gap-2">
          <label class="min-w-48 flex-1 space-y-1">
            <span
              class="block text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Output name (optional)
            </span>
            <input
              bind:value={setOpName}
              placeholder="auto: names of A and B joined by the operator symbol"
              class="w-full rounded border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <Button
            onclick={runSetOp}
            disabled={!setOpLeft || !setOpRight || setOpLeft === setOpRight}
          >
            Compute & save
          </Button>
        </div>
      </CardContent>
    </Card>
  {/if}
</div>
