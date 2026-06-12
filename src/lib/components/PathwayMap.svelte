<script lang="ts">
  import type { Kgml, KgmlEntry } from '$lib/kgml';
  import GeneHover from './GeneHover.svelte';
  import { resolve } from '$app/paths';

  type EntryGene = { wb: string; name: string };

  type Props = {
    kgml: Kgml;
    /** Object URL of the KEGG-rendered background image (WebP/PNG). When set,
        KGML hotspots are layered on top instead of drawing raw shapes. */
    imageUrl?: string | null;
    /** Native pixel dimensions of the background image. KGML entry coords live
        in this pixel space, so the SVG viewBox must match for overlay rects to
        align. Falls back to the KGML bounding box when no image is supplied. */
    imageWidth?: number | null;
    imageHeight?: number | null;
    overlay?: Map<string, string>;
    tooltip?: Map<string, string>;
    /** Worm genes per entry. When provided, tooltips/popover use these instead of the truncated KGML label. */
    entryGenes?: Map<string, EntryGene[]>;
    onEntryClick?: (entry: KgmlEntry) => void;
  };
  let {
    kgml,
    imageUrl,
    imageWidth,
    imageHeight,
    overlay,
    tooltip,
    entryGenes,
    onEntryClick,
  }: Props = $props();

  const canvasW = $derived(imageUrl && imageWidth ? imageWidth : kgml.width);
  const canvasH = $derived(imageUrl && imageHeight ? imageHeight : kgml.height);

  // Zoom/pan via viewBox manipulation (preserves SVG vector quality; no CSS-transform raster blur).
  let containerEl: HTMLDivElement | null = $state(null);
  let viewW = $state(0);
  let viewH = $state(0);
  let viewX = $state(0);
  let viewY = $state(0);

  // Reset view on pathway/canvas change.
  $effect(() => {
    void kgml;
    void canvasW;
    void canvasH;
    viewX = 0;
    viewY = 0;
    viewW = canvasW;
    viewH = canvasH;
  });

  // Pan via drag; pixel deltas are back-projected through viewBox scale to KGML units.
  let dragging = $state(false);
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartViewX = 0;
  let dragStartViewY = 0;

  function reset() {
    viewX = 0;
    viewY = 0;
    viewW = kgml.width;
    viewH = kgml.height;
  }

  function zoomAt(factor: number, cx: number, cy: number) {
    // cx/cy: KGML-coord point fixed under the zoom.
    const nw = viewW * factor;
    const nh = viewH * factor;
    viewX = cx - ((cx - viewX) * nw) / viewW;
    viewY = cy - ((cy - viewY) * nh) / viewH;
    viewW = nw;
    viewH = nh;
  }

  function pointFromEvent(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = containerEl?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    return { x: viewX + px * viewW, y: viewY + py * viewH };
  }

  function onWheel(e: WheelEvent) {
    // Consume wheel for zoom (like KEGG.jp); user can scroll the page by moving off the map.
    e.preventDefault();
    const { x, y } = pointFromEvent(e);
    zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, x, y);
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    // Dismiss popover on background click (popover stops propagation, so clicks inside don't reach here).
    pinnedEntry = null;
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartViewX = viewX;
    dragStartViewY = viewY;
  }
  function onMouseMove(e: MouseEvent) {
    if (!dragging || !containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    const dx = ((e.clientX - dragStartX) / rect.width) * viewW;
    const dy = ((e.clientY - dragStartY) / rect.height) * viewH;
    viewX = dragStartViewX - dx;
    viewY = dragStartViewY - dy;
  }
  function onMouseUp() {
    dragging = false;
  }

  function fillFor(e: KgmlEntry): string {
    const o = overlay?.get(e.id);
    if (o) return o;
    if (e.type === 'compound') return '#fff5b1';
    if (e.type === 'map') return '#ccddff';
    return e.bg || '#bfffbf';
  }
  function tipFor(e: KgmlEntry): string {
    // KEGG boxes can hold multiple worm orthologs of one mammalian gene (e.g. AMPK = aakb-1/aak-1/...);
    // prefer resolved worm symbols from entryGenes, fall back to KGML labels.
    const resolved = entryGenes?.get(e.id) ?? [];
    const all =
      resolved.length > 0
        ? resolved.map((g) => g.name).join(', ')
        : e.labels.length > 1
          ? e.labels.join(', ')
          : e.label;
    const base = `${all} (${e.type})`;
    const extra = tooltip?.get(e.id);
    return extra ? `${base} · ${extra}` : base;
  }

  // Click an entry with ≥2 mapped worm genes to pin a popover; each chip wraps GeneHover.
  let pinnedEntry = $state<KgmlEntry | null>(null);

  const pinnedScreen = $derived.by<{ left: number; top: number; w: number; h: number } | null>(
    () => {
      if (!pinnedEntry || !containerEl) return null;
      const r = containerEl.getBoundingClientRect();
      return {
        left: ((pinnedEntry.x - viewX) / viewW) * r.width,
        top: ((pinnedEntry.y - viewY) / viewH) * r.height,
        w: (pinnedEntry.width / viewW) * r.width,
        h: (pinnedEntry.height / viewH) * r.height,
      };
    },
  );

  function handleEntryClick(e: KgmlEntry) {
    // Entries with multiple resolved worm genes get the popover (KEGG groups/orthologs).
    if (e.type === 'gene' || e.type === 'ortholog' || e.type === 'group') {
      const genes = entryGenes?.get(e.id) ?? [];
      if (genes.length > 1) {
        pinnedEntry = e;
        return;
      }
    }
    pinnedEntry = null;
    onEntryClick?.(e);
  }

  const zoomPct = $derived(Math.round((canvasW / viewW) * 100));
</script>

<svelte:window onmousemove={onMouseMove} onmouseup={onMouseUp} />

<div class="space-y-2">
  <div class="flex flex-wrap items-center gap-2 text-xs">
    <button
      class="rounded border px-2 py-0.5 hover:bg-accent"
      onclick={() => zoomAt(1.25, viewX + viewW / 2, viewY + viewH / 2)}>−</button
    >
    <span class="font-mono text-muted-foreground">{zoomPct}%</span>
    <button
      class="rounded border px-2 py-0.5 hover:bg-accent"
      onclick={() => zoomAt(1 / 1.25, viewX + viewW / 2, viewY + viewH / 2)}>+</button
    >
    <button class="rounded border px-2 py-0.5 hover:bg-accent" onclick={reset}>Reset</button>
    <span class="text-muted-foreground">Wheel to zoom · drag to pan</span>
  </div>

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    bind:this={containerEl}
    class="relative h-[600px] overflow-hidden rounded border bg-white focus:outline-none focus:ring-1 focus:ring-primary"
    style:cursor={dragging ? 'grabbing' : 'grab'}
    role="application"
    tabindex="0"
    aria-label="Pathway map, zoom with wheel or plus/minus, drag to pan"
    onwheel={onWheel}
    onmousedown={onMouseDown}
    onkeydown={(e) => {
      if (e.key === '+' || e.key === '=') zoomAt(1 / 1.25, viewX + viewW / 2, viewY + viewH / 2);
      else if (e.key === '-' || e.key === '_') zoomAt(1.25, viewX + viewW / 2, viewY + viewH / 2);
      else if (e.key === '0') reset();
    }}
  >
    <svg
      width="100%"
      height="100%"
      viewBox={`${viewX} ${viewY} ${viewW} ${viewH}`}
      class="select-none font-sans"
      preserveAspectRatio="xMidYMid meet"
    >
      {#if imageUrl}
        <image
          href={imageUrl}
          x="0"
          y="0"
          width={canvasW}
          height={canvasH}
          preserveAspectRatio="none"
          pointer-events="none"
        />
        {#each kgml.entries as e (e.id)}
          {#if overlay?.has(e.id)}
            <rect
              x={e.x - e.width / 2}
              y={e.y - e.height / 2}
              width={e.width}
              height={e.height}
              fill={fillFor(e)}
              fill-opacity="0.55"
              stroke="none"
              pointer-events="none"
            />
          {/if}
          <rect
            x={e.x - e.width / 2}
            y={e.y - e.height / 2}
            width={e.width}
            height={e.height}
            fill="transparent"
            stroke="transparent"
            class={onEntryClick
              ? 'cursor-pointer hover:!fill-blue-200/30 hover:!stroke-blue-500 hover:!stroke-2'
              : ''}
            onclick={(ev) => {
              if (!onEntryClick) return;
              // Ignore click at end of pan.
              if (dragging) return;
              ev.stopPropagation();
              handleEntryClick(e);
            }}
            role={onEntryClick ? 'button' : undefined}
            tabindex={onEntryClick ? 0 : undefined}
          >
            <title>{tipFor(e)}</title>
          </rect>
        {/each}
      {:else}
        {#each kgml.relations as r, i (i)}
          {@const a = kgml.entries.find((e) => e.id === r.entry1)}
          {@const b = kgml.entries.find((e) => e.id === r.entry2)}
          {#if a && b}
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#888"
              stroke-width="1"
              stroke-opacity="0.5"
            />
          {/if}
        {/each}
        {#each kgml.entries as e (e.id)}
          {#if e.shape === 'circle' || e.type === 'compound'}
            <circle
              cx={e.x}
              cy={e.y}
              r={Math.min(e.width, e.height) / 2}
              fill={fillFor(e)}
              stroke={e.fg}
            >
              <title>{tipFor(e)}</title>
            </circle>
          {:else}
            <rect
              x={e.x - e.width / 2}
              y={e.y - e.height / 2}
              width={e.width}
              height={e.height}
              fill={fillFor(e)}
              stroke={e.fg}
              stroke-width="1"
              rx="2"
            >
              <title>{tipFor(e)}</title>
            </rect>
          {/if}
          <text
            x={e.x}
            y={e.y + 3}
            text-anchor="middle"
            font-size="9"
            fill="#222"
            pointer-events="none">{e.label}</text
          >
        {/each}
      {/if}
    </svg>

    {#if pinnedEntry && pinnedScreen}
      {@const genes = entryGenes?.get(pinnedEntry.id) ?? []}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="absolute z-20 max-w-md rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
        style:left="{Math.max(
          8,
          Math.min(pinnedScreen.left, (containerEl?.clientWidth ?? 0) - 280),
        )}px"
        style:top="{pinnedScreen.top + pinnedScreen.h / 2 + 8}px"
        onclick={(ev) => ev.stopPropagation()}
        onmousedown={(ev) => ev.stopPropagation()}
      >
        <div class="mb-1 flex items-baseline justify-between gap-2">
          <span class="text-xs font-semibold">{pinnedEntry.label}</span>
          <button
            class="text-xs text-muted-foreground hover:text-foreground"
            onclick={() => (pinnedEntry = null)}>×</button
          >
        </div>
        <div class="text-[10px] text-muted-foreground">
          {genes.length} worm orthologs · click to open · hover for details
        </div>
        <div class="mt-1.5 flex flex-wrap gap-1">
          {#each genes as g (g.wb)}
            <GeneHover id={g.wb}>
              <a
                href={resolve(`/gene/${g.wb}`)}
                class="rounded border px-1.5 py-0.5 font-mono text-xs hover:bg-accent"
              >
                {g.name}
              </a>
            </GeneHover>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>
