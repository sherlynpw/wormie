<script lang="ts">
  // Cnetplot: bipartite term-gene network. Top-N terms (by q) on a circle perimeter;
  // genes positioned at the centroid of their connected terms; edges per overlap list.
  // Layout is deterministic (no force simulation).

  import type { EnrichmentResult, EnrichmentKind } from '$lib/db/client';
  import { resolve } from '$app/paths';
  import { fmtP } from '$lib/format';

  import PlotExportMenu from './PlotExportMenu.svelte';
  import { NAMESPACE_COLOR } from '$lib/plot-colors';

  let {
    results,
    kind,
    nTerms = 10,
    size = 520,
    exportName,
  }: {
    results: EnrichmentResult[];
    kind: EnrichmentKind;
    nTerms?: number;
    size?: number;
    exportName?: string;
  } = $props();

  let svgEl: SVGSVGElement | null = $state(null);
  export function getSvg() {
    return svgEl;
  }

  // Top N by q (then p); skip empty-overlap terms (no edges).
  const topTerms = $derived(
    [...results]
      .filter((r) => r.overlap && r.overlap.length > 0)
      .sort((a, b) => a.q - b.q || a.p - b.p)
      .slice(0, nTerms),
  );

  type Node = {
    id: string;
    label: string;
    kind: 'term' | 'gene';
    x: number;
    y: number;
    r: number;
    fill: string;
    title: string;
    href: string | null;
  };
  type Edge = { x1: number; y1: number; x2: number; y2: number; opacity: number };

  function termHref(termId: string): string | null {
    if (kind === 'go') return `/go/${termId}`;
    if (kind === 'phenotype') return `/phenotype/${termId}`;
    if (kind === 'disease') return `/disease/${termId}`;
    return null;
  }

  // Color terms by GO namespace; genes are neutral grey.
  function termColor(r: EnrichmentResult): string {
    const ns = r.namespace ?? '';
    if (ns === 'BP' || ns === 'biological_process') return NAMESPACE_COLOR.BP;
    if (ns === 'MF' || ns === 'molecular_function') return NAMESPACE_COLOR.MF;
    if (ns === 'CC' || ns === 'cellular_component') return NAMESPACE_COLOR.CC;
    return NAMESPACE_COLOR.other;
  }

  const layout = $derived.by(() => {
    if (topTerms.length === 0) return { nodes: [] as Node[], edges: [] as Edge[] };
    const cx = size / 2;
    const cy = size / 2;
    const ringR = Math.min(cx, cy) - 60;
    const termR = Math.min(28, (2 * Math.PI * ringR) / (topTerms.length * 2.5));
    // Term nodes evenly spaced on the perimeter.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const termPos = new Map<string, { x: number; y: number }>();
    const termNodes: Node[] = topTerms.map((t, i) => {
      const a = -Math.PI / 2 + (i / topTerms.length) * 2 * Math.PI;
      const x = cx + ringR * Math.cos(a);
      const y = cy + ringR * Math.sin(a);
      termPos.set(t.term_id, { x, y });
      const sizeBoost = Math.min(14, Math.log2(t.k + 1) * 3);
      return {
        id: 'T:' + t.term_id,
        label: t.name,
        kind: 'term',
        x,
        y,
        r: termR + sizeBoost,
        fill: termColor(t),
        title: `${t.name} (${t.term_id}) · k=${t.k}/K=${t.K} · q=${fmtP(t.q)}`,
        href: termHref(t.term_id),
      };
    });

    // Build gene-to-terms map.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const geneToTerms = new Map<string, string[]>();
    for (const t of topTerms) {
      for (const g of t.overlap) {
        const arr = geneToTerms.get(g);
        if (arr) arr.push(t.term_id);
        else geneToTerms.set(g, [t.term_id]);
      }
    }

    // Gene radius scales with term count. Position: centroid of connected terms,
    // pulled toward center (pull 0.15 + 0.12*(n-1), max 0.6) so hubs cluster centrally.
    const geneNodes: Node[] = [];
    for (const [g, termIds] of geneToTerms.entries()) {
      let sx = 0;
      let sy = 0;
      for (const tid of termIds) {
        const p = termPos.get(tid)!;
        sx += p.x;
        sy += p.y;
      }
      sx /= termIds.length;
      sy /= termIds.length;
      const pull = Math.min(0.6, 0.15 + (termIds.length - 1) * 0.12);
      const gx = sx + (cx - sx) * pull;
      const gy = sy + (cy - sy) * pull;
      geneNodes.push({
        id: 'G:' + g,
        label: g,
        kind: 'gene',
        x: gx,
        y: gy,
        r: 3 + Math.min(6, termIds.length * 1.5),
        fill: 'hsl(0 0% 70%)',
        title: `${g} · in ${termIds.length} term${termIds.length === 1 ? '' : 's'}`,
        href: null,
      });
    }

    // Edges: gene to each connected term.
    const edges: Edge[] = [];
    for (const node of geneNodes) {
      const g = node.label;
      const termIds = geneToTerms.get(g) ?? [];
      for (const tid of termIds) {
        const tp = termPos.get(tid)!;
        edges.push({
          x1: node.x,
          y1: node.y,
          x2: tp.x,
          y2: tp.y,
          opacity: termIds.length > 1 ? 0.7 : 0.25,
        });
      }
    }

    return { nodes: [...termNodes, ...geneNodes], edges };
  });

  // Show gene labels only for hub genes (≥2 terms) to avoid clutter.
  const hubLabels = $derived.by(() => {
    /* eslint-disable svelte/prefer-svelte-reactivity */
    const set = new Set<string>();
    for (const t of topTerms) for (const g of t.overlap) set.add(g);
    const counts = new Map<string, number>();
    for (const t of topTerms) for (const g of t.overlap) counts.set(g, (counts.get(g) ?? 0) + 1);
    /* eslint-enable svelte/prefer-svelte-reactivity */
    const out: { id: string; show: boolean }[] = [];
    for (const g of set) out.push({ id: g, show: (counts.get(g) ?? 0) >= 2 });
    return new Map(out.map((x) => [x.id, x.show]));
  });
