<script lang="ts">
  import { onMount } from 'svelte';
  import { bookmarks } from '$lib/stores/bookmarks.svelte';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import PageHint from '$lib/components/PageHint.svelte';
  import GenePill from '$lib/components/GenePill.svelte';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Star from 'lucide-svelte/icons/star';
  import Download from 'lucide-svelte/icons/download';
  import { toast } from 'svelte-sonner';
  import { downloadTsv } from '$lib/download';

  onMount(() => bookmarks.init());

  let tagFilter = $state<string>('');
  const filtered = $derived(
    tagFilter ? bookmarks.all().filter((b) => (b.tags ?? []).includes(tagFilter)) : bookmarks.all(),
  );

  function exportTsv() {
    const rows = bookmarks.all();
    if (rows.length === 0) {
      toast.error('Nothing to export');
      return;
    }
    downloadTsv(
      `bookmarks_${new Date().toISOString().slice(0, 10)}.tsv`,
      [
        { header: 'wormbase_gene', get: (r) => r.wormbase_gene },
        { header: 'gene_name', get: (r) => r.gene_name ?? '' },
        { header: 'starred', get: (r) => (r.starred ? 'yes' : 'no') },
        { header: 'note', get: (r) => r.note ?? '' },
        { header: 'created_at', get: (r) => new Date(r.createdAt).toISOString() },
        { header: 'updated_at', get: (r) => new Date(r.updatedAt).toISOString() },
      ],
      rows,
    );
  }

  function fmtDate(ms: number): string {
    return new Date(ms).toLocaleString();
  }
</script>

<svelte:head>
  <title>Marked genes · wormie.rs.ht</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Marked genes</h1>
    <p class="text-sm text-muted-foreground">Genes you have starred or written a note on</p>
  </header>

  <PageHint id="bookmarks" title="Keeping track of genes">
    The <b>Star</b> button on any gene page adds it here, along with a note you can write in your own
    words — why it caught your eye, which experiment it came from. The two are independent: you can note
    a gene without starring it, and unstarring a gene keeps its note. Click a row to reopen the gene,
    or export the whole list as a spreadsheet.
  </PageHint>

  <Card>
    <CardHeader>
      <div class="flex flex-wrap items-baseline justify-between gap-3">
        <CardTitle class="text-xl">Your list</CardTitle>
        <div class="flex items-center gap-2">
          <Badge variant="muted" class="text-xs">
            {bookmarks.starredCount()} starred
            {#if bookmarks.count() > bookmarks.starredCount()}
              · {bookmarks.count() - bookmarks.starredCount()} noted
            {/if}
          </Badge>
          {#if bookmarks.count() > 0}
            <Button variant="outline" size="sm" onclick={exportTsv}>
              <Download class="h-3 w-3" />
              TSV
            </Button>
          {/if}
        </div>
      </div>
    </CardHeader>
    <CardContent>
      {#if bookmarks.count() === 0}
        <div class="text-sm text-muted-foreground">
          Nothing here yet. Open any gene page and click <b>Star</b> to star a gene, or
          <b>Add note</b> to keep a note on one without starring it.
        </div>
      {:else}
        {#if bookmarks.allTags().length > 0}
          <div class="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <span class="text-muted-foreground">Filter by tag:</span>
            <button
              type="button"
              onclick={() => (tagFilter = '')}
              class="rounded border bg-card px-2 py-0.5 transition-colors hover:bg-accent {tagFilter ===
              ''
                ? 'bg-accent text-accent-foreground'
                : ''}"
            >
              all ({bookmarks.count()})
            </button>
            {#each bookmarks.allTags() as t (t)}
              {@const n = bookmarks.all().filter((b) => (b.tags ?? []).includes(t)).length}
              <button
                type="button"
                onclick={() => (tagFilter = t)}
                class="rounded border bg-card px-2 py-0.5 transition-colors hover:bg-accent {tagFilter ===
                t
                  ? 'bg-accent text-accent-foreground'
                  : ''}"
              >
                {t} ({n})
              </button>
            {/each}
          </div>
        {/if}
        <div class="space-y-2">
          {#each filtered as b (b.wormbase_gene)}
            <div class="flex flex-col gap-1.5 rounded-md border p-3">
              <div class="flex flex-wrap items-baseline gap-2">
                <button
                  type="button"
                  onclick={() => bookmarks.toggle(b.wormbase_gene, b.gene_name)}
                  title={b.starred ? 'Remove star (keeps the note)' : 'Star this gene'}
                  class="self-center"
                >
                  <Star
                    class={b.starred
                      ? 'h-3.5 w-3.5 fill-amber-400 text-amber-500'
                      : 'h-3.5 w-3.5 text-muted-foreground hover:text-amber-500'}
                  />
                </button>
                <GenePill id={b.wormbase_gene} name={b.gene_name} />
                {#each b.tags ?? [] as t (t)}
                  <Badge variant="muted" class="py-0 text-[0.55rem]">{t}</Badge>
                {/each}
                <span class="font-mono text-[0.65rem] text-muted-foreground">
                  updated {fmtDate(b.updatedAt)}
                </span>
                <button
                  type="button"
                  onclick={() => bookmarks.remove(b.wormbase_gene)}
                  class="ml-auto text-muted-foreground hover:text-destructive"
                  title="Delete bookmark"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </button>
              </div>
              {#if b.note}
                <div class="whitespace-pre-wrap text-sm text-foreground/80">{b.note}</div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
