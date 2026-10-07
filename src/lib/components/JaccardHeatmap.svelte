<script lang="ts">
  import { rangeColor, rangeTextColor } from '$lib/plot-colors';
  // Symmetric N x N Jaccard matrix (|A ∩ B| / |A ∪ B|) for the /compare page (N ≥ 2 genes).

  interface GeneSets {
    name: string; // display label
    ids: string[]; // member ids (deduped internally)
  }

  let { sets, title }: { sets: GeneSets[]; title: string } = $props();

  const N = $derived(sets.length);

  const matrix = $derived.by(() => {
    const deduped = sets.map((s) => new Set(s.ids));
    const m: number[][] = [];
    for (let i = 0; i < N; i++) {
      const row: number[] = [];
      for (let j = 0; j < N; j++) {
        if (i === j) {
          row.push(1);
          continue;
        }
        const a = deduped[i];
        const b = deduped[j];
        if (a.size === 0 && b.size === 0) {
          row.push(0);
          continue;
        }
        let inter = 0;
        for (const x of a) if (b.has(x)) inter++;
        const union = a.size + b.size - inter;
        row.push(union === 0 ? 0 : inter / union);
      }
      m.push(row);
    }
    return m;
  });

  const dedupedSizes = $derived(sets.map((s) => new Set(s.ids).size));

  const shade = rangeColor;

  function fmt(v: number): string {
    if (v === 1) return '1';
    if (v === 0) return '0';
    return v.toFixed(2);
  }
</script>

<div>
  <div class="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
    {title}
  </div>
  {#if N < 2}
    <div class="text-xs italic text-muted-foreground">Need at least 2 genes.</div>
  {:else}
    <div class="inline-block overflow-x-auto">
      <table class="border-collapse text-xs">
        <thead>
          <tr>
            <th class="px-2 py-1"></th>
            {#each sets as s, i (i)}
              <th
                class="px-2 py-1 font-mono text-[0.65rem] text-muted-foreground"
                style="min-width: 56px;"
              >
                <div class="max-w-[80px] truncate" title={s.name}>{s.name}</div>
                <div class="font-normal text-muted-foreground/60">({dedupedSizes[i]})</div>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each matrix as row, i (i)}
            <tr>
              <th class="px-2 py-1 text-right font-mono text-[0.65rem] text-muted-foreground">
                <div class="max-w-[80px] truncate" title={sets[i].name}>{sets[i].name}</div>
              </th>
              {#each row as v, j (j)}
                <td
                  class="border border-border/40 text-center font-mono text-[0.65rem] tabular-nums"
                  style="background: {shade(v)}; color: {rangeTextColor(
                    v,
                  )}; min-width: 56px; height: 28px;"
                  title={`${sets[i].name} ∩ ${sets[j].name}: ${fmt(v)}`}
                >
                  {i === j ? '' : fmt(v)}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="mt-1 text-[0.6rem] text-muted-foreground">
      Jaccard = |A ∩ B| / |A ∪ B|. Numbers in parentheses are set sizes.
    </div>
  {/if}
</div>
