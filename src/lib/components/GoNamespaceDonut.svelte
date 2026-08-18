<script lang="ts">
  // Two-ring donut: outer = BP/MF/CC namespace counts; inner = same segments split by
  // evidence-code tier (experimental/curated/inferred/electronic). Lets users see at a
  // glance whether a gene's GO is curated vs predicted and how it splits across sub-ontologies.

  import type { GoAnnotation } from '$lib/queries';

  import PlotExportMenu from './PlotExportMenu.svelte';

  let {
    annotations,
    size = 200,
    exportName,
  }: {
    annotations: GoAnnotation[];
    size?: number;
    exportName?: string;
  } = $props();

  let svgEl: SVGSVGElement | null = $state(null);
  export function getSvg() {
    return svgEl;
  }

  // Evidence-code tiers per GO Consortium guidance.
  const TIERS = [
    {
      key: 'experimental',
      label: 'Experimental',
      codes: ['EXP', 'IDA', 'IMP', 'IPI', 'IGI', 'IEP', 'HDA', 'HMP', 'HGI', 'HEP'],
    },
    { key: 'curated', label: 'Curated (author/curator)', codes: ['TAS', 'IC', 'NAS'] },
    {
      key: 'inferred',
      label: 'Computational / phylogenetic',
      codes: ['IBA', 'IBD', 'IKR', 'IRD', 'ISS', 'ISM', 'ISO', 'ISA', 'RCA'],
    },
    { key: 'electronic', label: 'Electronic (IEA family)', codes: ['IEA', 'IEA-PROP'] },
  ] as const;
  const TIER_FOR: Record<string, (typeof TIERS)[number]['key']> = (() => {
    const m: Record<string, (typeof TIERS)[number]['key']> = {};
    for (const t of TIERS) for (const c of t.codes) m[c] = t.key;
    return m;
  })();
  function tierOf(code: string): (typeof TIERS)[number]['key'] {
    return TIER_FOR[code] ?? 'electronic';
  }

  const NS_LABEL: Record<string, string> = {
    BP: 'Biological process',
    MF: 'Molecular function',
    CC: 'Cellular component',
  };
  const NS_ORDER = ['BP', 'MF', 'CC'] as const;
  const NS_COLOR: Record<string, string> = {
    BP: 'hsl(280 60% 45%)',
    MF: 'hsl(200 70% 40%)',
    CC: 'hsl(150 55% 35%)',
  };
  // Evidence tier as a grey ramp: hue means namespace, value means evidence, so
  // the two rings encode different things and neither fades into the background.
  const TIER_GREY: Record<string, string> = {
    experimental: 'hsl(0 0% 28%)',
    curated: 'hsl(0 0% 46%)',
    inferred: 'hsl(0 0% 64%)',
    electronic: 'hsl(0 0% 80%)',
  };

  // Aggregate: nsCounts = namespace total; cells = flat (namespace, tier) buckets for inner arcs.
  type Cell = { ns: string; tier: string; count: number };
  const agg = $derived.by(() => {
    /* eslint-disable svelte/prefer-svelte-reactivity */
    const nsCounts = new Map<string, number>();
    const cellCounts = new Map<string, number>();
    /* eslint-enable svelte/prefer-svelte-reactivity */
    for (const a of annotations) {
      const ns = a.namespace;
      if (!NS_LABEL[ns]) continue;
      nsCounts.set(ns, (nsCounts.get(ns) ?? 0) + 1);
      const t = tierOf(a.evidence_code);
      const key = `${ns}:${t}`;
      cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
    }
    const cells: Cell[] = [];
    for (const ns of NS_ORDER) {
      for (const t of TIERS) {
        const c = cellCounts.get(`${ns}:${t.key}`) ?? 0;
        if (c > 0) cells.push({ ns, tier: t.key, count: c });
      }
    }
    const total = annotations.length;
    return { nsCounts, cells, total };
  });

  // Geometry (SVG centred at size/2, size/2): outer ring 13% wide, inner ring 16% wide, 2px gap.
  const cx = $derived(size / 2);
  const cy = $derived(size / 2);
  const rOuter = $derived(size / 2 - 4);
  const rOuterIn = $derived(rOuter - size * 0.13);
  const rInner = $derived(rOuterIn - 2);
  const rInnerIn = $derived(rInner - size * 0.16);

  function polar(r: number, angle: number) {
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
  }
  function arcPath(rOut: number, rIn: number, a0: number, a1: number): string {
    const [x0o, y0o] = polar(rOut, a0);
    const [x1o, y1o] = polar(rOut, a1);
    const [x1i, y1i] = polar(rIn, a1);
    const [x0i, y0i] = polar(rIn, a0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${x0o} ${y0o} A ${rOut} ${rOut} 0 ${large} 1 ${x1o} ${y1o} L ${x1i} ${y1i} A ${rIn} ${rIn} 0 ${large} 0 ${x0i} ${y0i} Z`;
  }

  // Outer slices: one per namespace. Inner slices: tiers within each namespace. Angles clockwise from 12 o'clock.
  const slices = $derived.by(() => {
    const total = agg.total;
    if (total === 0)
      return {
        outer: [] as { ns: string; path: string; mid: number; count: number }[],
        inner: [] as { ns: string; tier: string; path: string; count: number }[],
      };
    let a = -Math.PI / 2;
    const outer: { ns: string; path: string; mid: number; count: number }[] = [];
    for (const ns of NS_ORDER) {
      const c = agg.nsCounts.get(ns) ?? 0;
      if (c === 0) continue;
      const frac = c / total;
      const a1 = a + frac * 2 * Math.PI;
      outer.push({ ns, path: arcPath(rOuter, rOuterIn, a, a1), mid: (a + a1) / 2, count: c });
      a = a1;
    }
    // Inner ring: re-walk namespaces, splitting each by tier.
    a = -Math.PI / 2;
    const inner: { ns: string; tier: string; path: string; count: number }[] = [];
    for (const ns of NS_ORDER) {
      const c = agg.nsCounts.get(ns) ?? 0;
      if (c === 0) continue;
      const nsFrac = c / total;
      const nsStart = a;
      const nsEnd = a + nsFrac * 2 * Math.PI;
      let b = nsStart;
      for (const t of TIERS) {
        const cell = agg.cells.find((x) => x.ns === ns && x.tier === t.key);
        if (!cell) continue;
        const tierFrac = cell.count / c;
        const b1 = b + tierFrac * (nsEnd - nsStart);
        inner.push({ ns, tier: t.key, path: arcPath(rInner, rInnerIn, b, b1), count: cell.count });
        b = b1;
      }
      a = nsEnd;
    }
    return { outer, inner };
  });

  // Label only when the arc's fraction > 6% (otherwise too cramped).
  function labelFor(ns: string, mid: number, count: number) {
    const r = (rOuter + rOuterIn) / 2;
    const [x, y] = polar(r, mid);
    return { x, y, text: `${ns} ${count}` };
  }
</script>

{#if agg.total === 0}
  <div class="text-xs italic text-muted-foreground">No GO annotations to chart.</div>
{:else}
  <div class="relative flex flex-wrap items-center gap-4">
    {#if exportName}
      <div class="absolute right-1 top-1 z-10">
        <PlotExportMenu getSvg={() => svgEl} baseName={exportName} />
      </div>
    {/if}
    <svg
      bind:this={svgEl}
      viewBox="0 0 {size} {size}"
      width={size}
      height={size}
      role="img"
      aria-label="GO namespace × evidence-code donut"
    >
      <!-- Outer ring: namespace -->
      {#each slices.outer as s (s.ns)}
        {@const lbl = labelFor(s.ns, s.mid, s.count)}
        <path d={s.path} fill={NS_COLOR[s.ns]} opacity="1">
          <title>{NS_LABEL[s.ns]}: {s.count}</title>
        </path>
        {#if s.count / agg.total > 0.06}
          <text
            x={lbl.x}
            y={lbl.y}
            text-anchor="middle"
            dominant-baseline="middle"
            font-size="10"
            font-weight="600"
            fill="white"
            pointer-events="none">{lbl.text}</text
          >
        {/if}
      {/each}
      <!-- Inner ring: evidence tier within namespace -->
      {#each slices.inner as s (s.ns + ':' + s.tier)}
        <path d={s.path} fill={TIER_GREY[s.tier]}>
          <title>{NS_LABEL[s.ns]} · {TIERS.find((t) => t.key === s.tier)?.label}: {s.count}</title>
        </path>
      {/each}
      <!-- Center label -->
      <text
        x={cx}
        y={cy - 4}
        text-anchor="middle"
        dominant-baseline="middle"
        font-size="14"
        font-weight="700"
        class="fill-foreground"
      >
        {agg.total}
      </text>
      <text
        x={cx}
        y={cy + 10}
        text-anchor="middle"
        dominant-baseline="middle"
        font-size="9"
        class="fill-muted-foreground"
      >
        GO terms
      </text>
    </svg>
    <div class="space-y-1 text-[0.7rem]">
      <div class="font-semibold text-foreground">Outer: namespace</div>
      <div class="flex flex-col gap-0.5">
        {#each NS_ORDER as ns (ns)}
          {#if (agg.nsCounts.get(ns) ?? 0) > 0}
            <div class="inline-flex items-center gap-1.5">
              <span class="inline-block h-2 w-2 rounded-sm" style="background:{NS_COLOR[ns]}"
              ></span>
              <span>{NS_LABEL[ns]}</span>
              <span class="font-mono tabular-nums text-muted-foreground"
                >{agg.nsCounts.get(ns)}</span
              >
            </div>
          {/if}
        {/each}
      </div>
      <div class="mt-2 font-semibold text-foreground">Inner: evidence tier</div>
      <div class="flex flex-col gap-0.5">
        {#each TIERS as t (t.key)}
          <div class="inline-flex items-center gap-1.5">
            <span class="inline-block h-2 w-2 rounded-sm" style="background:{TIER_GREY[t.key]}"
            ></span>
            <span>{t.label}</span>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}
