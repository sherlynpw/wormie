<script lang="ts">
  import type { StringInteraction } from '$lib/queries';
  import { resolve } from '$app/paths';
  import GeneHover from './GeneHover.svelte';

  type Props = { interactions: StringInteraction[] };
  let { interactions }: Props = $props();

  let minScore = $state(700);
  let onlyExperimental = $state(false);

  const filtered = $derived(
    interactions
      .filter((r) => r.combined_score >= minScore)
      .filter((r) => (onlyExperimental ? r.experimental > 0 : true)),
  );

  // STRING's 7 evidence channels rendered as a stacked sparkline. Cell width
  // fixed; height proportional to channel score (0-1000). Hover shows the
  // numeric per-channel breakdown.
  const CHANNELS = [
    {
      key: 'neighborhood',
      name: 'genomic neighborhood',
      desc: 'Genes repeatedly found near each other on genomes',
      color: 'hsl(120 50% 45%)',
    },
    {
      key: 'fusion',
      name: 'gene fusion',
      desc: 'Fused into a single gene in some other species',
      color: 'hsl(0 60% 55%)',
    },
    {
      key: 'cooccurrence',
      name: 'co-occurrence',
      desc: 'Present or absent together across species',
      color: 'hsl(190 60% 45%)',
    },
    {
      key: 'coexpression',
      name: 'co-expression',
      desc: 'Expression levels correlated across experiments',
      color: 'hsl(280 50% 55%)',
    },
    {
      key: 'experimental',
      name: 'experimental',
      desc: 'Direct interaction evidence from lab experiments',
      color: 'hsl(40 80% 50%)',
    },
    {
      key: 'database',
      name: 'curated databases',
      desc: 'Association curated into pathway or complex databases',
      color: 'hsl(210 60% 50%)',
    },
    {
      key: 'textmining',
      name: 'text mining',
      desc: 'Co-mentioned in the scientific literature',
      color: 'hsl(160 35% 45%)',
    },
  ] as const;
</script>

<div class="space-y-3">
  <div class="flex flex-wrap items-center gap-3 text-xs">
    <span>{filtered.length} of {interactions.length} STRING partners</span>
    <label>
      Min score
      <input
        type="number"
        class="ml-1 w-16 rounded border bg-background px-1 py-0.5"
        bind:value={minScore}
        min="700"
        max="1000"
        step="10"
      />
    </label>
    <label class="inline-flex items-center gap-1">
      <input type="checkbox" bind:checked={onlyExperimental} /> experimental evidence only
    </label>
  </div>

  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.65rem] text-muted-foreground">
    <span>Evidence channels, left to right:</span>
    {#each CHANNELS as ch (ch.key)}
      <span class="inline-flex cursor-help items-center gap-1" title={ch.desc}>
        <span class="inline-block h-2.5 w-2.5 rounded-[2px]" style="background-color: {ch.color}"
        ></span>
        {ch.name}
      </span>
    {/each}
  </div>

  <div class="grid gap-1 text-xs">
    {#each filtered as r (r.partner)}
      <div class="flex items-center gap-3 rounded border px-2 py-1 hover:bg-accent/40">
        <GeneHover id={r.partner}>
          <a
            href={resolve(`/gene/${r.partner}`)}
            class="w-32 truncate font-mono text-foreground hover:underline"
          >
            {r.partner_name ?? r.partner}
          </a>
        </GeneHover>
        <span class="w-12 text-right font-mono text-muted-foreground">{r.combined_score}</span>
        <svg width={CHANNELS.length * 12} height="16" class="flex-shrink-0">
          {#each CHANNELS as ch, i (ch.key)}
            {@const score = r[ch.key]}
            {@const h = (score / 1000) * 14}
            <rect
              x={i * 12 + 1}
              y={16 - h - 1}
              width={10}
              height={h}
              fill={ch.color}
              opacity={score > 0 ? 1 : 0.15}
            >
              <title>{ch.name}: {score}</title>
            </rect>
          {/each}
        </svg>
      </div>
    {/each}
    {#if filtered.length === 0}
      <p class="text-muted-foreground">No STRING partners above the current threshold.</p>
    {/if}
  </div>
</div>
