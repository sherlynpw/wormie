<script lang="ts">
  import type { GeneRow } from '$lib/queries';
  import { Badge } from '$lib/components/ui/badge';
  import { Card } from '$lib/components/ui/card';
  import { cn } from '$lib/utils';
  import ExternalLink from 'lucide-svelte/icons/external-link';
  import Highlight from '$lib/components/Highlight.svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import SelectToggle from '$lib/components/SelectToggle.svelte';
  import Copyable from '$lib/components/Copyable.svelte';
  import GeneHover from '$lib/components/GeneHover.svelte';
  import { density } from '$lib/stores/density.svelte';
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  onMount(() => density.init());

  let { gene, highlight = null }: { gene: GeneRow; highlight?: RegExp | null } = $props();
  const isCompact = $derived(density.value === 'compact');
  const statusVariant = $derived(
    gene.status?.toLowerCase() === 'live' ? ('success' as const) : ('muted' as const),
  );
</script>

<Card
  class={cn(
    'border-l-4 border-l-primary transition-shadow hover:shadow-md',
    isCompact ? 'px-3 py-1.5' : 'px-4 py-3',
  )}
>
  <div class="mb-1 flex flex-wrap items-baseline justify-between gap-4">
    <span class="inline-flex items-center gap-2">
      <SelectToggle id={gene.wormbase_gene} size="md" />
      <GeneHover id={gene.wormbase_gene}>
        <a
          href={resolve(`/gene/${gene.wormbase_gene}`)}
          class="text-base font-semibold transition-colors hover:text-primary"
        >
          <Highlight text={gene.gene_name ?? gene.wormbase_gene} regex={highlight} />
        </a>
      </GeneHover>
      {#if gene.gene_name}
        <CopyButton text={gene.gene_name} />
      {/if}
    </span>
    <div class="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
      <a
        class="inline-flex items-center gap-1 hover:text-primary"
        href="https://www.wormbase.org/species/c_elegans/gene/{gene.wormbase_gene}"
        target="_blank"
        rel="noopener"
      >
        <Highlight text={gene.wormbase_gene} regex={highlight} />
        <ExternalLink class="h-3 w-3" />
      </a>
      <CopyButton text={gene.wormbase_gene} />
      {#if gene.entrez_id}
        <span class="ml-1 text-muted-foreground/60">·</span>
        <a
          class="inline-flex items-center gap-1 hover:text-primary"
          href="https://www.ncbi.nlm.nih.gov/gene/{gene.entrez_id}"
          target="_blank"
          rel="noopener"
        >
          Entrez <Highlight text={gene.entrez_id} regex={highlight} />
          <ExternalLink class="h-3 w-3" />
        </a>
        <CopyButton text={gene.entrez_id} />
      {/if}
    </div>
  </div>
  {#if !isCompact}
    {#if gene.gene_class_description}
      <Copyable text={gene.gene_class_description} label="Gene class" class="mb-1">
        <div class="text-xs italic text-muted-foreground">
          <Highlight text={gene.gene_class_description} regex={highlight} />
        </div>
      </Copyable>
    {/if}
    {#if gene.concise_description}
      <Copyable text={gene.concise_description} label="Description">
        <div class="text-sm leading-relaxed text-foreground/90">
          <Highlight text={gene.concise_description} regex={highlight} />
        </div>
      </Copyable>
    {/if}
    {#if gene.legacy_description}
      <Copyable text={gene.legacy_description} label="Legacy description" class="mt-1.5">
        <div class="text-xs leading-relaxed text-muted-foreground">
          <span class="mr-1.5 text-[0.6rem] font-semibold uppercase tracking-wider">Legacy</span>
          <Highlight text={gene.legacy_description} regex={highlight} />
        </div>
      </Copyable>
    {/if}
  {:else if gene.concise_description}
    <Copyable text={gene.concise_description} label="Description">
      <div class="line-clamp-1 text-xs leading-snug text-muted-foreground">
        <Highlight text={gene.concise_description} regex={highlight} />
      </div>
    </Copyable>
  {/if}
  {#if gene.matched_fields && gene.matched_fields.length}
    <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span class="text-[0.6rem] font-semibold uppercase tracking-wider">Matched in</span>
      {#each gene.matched_fields as mf (mf.field)}
        <span class="inline-flex items-center gap-1">
          <span class="font-medium text-foreground/80">{mf.label}:</span>
          <span class="font-mono">
            {#each mf.segments as seg, i (i)}{#if seg.m}<mark
                  class="rounded bg-yellow-200/70 px-0.5 text-foreground dark:bg-yellow-500/30"
                  >{seg.t}</mark
                >{:else}{seg.t}{/if}{/each}
          </span>
        </span>
      {/each}
    </div>
  {/if}
  <div class={cn('flex flex-wrap items-center gap-1.5', isCompact ? 'mt-1' : 'mt-2')}>
    {#if gene.sequence_name}
      <span class="inline-flex items-center gap-0.5">
        <Badge variant="secondary" class="font-mono">
          <Highlight text={gene.sequence_name} regex={highlight} />
        </Badge>
        <CopyButton text={gene.sequence_name} />
      </span>
    {/if}
    {#if gene.gene_type}<Badge variant="secondary">{gene.gene_type}</Badge>{/if}
    {#if gene.operon}<Badge variant="secondary">operon: {gene.operon}</Badge>{/if}
    {#if gene.status}
      <Badge variant={statusVariant}>{gene.status}</Badge>
    {/if}
  </div>
</Card>
