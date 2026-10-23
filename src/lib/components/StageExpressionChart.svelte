<script lang="ts">
  import type { StageExpression } from '$lib/queries';

  let { stages }: { stages: StageExpression[] } = $props();

  const W = 440;
  const H = 150;
  const PAD = { top: 10, right: 8, bottom: 26, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const rows = $derived(stages.filter((s) => s.median_fpkm != null));
  const max = $derived(Math.max(1, ...rows.map((s) => s.median_fpkm ?? 0)));
  const slot = $derived(rows.length ? plotW / rows.length : plotW);
  const barW = $derived(Math.min(36, slot * 0.6));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = $derived.by(() => {
    const step = niceStep(max / 3);
    const out: number[] = [];
    for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
    return out;
  });
  function niceStep(raw: number): number {
    const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-6)));
    const r = raw / mag;
    return (r >= 5 ? 5 : r >= 2 ? 2 : 1) * mag;
  }
  const fmt = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
</script>

<svg viewBox="0 0 {W} {H}" class="h-auto w-full max-w-[460px] text-[10px]" role="img">
  {#each ticks as t (t)}
    <line
      x1={PAD.left}
      x2={W - PAD.right}
      y1={y(t)}
      y2={y(t)}
      stroke="currentColor"
      stroke-opacity="0.12"
    />
    <text x={PAD.left - 4} y={y(t) + 3} text-anchor="end" fill="currentColor" fill-opacity="0.7">
      {fmt(t)}
    </text>
  {/each}
  {#each rows as s, i (s.stage_id)}
    {@const cx = PAD.left + slot * (i + 0.5)}
    {@const v = s.median_fpkm ?? 0}
    <rect
      x={cx - barW / 2}
      y={y(v)}
      width={barW}
      height={PAD.top + plotH - y(v)}
      class="fill-primary/70"
    >
      <title>{s.stage}: median {fmt(v)} FPKM over {s.n_libraries} libraries</title>
    </rect>
    <text x={cx} y={H - PAD.bottom + 12} text-anchor="middle" fill="currentColor">{s.stage}</text>
    <text
      x={cx}
      y={H - PAD.bottom + 22}
      text-anchor="middle"
      fill="currentColor"
      fill-opacity="0.55"
    >
      n={s.n_libraries}
    </text>
  {/each}
  <text
    x={10}
    y={PAD.top + plotH / 2}
    transform="rotate(-90 10 {PAD.top + plotH / 2})"
    text-anchor="middle"
    fill="currentColor"
    fill-opacity="0.7"
  >
    FPKM
  </text>
</svg>
