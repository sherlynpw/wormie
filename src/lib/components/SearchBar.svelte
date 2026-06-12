<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { SvelteURL } from 'svelte/reactivity';
  import { page } from '$app/state';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import Search from 'lucide-svelte/icons/search';
  import Share2 from 'lucide-svelte/icons/share-2';
  import Check from 'lucide-svelte/icons/check';
  import { ALL_FTS_FIELDS, DEFAULT_FTS_FIELDS, type FtsField } from '$lib/search';
  import { suggestGenes, suggestTerms, type SuggestRow, type TermSuggestion } from '$lib/queries';
  import { encodeIds } from '$lib/share';
  import { cn } from '$lib/utils';
  import { toast } from 'svelte-sonner';

  // Pastes longer than this land in `?gz=` instead of `?q=`: keeps URLs readable for typical
  // few-hundred-gene pastes, and avoids FTS5 limits (one bad token in a 1000-gene paste flips
  // the whole query into hybrid mode and matches nothing).
  const LONG_PASTE_THRESHOLD = 1500;

  let { initial = '' }: { initial?: string } = $props();
  // Written by both the bound <Input> and the $effect that resyncs to `initial` on prop change
  // (writable-derived case: $state + $effect instead of $derived).
  // eslint-disable-next-line svelte/prefer-writable-derived
  let value = $state('');
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let suggestTimer: ReturnType<typeof setTimeout> | null = null;
  let suggestRef: HTMLDivElement | null = $state(null);
  let suggestions = $state<SuggestRow[]>([]);
  let termSuggestions = $state<TermSuggestion[]>([]);
  let suggestOpen = $state(false);
  let highlightIdx = $state(-1);
  let suggestToken = 0;
  let shareCopied = $state(false);

  type FlatItem = { kind: 'gene'; row: SuggestRow } | { kind: 'term'; row: TermSuggestion };
  const flatItems = $derived<FlatItem[]>([
    ...suggestions.map((r) => ({ kind: 'gene' as const, row: r })),
    ...termSuggestions.map((r) => ({ kind: 'term' as const, row: r })),
  ]);

  $effect(() => {
    value = initial;
  });

  const FIELD_LABELS: Record<FtsField, string> = {
    gene_name: 'Gene name',
    wb_id: 'WormBase ID',
    entrez_id: 'Entrez ID',
    sequence_name: 'Sequence name',
    other_names: 'Synonyms',
    gene_class_description: 'Gene class',
    concise_description: 'Concise description',
    legacy_description: 'Automated description',
    phenotypes: 'Phenotypes',
    alleles: 'Alleles',
    tissues: 'Tissues',
    go_terms: 'GO terms',
    wormcat: 'WormCat',
    neuronal: 'Neuronal categories',
    orthologs: 'Ortholog symbols',
    synaptogenesis: 'Synaptogenesis panel',
    pathways: 'KEGG pathways',
  };

  const activeFields = $derived.by<FtsField[]>(() => {
    const raw = page.url.searchParams.get('fields');
    if (!raw) return [...DEFAULT_FTS_FIELDS];
    const set = new Set(raw.split(','));
    return ALL_FTS_FIELDS.filter((f) => set.has(f));
  });

  const allActive = $derived(activeFields.length === ALL_FTS_FIELDS.length);
  // True when selection matches the default subset (no `fields` param or an exact reproduction),
  // used to suppress the "filter applied" badge for users who haven't customized anything.
  const isDefault = $derived.by(() => {
    if (activeFields.length !== DEFAULT_FTS_FIELDS.length) return false;
    const set = new Set(activeFields);
    return DEFAULT_FTS_FIELDS.every((f) => set.has(f));
  });
  const canShare = $derived(
    typeof page !== 'undefined' && page.url.searchParams.toString().length > 0,
  );

  async function pushQuery(q: string, replace: boolean) {
    const url = new URL(page.url);
    url.searchParams.delete('page');
    if (!q) {
      url.searchParams.delete('q');
      url.searchParams.delete('gz');
    } else if (q.length > LONG_PASTE_THRESHOLD) {
      // Switch to gz-encoded ID list for huge pastes; split on the same delimiters as parseQuery
      // (whitespace, comma, semicolon, pipe, slash). Falls back to raw `?q=` on encoding error.
      const tokens = q.split(/[\s,;|/]+/).filter(Boolean);
      if (tokens.length > 50) {
        try {
          const token = await encodeIds(tokens);
          url.searchParams.set('gz', token);
          url.searchParams.delete('q');
        } catch {
          url.searchParams.set('q', q);
          url.searchParams.delete('gz');
        }
      } else {
        url.searchParams.set('q', q);
        url.searchParams.delete('gz');
      }
    } else {
      url.searchParams.set('q', q);
      url.searchParams.delete('gz');
    }
    goto(resolve((url.pathname + url.search) as '/'), {
      keepFocus: true,
      noScroll: true,
      replaceState: replace,
    });
  }

  function toggleField(f: FtsField) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const cur = new Set(activeFields);
    if (cur.has(f)) cur.delete(f);
    else cur.add(f);
    const arr = ALL_FTS_FIELDS.filter((x) => cur.has(x));
    const url = new URL(page.url);
    // Empty selection falls back to default (no `fields` param); selecting all writes explicitly
    // so the user's intent survives navigation.
    if (arr.length === 0) {
      url.searchParams.delete('fields');
    } else {
      url.searchParams.set('fields', arr.join(','));
    }
    url.searchParams.delete('page');
    goto(resolve((url.pathname + url.search) as '/'), {
      keepFocus: true,
      noScroll: true,
      replaceState: false,
    });
  }

  function resetFields() {
    const url = new URL(page.url);
    url.searchParams.delete('fields');
    url.searchParams.delete('page');
    goto(resolve((url.pathname + url.search) as '/'), {
      keepFocus: true,
      noScroll: true,
      replaceState: false,
    });
  }

  $effect(() => {
    if (!suggestOpen) return;
    const onClick = (e: MouseEvent) => {
      if (suggestRef && !suggestRef.contains(e.target as Node)) suggestOpen = false;
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  });

  // Detect a trailing operator-scoped fragment (e.g. "pheno:da", 'tissue:"motor"') and return
  // the op kind + partial value for scoped term lookup instead of generic name autocomplete.
  function opAtCursor(q: string): { op: 'pheno' | 'tissue' | 'go'; partial: string } | null {
    const m = q.match(/(?:^|\s)(pheno|tissue|go):"?([^"\s]*)$/i);
    if (!m) return null;
    return { op: m[1].toLowerCase() as 'pheno' | 'tissue' | 'go', partial: m[2] };
  }

  async function refreshSuggestions(q: string) {
    // Scoped operator autosuggest ("pheno:daf-c..." triggers phenotype picker, etc.).
    const scoped = opAtCursor(q);
    if (scoped) {
      const my = ++suggestToken;
      const kind = scoped.op === 'pheno' ? 'phenotype' : scoped.op;
      const terms = await suggestTerms(scoped.partial || ' ', 8, kind);
      if (my !== suggestToken) return;
      suggestions = [];
      termSuggestions = terms;
      suggestOpen = terms.length > 0;
      highlightIdx = -1;
      return;
    }
    // Skip suggestions for op-like queries, gene-list pastes, etc.
    if (q.length < 2 || /[:~,;|]/.test(q) || q.split(/\s+/).length > 3) {
      suggestions = [];
      termSuggestions = [];
      suggestOpen = false;
      return;
    }
    const my = ++suggestToken;
    const [rows, terms] = await Promise.all([suggestGenes(q, 5), suggestTerms(q, 4)]);
    if (my !== suggestToken) return;
    suggestions = rows;
    termSuggestions = terms;
    suggestOpen = rows.length > 0 || terms.length > 0;
    highlightIdx = -1;
  }

  function onInput() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (suggestTimer) clearTimeout(suggestTimer);
    const q = value.trim();
    debounceTimer = setTimeout(() => pushQuery(q, true), 200);
    suggestTimer = setTimeout(() => refreshSuggestions(q), 120);
  }

  function pickGene(s: SuggestRow) {
    suggestOpen = false;
    goto(resolve(`/gene/${s.wormbase_gene}`));
  }

  function termOpPrefix(kind: TermSuggestion['kind']): 'pheno' | 'tissue' | 'go' {
    return kind === 'phenotype' ? 'pheno' : kind === 'tissue' ? 'tissue' : 'go';
  }

  function pickTerm(t: TermSuggestion) {
    suggestOpen = false;
    // Navigate to a scoped home-page search rather than the term-detail view;
    // users almost always want "genes with this phenotype/tissue/GO" first.
    const op = termOpPrefix(t.kind);
    const needsQuote = /\s/.test(t.name);
    const v = needsQuote ? `"${t.name}"` : t.name;
    const url = new SvelteURL(page.url);
    url.pathname = '/';
    url.searchParams.set('q', `${op}:${v}`);
    url.searchParams.delete('page');
    goto(resolve((url.pathname + url.search) as '/'));
  }

  function pickFlat(item: FlatItem) {
    if (item.kind === 'gene') pickGene(item.row);
    else pickTerm(item.row);
  }

  function onKeydown(e: KeyboardEvent) {
    if (!suggestOpen || flatItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightIdx = (highlightIdx + 1) % flatItems.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightIdx = highlightIdx <= 0 ? flatItems.length - 1 : highlightIdx - 1;
    } else if (e.key === 'Enter') {
      if (highlightIdx >= 0 && highlightIdx < flatItems.length) {
        e.preventDefault();
        pickFlat(flatItems[highlightIdx]);
      }
    } else if (e.key === 'Escape') {
      suggestOpen = false;
    }
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (debounceTimer) clearTimeout(debounceTimer);
    suggestOpen = false;
    pushQuery(value.trim(), false);
  }

  let dragOver = $state(false);
  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer) return;
    const items = e.dataTransfer.items;
    if (items && items.length > 0 && items[0].kind === 'file') {
      e.preventDefault();
      dragOver = true;
    }
  }
  function onDragLeave() {
    dragOver = false;
  }
  async function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      // Accept plain lists or TSV/CSV; take the first token of each non-comment line.
      const tokens = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => l.split(/[\s,;|\t]/)[0])
        .filter(Boolean);
      if (tokens.length === 0) {
        toast.error('No gene IDs found in file');
        return;
      }
      const joined = tokens.join(', ');
      value = joined;
      pushQuery(joined, false);
      toast.success(
        `Loaded ${tokens.length.toLocaleString()} ID${tokens.length === 1 ? '' : 's'}`,
        {
          description: file.name,
          duration: 1500,
        },
      );
    } catch (err) {
      toast.error('Could not read file', { description: String(err) });
    }
  }

  async function copyShareLink() {
    const url = page.url.toString();
    try {
      await navigator.clipboard.writeText(url);
      shareCopied = true;
      toast.success('Link copied', {
        description: url.length > 80 ? url.slice(0, 80) + '...' : url,
        duration: 1500,
      });
      setTimeout(() => (shareCopied = false), 1500);
    } catch {
      toast.error('Could not copy link');
    }
  }

  // Operator chips: click to insert "op:" into the input (with a leading space if needed).
  // Grouped to avoid a flat wall of chips; examples from parser comments in $lib/search.ts.
  const OP_GROUPS: { label: string; ops: { key: string; example: string; help: string }[] }[] = [
    {
      label: 'Annotations',
      ops: [
        { key: 'go', example: 'go:apoptosis', help: 'GO term (name or ID)' },
        { key: 'cat', example: 'cat:"cell cycle"', help: 'WormCat category (quote multi-word)' },
        { key: 'pheno', example: 'pheno:locomotion', help: 'WBPhenotype term' },
        { key: 'tissue', example: 'tissue:neuron', help: 'WBbt anatomy term' },
        { key: 'neuronal', example: 'neuronal:GABA', help: 'Neuronal classification' },
        {
          key: 'syn',
          example: 'syn:innexin',
          help: 'Synaptogenesis panel class / subclass / notes (quote multi-word)',
        },
        { key: 'ortho', example: 'ortho:human', help: 'Has ortholog in species/symbol' },
        { key: 'expressed', example: 'expressed:AVA', help: 'Expressed in CeNGEN neuron class' },
      ],
    },
    {
      label: 'Identifiers',
      ops: [
        { key: 'name', example: 'name:daf*', help: 'Gene name / synonym (FTS)' },
        { key: 'seq', example: 'seq:Y110A7A.10', help: 'Sequence name (FTS)' },
        { key: 'wb', example: 'wb~WBGene0000*', help: 'WBGene ID (LIKE/glob)' },
        { key: 'desc', example: 'desc:insulin', help: 'Any description field' },
        { key: 'allele', example: 'allele:e1370', help: 'Allele ID / symbol' },
        { key: 'status', example: 'status:live', help: 'Gene status (live/dead/...)' },
        { key: 'type', example: 'type:protein_coding', help: 'Biotype' },
      ],
    },
  ];
  let showOps = $state(false);

  function insertOp(opKey: string) {
    const sep = value.length === 0 || /\s$/.test(value) ? '' : ' ';
    value = `${value}${sep}${opKey}:`;
    const input = suggestRef?.querySelector('input');
    if (input) {
      (input as HTMLInputElement).focus();
      const len = value.length;
      (input as HTMLInputElement).setSelectionRange(len, len);
    }
  }
