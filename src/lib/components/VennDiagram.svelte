<script lang="ts">
  import { UP_COLOR, DOWN_COLOR, upAlpha, downAlpha } from '$lib/plot-colors';
  // Two-set Venn with directional breakdown. Circle geometry is fixed rather than
  // area-proportional: with counts spanning orders of magnitude a proportional
  // layout collapses the smaller set to a dot, and the numbers carry the size.
  type Side = { label: string; up: number; down: number };
  type Shared = { up: number; down: number; discordant: number };

  let {
    a,
    b,
    shared,
    svgEl = $bindable<SVGSVGElement | null>(null),
  }: {
    a: Side;
    b: Side;
    shared: Shared;
    svgEl?: SVGSVGElement | null;
  } = $props();

  const W = 560;
  const H = 340;
  const R = 118;
  const CX_A = 210;
  const CX_B = 350;
  const CY = 180;

  // Same red/blue the volcano uses for direction.
  const UP = UP_COLOR;
  const DOWN = DOWN_COLOR;

  const totalA = $derived(a.up + a.down);
  const totalB = $derived(b.up + b.down);
  const totalShared = $derived(shared.up + shared.down + shared.discordant);
  const fmt = (n: number) => n.toLocaleString();
</script>

<svg
  bind:this={svgEl}
  viewBox="0 0 {W} {H}"
  class="h-auto w-full max-w-[560px]"
  role="img"
  aria-label="Venn diagram of genes changed in each contrast"
>
  <title>
    {a.label}: {fmt(totalA)} exclusive; {b.label}: {fmt(totalB)} exclusive; shared: {fmt(
      totalShared,
    )}
  </title>

  <circle cx={CX_A} cy={CY} r={R} fill={downAlpha(0.18)} stroke={downAlpha(0.5)} />
  <circle cx={CX_B} cy={CY} r={R} fill={upAlpha(0.18)} stroke={upAlpha(0.5)} />

  <text
    x={CX_A - 40}
    y="34"
    text-anchor="middle"
    class="fill-foreground"
    style="font-size: 15px; font-weight: 600;">{a.label}</text
  >
  <text
    x={CX_B + 40}
    y="34"
    text-anchor="middle"
    class="fill-foreground"
    style="font-size: 15px; font-weight: 600;">{b.label}</text
  >

  <!-- left only -->
  <text x="112" y={CY - 8} text-anchor="middle" style="font-size: 13px; fill: {DOWN};">
    {fmt(a.down)} down
  </text>
  <text x="112" y={CY + 14} text-anchor="middle" style="font-size: 13px; fill: {UP};">
    {fmt(a.up)} up
  </text>

  <!-- right only -->
  <text x="448" y={CY - 8} text-anchor="middle" style="font-size: 13px; fill: {DOWN};">
    {fmt(b.down)} down
  </text>
  <text x="448" y={CY + 14} text-anchor="middle" style="font-size: 13px; fill: {UP};">
    {fmt(b.up)} up
  </text>

  <!-- intersection -->
  <text
    x={(CX_A + CX_B) / 2}
    y={CY - 34}
    text-anchor="middle"
    class="fill-foreground"
    style="font-size: 12px; font-weight: 600;">Shared</text
  >
  <text x={(CX_A + CX_B) / 2} y={CY - 10} text-anchor="middle" style="font-size: 13px; fill: {UP};"
    >{fmt(shared.up)} ↑</text
  >
  <text
    x={(CX_A + CX_B) / 2}
    y={CY + 12}
    text-anchor="middle"
    style="font-size: 13px; fill: {DOWN};">{fmt(shared.down)} ↓</text
  >
  {#if shared.discordant > 0}
    <text
      x={(CX_A + CX_B) / 2}
      y={CY + 32}
      text-anchor="middle"
      class="fill-muted-foreground"
      style="font-size: 11px;">({fmt(shared.discordant)} opposite)</text
    >
  {/if}

  <text
    x={W / 2}
    y={H - 12}
    text-anchor="middle"
    class="fill-muted-foreground"
    style="font-size: 11px;"
  >
    {fmt(totalA)} only in {a.label} · {fmt(totalShared)} shared · {fmt(totalB)} only in {b.label}
  </text>
</svg>
