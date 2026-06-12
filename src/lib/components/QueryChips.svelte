<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { Badge } from '$lib/components/ui/badge';
  import { parseQuery, type Op, type ParsedQuery } from '$lib/search';
  import Tag from 'lucide-svelte/icons/tag';
  import ListChecks from 'lucide-svelte/icons/list-checks';
  import X from 'lucide-svelte/icons/x';

  let { parsed }: { parsed: ParsedQuery | null } = $props();

  // Round-trip an op back to its raw string form so we can locate-and-remove
  // it from the input. Quote the value when it contains whitespace.
  function opToString(op: Op): string {
    const sep = op.mode === 'like' ? '~' : ':';
    const needsQuote = /\s/.test(op.value);
    const val = needsQuote ? `"${op.value}"` : op.value;
    return `${op.key}${sep}${val}`;
  }

  // Remove a specific op from the current ?q= and navigate.
  function removeOp(target: Op) {
    const url = new URL(page.url);
    const raw = url.searchParams.get('q') ?? '';
    const reparsed = parseQuery(raw);
    const remainingOps = reparsed.ops.filter(
      (o) => !(o.key === target.key && o.value === target.value && o.mode === target.mode),
    );
    const parts: string[] = [];
    if (reparsed.freeText) parts.push(reparsed.freeText);
    for (const o of remainingOps) parts.push(opToString(o));
    const next = parts.join(' ').trim();
    if (next) url.searchParams.set('q', next);
    else url.searchParams.delete('q');
    url.searchParams.delete('page');
    goto(resolve((url.pathname + url.search) as '/'), { keepFocus: true, noScroll: true });
  }

  function removeFreeText() {
    const url = new URL(page.url);
    const raw = url.searchParams.get('q') ?? '';
    const reparsed = parseQuery(raw);
    const parts: string[] = [];
    for (const o of reparsed.ops) parts.push(opToString(o));
    const next = parts.join(' ').trim();
    if (next) url.searchParams.set('q', next);
    else url.searchParams.delete('q');
    url.searchParams.delete('page');
    goto(resolve((url.pathname + url.search) as '/'), { keepFocus: true, noScroll: true });
  }

  function clearAll() {
    const url = new URL(page.url);
    url.searchParams.delete('q');
    url.searchParams.delete('page');
    goto(resolve((url.pathname + url.search) as '/'), { keepFocus: true, noScroll: true });
  }

  const hasAny = $derived(
    !!parsed &&
      parsed.mode !== 'empty' &&
      (parsed.ops.length > 0 || !!parsed.freeText || parsed.mode === 'genelist'),
  );
</script>

{#if parsed && parsed.mode !== 'empty'}
  <div class="flex flex-wrap items-center gap-1.5 text-xs">
    {#if parsed.mode === 'genelist'}
      <Badge variant="outline" class="gap-1">
        <ListChecks class="h-3 w-3" />
        gene list ({parsed.ids.length})
      </Badge>
    {/if}
    {#each parsed.ops as op, i (i)}
      <Badge variant="secondary" class="gap-1 pr-0.5 font-mono">
        <Tag class="h-3 w-3" />
        {op.key}{op.mode === 'like' ? '~' : ':'}{op.value}
        <button
          type="button"
          onclick={() => removeOp(op)}
          aria-label="Remove {op.key} filter"
          class="ml-0.5 inline-flex items-center justify-center rounded p-0.5 transition-colors hover:bg-background/60"
        >
          <X class="h-3 w-3" />
        </button>
      </Badge>
    {/each}
    {#if parsed.freeText}
      <Badge variant="outline" class="gap-1 pr-0.5 font-mono">
        {parsed.freeText}
        <button
          type="button"
          onclick={removeFreeText}
          aria-label="Remove free-text search"
          class="ml-0.5 inline-flex items-center justify-center rounded p-0.5 transition-colors hover:bg-background/60"
        >
          <X class="h-3 w-3" />
        </button>
      </Badge>
    {/if}
    {#if hasAny}
      <button
        type="button"
        onclick={clearAll}
        class="ml-1 text-[0.65rem] uppercase tracking-wider text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Clear
      </button>
    {/if}
  </div>
{/if}