</script>

<div class="space-y-2">
  <form onsubmit={submit} class="flex items-center gap-2">
    <div
      bind:this={suggestRef}
      class="relative flex-1"
      role="application"
      ondragover={onDragOver}
      ondragleave={onDragLeave}
      ondrop={onDrop}
    >
      <Search
        class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="text"
        bind:value
        oninput={onInput}
        onkeydown={onKeydown}
        onfocus={() => {
          if (flatItems.length > 0) suggestOpen = true;
        }}
        placeholder="Search by gene name, ID, description, sequence, phenotype... (drop a gene-list file)"
        autocomplete="off"
        spellcheck="false"
        class={cn('pl-9', dragOver && 'ring-2 ring-primary')}
      />
      {#if suggestOpen && flatItems.length > 0}
        <div
          role="listbox"
          class="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border bg-popover shadow-md"
        >
          {#if suggestions.length > 0}
            <div
              class="px-3 pt-1.5 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Genes
            </div>
          {/if}
          {#each flatItems as item, i (item.kind === 'gene' ? `g:${item.row.wormbase_gene}` : `t:${item.row.kind}:${item.row.term_id}`)}
            {#if item.kind === 'term' && i > 0 && flatItems[i - 1].kind === 'gene'}
              <div
                class="mt-0.5 border-t px-3 pt-1.5 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Terms
              </div>
            {/if}
            <button
              type="button"
              role="option"
              aria-selected={i === highlightIdx}
              onclick={() => pickFlat(item)}
              onmouseenter={() => (highlightIdx = i)}
              class={cn(
                'flex w-full items-baseline gap-2 px-3 py-1.5 text-left transition-colors',
                i === highlightIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
              )}
            >
              {#if item.kind === 'gene'}
                <span class="font-medium">{item.row.gene_name ?? item.row.wormbase_gene}</span>
                {#if item.row.sequence_name}
                  <span class="font-mono text-xs text-muted-foreground"
                    >{item.row.sequence_name}</span
                  >
                {/if}
                {#if item.row.gene_class_description}
                  <span class="flex-1 truncate text-xs italic text-muted-foreground">
                    {item.row.gene_class_description}
                  </span>
                {/if}
              {:else}
                <span
                  class="w-12 shrink-0 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground"
                >
                  {item.row.kind === 'phenotype'
                    ? 'pheno'
                    : item.row.kind === 'tissue'
                      ? 'tissue'
                      : 'go'}
                </span>
                <span class="flex-1 truncate font-medium">{item.row.name}</span>
                <span class="font-mono text-[0.65rem] tabular-nums text-muted-foreground">
                  {item.row.n_genes.toLocaleString()}
                </span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    {#if canShare}
      <Button
        type="button"
        variant="outline"
        size="default"
        onclick={copyShareLink}
        title="Copy a shareable link to this search"
      >
        {#if shareCopied}<Check class="h-4 w-4 text-green-600" />{:else}<Share2
            class="h-4 w-4"
          />{/if}
      </Button>
    {/if}
    <Button type="submit">Search</Button>
  </form>

  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
    <span class="font-medium text-foreground/80">Search in:</span>
    {#each ALL_FTS_FIELDS as f (f)}
      {@const checked = activeFields.includes(f)}
      <label
        class="inline-flex cursor-pointer select-none items-center gap-1 transition-colors hover:text-foreground"
      >
        <input type="checkbox" {checked} onchange={() => toggleField(f)} class="h-3 w-3 rounded" />
        <span class={checked ? 'text-foreground' : ''}>{FIELD_LABELS[f]}</span>
      </label>
    {/each}
    <div class="ml-auto flex items-center gap-2">
      <button
        type="button"
        onclick={() => {
          const url = new URL(page.url);
          url.searchParams.set('fields', ALL_FTS_FIELDS.join(','));
          url.searchParams.delete('page');
          goto(resolve((url.pathname + url.search) as '/'), {
            keepFocus: true,
            noScroll: true,
            replaceState: false,
          });
        }}
        class={cn('text-[0.65rem] text-primary hover:underline', allActive && 'invisible')}
      >
        All
      </button>
      <button
        type="button"
        onclick={resetFields}
        class={cn('text-[0.65rem] text-primary hover:underline', isDefault && 'invisible')}
      >
        Default
      </button>
    </div>
  </div>

  <!-- Operator chips -->
  <div class="flex flex-wrap items-start gap-x-2 gap-y-1 text-xs">
    <button
      type="button"
      onclick={() => (showOps = !showOps)}
      class="inline-flex items-center gap-1 rounded border border-dashed bg-card px-2 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-expanded={showOps}
    >
      <span class="font-mono">filters{showOps ? ' ▾' : ' ▸'}</span>
    </button>
    {#if showOps}
      {#each OP_GROUPS as g (g.label)}
        <div class="inline-flex flex-wrap items-center gap-1">
          <span class="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
            {g.label}:
          </span>
          {#each g.ops as op (op.key)}
            <button
              type="button"
              onclick={() => insertOp(op.key)}
              class="inline-flex items-baseline gap-1 rounded border bg-card px-1.5 py-0.5 font-mono text-[0.7rem] text-foreground transition-colors hover:bg-accent"
              title={`${op.help} — example: ${op.example}`}
            >
              {op.key}<span class="text-muted-foreground">:</span>
            </button>
          {/each}
        </div>
      {/each}
      <span class="basis-full text-[0.65rem] text-muted-foreground">
        Combine with AND / OR / NOT. Append <span class="font-mono">*</span> for prefix (<span
          class="font-mono">daf*</span
        >) or quote a phrase (<span class="font-mono">"insulin signaling"</span>). Use
        <span class="font-mono">~</span>
        instead of <span class="font-mono">:</span> for glob LIKE on identifier fields (<span
          class="font-mono">wb~WBGene0000*</span
        >).
      </span>
    {/if}
  </div>
</div>
