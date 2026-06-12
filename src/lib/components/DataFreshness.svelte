<script lang="ts" module>
  type VersionInfo = {
    version: string;
    built_at: string;
    sources?: {
      wormbase?: { release?: string; date?: string };
      go?: { date?: string };
      biogrid?: { version?: string };
      wormbase_phenotype?: { release?: string; date?: string };
      alliance_expression?: { version?: string };
      cengen?: { release?: string; citation?: string };
    };
  };
  let cached: VersionInfo | null = null;
  let inflight: Promise<VersionInfo | null> | null = null;
  async function load(): Promise<VersionInfo | null> {
    if (cached) return cached;
    if (inflight) return inflight;
    inflight = fetch('/data/version.json')
      .then((r) => (r.ok ? (r.json() as Promise<VersionInfo>) : null))
      .then((v) => {
        cached = v;
        inflight = null;
        return v;
      })
      .catch(() => {
        inflight = null;
        return null;
      });
    return inflight;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { HoverCard, HoverCardTrigger, HoverCardContent } from '$lib/components/ui/hover-card';
  import { buildCitationBibtex, downloadBibtex } from '$lib/report';
  import { toast } from 'svelte-sonner';

  async function copyCitations() {
    try {
      const bib = await buildCitationBibtex();
      await navigator.clipboard.writeText(bib);
      toast.success('Citations copied (BibTeX)');
    } catch (e) {
      toast.error('Copy failed', { description: String(e) });
    }
  }
  async function downloadCitations() {
    try {
      const bib = await buildCitationBibtex();
      downloadBibtex(bib);
    } catch (e) {
      toast.error('Download failed', { description: String(e) });
    }
  }

  let info = $state<VersionInfo | null>(cached);

  onMount(() => {
    if (!info) load().then((v) => (info = v));
  });

  function fmtDate(s: string | undefined): string {
    if (!s) return '–';
    return s.slice(0, 10);
  }
</script>

{#if info}
  {@const v = info}
  <HoverCard openDelay={150} closeDelay={100}>
    <HoverCardTrigger>
      {#snippet child({ props }: { props: Record<string, unknown> })}
        <span
          class="cursor-help font-mono text-[0.65rem] text-muted-foreground transition-colors hover:text-foreground"
          {...props}
        >
          {v.sources?.wormbase?.release ?? 'WS?'} · built {fmtDate(v.built_at)}
        </span>
      {/snippet}
    </HoverCardTrigger>
    <HoverCardContent class="w-72 space-y-1.5 text-xs">
      <div class="mb-1 font-semibold">Data sources</div>
      <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono">
        <span class="text-muted-foreground">WormBase</span>
        <span>
          {v.sources?.wormbase?.release ?? '?'}
          <span class="text-muted-foreground">({fmtDate(v.sources?.wormbase?.date)})</span>
        </span>
        <span class="text-muted-foreground">Gene Ontology</span>
        <span>{fmtDate(v.sources?.go?.date)}</span>
        <span class="text-muted-foreground">Phenotype</span>
        <span>
          {v.sources?.wormbase_phenotype?.release ?? '?'}
          <span class="text-muted-foreground">({fmtDate(v.sources?.wormbase_phenotype?.date)})</span
          >
        </span>
        <span class="text-muted-foreground">BioGRID</span>
        <span>{v.sources?.biogrid?.version ?? '?'}</span>
        <span class="text-muted-foreground">Alliance expr.</span>
        <span>{v.sources?.alliance_expression?.version ?? '?'}</span>
        {#if v.sources?.cengen?.release}
          <span class="text-muted-foreground">CeNGEN</span>
          <span title={v.sources.cengen.citation ?? ''}>{v.sources.cengen.release}</span>
        {/if}
        <span class="text-muted-foreground">Build</span>
        <span class="text-[0.7rem]">{v.version}</span>
        <span class="text-muted-foreground">Built at</span>
        <span class="text-[0.7rem]">{v.built_at}</span>
      </div>
      <div class="mt-1 flex items-center justify-between gap-2 border-t pt-2 text-[0.7rem]">
        <span class="text-muted-foreground">Cite the data sources:</span>
        <div class="flex items-center gap-2">
          <button type="button" onclick={copyCitations} class="text-primary hover:underline"
            >Copy</button
          >
          <button type="button" onclick={downloadCitations} class="text-primary hover:underline"
            >Download .bib</button
          >
        </div>
      </div>
    </HoverCardContent>
  </HoverCard>
{/if}