</script>

{#if topTerms.length === 0}
  <div class="text-xs italic text-muted-foreground">
    No terms with overlap data to plot. (Imported clusterProfiler results without a
    <code>geneID</code> column can't be Cnetted.)
  </div>
{:else}
  <div class="space-y-2">
    <div class="relative overflow-hidden rounded-md border bg-card">
      {#if exportName}
        <div class="absolute right-1 top-1 z-10">
          <PlotExportMenu getSvg={() => svgEl} baseName={exportName} />
        </div>
      {/if}
      <svg
        bind:this={svgEl}
        viewBox="0 0 {size} {size}"
        width="100%"
        style="max-width: {size}px"
        role="img"
        aria-label="Cnetplot: term-gene bipartite network"
      >
        {#each layout.edges as e, i (i)}
          <line
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            stroke="currentColor"
            stroke-opacity={e.opacity * 0.5}
            stroke-width="1"
            class="text-muted-foreground"
          />
        {/each}
        {#each layout.nodes as n (n.id)}
          {#if n.kind === 'gene'}
            <circle
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill={n.fill}
              stroke="currentColor"
              stroke-opacity="0.4"
              stroke-width="0.5"
              class="text-foreground"
            >
              <title>{n.title}</title>
            </circle>
            {#if hubLabels.get(n.label)}
              <text
                x={n.x}
                y={n.y + n.r + 8}
                text-anchor="middle"
                font-size="9"
                class="fill-foreground"
                pointer-events="none">{n.label}</text
              >
            {/if}
          {:else}
            {#if n.href}
              <a href={resolve(n.href as '/')}>
                <circle cx={n.x} cy={n.y} r={n.r} fill={n.fill} stroke="white" stroke-width="1.5">
                  <title>{n.title}</title>
                </circle>
              </a>
            {:else}
              <circle cx={n.x} cy={n.y} r={n.r} fill={n.fill} stroke="white" stroke-width="1.5">
                <title>{n.title}</title>
              </circle>
            {/if}
            <text
              x={n.x}
              y={n.y + n.r + 11}
              text-anchor="middle"
              font-size="10"
              font-weight="600"
              class="fill-foreground"
              pointer-events="none"
            >
              {n.label.length > 28 ? n.label.slice(0, 27) + '…' : n.label}
            </text>
          {/if}
        {/each}
      </svg>
    </div>
    <div class="text-[0.65rem] text-muted-foreground">
      Top {topTerms.length} terms around the ring; genes pulled toward the centre by connection count
      (hub genes sit closer). Edge opacity rises with the gene's term count. Gene labels show for hub
      genes (≥ 2 terms) only.
    </div>
  </div>
{/if}
