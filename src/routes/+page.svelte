<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { untrack, onMount } from 'svelte';
  import { runSearch, getFacets, getMatchedIds, type GeneRow, type Facets } from '$lib/queries';
  import { readIdsFromUrl } from '$lib/share';
  import { cn } from '$lib/utils';
  import { exportTsv, exportCsv } from '$lib/exports';
  import { buildIdsQuery } from '$lib/share';
  import {
    highlightRegex,
    parseQuery,
    ALL_FTS_FIELDS,
    DEFAULT_FTS_FIELDS,
    type FtsField,
    type ParsedQuery,
  } from '$lib/search';
  import SearchBar from '$lib/components/SearchBar.svelte';
  import FacetsBar from '$lib/components/FacetsBar.svelte';
  import QueryChips from '$lib/components/QueryChips.svelte';
  import CardsView from '$lib/components/views/CardsView.svelte';
  import TableView from '$lib/components/views/TableView.svelte';
  import WormCatView from '$lib/components/views/WormCatView.svelte';
  import NeuronalView from '$lib/components/views/NeuronalView.svelte';
  import SynaptogenesisView from '$lib/components/views/SynaptogenesisView.svelte';
  import GoView from '$lib/components/views/GoView.svelte';
  import { Button } from '$lib/components/ui/button';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Pagination from '$lib/components/Pagination.svelte';
  import PageHint from '$lib/components/PageHint.svelte';
  import { toast } from 'svelte-sonner';
  import Download from 'lucide-svelte/icons/download';
  import BarChart from 'lucide-svelte/icons/bar-chart-3';
  import FileSearch from 'lucide-svelte/icons/file-search';
  import GitCompare from 'lucide-svelte/icons/git-compare';

  const PAGE_SIZE = 100;

  let rows = $state<GeneRow[]>([]);
  let parsed = $state<ParsedQuery | null>(null);
  let facets = $state<Facets | null>(null);
  let elapsedMs = $state(0);
  let loading = $state(false);
  let loadingMore = $state(false);
  let hasMore = $state(false);
  // Keyboard nav: -1 = nothing focused (avoids stealing focus on fresh render). j/k move, Enter navigates.
  // Ignored when an input/textarea is focused so search typing still works.
  let activeIdx = $state<number>(-1);

  // Reset activeIdx on result set change so j/k restarts at the top.
  $effect(() => {
    void rows;
    untrack(() => {
      activeIdx = -1;
    });
  });

  onMount(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const editable =
        tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      if (editable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (rows.length === 0) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = activeIdx < 0 ? 0 : Math.min(rows.length - 1, activeIdx + 1);
        scrollActiveIntoView();
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = activeIdx < 0 ? 0 : Math.max(0, activeIdx - 1);
        scrollActiveIntoView();
      } else if (e.key === 'Enter') {
        if (activeIdx < 0 || activeIdx >= rows.length) return;
        e.preventDefault();
        goto(resolve(`/gene/${rows[activeIdx].wormbase_gene}`));
      }
    }
    function scrollActiveIntoView() {
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-row-idx="${activeIdx}"]`);
        if (el) (el as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Large gene-list pastes arrive as ?gz= (gzip-encoded) rather than ?q= to avoid
  // URL length limits in SvelteKit routing, FTS5, and pushState; decoded here before downstream use.
  let q = $state('');
  $effect(() => {
    const direct = page.url.searchParams.get('q');
    if (direct) {
      q = direct;
      return;
    }
    const gz = page.url.searchParams.get('gz');
    if (gz) {
      let cancelled = false;
      readIdsFromUrl(page.url).then((ids) => {
        if (!cancelled) q = ids.join(',');
      });
      return () => {
        cancelled = true;
      };
    }
    q = '';
  });
  const fieldsParam = $derived(page.url.searchParams.get('fields'));
  const activeFields = $derived.by<FtsField[] | undefined>(() => {
    if (!fieldsParam) return DEFAULT_FTS_FIELDS as FtsField[];
    const set = new Set(fieldsParam.split(','));
    const out = ALL_FTS_FIELDS.filter((f) => set.has(f));
    return out.length === ALL_FTS_FIELDS.length ? undefined : out;
  });
  const view = $derived(page.url.searchParams.get('view') ?? 'cards');
  // Default 'live' hides dead genes; ?status=all disables the filter.
  const statusFilter = $derived(page.url.searchParams.get('status') ?? 'live');
  const currentPage = $derived(
    Math.max(1, parseInt(page.url.searchParams.get('page') ?? '1', 10) || 1),
  );

  const needsGeneList = $derived(view === 'cards' || view === 'table');
  const effectiveQuery = $derived.by(() => {
    if (!statusFilter || statusFilter === 'all') return q;
    // Gene-list mode: skip status filter (user asked for specific genes; appending any op also breaks genelist parsing).
    if (q && parseQuery(q).mode === 'genelist') return q;
    return `${q} status:${statusFilter}`.trim();
  });
  const totalPages = $derived(facets ? Math.max(1, Math.ceil(facets.n_genes / PAGE_SIZE)) : 1);
  const VIEW_HEADERS: Record<string, { title: string; caption: string }> = {
    wormcat: { title: 'WormCat', caption: 'Genes grouped by WormCat category' },
    go: { title: 'GO terms', caption: 'Genes grouped by Gene Ontology term' },
    neuronal: { title: 'Neuronal class', caption: 'Genes grouped by neuronal classification' },
    synaptogenesis: {
      title: 'Synaptogenesis',
      caption: 'Genes grouped by synaptogenesis panel class',
    },
  };
  const viewHeader = $derived(VIEW_HEADERS[view] ?? null);
  // `status:` is appended from the live/dead/all toggle, so it is not the user's
  // text and its chip would offer a remove button that edits nothing.
  const displayParsed = $derived.by(() => {
    if (!parsed) return parsed;
    if (q.includes('status:')) return parsed;
    return { ...parsed, ops: parsed.ops.filter((o) => o.key !== 'status') };
  });

  let queryToken = 0;

  $effect(() => {
    const eq = effectiveQuery;
    const nl = needsGeneList;
    const p = currentPage;
    const af = activeFields;
    untrack(() => runQuery(eq, nl, p, af));
  });

  async function runQuery(eq: string, nl: boolean, pageNum: number, af: FtsField[] | undefined) {
    const my = ++queryToken;
    loading = true;
    const t0 = performance.now();
    const offset = (pageNum - 1) * PAGE_SIZE;
    const facetsPromise = getFacets(eq);
    const resultPromise = nl
      ? runSearch(eq, PAGE_SIZE, offset, af)
      : Promise.resolve<{ rows: GeneRow[]; parsed: ParsedQuery | null }>({
          rows: [],
          parsed: null,
        });
    const [f, r] = await Promise.all([facetsPromise, resultPromise]);
    if (my !== queryToken) return;
    facets = f;
    rows = r.rows;
    parsed = r.parsed;
    const shown = offset + rows.length;
    hasMore = nl && r.rows.length === PAGE_SIZE && (f?.n_genes ?? 0) > shown;
    elapsedMs = performance.now() - t0;
    loading = false;
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    const my = queryToken;
    const offset = (currentPage - 1) * PAGE_SIZE + rows.length;
    const r = await runSearch(effectiveQuery, PAGE_SIZE, offset, activeFields);
    if (my !== queryToken) {
      loadingMore = false;
      return;
    }
    rows = [...rows, ...r.rows];
    const shown = (currentPage - 1) * PAGE_SIZE + rows.length;
    hasMore = r.rows.length === PAGE_SIZE && (facets?.n_genes ?? 0) > shown;
    loadingMore = false;
  }

  const highlight = $derived(parsed ? highlightRegex(parsed) : null);

  const EXAMPLES: { q: string; label: string }[] = [
    { q: 'daf-16, daf-2, daf-7', label: 'paste list' },
    { q: '"insulin signaling"', label: '"insulin signaling"' },
    { q: 'pheno:Daf-c', label: 'pheno:Daf-c' },
    { q: 'tissue:neuron', label: 'tissue:neuron' },
    { q: 'ortho:FOXO1', label: 'ortho:FOXO1' },
    { q: 'cat:"cell cycle"', label: 'cat:"cell cycle"' },
    { q: 'seq~Y110A7A.*', label: 'seq~Y110A7A.*' },
    { q: 'expressed:AVA>10', label: 'expressed:AVA>10' },
  ];

  const QUICK_STARTS: { group: string; chips: { q: string; label: string }[] }[] = [
    {
      group: 'Pathways',
      chips: [
        { q: 'desc:"insulin signaling"', label: 'Insulin / IIS' },
        { q: 'desc:"TGF-beta" OR pheno:Daf-c', label: 'TGF-β / dauer' },
        { q: 'cat:"Stress response"', label: 'Stress response' },
        { q: 'cat:Chaperone', label: 'Chaperones' },
        { q: 'cat:"Cell cycle"', label: 'Cell cycle' },
        { q: 'desc:autophagy', label: 'Autophagy' },
        { q: 'desc:MAPK', label: 'MAPK' },
      ],
    },
    {
      group: 'Phenotypes',
      chips: [
        { q: 'pheno:Daf-c', label: 'Dauer constitutive' },
        { q: 'pheno:"life span extended"', label: 'Lifespan extended' },
        { q: 'pheno:"embryonic lethal"', label: 'Embryonic lethal' },
        { q: 'pheno:"sterile progeny"', label: 'Sterile' },
        { q: 'pheno:"locomotion variant"', label: 'Locomotion variant' },
      ],
    },
    {
      group: 'Tissues / neurons',
      chips: [
        { q: 'tissue:motoneuron', label: 'Motor neurons' },
        { q: 'tissue:"intestinal cell"', label: 'Intestine' },
        { q: 'tissue:germline', label: 'Germline' },
        { q: 'expressed:AVA,AVB,AVD,AVE@medium', label: 'Command interneurons' },
        { q: 'expressed:ASE,ADL,ASH,AWA,AWB,AWC@medium', label: 'Sensory neurons' },
      ],
    },
    {
      group: 'Gene classes',
      chips: [
        { q: 'cat:"Transcription factor"', label: 'Transcription factors' },
        { q: 'cat:Kinase OR desc:kinase', label: 'Kinases' },
        { q: 'cat:"GPCRs"', label: 'GPCRs' },
        { q: 'desc:neuropeptide', label: 'Neuropeptides' },
        { q: 'cat:Globin', label: 'Globins' },
      ],
    },
    {
      group: 'Conservation',
      chips: [
        { q: 'ortho:HSF1', label: 'HSF1 (heat shock)' },
        { q: 'ortho:FOXO1', label: 'FOXO1 (longevity)' },
        { q: 'ortho:TP53', label: 'TP53 (apoptosis)' },
        { q: 'ortho:MTOR', label: 'mTOR' },
      ],
    },
    {
      group: 'Synaptogenesis',
      chips: [
        { q: 'syn:"activity regulated"', label: 'Activity-regulated TFs' },
        { q: 'syn:remodeling', label: 'Remodeling (dauer)' },
        { q: 'syn:adhesion', label: 'Adhesion / specificity' },
        { q: 'syn:"active zone"', label: 'Active zone scaffolds' },
        { q: 'syn:"SV release"', label: 'SV / release machinery' },
        { q: 'syn:innexin', label: 'Innexins (gap junctions)' },
        { q: 'syn:postsynaptic', label: 'Postsynaptic receptors' },
        { q: 'syn:"mRNA export"', label: 'RNA export / processing' },
        { q: 'syn:PHR', label: 'Synapse growth control' },
        { q: 'syn:Wnt', label: 'Synapse positioning' },
        { q: 'syn:"NT identity"', label: 'Neurotransmitter identity' },
      ],
    },
  ];
  function tryExample(eq: string) {
    const url = new URL(page.url);
    url.searchParams.set('q', eq);
    url.searchParams.delete('page');
    goto(resolve((url.pathname + url.search) as '/'), { keepFocus: true, noScroll: true });
  }

  let exporting = $state(false);
  let sending = $state(false);
  async function exportMatched(format: 'tsv' | 'csv') {
    if (exporting) return;
    exporting = true;
    try {
      const ids = await getMatchedIds(effectiveQuery, 50_000);
      if (!ids.length) {
        toast.error('No results to export');
        return;
      }
      const n = format === 'tsv' ? await exportTsv(ids) : await exportCsv(ids);
      toast.success(`${format.toUpperCase()} exported`, {
        description: `${ids.length.toLocaleString()} gene${ids.length === 1 ? '' : 's'} saved.`,
      });
      void n;
    } catch (e) {
      toast.error('Export failed', { description: String(e) });
    } finally {
      exporting = false;
    }
  }
  async function sendMatchedTo(tool: 'compare' | 'enrichment' | 'lookup') {
    if (sending) return;
    sending = true;
    try {
      const ids = await getMatchedIds(effectiveQuery, 50_000);
      if (!ids.length) {
        toast.error('No results to send');
        return;
      }
      const q = await buildIdsQuery(ids);
      goto(resolve(`/${tool}?${q}`));
    } catch (e) {
      toast.error('Send failed', { description: String(e) });
    } finally {
      sending = false;
    }
  }
  const hasResults = $derived(needsGeneList && !loading && rows.length > 0);

  // One example row at a time: the full grid was ~50 chips competing with the
  // search bar for attention.
  let exampleTab = $state(QUICK_STARTS[0]?.group ?? '');
  const exampleChips = $derived(
    QUICK_STARTS.find((g) => g.group === exampleTab)?.chips ?? QUICK_STARTS[0]?.chips ?? [],
  );
  let showSyntax = $state(false);
</script>

<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
  <!-- Browsing an annotation tree is not a text search; the bar stays only when a
       query is already filtering the tree, so it can be seen and cleared. -->
  {#if needsGeneList || q}
    <SearchBar initial={q} />
  {/if}

  {#if needsGeneList}
    <PageHint id="home-search" title="What this step does">
      Finds genes, and hands the result to any analysis on the left. Typing plain words searches
      names and descriptions, so <code>insulin</code> returns genes whose text mentions it.
      <br /><br />
      To ask a sharper question, put a filter in front of the word. Looking for the genes annotated to
      insulin signalling, rather than the ones that merely mention it? Search
      <code>go:"insulin receptor signaling pathway"</code>. Genes that give a dauer phenotype when
      disrupted: <code>pheno:dauer</code>. Genes expressed in the AVA interneuron:
      <code>expressed:AVA</code>. Worm genes with a human counterpart:
      <code>ortho:human</code>. The <b>filters</b> button lists every filter available.
      <br /><br />
      Filters combine. <code>go:apoptosis AND tissue:neuron</code> keeps only genes that are both;
      <code>pheno:dauer OR pheno:lifespan</code> keeps either; <code>NOT type:pseudogene</code>
      drops a group. A <code>*</code> stands for any ending, so <code>name:daf*</code> catches every
      daf gene, and <code>desc~*kinase*</code> finds kinase anywhere in a description.
      <br /><br />
      You can also paste a gene list (<code>daf-16, daf-2, age-1</code>) or drop a
      <code>.txt</code> file of gene names onto the search bar to work with just those genes.
    </PageHint>
  {/if}

  {#if !q && needsGeneList}
    <div class="space-y-4 py-2">
      <div class="space-y-1.5">
        <div class="flex flex-wrap items-baseline gap-2">
          <span class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Try a search
          </span>
          <div class="flex flex-wrap gap-1">
            {#each QUICK_STARTS as section (section.group)}
              <button
                type="button"
                onclick={() => (exampleTab = section.group)}
                class={cn(
                  'rounded-md px-2 py-0.5 text-xs transition-colors',
                  exampleTab === section.group
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                {section.group}
              </button>
            {/each}
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5">
          {#each exampleChips as c (c.q)}
            <button
              type="button"
              onclick={() => tryExample(c.q)}
              class="inline-flex items-center rounded-md border bg-card px-2 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
              title={c.q}
            >
              {c.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="space-y-1.5">
        <button
          type="button"
          onclick={() => (showSyntax = !showSyntax)}
          class="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {showSyntax ? 'Hide' : 'Show'} search syntax
        </button>
        {#if showSyntax}
          <div class="space-y-2 rounded-md border bg-card p-3">
            <div class="flex flex-wrap gap-1.5">
              {#each EXAMPLES as e (e.q)}
                <button
                  type="button"
                  onclick={() => tryExample(e.q)}
                  class="inline-flex items-center rounded-md border bg-background px-2 py-0.5 font-mono text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {e.label}
                </button>
              {/each}
            </div>
            <div class="space-y-1 text-xs leading-relaxed text-muted-foreground">
              <div>
                Paste a gene list (<span class="font-mono">daf-16, daf-2</span>), or search text:
                <span class="font-mono">daf*</span> (prefix),
                <span class="font-mono">"insulin signaling"</span> (phrase),
                <span class="font-mono">kinase AND NOT phosphatase</span>.
              </div>
              <div>
                Restrict to a field with <span class="font-mono">:</span> —
                <span class="font-mono">go:apoptosis</span>,
                <span class="font-mono">cat:"cell cycle"</span>,
                <span class="font-mono">neuronal:sensory</span>,
                <span class="font-mono">type:protein_coding</span>,
                <span class="font-mono">pheno:Daf-c</span>,
                <span class="font-mono">tissue:neuron</span>,
                <span class="font-mono">ortho:FOXO1</span>,
                <span class="font-mono">allele:tm2200</span>,
                <span class="font-mono">name:daf</span>,
                <span class="font-mono">seq:Y110A7A.10</span>,
                <span class="font-mono">desc:kinase</span>.
              </div>
              <div>
                Wildcards with <span class="font-mono">~</span> (<span class="font-mono">*</span>
                any,
                <span class="font-mono">?</span> one):
                <span class="font-mono">seq~Y110A7A.*</span>,
                <span class="font-mono">name~daf-?</span>,
                <span class="font-mono">wb~WBGene00001*</span>,
                <span class="font-mono">desc~*kinase*</span>.
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <QueryChips parsed={displayParsed} />

  {#if !viewHeader}
    <FacetsBar {facets} {elapsedMs} />
  {/if}

  {#if hasResults}
    <div class="flex flex-wrap items-center gap-1.5 text-xs">
      <span class="mr-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">
        Send all matches
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={sending || (facets?.n_genes ?? 0) < 2}
        onclick={() => sendMatchedTo('enrichment')}
      >
        <BarChart class="h-3 w-3" />
        Over-representation
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={sending || (facets?.n_genes ?? 0) < 1}
        onclick={() => sendMatchedTo('lookup')}
      >
        <FileSearch class="h-3 w-3" />
        Gene name resolver
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={sending || (facets?.n_genes ?? 0) < 2}
        onclick={() => sendMatchedTo('compare')}
      >
        <GitCompare class="h-3 w-3" />
        Annotation overlap
      </Button>
      <span class="mx-1 h-4 w-px bg-border"></span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={exporting}
        onclick={() => exportMatched('tsv')}
      >
        <Download class="h-3 w-3" />
        TSV
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={exporting}
        onclick={() => exportMatched('csv')}
      >
        <Download class="h-3 w-3" />
        CSV
      </Button>
    </div>
  {/if}

  {#if viewHeader}
    <Button variant="ghost" size="sm" href={resolve('/')} class="self-start">
      <ArrowLeft />
      Back
    </Button>

    <header class="space-y-1">
      <h1 class="text-2xl font-semibold">{viewHeader.title}</h1>
      <p class="text-sm text-muted-foreground">{viewHeader.caption}</p>
      <p class="text-[0.7rem] text-muted-foreground">
        {#if view === 'wormcat'}
          WormCat 2.0 category tree (Higgins et al.) —
          <a
            href="https://doi.org/10.1093/genetics/iyac085"
            target="_blank"
            rel="noopener noreferrer"
            class="underline underline-offset-2 hover:text-foreground">the paper</a
          >
        {:else if view === 'go'}
          Gene Ontology terms from the GO Consortium, with <em>C. elegans</em> annotations curated
          by WormBase —
          <a
            href="https://wormbase.org/tools/ontology_browser"
            target="_blank"
            rel="noopener noreferrer"
            class="underline underline-offset-2 hover:text-foreground">browse at WormBase</a
          >
        {:else if view === 'neuronal'}
          Neuronal gene classes from Hobert's survey of the <em>C. elegans</em> neuronal genome —
          <a
            href="https://www.ncbi.nlm.nih.gov/books/NBK116086/"
            target="_blank"
            rel="noopener noreferrer"
            class="underline underline-offset-2 hover:text-foreground">WormBook</a
          >
        {:else if view === 'synaptogenesis'}
          Synaptogenesis panel curated from the primary literature; each entry links its reference
        {/if}
      </p>
    </header>
  {/if}

  {#snippet browseMeta()}
    <FacetsBar {facets} {elapsedMs} align="end" />
  {/snippet}

  <div class:opacity-50={loading}>
    {#if view === 'cards'}
      <CardsView {rows} {highlight} {activeIdx} />
    {:else if view === 'table'}
      <TableView {rows} {highlight} {activeIdx} />
    {:else if view === 'wormcat'}
      <WormCatView term={effectiveQuery} meta={browseMeta} />
    {:else if view === 'neuronal'}
      <NeuronalView term={effectiveQuery} meta={browseMeta} />
    {:else if view === 'synaptogenesis'}
      <SynaptogenesisView term={effectiveQuery} meta={browseMeta} />
    {:else if view === 'go'}
      <GoView term={effectiveQuery} freeText={parsed?.freeText ?? q} meta={browseMeta} />
    {/if}
  </div>

  {#if needsGeneList && !loading && rows.length > 0}
    <div class="flex flex-col items-center gap-3 py-3">
      <Pagination current={currentPage} total={totalPages} />
      <div class="flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          Showing
          <span class="font-semibold tabular-nums text-foreground">
            {((currentPage - 1) * PAGE_SIZE + 1).toLocaleString()}–{(
              (currentPage - 1) * PAGE_SIZE +
              rows.length
            ).toLocaleString()}
          </span>
          of
          <span class="font-semibold tabular-nums text-foreground">
            {(facets?.n_genes ?? 0).toLocaleString()}
          </span>
        </span>
        {#if hasMore}
          <Button variant="outline" size="sm" onclick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading...' : `Load ${PAGE_SIZE} more`}
          </Button>
        {/if}
      </div>
    </div>
  {/if}
</div>
