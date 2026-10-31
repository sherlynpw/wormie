<script lang="ts">
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';

  type Entry = {
    date: string; // YYYY-MM-DD
    title: string;
    changes: string[];
  };

  // Newest first. Add a new entry at the top for each notable release.
  const ENTRIES: Entry[] = [
    {
      date: '2026-10-30',
      title: 'Clearer neuron names and searches that find more',
      changes: [
        'Rename the Hobert catalogue of neuronal genes to "Neuronal genes" and the CeNGEN (C. elegans Neuronal Gene Expression Network) single-cell data to "Neuron types", so a group of genes and a group of cells no longer have almost the same name. The neuronal: and expressed: search prefixes do not change.',
        'Show where a search would match when nothing matches in gene names and IDs. For example, TFEB now lists hlh-30 under ortholog symbols, with a link to its gene page, and does not stop at "Found 0 genes".',
      ],
    },
    {
      date: '2026-10-25',
      title: 'Browse by tissue, phenotype and disease',
      changes: [
        'Add browse pages for phenotypes (the WormBase phenotype ontology as a tree), human diseases (a list you can filter) and tissues (the WormBase anatomy tree).',
        'Add a page for each tissue with its definition, its parent and child terms (with part-of links marked) and its genes. Tissue names on a gene page now open this page.',
        'Link each CeNGEN neuron type on a gene page to the page for that neuron type. AWC, IL2, RMD and RME have bulk data only, so they have no page.',
        'Link each gene in the differential expression (DE) results table, the volcano plot and the MA plot to its gene page. This also works for genes that have only a sequence name.',
        'Show names that match more than one gene in an "Ambiguous" group in the gene name resolver, so you can choose the correct gene. For example, syt-1 matches snt-1 and nos-3.',
      ],
    },
    {
      date: '2026-10-24',
      title: 'Ranked-list enrichment p-values and search fixes',
      changes: [
        'Fix ranked-list enrichment (gene set enrichment analysis, GSEA) p-values for very strongly enriched sets. For some sets the refined p-value estimate did not run, so a WormCat set showed p of about 0.003 where the R package fgsea gives 4e-41. The results now agree with fgsea for every significant set.',
        'Give tied genes the same rank in per-sample set scores (single-sample GSEA, ssGSEA), so a score depends only on the expression values and not on the row order of the table.',
        'Add protein domain names and accessions to the free-text search, for example domain:forkhead.',
        'Read a quoted search value as one phrase, so cat:"amino acid" finds 126 genes and not 1,096.',
        'Fix the home search count, which could include genes that the result list did not show. "Send all matches" then sent those genes too.',
        'Accept WormBase gene IDs in lowercase, such as wbgene00000898.',
      ],
    },
    {
      date: '2026-10-23',
      title: 'Genome position, life stages, gene models and protein domains',
      changes: [
        'Add the genetic map position and the genome coordinates (WBcel235) to the gene page header, for example III:-8.07 cM for daf-2, with a link to the WormBase genome browser.',
        'Add a chr: search prefix (for example chr:X), genes per chromosome in the search facets, a Map column in the table view and chromosome and coordinate columns in the exports.',
        'Add an "Expression across life stages" panel to the gene page. It shows the median fragments per kilobase of transcript per million mapped reads (FPKM) for each stage from embryo to adult and dauer, from the WormBase control libraries.',
        'Add a gene model panel with the isoforms, exons, coding sequence and protein length of each transcript.',
        'Add a protein domain panel with InterPro, Pfam, SMART, PANTHER, SUPERFAMILY, PROSITE and PRINTS entries for each gene.',
        'Add protein domains (InterPro) as an enrichment kind in over-representation, ranked-list enrichment and per-sample set scores.',
        'Fix the search for a pasted list of about 3,000 or more IDs, which failed and then showed every gene.',
        'Read counts tables exported from Excel that have a tab at the end of each line. Tell you when empty or non-number cells are read as 0 and when a gene ID occurs twice.',
        'Fix the shrinkage choice for each contrast, which ignored the choice made before the fit.',
      ],
    },
    {
      date: '2026-10-19',
      title: 'Synapse panel v6 and trend test on set scores',
      changes: [
        'Update the synapse panel, now named "Synapse development and function", to 178 genes in 12 classes. Each gene now has at least one primary research article that names it. The dauer signaling genes (daf-2, daf-7, daf-12, daf-16) are removed and a new synaptic cargo transport class holds unc-104, unc-116 and related genes.',
        'Add "Test a trend" to per-sample set scores. It tests if set scores change with a variable such as age, with one limma linear model for each set and a Benjamini-Hochberg false discovery rate (FDR) across sets.',
        'Show a warning with the R error when log2 fold change shrinkage fails. The table then shows the values without shrinkage.',
        'Resolve Entrez IDs, and alternative names of genes that have more than one, in the gene name resolver. For example, daf-17 now finds daf-16.',
        'Fix AND, OR and NOT in searches that use prefixes such as go:, cat: or expressed:. Before, OR acted as AND and NOT was ignored.',
        'Add CeNGEN neuron types as a category in Annotation overlap.',
      ],
    },
    {
      date: '2026-10-16',
      title: 'Curated panels matched by WormBase ID',
      changes: [
        'Match the neuronal genes and the synapse panel to WormBase gene IDs, not to gene names.',
        'Remove ncs-8, ncs-9 and nep-27 from the neuronal genes, because the source chapter gives no sequence name for them and WormBase has no such genes.',
        'Remove the proneural and terminal selector transcription factor classes from the synapse panel, so it covers synapse formation itself (v5, 171 genes in 11 classes).',
      ],
    },
    {
      date: '2026-10-13',
      title: 'Differential expression and enrichment corrections',
      changes: [
        'Fix apeglm shrinkage, which did nothing when a condition name had a hyphen (such as daf-2). Those results were not shrunk but had the apeglm label.',
        'Fix the adjusted p-values after shrinkage, which used the DESeq2 default alpha of 0.1 and not your cutoff.',
        'Read plain gene-by-sample count tables (tab or comma separated) in differential expression. Before, the first five sample columns of such a table were dropped without a message.',
        'Add a strandedness choice to read counting (unstranded, forward or reverse), with a warning when fewer than 20% of the reads in a sample are assigned.',
        'Fix the refined p-values in ranked-list enrichment, which were about two times too small. The estimate now goes down to 1e-50 and shows smaller values as "< 1e-50".',
        'Change "flipped" in Contrast comparison to genes significant in both contrasts with opposite signs. Before, it meant a log2 fold change above 0.5 in both, with no p-value check. Genes now fall into six groups that match the Venn diagram.',
        'Accept edgeR and limma tables in ranked-list enrichment.',
        'Offer all enrichment kinds in per-sample set scores, and exclude NOT annotations of Gene Ontology (GO) from its gene sets.',
        'Keep one WormCat term when the same name has the same genes at two category levels.',
        'Call a gene significant only when its adjusted p-value is below the cutoff, as DESeq2 does. Before, a value equal to the cutoff also counted.',
        'Show allele names (for 6,974 of 7,487 alleles with phenotypes) in place of WormBase variation IDs.',
        'Accept gene lists in Enrichment overlap, which runs over-representation on each list.',
      ],
    },
    {
      date: '2026-10-08',
      title: 'CeNGEN 2024 data and redundancy reduction',
      changes: [
        'Use the 2024 CeNGEN integrated expression data for 52 neuron types, with contamination from other cell types removed. The old 2021 file had values of 10^12 or more in the AVK column for 1,729 genes. The single-cell threshold calls for neuron-type enrichment do not change.',
        'Calculate the co-expression again over the 52 neuron types.',
        'Mark the 75 genes that CeNGEN itself calls unreliable on their gene pages.',
        'Add an optional reduction of redundant enrichment terms that follows REVIGO (Supek et al. 2011), with a similarity slider. It is off by default.',
      ],
    },
    {
      date: '2026-10-02',
      title: 'Synapse panel v4 and reference fixes',
      changes: [
        'Rebuild the synapse panel (v4) after a check against its cited papers. It now has 220 genes. 24 genes whose papers did not support them are removed, ceh-38 and ceh-41 are added and each gene has a role-based subclass.',
        'Show each paper once in the gene page References list. Before, a paper cited by its PubMed ID and by its WormBase paper ID showed twice.',
      ],
    },
    {
      date: '2026-10-01',
      title: 'KEGG pathways removed',
      changes: [
        'Remove the KEGG pathway data from the site, because the KEGG license does not allow redistribution. The other enrichment kinds do not change.',
      ],
    },
    {
      date: '2026-09-11',
      title: 'Gene Ontology enrichment per aspect',
      changes: [
        'Test each GO term against the genes annotated in the same aspect (biological process, molecular function or cellular component), as clusterProfiler, topGO and GOstats do. Results are more sensitive: the daf-2 Class I list gives 230 terms at q <= 0.05 in place of 173, and the top terms stay the same.',
        'Add explanations to the statistical columns of the enrichment tables, and state the background of a custom gene set analysis in words.',
      ],
    },
    {
      date: '2026-09-09',
      title: 'Gene overlap, NOT annotations and alternative names',
      changes: [
        'Stop GO annotations with a NOT qualifier (the gene does not have that function) from counting toward parent terms and enrichment. The gene page still shows them. Enrichment results can change by 1 to 2%.',
        'Add alternative gene names from the Alliance of Genome Resources to the search, so nca-1 now finds unc-77.',
        'Add the Gene overlap page, which compares gene lists by gene and not by text. daf-2 in one list and WBGene00000898 in another count as the same gene.',
        'Correct three gene names in the neuronal genes that were misspelled in the source chapter (dpf-3, alh-7 and cft-1).',
      ],
    },
    {
      date: '2026-08-20',
      title: 'Fresh sources and more inputs',
      changes: [
        'Fix the weekly database build, which reused GO and BioGRID files that were months old. Each weekly build now downloads fresh sources.',
        'State the background (universe) of each over-representation result on its card.',
        'Accept edgeR and limma differential expression tables in over-representation. Single-cell marker tables are refused with an explanation, because their rows are already filtered and give a wrong background.',
        'Add the WormBase gene annotation to read counting, so you can load it with one click and not search for a file.',
        'Accept built-in GO, WormCat, phenotype and tissue gene sets in per-sample set scores.',
        'Add a Venn diagram to Contrast comparison.',
        'Mark dead and suppressed genes in the gene name resolver.',
      ],
    },
    {
      date: '2026-08-16',
      title: 'CeNGEN co-expression and analysis filters',
      changes: [
        'Add co-expression across CeNGEN neuron types to the gene page. A pair is kept when p < 0.001 and each gene is in the top 200 of the other.',
        'Use one significance setting in differential expression for both the independent filtering and the cutoff. Before, the filtering used 0.1 and the cutoff 0.05. Add a minimum baseMean filter and a protein-coding filter.',
        'Use the genes that a differential expression table tested as the background when you send its significant genes to over-representation.',
        'Fix the fold change filter for over-representation from a differential expression table, which mixed up- and down-regulated genes. Add a choice of all, up only or down only.',
        'Use a null model that keeps the number of partners of each gene in Network connectivity, and let you choose the BioGRID evidence types.',
        'Fix the database build, which sometimes used an older BioGRID release.',
      ],
    },
    {
      date: '2026-06-20',
      title: 'Gene-page references rework',
      changes: [
        'Gene references now show paper titles linked to their digital object identifier (DOI), instead of only WormBase paper (WBPaper) or PubMed (PMID) IDs. The titles come from the Alliance of Genome Resources bibliography.',
        'Added an "All literature" section that lists all publications linked to each gene by the National Center for Biotechnology Information (NCBI) gene2pubmed file (for example about 108 for hlh-30, up from a handful).',
        'Papers missing from the bulk bibliography (mostly recent ones) are looked up when the database is built, using the WormBase REST service and the NCBI esummary service, so titles and DOIs stay current.',
      ],
    },
  ];
</script>

<svelte:head>
  <title>Changelog · wormie.rs.ht</title>
</svelte:head>

<div class="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <Card>
    <CardHeader>
      <CardTitle class="text-xl">Changelog</CardTitle>
      <div class="text-sm text-muted-foreground">
        Notable changes to wormie.rs.ht, newest first.
      </div>
    </CardHeader>
  </Card>

  {#each ENTRIES as entry (entry.date + entry.title)}
    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="flex items-baseline justify-between gap-3 text-base">
          <span>{entry.title}</span>
          <span class="shrink-0 font-mono text-xs font-normal text-muted-foreground"
            >{entry.date}</span
          >
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul class="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          {#each entry.changes as change, i (i)}
            <li>{change}</li>
          {/each}
        </ul>
      </CardContent>
    </Card>
  {/each}
</div>
