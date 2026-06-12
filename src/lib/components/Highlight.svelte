<script lang="ts">
  let { text = '', regex }: { text: string | null | undefined; regex: RegExp | null } = $props();

  const parts = $derived.by<{ text: string; hit: boolean }[]>(() => {
    const value = text ?? '';
    if (!regex || !value) return [{ text: value, hit: false }];
    const out: { text: string; hit: boolean }[] = [];
    let last = 0;
    const re = new RegExp(
      regex.source,
      regex.flags.includes('g') ? regex.flags : regex.flags + 'g',
    );
    for (let m: RegExpExecArray | null; (m = re.exec(value)); ) {
      if (m.index > last) out.push({ text: value.slice(last, m.index), hit: false });
      out.push({ text: m[0], hit: true });
      last = m.index + m[0].length;
      if (m.index === re.lastIndex) re.lastIndex++; // empty match guard
    }
    if (last < value.length) out.push({ text: value.slice(last), hit: false });
    return out;
  });
</script>

{#each parts as p, i (i)}
  {#if p.hit}
    <mark class="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-500/30"
      >{p.text}</mark
    >
  {:else}
    {p.text}
  {/if}
{/each}
