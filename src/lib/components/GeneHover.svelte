<script lang="ts">
  import { HoverCard, HoverCardTrigger, HoverCardContent } from '$lib/components/ui/hover-card';
  import { Badge } from '$lib/components/ui/badge';
  import { preloadGene } from '$lib/components/GenePill.svelte';
  import type { GeneRow } from '$lib/queries';
  import ExternalLink from 'lucide-svelte/icons/external-link';

  type Props = {
    id: string;
    children?: import('svelte').Snippet;
  };

  let { id, children }: Props = $props();
  let open = $state(false);
  let gene = $state<GeneRow | null>(null);
  let loading = $state(false);

  $effect(() => {
    if (!open) return;
    if (gene) return;
    loading = true;
    preloadGene(id)
      .then((g) => {
        gene = g;
      })
      .finally(() => {
        loading = false;
      });
  });
</script>

<HoverCard bind:open openDelay={250} closeDelay={100}>
  <HoverCardTrigger>
    {#snippet child({ props }: { props: Record<string, unknown> })}
      <span class="inline" {...props}>
        {#if children}{@render children()}{/if}
      </span>
    {/snippet}
  </HoverCardTrigger>
  <HoverCardContent>
    {#if loading && !gene}
      <div class="text-sm text-muted-foreground">Loading {id}...</div>
    {:else if gene}
      <div class="space-y-1.5">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <div class="text-sm font-semibold">{gene.gene_name ?? gene.wormbase_gene}</div>
          <div
            class="inline-flex items-center gap-1 font-mono text-[0.65rem] text-muted-foreground"
          >
            <a
              class="inline-flex items-center gap-0.5 hover:text-primary"
              href="https://www.wormbase.org/species/c_elegans/gene/{gene.wormbase_gene}"
              target="_blank"
              rel="noopener"
            >
              {gene.wormbase_gene}
              <ExternalLink class="h-2.5 w-2.5" />
            </a>
          </div>
        </div>
        {#if gene.gene_class_description}
          <div class="text-[0.7rem] italic text-muted-foreground">
            {gene.gene_class_description}
          </div>
        {/if}
        {#if gene.concise_description}
          <div class="line-clamp-4 text-xs leading-snug text-foreground/90">
            {gene.concise_description}
          </div>
        {/if}
        <div class="flex flex-wrap gap-1 pt-1">
          {#if gene.sequence_name}
            <Badge variant="secondary" class="py-0 font-mono text-[0.6rem]">
              {gene.sequence_name}
            </Badge>
          {/if}
          {#if gene.gene_type}
            <Badge variant="secondary" class="py-0 text-[0.6rem]">{gene.gene_type}</Badge>
          {/if}
          {#if gene.status}
            <Badge
              variant={gene.status.toLowerCase() === 'live' ? 'success' : 'muted'}
              class="py-0 text-[0.6rem]"
            >
              {gene.status}
            </Badge>
          {/if}
          {#if gene.entrez_id}
            <a
              href="https://www.ncbi.nlm.nih.gov/gene/{gene.entrez_id}"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center"
            >
              <Badge
                variant="outline"
                class="py-0 font-mono text-[0.6rem] transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Entrez {gene.entrez_id}
                <ExternalLink class="ml-1 h-2.5 w-2.5" />
              </Badge>
            </a>
          {/if}
        </div>
      </div>
    {:else if open}
      <div class="text-sm text-muted-foreground">Not found.</div>
    {/if}
  </HoverCardContent>
</HoverCard>
