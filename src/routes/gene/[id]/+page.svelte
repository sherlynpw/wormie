<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { untrack } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { fmtTitle } from '$lib/format';
  import StageExpressionChart from '$lib/components/StageExpressionChart.svelte';
  import { KEGG_ENABLED } from '$lib/config';
  import {
    getGene,
    getWormcatFor,
    getNeuronalFor,
    getSynaptogenesisFor,
    getStageExpressionFor,
    getTranscriptsFor,
    getDomainsFor,
    type StageExpression,
    type GeneTranscript,
    type GeneDomain,
    getGoFor,
    getOrthologs,
    getInteractionsFor,
    getSimilarGenes,
    getPhenotypesFor,
    getPhenotypeCategoriesFor,
    getAllelesFor,
    getAnatomyFor,
    getXrefsFor,
    getPapersFor,
    getGenePapers,
    type GenePaper,
    getCengenExpressionFor,
    getCengenCoexpressionFor,
    getDiseasesFor,
    getRnaiForGene,
    getPathwaysFor,
    type PathwayMembership,
    getStringInteractionsFor,
    type StringInteraction,
    type GeneRow,
    type CengenExpressionRow,
    type CengenCoexprNeighbor,
    type DiseaseAssociation,
    type WormcatAssignment,
    type NeuronalAssignment,
    type SynaptogenesisAssignment,
    type GoAnnotation,
    type Interaction,
    type SimilarGene,
    type Ortholog,
    type PhenotypeRow,
    type PhenotypeCategoryRoll,
    type AlleleRow,
    type AnatomyRow,
    type XrefRow,
    type PaperRef,
    type RnaiRow,
  } from '$lib/queries';
  import GenePill from '$lib/components/GenePill.svelte';
  import TermHover from '$lib/components/TermHover.svelte';
  import { recents } from '$lib/stores/recents.svelte';
  import SystemBadge from '$lib/components/SystemBadge.svelte';
  import AllelePhenotypeMatrix from '$lib/components/AllelePhenotypeMatrix.svelte';
  import MiniInteractionNetwork from '$lib/components/MiniInteractionNetwork.svelte';
  import PageToc, { type TocEntry, type TocLeaf } from '$lib/components/PageToc.svelte';
  import EmptyPanel from '$lib/components/EmptyPanel.svelte';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Separator } from '$lib/components/ui/separator';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import ExternalLink from 'lucide-svelte/icons/external-link';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import Copyable from '$lib/components/Copyable.svelte';
  import PageHint from '$lib/components/PageHint.svelte';
  import ControlHint from '$lib/components/ControlHint.svelte';
  import CengenStripPlot from '$lib/components/CengenStripPlot.svelte';
  import AllelePhenotypeBar from '$lib/components/AllelePhenotypeBar.svelte';
  import Download from 'lucide-svelte/icons/download';
  import { buildGeneReport, downloadMarkdown } from '$lib/report';
  import BookmarkToggle from '$lib/components/BookmarkToggle.svelte';
  import ExpandMore from '$lib/components/ExpandMore.svelte';
  import GoNamespaceDonut from '$lib/components/GoNamespaceDonut.svelte';
  import PhenotypeCategoryHeatmap from '$lib/components/PhenotypeCategoryHeatmap.svelte';
  import MiniPhenotypeGraph from '$lib/components/MiniPhenotypeGraph.svelte';
  import StringInteractionsCard from '$lib/components/StringInteractionsCard.svelte';
  import StickyNote from 'lucide-svelte/icons/sticky-note';
  import { bookmarks } from '$lib/stores/bookmarks.svelte';
  import {
    classById as synaptoClassById,
    refById as synaptoRefById,
    doiHref as synaptoDoiHref,
    prettySubclass as synaptoSubclass,
    refShortLabel as synaptoRefLabel,
  } from '$lib/synaptogenesis-references';
  import { rangeColor, rangeTextColor } from '$lib/plot-colors';

  let gene = $state<GeneRow | null>(null);
  let wormcat = $state<WormcatAssignment | null>(null);
  let neuronal = $state<NeuronalAssignment[]>([]);
  let synaptogenesis = $state<SynaptogenesisAssignment[]>([]);
  let stages = $state<StageExpression[]>([]);
  let transcripts = $state<GeneTranscript[]>([]);
  let domains = $state<GeneDomain[]>([]);
  let goAnnotations = $state<GoAnnotation[]>([]);
  let orthologs = $state<Ortholog[]>([]);
  let interactions = $state<Interaction[]>([]);
  let similar = $state<SimilarGene[]>([]);
  let phenotypes = $state<PhenotypeRow[]>([]);
  let phenotypeCategories = $state<PhenotypeCategoryRoll[]>([]);
  let alleles = $state<AlleleRow[]>([]);
  let anatomy = $state<AnatomyRow[]>([]);
  let xrefs = $state<XrefRow[]>([]);
  let papers = $state<PaperRef[]>([]);
  let literaturePapers = $state<GenePaper[]>([]);
  let cengen = $state<CengenExpressionRow[]>([]);
  let cengenCoexpr = $state<CengenCoexprNeighbor[]>([]);
  let pathways = $state<PathwayMembership[]>([]);
  let stringInteractions = $state<StringInteraction[]>([]);
  // Picking a neuron triggers a fresh SQL query filtered to that neuron type; global Pearson scores still drive ordering.
  let coexprNeuron = $state<string>('');
  let coexprThreshold = $state<number>(2);
  let coexprLoading = $state<boolean>(false);

  // Truncate chip clusters/row lists for first render; genes with 200+ phenotypes/alleles would balloon the DOM.
  const CHIP_LIMIT = 60;
  const ROW_LIMIT = 25;
  let phenotypesExpanded = $state(false);
  let anatomyExpanded = $state(false);
  let goExpanded = $state<Record<string, boolean>>({});
  let allelesExpanded = $state(false);
  let diseasesExpanded = $state(false);
  let interactionsExpanded = $state<Record<string, boolean>>({});
  let orthologsExpanded = $state<Record<string, boolean>>({});
  // Fetched past the display limit so the header can state the real total.
  const SIMILAR_FETCH = 200;
  // Reciprocity bounds the stored list at 200 per gene, so this fetches all of it.
  const COEXPR_FETCH = 200;
  let similarShown = $state(ROW_LIMIT);
  let coexprShown = $state(ROW_LIMIT);
  let papersExpanded = $state(false);
  let literatureExpanded = $state(false);
  const rnaiByPhenotype = $derived.by(() => {
    const m = new SvelteMap<string, { reagents: string[]; papers: SvelteSet<string> }>();
    for (const r of rnai) {
      for (const pid of r.phenotype_ids) {
        let e = m.get(pid);
        if (!e) m.set(pid, (e = { reagents: [], papers: new SvelteSet() }));
        e.reagents.push(r.wbrnai_id);
        for (const p of r.paper_ids) e.papers.add(p);
      }
    }
    return m;
  });

  const coexprFiltered = $derived(cengenCoexpr);
  const coexprNeuronOptions = $derived(
    // Only neurons where the gene is called expressed (max_threshold >= 1) so the picker shows useful filters.
    cengen
      .filter((r) => (r.max_threshold ?? 0) >= 1)
      .map((r) => r.neuron_type)
      .sort(),
  );

  async function reloadCoexpr(wb: string) {
    coexprLoading = true;
    try {
      const rows = await getCengenCoexpressionFor(wb, COEXPR_FETCH, {
        neuronType: coexprNeuron || undefined,
        minThreshold: coexprThreshold,
      });
      cengenCoexpr = rows;
      coexprShown = ROW_LIMIT;
    } finally {
      coexprLoading = false;
    }
  }
  let diseases = $state<DiseaseAssociation[]>([]);
  let rnai = $state<RnaiRow[]>([]);
  let loading = $state(true);
  let notFound = $state(false);

  const id = $derived(page.params.id ?? '');
  let loadToken = 0;

  $effect(() => {
    const cur = id;
    untrack(() => {
      coexprNeuron = '';
      coexprThreshold = 2;
      load(cur);
    });
  });

  async function load(cur: string) {
    const my = ++loadToken;
    loading = true;
    notFound = false;
    const g = await getGene(cur);
    if (my !== loadToken) return;
    gene = g;
    if (!gene) {
      notFound = true;
      loading = false;
      return;
    }
    recents.push('gene', gene.wormbase_gene, gene.gene_name ?? gene.wormbase_gene);
    const wb = gene.wormbase_gene;
    const [
      wc,
      neu,
      syn,
      goAnn,
      ortho,
      ix,
      sim,
      ph,
      phCat,
      al,
      an,
      xr,
      pp,
      lit,
      ce,
      cx,
      dz,
      rn,
      pw,
      si,
      st,
      tr,
      dm,
    ] = await Promise.all([
      getWormcatFor(wb),
      getNeuronalFor(wb),
      getSynaptogenesisFor(wb),
      getGoFor(wb),
      getOrthologs(wb),
      getInteractionsFor(wb),
      getSimilarGenes(wb, SIMILAR_FETCH),
      getPhenotypesFor(wb),
      getPhenotypeCategoriesFor(wb),
      getAllelesFor(wb),
      getAnatomyFor(wb),
      getXrefsFor(wb),
      getPapersFor(wb, 20),
      getGenePapers(wb),
      getCengenExpressionFor(wb),
      getCengenCoexpressionFor(wb, COEXPR_FETCH),
      getDiseasesFor(wb),
      getRnaiForGene(wb),
      getPathwaysFor(wb),
      getStringInteractionsFor(wb),
      getStageExpressionFor(wb),
      getTranscriptsFor(wb),
      getDomainsFor(wb),
    ]);
    if (my !== loadToken) return;
    wormcat = wc;
    neuronal = neu;
    synaptogenesis = syn;
    goAnnotations = goAnn;
    orthologs = ortho;
    interactions = ix;
    similar = sim;
    phenotypes = ph;
    phenotypeCategories = phCat;
    alleles = al;
    anatomy = an;
    xrefs = xr;
    papers = pp;
    literaturePapers = lit;
    cengen = ce;
    cengenCoexpr = cx;
    similarShown = ROW_LIMIT;
    coexprShown = ROW_LIMIT;
    diseases = dz;
    rnai = rn;
    pathways = pw;
    stringInteractions = si;
    stages = st;
    transcripts = tr;
    domains = dm;
    loading = false;
  }

  const orthologsBySpecies = $derived.by(() => {
    const groups: Record<string, Ortholog[]> = {};
    for (const o of orthologs) {
      (groups[o.species] ??= []).push(o);
    }
    return groups;
  });

  const bestHumanOrthos = $derived(
    orthologs.filter((o) => o.species === 'Homo sapiens' && o.is_best_score === 1).slice(0, 5),
  );

  const SPECIES_ORDER = [
    'Homo sapiens',
    'Mus musculus',
    'Rattus norvegicus',
    'Danio rerio',
    'Xenopus tropicalis',
    'Xenopus laevis',
    'Drosophila melanogaster',
    'Saccharomyces cerevisiae',
  ];

  const SPECIES_SHORT: Record<string, string> = {
    'Homo sapiens': 'Human',
    'Mus musculus': 'Mouse',
    'Rattus norvegicus': 'Rat',
    'Danio rerio': 'Zebrafish',
    'Xenopus tropicalis': 'Frog (tropicalis)',
    'Xenopus laevis': 'Frog (laevis)',
    'Drosophila melanogaster': 'Fly',
    'Saccharomyces cerevisiae': 'Yeast',
  };

  const SPECIES_ABBR: Record<string, string> = {
    'Homo sapiens': 'Hs',
    'Mus musculus': 'Mm',
    'Rattus norvegicus': 'Rn',
    'Danio rerio': 'Dr',
    'Xenopus tropicalis': 'Xt',
    'Xenopus laevis': 'Xl',
    'Drosophila melanogaster': 'Dm',
    'Saccharomyces cerevisiae': 'Sc',
  };

  // Three tiers per species: "best" (is_best_score=1, strong accent), "any" (present, muted), "none" (dashed placeholder).
  type PhyloCell = {
    species: string;
    short: string;
    abbr: string;
    count: number;
    bestSymbols: string[];
    tier: 'best' | 'any' | 'none';
  };
  const phyloStrip = $derived.by<PhyloCell[]>(() => {
    return SPECIES_ORDER.map((sp) => {
      const matches = orthologs.filter((o) => o.species === sp);
      const best = matches.filter((o) => o.is_best_score === 1);
      const tier: 'best' | 'any' | 'none' =
        best.length > 0 ? 'best' : matches.length > 0 ? 'any' : 'none';
      return {
        species: sp,
        short: SPECIES_SHORT[sp] ?? sp,
        abbr: SPECIES_ABBR[sp] ?? sp.slice(0, 2),
        count: matches.length,
        bestSymbols: best.map((o) => o.ortholog_symbol),
        tier,
      };
    });
  });

  const goByNs = $derived.by<{ BP: number; MF: number; CC: number; total: number }>(() => {
    let BP = 0,
      MF = 0,
      CC = 0;
    for (const g of goAnnotations) {
      if (g.namespace === 'BP') BP++;
      else if (g.namespace === 'MF') MF++;
      else if (g.namespace === 'CC') CC++;
    }
    return { BP, MF, CC, total: BP + MF + CC };
  });

  // One line for the header: isoform count, exon range and protein (or transcript) length range.
  const modelSummary = $derived.by(() => {
    if (transcripts.length === 0) return null;
    const range = (xs: number[]) => {
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);
      return lo === hi ? `${lo}` : `${lo} to ${hi}`;
    };
    const coding = transcripts.filter((t) => t.cds_nt > 0);
    return {
      n: transcripts.length,
      exons: range(transcripts.map((t) => t.exons)),
      aa: coding.length ? range(coding.map((t) => Math.floor(t.cds_nt / 3))) : '',
      nt: range(transcripts.map((t) => t.length_nt)),
    };
  });

  // Dynamic TOC: leaves appear only if their section has data; groups vanish when all children are empty.
  // Card render order below mirrors this grouping.
  const tocEntries = $derived.by<TocEntry[]>(() => {
    // Grouped by the question a reader arrives with, not by the source each panel came from.
    // Every panel renders even with no data, so every panel is always listed.
    const identity: TocLeaf[] = [
      { id: 'overview', label: 'Overview' },
      { id: 'model', label: 'Gene model' },
      { id: 'domains', label: 'Protein domains' },
      { id: 'phylo', label: 'Conservation' },
      { id: 'orthologs', label: 'Orthologs' },
      { id: 'external', label: 'External resources' },
    ];
    const perturbation: TocLeaf[] = [
      { id: 'alleles', label: 'Alleles' },
      { id: 'phenotypes', label: 'Phenotypes' },
      { id: 'diseases', label: 'Diseases' },
    ];
    const annotation: TocLeaf[] = [
      { id: 'go', label: 'Gene Ontology' },
      { id: 'wormcat', label: 'WormCat' },
      { id: 'neuronal', label: 'Neuronal class' },
      { id: 'synaptogenesis', label: 'Synapse panel' },
      ...(KEGG_ENABLED ? [{ id: 'pathways', label: 'KEGG' }] : []),
    ];
    const expression: TocLeaf[] = [
      { id: 'tissues', label: 'Tissues' },
      { id: 'stages', label: 'Life stages' },
      { id: 'cengen', label: 'Neurons (CeNGEN)' },
    ];
    const related: TocLeaf[] = [
      { id: 'interactions', label: 'Experimental (BioGRID)' },
      { id: 'string-interactions', label: 'Predicted (STRING)' },
      { id: 'similar', label: 'Annotation similarity' },
      { id: 'cengen-coexpr', label: 'Co-expressed' },
    ];
    const literature: TocLeaf[] = [
      { id: 'papers', label: 'References' },
      { id: 'literature', label: 'All literature' },
    ];

    void allelesExpanded; // alleles use <details>; flagged here for parity if that changes
    return [
      { label: 'Identity', children: identity },
      { label: 'Perturbation', children: perturbation },
      { label: 'Annotation', children: annotation },
      { label: 'Expression', children: expression },
      { label: 'Related genes', children: related },
      { label: 'Literature', children: literature },
    ];
  });

  // Group label keyed by its first panel's id, so the in-page headings track the TOC grouping.
  const groupStartLabels = $derived(
    new Map(
      tocEntries.flatMap((e) =>
        'children' in e && e.children.length ? [[e.children[0].id, e.label] as const] : [],
      ),
    ),
  );

  const xrefBundle = $derived.by(() => {
    /* eslint-disable svelte/prefer-svelte-reactivity */
    const uniprot = new Set<string>();
    const refseq = new Set<string>();
    const insdc = new Set<string>();
    /* eslint-enable svelte/prefer-svelte-reactivity */
    const transcripts: string[] = [];
    for (const x of xrefs) {
      if (x.uniprot_acc) uniprot.add(x.uniprot_acc);
      if (x.insdc_protein_id) refseq.add(x.insdc_protein_id);
      if (x.insdc_locus_tag) insdc.add(x.insdc_locus_tag);
      if (x.transcript_seq_name) transcripts.push(x.transcript_seq_name);
    }
    return {
      uniprot: [...uniprot],
      refseq: [...refseq],
      insdc: [...insdc],
      transcripts,
    };
  });

  const interactionsByType = $derived.by(() => {
    const groups: Record<string, Interaction[]> = { physical: [], genetic: [] };
    for (const i of interactions) {
      const t = (i.experimental_type ?? '').toLowerCase();
      if (t === 'physical') groups.physical.push(i);
      else if (t === 'genetic') groups.genetic.push(i);
      else (groups.other ??= []).push(i);
    }
    return groups;
  });

  const goByNamespace = $derived.by(() => {
    const groups: Record<string, GoAnnotation[]> = { BP: [], MF: [], CC: [] };
    for (const a of goAnnotations) {
      const ns =
        a.namespace in groups
          ? a.namespace
          : a.aspect === 'P'
            ? 'BP'
            : a.aspect === 'F'
              ? 'MF'
              : 'CC';
      (groups[ns] ??= []).push(a);
    }
    return groups;
  });

  const NS_LABEL: Record<string, string> = {
    BP: 'Biological process',
    MF: 'Molecular function',
    CC: 'Cellular component',
  };
