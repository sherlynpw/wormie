<script lang="ts">
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';

  type Entry = {
    date: string; // YYYY-MM-DD
    title: string;
    changes: string[];
  };

  // Newest first. Add a new entry at the top for each notable release.
  const ENTRIES: Entry[] = [
    {
      date: '2026-06-20',
      title: 'Gene-page references rework',
      changes: [
        'Gene references now show real paper titles linked to their DOI instead of bare WBPaper/PMID identifiers, resolved from the Alliance of Genome Resources bibliography.',
        'Added an "All literature" section listing the comprehensive set of publications linked to each gene via NCBI gene2pubmed (e.g. ~108 for hlh-30, up from a handful).',
        'Papers missing from the bulk bibliography (mostly recent ones) are resolved at build time from WormBase REST and NCBI esummary, so titles and DOIs stay current.',
      ],
    },
  ];
</script>

<svelte:head>
  <title>Changelog - wormie.rs.ht</title>
</svelte:head>

<div class="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <Card>
    <CardHeader>
      <CardTitle class="text-xl">Changelog</CardTitle>
      <div class="text-sm text-muted-foreground">
        Notable changes to wormie.rs.ht, newest first.
      </div>
    </CardHeader>
  </Card>

  {#each ENTRIES as entry (entry.date + entry.title)}
    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="flex items-baseline justify-between gap-3 text-base">
          <span>{entry.title}</span>
          <span class="shrink-0 font-mono text-xs font-normal text-muted-foreground"
            >{entry.date}</span
          >
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul class="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          {#each entry.changes as change, i (i)}
            <li>{change}</li>
          {/each}
        </ul>
      </CardContent>
    </Card>
  {/each}
</div>
