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

  type Param = 'paste' | 'gmt' | 'ranked' | 'deseq2' | 'results' | 'counts' | 'session';
  type Target = { path: string; param: Param; label: string };
  // First entry is the default target; rest appear in "Open in ..." submenu.
  const TYPE_ROUTES: Record<DatasetType, Target[]> = {
    'gene-list': [
      { path: '/enrichment', param: 'paste', label: 'Enrichment (ORA)' },
      { path: '/enrichment', param: 'deseq2', label: 'Enrichment (DESeq2 / volcano)' },
    ],
    ranked: [
      { path: '/gsea', param: 'ranked', label: 'GSEA' },
      { path: '/enrichment', param: 'ranked', label: 'Enrichment (gene list)' },
      { path: '/enrichment', param: 'deseq2', label: 'Enrichment (DESeq2 / volcano)' },
    ],
    deseq2: [
      { path: '/enrichment', param: 'deseq2', label: 'Enrichment (DE subset)' },
      { path: '/gsea', param: 'ranked', label: 'GSEA (preranked)' },
    ],
    gmt: [{ path: '/gmt', param: 'gmt', label: 'GMT' }],
    counts: [{ path: '/ssgsea', param: 'counts', label: 'ssGSEA' }],
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

<div class="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <PageHint id="datasets" title="Saved inputs">
    Named, reusable inputs across the site (gene lists, ranked stats, DESeq2 tables, GMTs, count
    matrices). Each tool has a "Save" button that drops the current input here, and a picker to load
    any saved one. Stored in browser localStorage; no server.
  </PageHint>

  <Card>
    <CardHeader>
      <CardTitle class="text-xl">Datasets</CardTitle>
      <div class="text-sm text-muted-foreground">
        Saved gene lists, ranked stats, DESeq2 outputs, GMT collections, and counts matrices. All
        persisted in your browser ONLY.
      </div>
    </CardHeader>
    <CardContent>
      {#if !datasets.loaded}
        <div class="text-sm text-muted-foreground">Loading...</div>
      {:else if datasets.items.length === 0}
        <div class="text-sm text-muted-foreground">
          No saved datasets. Use the <span class="font-semibold text-foreground">Save</span> button on
          any tool page (Enrichment, GSEA, Custom GMT, ssGSEA) to add one here.
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
          Combine two saved gene lists into a new one. <b>Union</b> (A ∪ B) keeps all unique genes,
          <b>Intersect</b>
          (A ∩ B) keeps genes in both, <b>Difference</b> (A \ B) keeps genes in A but not B. Operates
          on token-level gene IDs (mixed names/WBGene OK; the output preserves whatever was in the source
          lists).
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
              title="A ∪ B">∪</button
            >
            <button
              type="button"
              onclick={() => (setOpKind = 'intersect')}
              class="border-l px-3 py-1.5 {setOpKind === 'intersect'
                ? 'bg-accent text-accent-foreground'
                : 'bg-card hover:bg-muted/50'}"
              title="A ∩ B">∩</button
            >
            <button
              type="button"
              onclick={() => (setOpKind = 'difference')}
              class="border-l px-3 py-1.5 {setOpKind === 'difference'
                ? 'bg-accent text-accent-foreground'
                : 'bg-card hover:bg-muted/50'}"
              title="A \ B (in A, not in B)">\</button
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
              placeholder="auto: A ∪ B"
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