</script>

<svelte:head
  ><title>{gene ? (gene.gene_name ?? gene.wormbase_gene) : 'Gene'} · wormie.rs.ht</title
  ></svelte:head
>

<div
  class="mx-auto max-w-4xl p-4 md:p-6 xl:grid xl:max-w-6xl xl:grid-cols-[minmax(0,1fr)_192px] xl:gap-6"
>
  <div class="min-w-0 space-y-4">
    {#snippet groupHeading(firstId: string)}
      {@const label = groupStartLabels.get(firstId)}
      {#if label}
        <h2
          class="border-b pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {label}
        </h2>
      {/if}
    {/snippet}
    <div class="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" href="/">
        <ArrowLeft />
        Back
      </Button>
      {#if gene}
        {@const safeGene = gene}
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <BookmarkToggle wormbase_gene={safeGene.wormbase_gene} gene_name={safeGene.gene_name} />
          <Button
            variant="outline"
            size="sm"
            onclick={async () => {
              const md = await buildGeneReport({
                gene: safeGene,
                go: goAnnotations,
                phenotypes,
                anatomy,
                orthologs,
                wormcat,
                neuronal,
                cengen,
                cengenCoexpr,
                diseases,
              });
              downloadMarkdown(md, `${safeGene.gene_name ?? safeGene.wormbase_gene}_report.md`);
            }}
            title="Download a self-contained Markdown summary of this gene"
          >
            <Download class="h-3.5 w-3.5" />
            Report
          </Button>
        </div>
      {/if}
    </div>

    {#if gene && bookmarks.get(gene.wormbase_gene)?.note}
      <div
        class="rounded-r-md border-l-4 border-amber-400 bg-amber-50/40 py-2 pl-3 text-sm dark:bg-amber-950/20"
      >
        <div
          class="mb-1 flex items-center gap-1.5 text-[0.6rem] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400"
        >
          <StickyNote class="h-3 w-3" />
          Your note
        </div>
        <div class="whitespace-pre-wrap leading-relaxed text-foreground/90">
          {bookmarks.get(gene.wormbase_gene)?.note}
        </div>
      </div>
    {/if}

    <PageHint id="gene-detail" title="What's on this page">
      Concise + automated descriptions, gene class, sequence/Entrez/Reactome cross-links, curated GO
      annotations (direct, not propagated), phenotypes from RNAi+allele data, expression patterns,
      interactions, orthologs, and citations. Hover any other gene or term to preview without
      leaving the page.
    </PageHint>

    {#if loading}
      <div class="text-sm text-muted-foreground">Loading gene...</div>
    {:else if notFound}
      <Card>
        <CardContent class="pt-6">
          <div class="mb-1 font-medium">Gene not found</div>
          <div class="text-sm text-muted-foreground">
            No gene matched <span class="font-mono">{id}</span>.
          </div>
        </CardContent>
      </Card>
    {:else if gene}
      {@render groupHeading('overview')}
      <Card id="overview">
        <CardHeader>
          <div class="flex flex-wrap items-baseline justify-between gap-4">
            <CardTitle class="text-2xl">
              {gene.gene_name ?? gene.wormbase_gene}
            </CardTitle>
            <div
              class="inline-flex flex-wrap items-center gap-1 font-mono text-xs text-muted-foreground"
            >
              <a
                class="inline-flex items-center gap-1 hover:text-primary"
                href="https://www.wormbase.org/species/c_elegans/gene/{gene.wormbase_gene}"
                target="_blank"
                rel="noopener"
              >
                {gene.wormbase_gene}
                <ExternalLink class="h-3 w-3" />
              </a>
              <CopyButton text={gene.wormbase_gene} />
              {#if gene.entrez_id}
                <span class="ml-1">·</span>
                <a
                  class="inline-flex items-center gap-1 hover:text-primary"
                  href="https://www.ncbi.nlm.nih.gov/gene/{gene.entrez_id}"
                  target="_blank"
                  rel="noopener"
                >
                  Entrez {gene.entrez_id}
                  <ExternalLink class="h-3 w-3" />
                </a>
                <CopyButton text={gene.entrez_id} />
              {/if}
              {#if gene.chromosome && gene.start_pos != null && gene.end_pos != null}
                <span class="ml-1">·</span>
                <a
                  class="inline-flex items-center gap-1 hover:text-primary"
                  href="https://wormbase.org/tools/genome/jbrowse-simple/?data=data%2Fc_elegans_PRJNA13758&loc={encodeURIComponent(
                    `${gene.chromosome}:${gene.start_pos}..${gene.end_pos}`,
                  )}&tracks=Curated_Genes"
                  target="_blank"
                  rel="noopener"
                  title="Genetic map position (interpolated, as WormBase reports it) and WBcel235 coordinates; opens this region in the WormBase genome browser"
                >
                  {#if gene.cm != null}
                    {gene.chromosome}:{gene.cm.toFixed(2)} cM
                    <span class="text-muted-foreground"
                      >({gene.start_pos.toLocaleString()}-{gene.end_pos.toLocaleString()}{gene.strand
                        ? ` ${gene.strand}`
                        : ''})</span
                    >
                  {:else}
                    {gene.chromosome}:{gene.start_pos.toLocaleString()}-{gene.end_pos.toLocaleString()}{gene.strand
                      ? ` (${gene.strand})`
                      : ''}
                  {/if}
                  <ExternalLink class="h-3 w-3" />
                </a>
                <CopyButton
                  text={gene.cm != null
                    ? `${gene.chromosome}:${gene.cm.toFixed(2)}`
                    : `${gene.chromosome}:${gene.start_pos}-${gene.end_pos}`}
                />
              {/if}
              {#if bestHumanOrthos.length > 0}
                <span class="ml-1">·</span>
                <a
                  class="inline-flex items-center gap-1 hover:text-primary"
                  href="https://reactome.org/content/query?q={encodeURIComponent(
                    bestHumanOrthos[0].ortholog_symbol,
                  )}&species=Homo+sapiens&types=Pathway"
                  target="_blank"
                  rel="noopener"
                  title="Open human ortholog {bestHumanOrthos[0]
                    .ortholog_symbol} in Reactome pathways"
                >
                  Reactome
                  <ExternalLink class="h-3 w-3" />
                </a>
              {/if}
            </div>
          </div>

          <div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {#if gene.gene_type}
              <Badge variant="muted">{gene.gene_type}</Badge>
            {/if}
            {#if modelSummary}
              <Badge variant="outline" title="Transcripts in the WormBase canonical gene set"
                >{modelSummary.n} {modelSummary.n === 1 ? 'transcript' : 'isoforms'}</Badge
              >
              <Badge variant="outline" title="Exons per transcript"
                >{modelSummary.exons} exons</Badge
              >
              {#if modelSummary.aa}
                <Badge variant="outline" title="Protein length across isoforms"
                  >{modelSummary.aa} aa</Badge
                >
              {:else}
                <Badge variant="outline" title="Transcript length">{modelSummary.nt} nt</Badge>
              {/if}
            {/if}
            {#if gene.status && gene.status !== 'Live'}
              <Badge variant="outline" class="border-amber-500 text-amber-600 dark:text-amber-400">
                {gene.status}
              </Badge>
            {/if}
            {#if wormcat?.category_1}
              <Badge variant="secondary" title="WormCat top-level category"
                >{wormcat.category_1}</Badge
              >
            {/if}
            {#if gene.sequence_name}
              <Badge variant="outline" class="font-mono text-[0.6rem]">{gene.sequence_name}</Badge>
            {/if}
            {#if goByNs.total > 0}
              <Badge variant="outline">{goByNs.total} GO</Badge>
            {/if}
            {#if phenotypes.length > 0}
              <Badge variant="outline"
                >{phenotypes.length} phenotype{phenotypes.length === 1 ? '' : 's'}</Badge
              >
            {/if}
            {#if alleles.length > 0}
              <Badge variant="outline"
                >{alleles.length} allele{alleles.length === 1 ? '' : 's'}</Badge
              >
            {/if}
            {#if orthologs.length > 0}
              <Badge variant="outline">
                {Object.keys(orthologsBySpecies).length} species
              </Badge>
            {/if}
            {#if interactions.length > 0}
              <Badge variant="outline"
                >{interactions.length} interaction{interactions.length === 1 ? '' : 's'}</Badge
              >
            {/if}
            {#if anatomy.length > 0}
              <Badge variant="outline"
                >{anatomy.length} tissue{anatomy.length === 1 ? '' : 's'}</Badge
              >
            {/if}
          </div>

          {#if gene.gene_class_description}
            <Copyable text={gene.gene_class_description} label="Gene class">
              <div class="text-sm italic text-muted-foreground">{gene.gene_class_description}</div>
            </Copyable>
          {/if}
          <!-- Sequence name, gene type and status live in the summary row above; only
               fields that row does not carry belong here. -->
          <div class="mt-2 flex flex-wrap gap-1.5">
            {#if gene.operon}<Badge variant="secondary">operon: {gene.operon}</Badge>{/if}
            {#if gene.other_names}
              <Badge variant="outline">aka {gene.other_names}</Badge>
            {/if}
            {#if bestHumanOrthos.length > 0}
              <Badge variant="default" class="bg-accent text-accent-foreground hover:bg-accent">
                Human:
                {#each bestHumanOrthos as h, i (h.ortholog_id)}{#if i > 0},
                  {/if}{h.ortholog_symbol}{/each}
              </Badge>
            {/if}
          </div>
        </CardHeader>

        {#if gene.concise_description || gene.legacy_description}
          <CardContent class="space-y-3">
            {#if gene.concise_description}
              <div>
                <div
                  class="mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Description
                </div>
                <Copyable text={gene.concise_description} label="Description">
                  <p class="text-sm leading-relaxed">{gene.concise_description}</p>
                </Copyable>
              </div>
            {/if}
            {#if gene.legacy_description}
              <div>
                <div
                  class="mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Legacy description
                </div>
                <Copyable text={gene.legacy_description} label="Legacy description">
                  <p class="text-sm leading-relaxed text-muted-foreground">
                    {gene.legacy_description}
                  </p>
                </Copyable>
              </div>
            {/if}
          </CardContent>
        {/if}
      </Card>

      {#if transcripts.length > 0}
        <Card id="model">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Gene model
              <ControlHint id="gene-model" title="Gene model">
                Transcripts of this gene in the WormBase canonical gene set for this build's
                release, with exon count, spliced length and coding length. Protein length is the
                coding length divided by three. Isoform letters follow the WormBase sequence name.
              </ControlHint>
            </CardTitle>
            <span class="font-mono text-xs text-muted-foreground">{transcripts.length}</span>
          </CardHeader>
          <CardContent class="pt-0">
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead class="text-left text-muted-foreground">
                  <tr>
                    <th class="py-1 pr-3">Transcript</th>
                    <th class="py-1 pr-3">Type</th>
                    <th class="py-1 pr-3 text-right">Exons</th>
                    <th class="py-1 pr-3 text-right">Spliced</th>
                    <th class="py-1 pr-3 text-right">CDS</th>
                    <th class="py-1 pr-3 text-right">Protein</th>
                  </tr>
                </thead>
                <tbody>
                  {#each transcripts as t (t.transcript_id)}
                    <tr class="border-t">
                      <td class="py-1 pr-3 font-mono">{t.transcript_id}</td>
                      <td class="py-1 pr-3 text-muted-foreground"
                        >{(t.biotype ?? '').replace(/_/g, ' ')}</td
                      >
                      <td class="py-1 pr-3 text-right tabular-nums">{t.exons}</td>
                      <td class="py-1 pr-3 text-right tabular-nums"
                        >{t.length_nt.toLocaleString()} nt</td
                      >
                      <td class="py-1 pr-3 text-right tabular-nums"
                        >{t.cds_nt ? `${t.cds_nt.toLocaleString()} nt` : ''}</td
                      >
                      <td class="py-1 pr-3 text-right tabular-nums"
                        >{t.cds_nt ? `${Math.floor(t.cds_nt / 3)} aa` : ''}</td
                      >
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="model"
          title="Gene model"
          message="No transcript in the canonical gene set for this gene in this build."
        />
      {/if}

      {#if domains.length > 0}
        <Card id="domains">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Protein domains
              <ControlHint id="gene-domains" title="Protein domains">
                Domains and families found on this gene's proteins by InterProScan, as WormBase
                distributes them: InterPro entries first, then the member databases (Pfam, SMART,
                PANTHER, SUPERFAMILY, PROSITE, PRINTS). An accession opens the search for every gene
                carrying it; the Protein domains enrichment kind tests a gene list against the
                InterPro entries.
              </ControlHint>
            </CardTitle>
            <span class="font-mono text-xs text-muted-foreground">{domains.length}</span>
          </CardHeader>
          <CardContent class="space-y-1 pt-0">
            {#each domains as d (d.accession)}
              <div class="flex flex-wrap items-baseline gap-2 text-sm">
                <a
                  href={resolve(`/?q=${encodeURIComponent(`domain:${d.accession}`)}`)}
                  class="font-mono text-xs text-primary hover:underline"
                  title="Every gene carrying this domain">{d.accession}</a
                >
                <span>{d.name ?? ''}</span>
                <Badge variant="outline" class="px-1 py-0 text-[0.55rem]">{d.source}</Badge>
              </div>
            {/each}
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="domains"
          title="Protein domains"
          message="No protein domain recorded for this gene in this build."
        />
      {/if}

      {#if orthologs.length > 0}
        <Card id="phylo">
          <CardHeader class="pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Phylogenetic footprint
              <ControlHint id="gene-phylo" title="Phylogenetic footprint">
                Conservation across model organisms via Alliance ortholog calls. Bar indicates
                whether a high-confidence one-to-one ortholog exists in each species.
              </ControlHint>
            </CardTitle>
          </CardHeader>
          <CardContent class="pt-0">
            <div class="flex flex-wrap gap-1.5">
              {#each phyloStrip as p (p.species)}
                <div
                  class={p.tier === 'best'
                    ? 'flex min-w-[64px] cursor-help flex-col items-center gap-0.5 rounded-md border-2 border-accent bg-accent/30 px-2 py-1.5'
                    : p.tier === 'any'
                      ? 'flex min-w-[64px] cursor-help flex-col items-center gap-0.5 rounded-md border border-accent/40 bg-accent/10 px-2 py-1.5'
                      : 'flex min-w-[64px] cursor-help flex-col items-center gap-0.5 rounded-md border border-dashed border-border/60 bg-card px-2 py-1.5 opacity-50'}
                  title={p.tier === 'none'
                    ? `${p.short}: no ortholog`
                    : `${p.short}: ${p.count} ortholog${p.count === 1 ? '' : 's'}${p.bestSymbols.length > 0 ? ` · best: ${p.bestSymbols.slice(0, 3).join(', ')}${p.bestSymbols.length > 3 ? '…' : ''}` : ''}`}
                >
                  <span
                    class={'font-mono text-sm ' +
                      (p.tier === 'best'
                        ? 'font-bold'
                        : p.tier === 'any'
                          ? 'font-semibold'
                          : 'font-medium text-muted-foreground')}
                  >
                    {p.abbr}
                  </span>
                  <span class="text-[0.6rem] text-muted-foreground">{p.short}</span>
                  {#if p.tier === 'none'}
                    <span class="font-mono text-[0.6rem] text-muted-foreground">—</span>
                  {:else}
                    <span
                      class="inline-flex items-center gap-0.5 font-mono text-[0.6rem] tabular-nums"
                    >
                      {#if p.tier === 'best'}
                        <span class="text-accent-foreground/80">★</span>
                      {/if}
                      {p.count}
                    </span>
                  {/if}
                </div>
              {/each}
            </div>
            <div class="mt-2 text-[0.65rem] text-muted-foreground">
              <span class="font-semibold">★</span> = high-confidence one-to-one ortholog flagged by Alliance.
              Lighter tiles have orthologs but no best-score call; dashed tiles have none. Hover any tile
              for best-score symbols.
            </div>
          </CardContent>
        </Card>

        <Card id="orthologs">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Orthologs
              <ControlHint id="gene-orthologs" title="Orthologs">
                Per-species ortholog calls with the originating prediction algorithms (InParanoid,
                OrthoFinder, PANTHER, Compara, etc.) and the count of supporting methods. The
                Alliance "best" call is highlighted.
              </ControlHint>
            </CardTitle>
            <span class="font-mono text-xs text-muted-foreground">
              {orthologs.length} across {Object.keys(orthologsBySpecies).length} species
            </span>
          </CardHeader>
          <CardContent class="space-y-3 pt-0">
            {#each SPECIES_ORDER as sp (sp)}
              {#if orthologsBySpecies[sp]?.length}
                <div>
                  <div
                    class="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {SPECIES_SHORT[sp] ?? sp}
                    <span class="font-normal normal-case text-muted-foreground/70">
                      ({orthologsBySpecies[sp].length})
                    </span>
                  </div>
                  <div class="flex flex-wrap gap-1">
                    {#each orthologsExpanded[sp] ? orthologsBySpecies[sp] : orthologsBySpecies[sp].slice(0, CHIP_LIMIT) as o (o.ortholog_id)}
                      <span
                        class="inline-flex items-baseline gap-1 rounded border bg-card px-1.5 py-0.5 text-xs"
                        title={o.algorithms ?? ''}
                      >
                        <span class="font-medium">{o.ortholog_symbol}</span>
                        <span class="font-mono text-[0.6rem] text-muted-foreground">
                          {o.algorithms_match}/{o.out_of_algorithms}
                        </span>
                        {#if o.is_best_score}
                          <Badge
                            variant="default"
                            class="bg-accent px-1 py-0 text-[0.55rem] text-accent-foreground hover:bg-accent"
                          >
                            best
                          </Badge>
                        {/if}
                      </span>
                    {/each}
                    <ExpandMore
                      total={orthologsBySpecies[sp].length}
                      shown={CHIP_LIMIT}
                      expanded={!!orthologsExpanded[sp]}
                      onToggle={(v) => (orthologsExpanded = { ...orthologsExpanded, [sp]: v })}
                      label="orthologs"
                    />
                  </div>
                </div>
              {/if}
            {/each}
            <div class="pt-1 text-xs text-muted-foreground">
              Source:
              <a
                href="https://www.alliancegenome.org/"
                target="_blank"
                rel="noopener"
                class="hover:text-primary"
              >
                Alliance of Genome Resources (stringent)
              </a>
            </div>
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="phylo"
          title="Phylogenetic footprint"
          message="No orthologs found, so there is no conservation profile to draw."
        />
        <EmptyPanel
          id="orthologs"
          title="Orthologs"
          message="No orthologs for this gene in the Alliance orthology set."
        />
      {/if}

      {#if xrefBundle.uniprot.length > 0 || xrefBundle.refseq.length > 0 || xrefBundle.insdc.length > 0}
        <Card id="external">
          <CardHeader class="pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              External resources
              <ControlHint id="gene-external" title="External resources">
                Cross-references from WormBase: UniProt (protein), RefSeq (NCBI transcript), INSDC
                (sequence). Click any to jump to the canonical record.
              </ControlHint>
            </CardTitle>
          </CardHeader>
          <CardContent class="pt-0">
            <div class="flex flex-wrap gap-2 text-sm">
              <a
                href="https://wormbase.org/species/c_elegans/gene/{gene.wormbase_gene}"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 transition-colors hover:bg-accent"
              >
                <span class="font-mono text-[0.6rem] text-muted-foreground">WB</span>
                <span>{gene.wormbase_gene}</span>
                <ExternalLink class="h-3 w-3 text-muted-foreground" />
              </a>
              <a
                href="https://www.alliancegenome.org/gene/WB:{gene.wormbase_gene}"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 transition-colors hover:bg-accent"
              >
                <span class="font-mono text-[0.6rem] text-muted-foreground">Alliance</span>
                <ExternalLink class="h-3 w-3 text-muted-foreground" />
              </a>
              {#each xrefBundle.uniprot.slice(0, 3) as acc (acc)}
                <a
                  href="https://www.uniprot.org/uniprotkb/{acc}/entry"
                  target="_blank"
                  rel="noopener"
                  class="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 transition-colors hover:bg-accent"
                >
                  <span class="font-mono text-[0.6rem] text-muted-foreground">UniProt</span>
                  <span class="font-mono">{acc}</span>
                  <ExternalLink class="h-3 w-3 text-muted-foreground" />
                </a>
                <a
                  href="https://alphafold.ebi.ac.uk/entry/{acc}"
                  target="_blank"
                  rel="noopener"
                  class="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 transition-colors hover:bg-accent"
                  title="Predicted 3D structure"
                >
                  <span class="font-mono text-[0.6rem] text-muted-foreground">AlphaFold</span>
                  <span class="font-mono">{acc}</span>
                  <ExternalLink class="h-3 w-3 text-muted-foreground" />
                </a>
              {/each}
              {#each xrefBundle.refseq.slice(0, 2) as acc (acc)}
                <a
                  href="https://www.ncbi.nlm.nih.gov/protein/{acc}"
                  target="_blank"
                  rel="noopener"
                  class="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 transition-colors hover:bg-accent"
                >
                  <span class="font-mono text-[0.6rem] text-muted-foreground">NCBI</span>
                  <span class="font-mono">{acc}</span>
                  <ExternalLink class="h-3 w-3 text-muted-foreground" />
                </a>
              {/each}
            </div>
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="external"
          title="External resources"
          message="No UniProt, RefSeq or INSDC cross-references in WormBase for this gene."
        />
      {/if}

      {@render groupHeading('alleles')}
      {#if alleles.length > 0}
        <Card id="alleles">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Alleles
              <ControlHint id="gene-alleles" title="Alleles">
                Alleles of this gene with recorded phenotypes, by WormBase allele name (WBVar ID on
                hover), with how many phenotypes each has. Each links to its WormBase variation
                page, which describes the molecular change.
              </ControlHint>
            </CardTitle>
            <span class="font-mono text-xs text-muted-foreground">
              {alleles.length} with phenotype data
            </span>
          </CardHeader>
          <CardContent class="space-y-3 pt-0">
            <div>
              <div
                class="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Phenotype coverage per allele
              </div>
              <AllelePhenotypeBar {alleles} />
            </div>
            <details class="text-sm">
              <summary class="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Show full phenotype list per allele
              </summary>
              <div class="mt-2 max-h-72 overflow-x-auto overflow-y-auto rounded-md border bg-card">
                <table class="w-full text-sm">
                  <thead class="sticky top-0 border-b bg-card">
                    <tr>
                      <th
                        class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        Allele
                      </th>
                      <th
                        class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        Phenotypes
                      </th>
                      <th
                        class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        Phenotype list (truncated)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each alleles as a (a.allele_id)}
                      <tr class="border-b last:border-b-0 hover:bg-muted/30">
                        <td class="px-3 py-1.5 align-top">
                          <a
                            href="https://wormbase.org/species/c_elegans/variation/{a.allele_id}"
                            target="_blank"
                            rel="noopener"
                            class="font-mono text-[0.65rem] text-primary hover:underline"
                          >
                            {a.name}
                          </a>
                          {#if a.name !== a.allele_id}
                            <span class="ml-1 font-mono text-[0.6rem] text-muted-foreground"
                              >{a.allele_id}</span
                            >
                          {/if}
                        </td>
                        <td class="px-3 py-1.5 text-right font-mono text-xs tabular-nums"
                          >{a.n_phenotypes}</td
                        >
                        <td class="max-w-[40ch] truncate px-3 py-1.5 text-xs text-muted-foreground">
                          {a.phenotype_names.split(',').slice(0, 4).join(', ')}{a.n_phenotypes > 4
                            ? '...'
                            : ''}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </details>
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="alleles"
          title="Alleles"
          message="No alleles or variants recorded in WormBase for this gene."
        />
      {/if}

      {#if phenotypes.length > 0}
        <Card id="phenotypes">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Phenotypes
              <ControlHint id="gene-pheno" title="Phenotypes">
                Phenotypes observed when this gene is perturbed (RNAi or allele). Grouped by
                phenotype ontology term; numbers indicate distinct alleles/experiments. Hover any
                term for the WBPhenotype definition.
              </ControlHint>
            </CardTitle>
            {@const rnaiOnlyCount = phenotypes.filter((p) => p.n_alleles === 0).length}
            <span class="font-mono text-xs text-muted-foreground">
              {phenotypes.length} terms · {alleles.length} alleles{rnaiOnlyCount > 0
                ? ` · ${rnaiOnlyCount} RNAi-only`
                : ''}
            </span>
          </CardHeader>
          <CardContent class="space-y-4 pt-0">
            {#if phenotypeCategories.length > 0}
              <PhenotypeCategoryHeatmap categories={phenotypeCategories} />
            {/if}
            {#if gene && phenotypes.length > 0}
              <MiniPhenotypeGraph {phenotypes} focalGene={gene.wormbase_gene} />
            {/if}
            <div class="flex flex-wrap gap-1">
              {#each phenotypesExpanded ? phenotypes : phenotypes.slice(0, CHIP_LIMIT) as p (p.term_id)}
                {@const rnaiOnly = p.n_alleles === 0 && p.n_evidence > 0}
                {@const ev = rnaiByPhenotype.get(p.term_id)}
                <TermHover kind="phenotype" id={p.term_id}>
                  {#snippet footer()}
                    {#if ev}
                      <div class="space-y-1">
                        <div class="text-[0.65rem] text-muted-foreground">
                          Scored by {ev.reagents.length} RNAi experiment{ev.reagents.length === 1
                            ? ''
                            : 's'}{ev.papers.size > 0
                            ? ` across ${ev.papers.size} paper${ev.papers.size === 1 ? '' : 's'}`
                            : ''}
                        </div>
                        <div class="flex flex-wrap gap-1">
                          <!-- eslint-disable svelte/no-navigation-without-resolve -->
                          {#each ev.reagents.slice(0, 8) as id (id)}
                            <a
                              href={`https://wormbase.org/species/c_elegans/rnai/${id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              class="rounded border bg-card px-1 py-0.5 font-mono text-[0.55rem] text-muted-foreground hover:bg-accent hover:text-foreground"
                              title="Clone and library on WormBase"
                            >
                              {id.replace('WBRNAi', '')}
                            </a>
                          {/each}
                          <!-- eslint-enable svelte/no-navigation-without-resolve -->
                          {#if ev.reagents.length > 8}
                            <span class="text-[0.55rem] text-muted-foreground"
                              >+{ev.reagents.length - 8}</span
                            >
                          {/if}
                        </div>
                      </div>
                    {/if}
                  {/snippet}
                  <a
                    href={resolve(`/phenotype/${p.term_id}`)}
                    class="inline-flex items-baseline gap-1 rounded border bg-card px-1.5 py-0.5 text-xs transition-colors hover:bg-accent"
                    title={rnaiOnly
                      ? `${p.term_id} · scored by ${ev ? ev.reagents.length : p.n_evidence} RNAi experiment${(ev ? ev.reagents.length : p.n_evidence) === 1 ? '' : 's'}${ev && ev.papers.size > 0 ? ` across ${ev.papers.size} paper${ev.papers.size === 1 ? '' : 's'}` : ''}${ev ? `: ${ev.reagents.slice(0, 6).join(', ')}${ev.reagents.length > 6 ? ' ...' : ''}` : ''}`
                      : `${p.term_id} · ${p.n_alleles} allele${p.n_alleles === 1 ? '' : 's'}${p.n_evidence > p.n_alleles ? ` + ${p.n_evidence - p.n_alleles} other evidence` : ''}`}
                  >
                    <span>{p.name}</span>
                    {#if rnaiOnly}
                      <span
                        class="font-mono text-[0.55rem] uppercase tracking-wider text-amber-700 dark:text-amber-400"
                        >RNAi</span
                      >
                      <span class="font-mono text-[0.6rem] text-muted-foreground"
                        >{ev ? ev.reagents.length : p.n_evidence}</span
                      >
                    {:else}
                      <span class="font-mono text-[0.6rem] text-muted-foreground"
                        >{p.n_alleles}</span
                      >
                    {/if}
                  </a>
                </TermHover>
              {/each}
              <ExpandMore
                total={phenotypes.length}
                shown={CHIP_LIMIT}
                expanded={phenotypesExpanded}
                onToggle={(v) => (phenotypesExpanded = v)}
                label="phenotypes"
              />
            </div>

            {@const matrixPhenotypes = phenotypes.filter((p) => p.n_alleles > 0)}
            {#if alleles.length >= 2 && matrixPhenotypes.length >= 2}
              <div>
                <div
                  class="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Allele × phenotype matrix
                </div>
                <AllelePhenotypeMatrix {alleles} phenotypes={matrixPhenotypes} />
              </div>
            {/if}
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="phenotypes"
          title="Phenotypes"
          message="No phenotypes reported for this gene from RNAi or allele studies."
        />
      {/if}

      {#if diseases.length > 0}
        <Card id="diseases">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Human diseases
              <ControlHint id="gene-diseases" title="Disease associations">
                Disease Ontology (DOID) terms linked to this gene by the Alliance of Genome
                Resources, inferred via human ortholog or assigned directly by WB curators. Number
                is the count of supporting evidence rows.
              </ControlHint>
            </CardTitle>
            <span class="font-mono text-xs text-muted-foreground">
              {diseases.length} term{diseases.length === 1 ? '' : 's'}
            </span>
          </CardHeader>
          <CardContent class="pt-0">
            <div class="flex flex-wrap gap-1.5">
              {#each diseasesExpanded ? diseases : diseases.slice(0, CHIP_LIMIT) as d (d.do_id)}
                <a
                  href={resolve(`/disease/${d.do_id}`)}
                  class="inline-flex items-baseline gap-1.5 rounded border bg-card px-1.5 py-0.5 text-xs transition-colors hover:bg-accent"
                  title={`${d.do_id} · ${d.association_type ?? ''}${d.with_ortholog ? ' · via ' + d.with_ortholog : ''}`}
                >
                  <span>{d.do_name}</span>
                  <span class="font-mono text-[0.6rem] text-muted-foreground"
                    >{d.evidence_count}</span
                  >
                </a>
              {/each}
              <ExpandMore
                total={diseases.length}
                shown={CHIP_LIMIT}
                expanded={diseasesExpanded}
                onToggle={(v) => (diseasesExpanded = v)}
                label="diseases"
              />
            </div>
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="diseases"
          title="Human diseases"
          message="No human disease associations from the Alliance for this gene."
        />
      {/if}

      {@render groupHeading('go')}
      {#if goAnnotations.length}
        <Card id="go">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              GO annotations
              <ControlHint id="gene-go-list" title="GO annotations">
                Direct curated GO terms (no ancestor propagation), grouped by namespace and sorted
                by evidence-code reliability (experimental first). Hover any term for its
                definition.
              </ControlHint>
            </CardTitle>
            <span class="font-mono text-xs text-muted-foreground">{goAnnotations.length}</span>
          </CardHeader>
          <CardContent class="space-y-4 pt-0">
            <GoNamespaceDonut annotations={goAnnotations} exportName="go-namespace-donut" />
            {#each Object.entries(goByNamespace) as [ns, items] (ns)}
              {#if items.length}
                <div>
                  <div
                    class="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {NS_LABEL[ns] ?? ns} ({items.length})
                  </div>
                  <ul class="space-y-1.5 text-sm">
                    {#each goExpanded[ns] ? items : items.slice(0, ROW_LIMIT) as a, i (i)}
                      <li class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <TermHover kind="go" id={a.go_id}>
                          <a
                            href={resolve(`/go/${a.go_id}`)}
                            class="font-mono text-xs text-primary hover:underline"
                            title="View graph"
                          >
                            {a.go_id}
                          </a>
                        </TermHover>
                        <TermHover kind="go" id={a.go_id}>
                          <span>{a.name}</span>
                        </TermHover>
                        <Badge variant="outline" class="py-0 text-[0.6rem]">
                          {a.evidence_code}
                        </Badge>
                        {#if a.qualifier}
                          <span class="text-xs italic text-muted-foreground">{a.qualifier}</span>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                  {#if items.length > ROW_LIMIT}
                    <div class="mt-2 flex">
                      <ExpandMore
                        total={items.length}
                        shown={ROW_LIMIT}
                        expanded={!!goExpanded[ns]}
                        label="annotations"
                        onToggle={(v) => (goExpanded = { ...goExpanded, [ns]: v })}
                      />
                    </div>
                  {/if}
                </div>
                <Separator />
              {/if}
            {/each}
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="go"
          title="GO annotations"
          message="No GO annotations curated by WormBase for this gene."
        />
      {/if}

      {#if wormcat && (wormcat.category_1 || wormcat.category_2 || wormcat.category_3)}
        <Card id="wormcat">
          <CardHeader class="pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              WormCat
              <ControlHint id="gene-wormcat" title="WormCat classification">
                WormCat 2.0 functional category, three levels deep. Used by /enrichment and /gsea as
                a coarser, worm-specific alternative to GO.
              </ControlHint>
            </CardTitle>
          </CardHeader>
          <CardContent class="pt-0">
            <div class="flex flex-wrap items-center gap-2 text-sm">
              {#if wormcat.category_1}
                <Badge variant="secondary">{wormcat.category_1}</Badge>
              {/if}
              {#if wormcat.category_2 && wormcat.category_2 !== wormcat.category_1}
                <span class="text-muted-foreground">›</span>
                <Badge variant="secondary">{wormcat.category_2}</Badge>
              {/if}
              {#if wormcat.category_3 && wormcat.category_3 !== wormcat.category_2}
                <span class="text-muted-foreground">›</span>
                <Badge variant="secondary">{wormcat.category_3}</Badge>
              {/if}
            </div>
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="wormcat"
          title="WormCat"
          message="This gene is not assigned to a WormCat category."
        />
      {/if}

      {#if neuronal.length}
        <Card id="neuronal">
          <CardHeader class="pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Neuronal classification
              <ControlHint id="gene-neuronal" title="Neuronal classification">
                Hobert-lab catalogue of neuronal genes, classified by function (transcription
                factor, neuropeptide, receptor, etc.) and by supercategory.
              </ControlHint>
            </CardTitle>
          </CardHeader>
          <CardContent class="space-y-1 pt-0">
            {#each neuronal as n, i (i)}
              <div class="flex items-center gap-2 text-sm">
                {#if n.supercategory}<Badge variant="secondary">{n.supercategory}</Badge>{/if}
                {#if n.category && n.category !== n.supercategory}
                  <span class="text-muted-foreground">›</span>
                  <Badge variant="secondary">{n.category}</Badge>
                {/if}
              </div>
            {/each}
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="neuronal"
          title="Neuronal classification"
          message="This gene is not in Hobert's survey of neuronal gene classes."
        />
      {/if}

      {#if synaptogenesis.length}
        <Card id="synaptogenesis">
          <CardHeader class="pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Synapse development and function panel
              <ControlHint id="gene-synaptogenesis" title="Synapse development and function panel">
                178 genes in 12 functional classes, from activity-regulated transcription through
                synaptic machinery to neurotransmitter identity. The papers listed are the primary
                research articles this gene was curated from; the reviews behind each class are on
                the panel view.
              </ControlHint>
            </CardTitle>
            <div class="text-xs text-muted-foreground">
              Curated from the literature by the Richardson Lab. Not exhaustive and may contain
              errors; corrections are welcome.
            </div>
          </CardHeader>
          <CardContent class="space-y-3 pt-0">
            {#each synaptogenesis as s, i (i)}
              {@const meta = synaptoClassById(s.class)}
              {@const geneRefs = (s.refs ?? '').split(';').filter(Boolean)}
              <div>
                <div class="flex flex-wrap items-center gap-2 text-sm">
                  <a href={resolve(`/?view=synaptogenesis&q=${encodeURIComponent(s.class)}`)}>
                    <Badge variant="secondary">{meta?.label ?? s.class}</Badge>
                  </a>
                  {#if s.subclass}
                    <span class="text-muted-foreground">›</span>
                    <Badge variant="secondary">{synaptoSubclass(s.subclass)}</Badge>
                  {/if}
                </div>
                {#if s.notes}
                  <div class="mt-2.5 text-xs text-muted-foreground">{s.notes}</div>
                {/if}
                {#if geneRefs.length > 0}
                  <div class="mt-1.5 flex flex-wrap items-center gap-1">
                    <span class="text-xs text-muted-foreground">Papers:</span>
                    {#each geneRefs as rid (rid)}
                      {@const r = synaptoRefById(rid)}
                      {#if r}
                        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
                        <a
                          href={synaptoDoiHref(r.doi)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${r.authors} (${r.year}) — ${fmtTitle(r.title)}. ${r.journal}`}
                          class="inline-block rounded border bg-background px-1.5 py-0.5 text-[0.65rem] text-muted-foreground hover:bg-accent"
                        >
                          {synaptoRefLabel(r)}
                        </a>
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="synaptogenesis"
          title="Synapse development and function panel"
          message="This gene is not in the curated synapse development and function panel."
        />
      {/if}

      {#if !KEGG_ENABLED}
        <!-- KEGG excluded from the build (license): no panel, not an empty one -->
      {:else if pathways.length > 0}
        <Card id="pathways">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="text-base">KEGG pathways</CardTitle>
            <span class="font-mono text-xs text-muted-foreground">{pathways.length}</span>
          </CardHeader>
          <CardContent class="pt-0">
            <ul class="flex flex-wrap gap-2 text-sm">
              {#each pathways as p (p.pathway_id)}
                <li>
                  <a
                    href={resolve(`/pathway/${p.pathway_id.replace(/^path:/, '')}`)}
                    class="rounded border px-2 py-0.5 hover:bg-accent"
                  >
                    <span>{p.name}</span>
                    <span class="ml-1 font-mono text-xs text-muted-foreground">
                      {p.pathway_id.replace(/^path:/, '')}
                    </span>
                  </a>
                </li>
              {/each}
            </ul>
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="pathways"
          title="KEGG pathways"
          message="This gene is not a member of any KEGG pathway."
        />
      {/if}

      {@render groupHeading('tissues')}
      {#if stages.length > 0}
        <Card id="stages">
          <CardHeader class="pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Expression across life stages
              <ControlHint id="gene-stages" title="Expression across life stages">
                Median FPKM per stage over the RNA-seq libraries WormBase classes as controls (wild
                type, untreated), the grey bars of the WormBase expression plot. Reads were aligned
                with STAR and quantified with cufflinks by WormBase; n is the number of libraries
                behind each bar. Stages with no control library are left out.
              </ControlHint>
            </CardTitle>
            <div class="text-xs text-muted-foreground">
              When this gene is expressed, from the WormBase control RNA-seq set.
            </div>
          </CardHeader>
          <CardContent class="pt-0">
            <StageExpressionChart {stages} />
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="stages"
          title="Expression across life stages"
          message="No control RNA-seq value for this gene in this build."
        />
      {/if}
      {#if anatomy.length > 0}
        <Card id="tissues">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Tissue expression
              <ControlHint id="gene-tissue" title="Tissue expression">
                From the Alliance expression atlas (modENCODE + EBI Expression Atlas aggregates),
                mapped to WormBase Anatomy (WBbt) terms. Reflects published in-situ and RNA-seq
                calls.
              </ControlHint>
            </CardTitle>
            <span class="font-mono text-xs text-muted-foreground">
              {anatomy.length} tissues with reported expression
            </span>
          </CardHeader>
          <CardContent class="pt-0">
            <div class="flex flex-wrap gap-1.5">
              {#each anatomyExpanded ? anatomy : anatomy.slice(0, CHIP_LIMIT) as t (t.term_id)}
                <TermHover kind="tissue" id={t.term_id}>
                  <a
                    href="https://wormbase.org/species/all/anatomy_term/{t.term_id}"
                    target="_blank"
                    rel="noopener"
                    class="inline-flex items-baseline gap-1 rounded border bg-card px-1.5 py-0.5 text-xs transition-colors hover:bg-accent"
                    title={`${t.term_id} · ${t.n_evidence} evidence row${t.n_evidence === 1 ? '' : 's'}`}
                  >
                    <span>{t.name}</span>
                    {#if t.n_evidence > 1}
                      <span class="font-mono text-[0.6rem] text-muted-foreground"
                        >{t.n_evidence}</span
                      >
                    {/if}
                  </a>
                </TermHover>
              {/each}
              <ExpandMore
                total={anatomy.length}
                shown={CHIP_LIMIT}
                expanded={anatomyExpanded}
                onToggle={(v) => (anatomyExpanded = v)}
                label="tissues"
              />
            </div>
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="tissues"
          title="Tissue expression"
          message="No tissue expression reported for this gene in the Alliance expression atlas."
        />
      {/if}

      {#if cengen.length > 0 && gene}
        <Card id="cengen">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Neuronal expression (CeNGEN L4)
              <ControlHint id="gene-cengen" title="CeNGEN L4 expression">
                Bars show CeNGEN's integrated expression for the 52 neuron types sequenced in bulk
                after sorting, with transcripts that leaked in from other cell types subtracted
                using the single-cell atlas (Barrett et al. 2025); dots are the single-cell
                threshold calls for all 128 classes. The bulk values are deeper but not the same
                quantity as the per-neuron TPM in CeNGEN's single-cell app, so compare ranks within
                a neuron rather than numbers.
              </ControlHint>
            </CardTitle>
            <span class="font-mono text-xs text-muted-foreground">
              {cengen.length} neuron type{cengen.length === 1 ? '' : 's'}
            </span>
          </CardHeader>
          <CardContent class="pt-0">
            <CengenStripPlot gene={gene.wormbase_gene} geneName={gene.gene_name} rows={cengen} />
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="cengen"
          title="Neuronal expression (CeNGEN L4)"
          message="This gene was not detected in the CeNGEN L4 single-cell atlas."
        />
      {/if}

      {@render groupHeading('interactions')}
      {#if interactions.length > 0}
        <Card id="interactions">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Interactions
              <ControlHint id="gene-interactions" title="Interactions">
                BioGRID physical + genetic interactions. Click any partner to recenter, or open the
                interactive network view for the local neighborhood.
              </ControlHint>
            </CardTitle>
            <div class="flex items-center gap-3">
              <span class="font-mono text-xs text-muted-foreground"
                >{interactions.length} total</span
              >
              <a
                href={resolve(`/network/${gene.wormbase_gene}`)}
                class="text-xs text-primary hover:underline"
              >
                View as graph →
              </a>
            </div>
          </CardHeader>
          <CardContent class="space-y-3 pt-0">
            <MiniInteractionNetwork
              focalId={gene.wormbase_gene}
              focalName={gene.gene_name}
              {interactions}
            />
            {#each Object.entries(interactionsByType) as [type, items] (type)}
              {#if items.length}
                <div>
                  <div
                    class="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {type === 'physical' ? 'Physical' : type === 'genetic' ? 'Genetic' : 'Other'}
                    ({items.length})
                  </div>
                  <div class="flex flex-wrap gap-1.5">
                    {#each interactionsExpanded[type] ? items : items.slice(0, CHIP_LIMIT) as i, idx (`${i.partner}:${i.experimental_system}:${idx}`)}
                      <span class="inline-flex items-center gap-1">
                        <GenePill id={i.partner} name={i.partner_name ?? i.partner_symbol} />
                        <SystemBadge name={i.experimental_system} />
                      </span>
                    {/each}
                    <ExpandMore
                      total={items.length}
                      shown={CHIP_LIMIT}
                      expanded={!!interactionsExpanded[type]}
                      onToggle={(v) =>
                        (interactionsExpanded = { ...interactionsExpanded, [type]: v })}
                      label="interactions"
                    />
                  </div>
                </div>
              {/if}
            {/each}
            <div class="pt-1 text-xs text-muted-foreground">
              Source:
              <a
                href="https://thebiogrid.org/"
                target="_blank"
                rel="noopener"
                class="hover:text-primary"
              >
                BioGRID 5.0.257
              </a>
            </div>
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="interactions"
          title="Interactions"
          message="No physical or genetic interactions reported for this gene in BioGRID."
        />
      {/if}

      {#if stringInteractions.length > 0}
        <Card id="string-interactions">
          <CardHeader class="pb-3">
            <CardTitle class="inline-flex items-baseline gap-2 text-base">
              STRING predictions
              <span class="font-mono text-xs text-muted-foreground">v12 · score ≥ 700</span>
            </CardTitle>
          </CardHeader>
          <CardContent class="pt-0">
            <StringInteractionsCard interactions={stringInteractions} />
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="string-interactions"
          title="STRING predictions"
          message="No predicted functional partners for this gene in STRING."
        />
      {/if}

      {#if similar.length > 0}
        <Card id="similar">
          <CardHeader class="flex flex-row flex-wrap items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Similar genes
              <ControlHint id="gene-similar" title="Similar genes">
                Ranked by shared GO and WormCat annotations, both IDF-weighted so a rare category
                counts for more than a broad one, plus shared neuronal categories and interaction
                partners. GO ancestors count at reduced weight and only a few levels up, so
                similarity isn't dominated by trivial parents.
              </ControlHint>
            </CardTitle>
            <span class="font-mono text-xs text-muted-foreground">
              showing {Math.min(similarShown, similar.length)} of top {similar.length} ranked
            </span>
            <div class="text-xs text-muted-foreground">
              Ranked by IDF-weighted shared GO terms (with is_a ancestors) and WormCat categories,
              plus shared neuronal categories and interaction partners.
            </div>
          </CardHeader>
          <CardContent class="space-y-2 pt-0">
            {#each similar.slice(0, similarShown) as s (s.wormbase_gene)}
              <div class="border-b pb-2 last:border-b-0 last:pb-0">
                <div class="flex items-baseline gap-2 text-sm">
                  <GenePill id={s.wormbase_gene} name={s.gene_name} variant="inline" />
                  {#if s.concise_description}
                    <span class="flex-1 truncate text-xs text-muted-foreground">
                      {s.concise_description}
                    </span>
                  {/if}
                  <div class="flex shrink-0 gap-1">
                    {#if s.shared_go > 0}
                      <Badge
                        variant="muted"
                        class="px-1 py-0 text-[0.55rem] tabular-nums"
                        title="Direct GO terms shared (IDF-weighted score: {s.shared_go_score.toFixed(
                          1,
                        )})"
                      >
                        {s.shared_go} GO
                      </Badge>
                    {/if}
                    {#if s.shared_wormcat > 0}
                      <Badge variant="muted" class="px-1 py-0 text-[0.55rem]"
                        >{s.shared_wormcat} wc</Badge
                      >
                    {/if}
                    {#if s.shared_neuronal > 0}
                      <Badge variant="muted" class="px-1 py-0 text-[0.55rem]"
                        >{s.shared_neuronal} neu</Badge
                      >
                    {/if}
                    {#if s.shared_partners > 0}
                      <Badge variant="muted" class="px-1 py-0 text-[0.55rem]">
                        {s.shared_partners} ix
                      </Badge>
                    {/if}
                  </div>
                </div>
                {#if s.top_shared.length > 0}
                  <div class="mt-1 pl-2 text-[0.65rem] leading-snug text-muted-foreground">
                    <span class="mr-1">Shares:</span
                    >{#each s.top_shared as t, i (t.go_id)}{#if i > 0},
                      {/if}<TermHover kind="go" id={t.go_id}
                        ><a
                          href={resolve(`/go/${t.go_id}`)}
                          class="hover:text-primary"
                          title={t.go_id}>{t.name}</a
                        ></TermHover
                      >{/each}
                  </div>
                {/if}
              </div>
            {/each}
            <div class="flex">
              <ExpandMore
                total={similar.length}
                shown={similarShown}
                expanded={similarShown > ROW_LIMIT}
                step={ROW_LIMIT}
                onToggle={(more) =>
                  (similarShown = more
                    ? Math.min(similar.length, similarShown + ROW_LIMIT)
                    : ROW_LIMIT)}
                label="similar genes"
              />
            </div>
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="similar"
          title="Similar genes"
          message="No other gene shares enough annotations with this one to rank as similar."
        />
      {/if}

      {#if cengenCoexpr.length > 0 && gene}
        {@const safeGene = gene}
        <Card id="cengen-coexpr">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Co-expressions across neuron types
              <ControlHint id="gene-cengen-coexpr" title="CeNGEN co-expression">
                Genes whose expression across CeNGEN's 52 bulk-sequenced neuron types best matches
                this gene (Pearson on log1p TMM). A pair is kept only if it is significant at p &lt;
                0.001 and each gene is among the other's 200 strongest partners. Rows are ordered by
                mutual rank, so #3/#4 is a tighter pair than #3/#180. A gene can appear here with no
                expression card above, which shows only values over 0.5 TMM.
              </ControlHint>
            </CardTitle>
            <span class="font-mono text-xs text-muted-foreground">
              showing {Math.min(coexprShown, coexprFiltered.length)} of {coexprFiltered.length} neighbors
            </span>
          </CardHeader>
          <CardContent class="space-y-2 pt-0">
            <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <label class="inline-flex items-center gap-1">
                in neuron
                <select
                  bind:value={coexprNeuron}
                  onchange={() => reloadCoexpr(safeGene.wormbase_gene)}
                  class="rounded border bg-card px-1 py-0.5 font-mono text-xs"
                >
                  <option value="">(all, global)</option>
                  {#each coexprNeuronOptions as nt (nt)}
                    <option value={nt}>{nt}</option>
                  {/each}
                </select>
              </label>
              {#if coexprNeuron}
                <label class="inline-flex items-center gap-1">
                  threshold
                  <select
                    bind:value={coexprThreshold}
                    onchange={() => reloadCoexpr(safeGene.wormbase_gene)}
                    class="rounded border bg-card px-1 py-0.5 font-mono text-xs"
                  >
                    <option value={1}>liberal</option>
                    <option value={2}>medium</option>
                    <option value={3}>conservative</option>
                    <option value={4}>stringent</option>
                  </select>
                </label>
              {/if}
              {#if coexprLoading}
                <span>Loading…</span>
              {/if}
            </div>
            {#if coexprFiltered.length === 0}
              <div class="text-xs italic text-muted-foreground">
                No co-expressed neighbors meet the filter. Try a looser threshold or "all (global)".
              </div>
            {:else}
              <div class="grid grid-cols-[auto_auto_1fr] items-baseline gap-x-3 gap-y-1 text-xs">
                <span
                  class="cursor-help text-right text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
                  title="Pearson correlation on log1p(expression) across CeNGEN’s 52 bulk-sequenced neuron types.&#10;Scale (higher = more similar expression pattern):&#10;  1.00&#9;identical pattern&#10;  0.8 – 0.99&#9;very tight: same neuron-type specificity&#10;  0.5 – 0.8&#9;strong: shared dominant neuron classes&#10;  0.3 – 0.5&#9;moderate: overlapping but distinct programs&#10;  0.1 – 0.3&#9;weak: barely above coincidence"
                >
                  Pearson
                </span>
                <span
                  class="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Gene
                </span>
                <span
                  class="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Description
                </span>
                {#each coexprFiltered.slice(0, coexprShown) as n (n.wormbase_gene)}
                  {@const t = Math.max(0, Math.min(1, (n.pearson - 0.1) / 0.9))}
                  <span
                    class="rounded px-1.5 py-0.5 text-right font-mono tabular-nums"
                    style="background-color: {rangeColor(t)}; color: {rangeTextColor(t)};"
                    title="Pearson {n.pearson.toFixed(3)} (1.0 = identical pattern)"
                  >
                    {n.pearson.toFixed(3)}
                  </span>
                  <span class="flex items-baseline gap-1">
                    <GenePill id={n.wormbase_gene} name={n.gene_name} />
                    {#if n.rank_self > 0 && n.rank_other > 0}
                      <span
                        class="shrink-0 font-mono text-[0.55rem] tabular-nums text-muted-foreground"
                        title={`#${n.rank_self} in this gene's neighbors, #${n.rank_other} in ${n.gene_name ?? n.wormbase_gene}'s`}
                      >
                        #{n.rank_self}/{n.rank_other}
                      </span>
                    {/if}
                  </span>
                  <span class="truncate text-muted-foreground">
                    {n.concise_description ?? ''}
                  </span>
                {/each}
              </div>
              <div class="flex">
                <ExpandMore
                  total={coexprFiltered.length}
                  shown={coexprShown}
                  expanded={coexprShown > ROW_LIMIT}
                  step={ROW_LIMIT}
                  onToggle={(more) =>
                    (coexprShown = more
                      ? Math.min(coexprFiltered.length, coexprShown + ROW_LIMIT)
                      : ROW_LIMIT)}
                  label="neighbors"
                />
              </div>
            {/if}
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="cengen-coexpr"
          title="Co-expressions across neuron types"
          message="No co-expression neighbors, since this gene was not detected in the CeNGEN atlas."
        />
      {/if}

      {@render groupHeading('papers')}
      {#if papers.length > 0}
        <Card id="papers">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              References
              <ControlHint id="gene-refs" title="References">
                Publications citing this gene, aggregated from GO and phenotype annotation
                references. Skips curation-only refs (GO_REF:*).
              </ControlHint>
            </CardTitle>
            <span class="font-mono text-xs text-muted-foreground">
              {papers.length} distinct paper{papers.length === 1 ? '' : 's'}
            </span>
          </CardHeader>
          <CardContent class="pt-0">
            <div class="mb-2 text-[0.65rem] text-muted-foreground">
              Top papers cited across GO annotations and allele-mediated phenotypes for this gene.
            </div>
            <div class="flex flex-col divide-y">
              {#each papersExpanded ? papers : papers.slice(0, CHIP_LIMIT) as p (p.reference)}
                <!-- eslint-disable svelte/no-navigation-without-resolve -->
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener"
                  class="group flex items-baseline gap-2 py-1.5 transition-colors hover:bg-accent"
                  title={`${p.title ? `${p.journal ?? ''}${p.journal && p.year ? ' · ' : ''}${p.year ?? ''} · ` : ''}${p.n_go} GO · ${p.n_pheno} phenotype evidence`}
                >
                  {#if p.title}
                    <span class="min-w-0 flex-1 truncate text-xs group-hover:underline">
                      {fmtTitle(p.title)}
                    </span>
                    <span class="shrink-0 font-mono text-[0.6rem] text-muted-foreground">
                      {p.authors ?? ''}{p.authors && p.year ? ' ' : ''}{p.year ? `(${p.year})` : ''}
                    </span>
                  {:else}
                    <span class="min-w-0 flex-1 truncate font-mono text-xs group-hover:underline">
                      <span class="text-[0.6rem] text-muted-foreground">{p.prefix}</span>
                      {p.id}
                    </span>
                  {/if}
                  <span class="shrink-0 font-mono text-[0.6rem] text-muted-foreground"
                    >×{p.total}</span
                  >
                </a>
                <!-- eslint-enable svelte/no-navigation-without-resolve -->
              {/each}
              <ExpandMore
                total={papers.length}
                shown={CHIP_LIMIT}
                expanded={papersExpanded}
                onToggle={(v) => (papersExpanded = v)}
                label="papers"
              />
            </div>
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="papers"
          title="References"
          message="No curated WormBase references for this gene."
        />
      {/if}

      {#if literaturePapers.length > 0}
        <Card id="literature">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              All literature
              <ControlHint id="gene-literature" title="All literature">
                Comprehensive list of publications linked to this gene by NCBI (gene2pubmed),
                resolved to titles and DOIs where available.
              </ControlHint>
            </CardTitle>
            <span class="font-mono text-xs text-muted-foreground">
              {literaturePapers.length} paper{literaturePapers.length === 1 ? '' : 's'}
            </span>
          </CardHeader>
          <CardContent class="pt-0">
            <div class="flex flex-col divide-y">
              {#each literatureExpanded ? literaturePapers : literaturePapers.slice(0, CHIP_LIMIT) as p (p.pmid)}
                <!-- eslint-disable svelte/no-navigation-without-resolve -->
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener"
                  class="group flex items-baseline gap-2 py-1.5 transition-colors hover:bg-accent"
                  title={p.title
                    ? `${p.journal ?? ''}${p.journal && p.year ? ' · ' : ''}${p.year ?? ''}`
                    : `PMID:${p.pmid}`}
                >
                  {#if p.title}
                    <span class="min-w-0 flex-1 truncate text-xs group-hover:underline">
                      {fmtTitle(p.title)}
                    </span>
                    <span class="shrink-0 font-mono text-[0.6rem] text-muted-foreground">
                      {p.authors ?? ''}{p.authors && p.year ? ' ' : ''}{p.year ? `(${p.year})` : ''}
                    </span>
                  {:else}
                    <span class="min-w-0 flex-1 truncate font-mono text-xs group-hover:underline">
                      <span class="text-[0.6rem] text-muted-foreground">PMID</span>
                      {p.pmid}
                    </span>
                  {/if}
                </a>
                <!-- eslint-enable svelte/no-navigation-without-resolve -->
              {/each}
              <ExpandMore
                total={literaturePapers.length}
                shown={CHIP_LIMIT}
                expanded={literatureExpanded}
                onToggle={(v) => (literatureExpanded = v)}
                label="papers"
              />
            </div>
          </CardContent>
        </Card>
      {:else}
        <EmptyPanel
          id="literature"
          title="All literature"
          message="No publications linked to this gene in NCBI gene2pubmed."
        />
      {/if}
    {/if}
  </div>

  {#if gene}
    <aside class="hidden xl:block">
      <PageToc entries={tocEntries} />
    </aside>
  {/if}
</div>
