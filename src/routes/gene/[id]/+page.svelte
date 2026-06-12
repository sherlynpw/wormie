<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { untrack } from 'svelte';
  import {
    getGene,
    getWormcatFor,
    getNeuronalFor,
    getSynaptogenesisFor,
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
  } from '$lib/synaptogenesis-references';

  let gene = $state<GeneRow | null>(null);
  let wormcat = $state<WormcatAssignment | null>(null);
  let neuronal = $state<NeuronalAssignment[]>([]);
  let synaptogenesis = $state<SynaptogenesisAssignment[]>([]);
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
  let similarExpanded = $state(false);
  let papersExpanded = $state(false);
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
      const rows = await getCengenCoexpressionFor(wb, 20, {
        neuronType: coexprNeuron || undefined,
        minThreshold: coexprThreshold,
      });
      cengenCoexpr = rows;
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
    const [wc, neu, syn, goAnn, ortho, ix, sim, ph, phCat, al, an, xr, pp, ce, cx, dz, rn, pw, si] =
      await Promise.all([
        getWormcatFor(wb),
        getNeuronalFor(wb),
        getSynaptogenesisFor(wb),
        getGoFor(wb),
        getOrthologs(wb),
        getInteractionsFor(wb),
        getSimilarGenes(wb, 16),
        getPhenotypesFor(wb),
        getPhenotypeCategoriesFor(wb),
        getAllelesFor(wb),
        getAnatomyFor(wb),
        getXrefsFor(wb),
        getPapersFor(wb, 20),
        getCengenExpressionFor(wb),
        getCengenCoexpressionFor(wb, 20),
        getDiseasesFor(wb),
        getRnaiForGene(wb),
        getPathwaysFor(wb),
        getStringInteractionsFor(wb),
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
    cengen = ce;
    cengenCoexpr = cx;
    diseases = dz;
    rnai = rn;
    pathways = pw;
    stringInteractions = si;
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

  // Dynamic TOC: leaves appear only if their section has data; groups vanish when all children are empty.
  // Card render order below mirrors this grouping.
  const tocEntries = $derived.by<TocEntry[]>(() => {
    const overview: TocLeaf[] = [{ id: 'overview', label: 'Overview' }];

    const identity: TocLeaf[] = [];
    if (xrefs.length > 0) identity.push({ id: 'external', label: 'External resources' });
    if (wormcat?.category_1) identity.push({ id: 'wormcat', label: 'WormCat' });
    if (neuronal.length > 0) identity.push({ id: 'neuronal', label: 'Neuronal class' });

    const expression: TocLeaf[] = [];
    if (anatomy.length > 0) expression.push({ id: 'tissues', label: 'Tissues' });
    if (cengen.length > 0) expression.push({ id: 'cengen', label: 'CeNGEN neurons' });
    if (cengenCoexpr.length > 0) expression.push({ id: 'cengen-coexpr', label: 'Co-expressed' });

    const ontology: TocLeaf[] = [];
    if (goAnnotations.length > 0) {
      ontology.push({ id: 'go-dist', label: 'GO distribution' });
      ontology.push({ id: 'go', label: 'GO annotations' });
    }
    if (pathways.length > 0) ontology.push({ id: 'pathways', label: 'KEGG pathways' });

    const physiology: TocLeaf[] = [];
    if (phenotypes.length > 0) physiology.push({ id: 'phenotypes', label: 'Phenotypes' });
    if (alleles.length > 0) physiology.push({ id: 'alleles', label: 'Alleles' });
    void allelesExpanded; // alleles use <details>; flagged here for parity if that changes
    if (diseases.length > 0) physiology.push({ id: 'diseases', label: 'Diseases' });

    const conservation: TocLeaf[] = [];
    if (orthologs.length > 0) {
      conservation.push({ id: 'phylo', label: 'Phylo footprint' });
      conservation.push({ id: 'orthologs', label: 'Orthologs' });
    }

    const network: TocLeaf[] = [];
    if (interactions.length > 0) network.push({ id: 'interactions', label: 'Interactions' });
    if (stringInteractions.length > 0)
      network.push({ id: 'string-interactions', label: 'STRING predictions' });
    if (similar.length > 0) network.push({ id: 'similar', label: 'Similar genes' });

    const literature: TocLeaf[] = [];
    if (papers.length > 0) literature.push({ id: 'papers', label: 'References' });

    const out: TocEntry[] = [...overview];
    if (identity.length) out.push({ label: 'Identity', children: identity });
    if (expression.length) out.push({ label: 'Expression', children: expression });
    if (ontology.length) out.push({ label: 'Function (GO)', children: ontology });
    if (physiology.length) out.push({ label: 'Phenotype & disease', children: physiology });
    if (conservation.length) out.push({ label: 'Conservation', children: conservation });
    if (network.length) out.push({ label: 'Network', children: network });
    if (literature.length) out.push({ label: 'Literature', children: literature });
    return out;
  });

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

<div
  class="mx-auto max-w-4xl p-4 md:p-6 xl:grid xl:max-w-6xl xl:grid-cols-[minmax(0,1fr)_192px] xl:gap-6"
>
  <div class="min-w-0 space-y-4">
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

    {#if gene && bookmarks.has(gene.wormbase_gene) && bookmarks.get(gene.wormbase_gene)?.note}
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
      <Card id="overview">
        <CardHeader>
          <div class="flex flex-wrap items-baseline justify-between gap-4">
            <CardTitle class="text-2xl">
              {gene.gene_name ?? gene.wormbase_gene}
            </CardTitle>
            <div class="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
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
          <div class="mt-2 flex flex-wrap gap-1.5">
            {#if gene.sequence_name}
              <Badge variant="secondary" class="font-mono">{gene.sequence_name}</Badge>
            {/if}
            {#if gene.gene_type}<Badge variant="secondary">{gene.gene_type}</Badge>{/if}
            {#if gene.operon}<Badge variant="secondary">operon: {gene.operon}</Badge>{/if}
            {#if gene.status}
              <Badge variant={gene.status.toLowerCase() === 'live' ? 'success' : 'muted'}>
                {gene.status}
              </Badge>
            {/if}
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
      {/if}

      {#if neuronal.length}
        <Card id="neuronal">
          <CardHeader class="pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Neuronal classification
              <ControlHint id="gene-neuronal" title="Neuronal classification">
                CeNGEN / Hobert-lab classification of neuronal-expressed genes by function
                (transcription factor, neuropeptide, receptor, etc.) and by supercategory.
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
      {/if}

      {#if synaptogenesis.length}
        <Card id="synaptogenesis">
          <CardHeader class="pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Synaptogenesis panel
              <ControlHint id="gene-synaptogenesis" title="Synaptogenesis panel">
                Curated 215-gene panel grouped into 13 functional classes — proneural fate, terminal
                selectors, active zone, SV release, innexins, postsynaptic, Wnt/PHR signaling, etc.
                Source: Andrew lab pipeline. Each class links to the primary references that justify
                its membership.
              </ControlHint>
            </CardTitle>
          </CardHeader>
          <CardContent class="space-y-2 pt-0">
            {#each synaptogenesis as s, i (i)}
              {@const meta = synaptoClassById(s.class)}
              <div class="rounded-md border bg-card/50 p-2">
                <div class="flex flex-wrap items-center gap-1.5 text-sm">
                  <a
                    href={resolve(`/?view=synaptogenesis&q=${encodeURIComponent(s.class)}`)}
                    class="text-primary hover:underline"
                  >
                    <Badge variant="secondary">{meta?.label ?? s.class}</Badge>
                  </a>
                  {#if s.subclass}
                    <span class="text-muted-foreground">›</span>
                    <Badge variant="muted" class="text-[0.65rem]">{s.subclass}</Badge>
                  {/if}
                  {#if meta?.note}
                    <Badge variant="outline" class="text-[0.6rem]">{meta.note}</Badge>
                  {/if}
                </div>
                {#if s.notes}
                  <div class="mt-1 text-xs text-muted-foreground">{s.notes}</div>
                {/if}
                {#if meta?.refIds && meta.refIds.length > 0}
                  <div class="mt-1.5 flex flex-wrap gap-1">
                    {#each meta.refIds as rid (rid)}
                      {@const r = synaptoRefById(rid)}
                      {#if r}
                        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
                        <a
                          href={synaptoDoiHref(r.doi)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${r.authors} (${r.year}) — ${r.title}. ${r.journal}`}
                          class="inline-block rounded border bg-background px-1.5 py-0.5 font-mono text-[0.6rem] text-muted-foreground hover:bg-accent"
                        >
                          {rid}
                        </a>
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </CardContent>
        </Card>
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
      {/if}

      {#if cengen.length > 0 && gene}
        <Card id="cengen">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Neuronal expression (CeNGEN L4)
              <ControlHint id="gene-cengen" title="CeNGEN L4 expression">
                Per-neuron-type TMM-normalized expression from the CeNGEN L4 integrated atlas
                (Barrett et al. 2022, combines bulk + scRNA-seq). Mean across replicates of each
                neuron type; threshold TMM &gt; 0.5. Use this for "is this gene expressed in neuron
                X" answers; the Alliance Tissue expression card above is broader anatomy.
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
      {/if}

      {#if cengenCoexpr.length > 0 && gene}
        {@const safeGene = gene}
        <Card id="cengen-coexpr">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Co-expressed in CeNGEN neurons
              <ControlHint id="gene-cengen-coexpr" title="CeNGEN co-expression">
                Genes whose expression pattern across CeNGEN's 41 bulk-covered neuron types most
                closely matches this gene (Pearson on log1p TMM, computed at build time). Pick a
                neuron to restrict neighbors to those also called expressed in that neuron at the
                chosen threshold; Pearson scores stay global so they still measure overall pattern
                similarity.
              </ControlHint>
            </CardTitle>
            <span class="font-mono text-xs text-muted-foreground">
              {coexprFiltered.length} of {cengenCoexpr.length} neighbors
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
                  title="Pearson correlation on log1p(TMM) across CeNGEN’s 41 neuron types.&#10;Scale (higher = more similar expression pattern):&#10;  1.00&#9;identical pattern&#10;  0.8 – 0.99&#9;very tight: same neuron-type specificity&#10;  0.5 – 0.8&#9;strong: shared dominant neuron classes&#10;  0.3 – 0.5&#9;moderate: overlapping but distinct programs&#10;  0.1 – 0.3&#9;weak: barely above coincidence"
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
                {#each coexprFiltered as n (n.wormbase_gene)}
                  {@const t = Math.max(0, Math.min(1, (n.pearson - 0.1) / 0.9))}
                  <span
                    class="rounded px-1.5 py-0.5 text-right font-mono tabular-nums"
                    style="background-color: hsl(142 {50 + 35 * t}% {92 -
                      32 * t}%); color: hsl(142 {Math.round(60 + 30 * t)}% {Math.round(
                      28 - 10 * t,
                    )}%);"
                    title="Pearson {n.pearson.toFixed(3)} (1.0 = identical pattern)"
                  >
                    {n.pearson.toFixed(3)}
                  </span>
                  <GenePill id={n.wormbase_gene} name={n.gene_name} />
                  <span class="truncate text-muted-foreground">
                    {n.concise_description ?? ''}
                  </span>
                {/each}
              </div>
            {/if}
          </CardContent>
        </Card>
      {/if}

      {#if goByNs.total > 0}
        <Card id="go-dist">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              GO annotation distribution
              <ControlHint id="gene-go-dist" title="GO annotation distribution">
                Counts of this gene's <b>direct</b> GO annotations split by namespace (BP / MF / CC) and
                evidence-code class (experimental vs computational). Propagated ancestor annotations aren't
                counted here.
              </ControlHint>
            </CardTitle>
            <span class="font-mono text-xs text-muted-foreground">{goByNs.total} annotations</span>
          </CardHeader>
          <CardContent class="space-y-2 pt-0">
            <div class="flex h-6 overflow-hidden rounded-md border">
              {#if goByNs.BP > 0}
                <div
                  class="flex items-center justify-center bg-emerald-500/70 font-mono text-[0.7rem] font-semibold text-white dark:bg-emerald-600/70"
                  style="width: {(goByNs.BP / goByNs.total) * 100}%"
                  title="Biological process: {goByNs.BP}"
                >
                  {goByNs.BP}
                </div>
              {/if}
              {#if goByNs.MF > 0}
                <div
                  class="flex items-center justify-center bg-violet-500/70 font-mono text-[0.7rem] font-semibold text-white dark:bg-violet-600/70"
                  style="width: {(goByNs.MF / goByNs.total) * 100}%"
                  title="Molecular function: {goByNs.MF}"
                >
                  {goByNs.MF}
                </div>
              {/if}
              {#if goByNs.CC > 0}
                <div
                  class="flex items-center justify-center bg-amber-500/70 font-mono text-[0.7rem] font-semibold text-white dark:bg-amber-600/70"
                  style="width: {(goByNs.CC / goByNs.total) * 100}%"
                  title="Cellular component: {goByNs.CC}"
                >
                  {goByNs.CC}
                </div>
              {/if}
            </div>
            <div class="flex gap-4 text-xs text-muted-foreground">
              <div class="flex items-center gap-1.5">
                <span class="h-3 w-3 rounded-sm bg-emerald-500/70"></span>
                Biological process ({goByNs.BP})
              </div>
              <div class="flex items-center gap-1.5">
                <span class="h-3 w-3 rounded-sm bg-violet-500/70"></span>
                Molecular function ({goByNs.MF})
              </div>
              <div class="flex items-center gap-1.5">
                <span class="h-3 w-3 rounded-sm bg-amber-500/70"></span>
                Cellular component ({goByNs.CC})
              </div>
            </div>
          </CardContent>
        </Card>
      {/if}

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
      {/if}

      {#if pathways.length > 0}
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
                <TermHover kind="phenotype" id={p.term_id}>
                  <a
                    href={resolve(`/phenotype/${p.term_id}`)}
                    class="inline-flex items-baseline gap-1 rounded border bg-card px-1.5 py-0.5 text-xs transition-colors hover:bg-accent"
                    title={rnaiOnly
                      ? `${p.term_id} · ${p.n_evidence} RNAi/non-allele evidence row${p.n_evidence === 1 ? '' : 's'} (no alleles)`
                      : `${p.term_id} · ${p.n_alleles} allele${p.n_alleles === 1 ? '' : 's'}${p.n_evidence > p.n_alleles ? ` + ${p.n_evidence - p.n_alleles} other evidence` : ''}`}
                  >
                    <span>{p.name}</span>
                    {#if rnaiOnly}
                      <span
                        class="font-mono text-[0.55rem] uppercase tracking-wider text-amber-700 dark:text-amber-400"
                        >RNAi</span
                      >
                      <span class="font-mono text-[0.6rem] text-muted-foreground"
                        >{p.n_evidence}</span
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
      {/if}

      {#if alleles.length > 0}
        <Card id="alleles">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Alleles
              <ControlHint id="gene-alleles" title="Alleles">
                Reported variants for this gene with their molecular nature (point mutation,
                deletion, knockout etc) and any associated phenotypes. Drawn from WormBase variation
                records.
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
                            {a.allele_id}
                          </a>
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
      {/if}

      {#if rnai.length > 0}
        <Card id="rnai">
          <CardHeader class="flex flex-row items-baseline justify-between pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              RNAi reagents
              <ControlHint id="gene-rnai" title="RNAi reagents">
                WormBase-curated RNAi knockdown experiments that targeted this gene, with the
                phenotypes scored. Each reagent links to its WormBase RNAi page where the source
                library (Ahringer, ORFeome, etc.) and clone names (sjj_*, mv_*) live.
              </ControlHint>
            </CardTitle>
            <span class="font-mono text-xs text-muted-foreground">
              {rnai.length} reagent{rnai.length === 1 ? '' : 's'}
            </span>
          </CardHeader>
          <CardContent class="pt-0">
            <div class="overflow-x-auto rounded-md border bg-card">
              <table class="w-full text-sm">
                <thead class="border-b bg-card">
                  <tr>
                    <th
                      class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      Reagent
                    </th>
                    <th
                      class="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      Phenotypes
                    </th>
                    <th
                      class="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      Observed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {#each rnai.slice(0, 30) as r (r.wbrnai_id)}
                    <tr class="border-b last:border-b-0 hover:bg-muted/30">
                      <td class="px-3 py-2 align-top">
                        <a
                          href={`https://wormbase.org/species/c_elegans/rnai/${r.wbrnai_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="font-mono text-primary hover:underline"
                          title="View clone names + library on WormBase"
                        >
                          {r.wbrnai_id}
                        </a>
                      </td>
                      <td
                        class="px-3 py-2 text-right align-top font-mono tabular-nums text-muted-foreground"
                      >
                        {r.phenotype_count}
                      </td>
                      <td class="px-3 py-2 align-top">
                        <div class="flex flex-wrap gap-1">
                          {#each r.phenotype_names.slice(0, 6) as name, i (r.phenotype_ids[i])}
                            <a
                              href={resolve(`/phenotype/${r.phenotype_ids[i]}`)}
                              class="inline-block rounded border bg-background px-1.5 py-0.5 text-[0.65rem] hover:bg-accent"
                            >
                              {name}
                            </a>
                          {/each}
                          {#if r.phenotype_names.length > 6}
                            <span class="text-[0.65rem] italic text-muted-foreground"
                              >+{r.phenotype_names.length - 6} more</span
                            >
                          {/if}
                        </div>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            {#if rnai.length > 30}
              <div class="mt-2 text-[0.7rem] text-muted-foreground">
                Showing 30 of {rnai.length} reagents (sorted by phenotype count). For the full list, see
                WormBase.
              </div>
            {/if}
          </CardContent>
        </Card>
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
      {/if}

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
      {/if}

      {#if similar.length > 0}
        <Card id="similar">
          <CardHeader class="pb-3">
            <CardTitle class="inline-flex items-center gap-1.5 text-base">
              Similar genes
              <ControlHint id="gene-similar" title="Similar genes">
                Ranked by shared GO annotations (IDF-weighted), shared WormCat & neuronal
                categories, and shared interaction partners. Direct annotations only — propagated GO
                ancestors aren't used so similarity isn't dominated by trivial parents.
              </ControlHint>
            </CardTitle>
            <div class="text-xs text-muted-foreground">
              Ranked by IDF-weighted shared GO terms (with is_a ancestors), shared WormCat +
              neuronal categories, and shared interaction partners.
            </div>
          </CardHeader>
          <CardContent class="space-y-2 pt-0">
            {#each similarExpanded ? similar : similar.slice(0, ROW_LIMIT) as s (s.wormbase_gene)}
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
                shown={ROW_LIMIT}
                expanded={similarExpanded}
                onToggle={(v) => (similarExpanded = v)}
                label="similar genes"
              />
            </div>
          </CardContent>
        </Card>
      {/if}

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
            <div class="flex flex-wrap gap-1.5">
              {#each papersExpanded ? papers : papers.slice(0, CHIP_LIMIT) as p (p.reference)}
                <!-- eslint-disable svelte/no-navigation-without-resolve -->
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener"
                  class="inline-flex items-baseline gap-1.5 rounded-md border bg-card px-2 py-1 transition-colors hover:bg-accent"
                  title={`${p.n_go} GO · ${p.n_pheno} phenotype evidence`}
                >
                  <span class="font-mono text-[0.6rem] text-muted-foreground">{p.prefix}</span>
                  <span class="font-mono text-xs">{p.id}</span>
                  <span class="font-mono text-[0.6rem] text-muted-foreground">×{p.total}</span>
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
      {/if}
    {/if}
  </div>

  {#if gene}
    <aside class="hidden xl:block">
      <PageToc entries={tocEntries} />
    </aside>
  {/if}
</div>
