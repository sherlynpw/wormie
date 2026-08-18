<script lang="ts" module>
  import {
    getGoTerm,
    getPhenotypeDetail,
    getAnatomyDetail,
    type GoTermDetail,
    type PhenotypeDetail,
    type AnatomyDetail,
  } from '$lib/queries';

  export type TermKind = 'go' | 'phenotype' | 'tissue';
  export type TermDetail =
    | ({ kind: 'go' } & GoTermDetail)
    | ({ kind: 'phenotype' } & PhenotypeDetail)
    | ({ kind: 'tissue' } & AnatomyDetail);

  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const cache = new Map<string, Promise<TermDetail | null>>();
  const cap = 200;

  export function preloadTerm(kind: TermKind, id: string): Promise<TermDetail | null> {
    const key = `${kind}:${id}`;
    const existing = cache.get(key);
    if (existing) {
      cache.delete(key);
      cache.set(key, existing);
      return existing;
    }
    const p: Promise<TermDetail | null> =
      kind === 'go'
        ? getGoTerm(id).then((d) => (d ? { kind: 'go', ...d } : null))
        : kind === 'phenotype'
          ? getPhenotypeDetail(id).then((d) => (d ? { kind: 'phenotype', ...d } : null))
          : getAnatomyDetail(id).then((d) => (d ? { kind: 'tissue', ...d } : null));
    cache.set(key, p);
    if (cache.size > cap) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return p;
  }
</script>

<script lang="ts">
  import { HoverCard, HoverCardTrigger, HoverCardContent } from '$lib/components/ui/hover-card';
  import { Badge } from '$lib/components/ui/badge';
  import ExternalLink from 'lucide-svelte/icons/external-link';

  type Props = {
    kind: TermKind;
    id: string;
    children?: import('svelte').Snippet;
    /** Extra content for the card, e.g. the evidence behind this term for one gene. */
    footer?: import('svelte').Snippet;
  };

  let { kind, id, children, footer }: Props = $props();
  let open = $state(false);
  let detail = $state<TermDetail | null>(null);
  let loading = $state(false);

  $effect(() => {
    if (!open) return;
    if (detail) return;
    loading = true;
    preloadTerm(kind, id)
      .then((d) => {
        detail = d;
      })
      .finally(() => {
        loading = false;
      });
  });

  function externalHref(d: TermDetail): { label: string; url: string } | null {
    if (d.kind === 'go') {
      return { label: 'AmiGO', url: `https://amigo.geneontology.org/amigo/term/${d.go_id}` };
    }
    if (d.kind === 'phenotype') {
      return {
        label: 'WormBase',
        url: `https://wormbase.org/species/all/phenotype/${d.term_id}`,
      };
    }
    // tissue
    return {
      label: 'WormBase',
      url: `https://wormbase.org/species/all/anatomy_term/${d.term_id}`,
    };
  }

  const kindLabel = $derived(kind === 'go' ? 'GO' : kind === 'phenotype' ? 'Phenotype' : 'Tissue');
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
    {#if loading && !detail}
      <div class="text-sm text-muted-foreground">Loading {id}...</div>
      {#if footer}<div class="mt-2 border-t pt-2">{@render footer()}</div>{/if}
    {:else if detail}
      {@const ext = externalHref(detail)}
      <div class="space-y-1.5">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <div class="text-sm font-semibold">{detail.name}</div>
          <div
            class="inline-flex items-center gap-1 font-mono text-[0.65rem] text-muted-foreground"
          >
            {#if ext}
              <!-- eslint-disable svelte/no-navigation-without-resolve -->
              <a
                class="inline-flex items-center gap-0.5 hover:text-primary"
                href={ext.url}
                target="_blank"
                rel="noopener"
              >
                {detail.kind === 'go' ? detail.go_id : detail.term_id}
                <ExternalLink class="h-2.5 w-2.5" />
              </a>
              <!-- eslint-enable svelte/no-navigation-without-resolve -->
            {:else}
              {detail.kind === 'go' ? detail.go_id : detail.term_id}
            {/if}
          </div>
        </div>
        <div class="flex flex-wrap gap-1">
          <Badge variant="secondary" class="py-0 text-[0.6rem]">{kindLabel}</Badge>
          {#if detail.kind === 'go'}
            <Badge variant="secondary" class="py-0 text-[0.6rem]">{detail.namespace}</Badge>
          {/if}
          {#if detail.kind !== 'go'}
            <Badge variant="outline" class="py-0 font-mono text-[0.6rem]">
              {detail.n_genes.toLocaleString()} gene{detail.n_genes === 1 ? '' : 's'}
            </Badge>
          {/if}
        </div>
        {#if detail.definition}
          <div class="line-clamp-4 text-xs leading-snug text-foreground/80">
            {detail.definition}
          </div>
        {/if}
        {#if footer}<div class="border-t pt-1.5">{@render footer()}</div>{/if}
      </div>
    {:else if open}
      <div class="text-sm text-muted-foreground">Not found.</div>
    {/if}
  </HoverCardContent>
</HoverCard>
