// Guided tour controller. Steps reference optional DOM selectors (spotlight
// cutout) and optional `route` to navigate before activating. Completion
// persisted in localStorage to avoid re-triggering.

import { goto } from '$app/navigation';
import { resolve } from '$app/paths';

export type TourStep = {
  id: string;
  title: string;
  body: string;
  /** CSS selector to spotlight. If omitted, centered modal. */
  selector?: string;
  /** Route to navigate to before showing this step. */
  route?: string;
  /** Preferred placement of the tooltip relative to the target. */
  placement?: 'bottom' | 'top' | 'right' | 'left';
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to wormie.rs.ht',
    body: 'A C. elegans gene browser and analysis tool. The database downloads once into your browser, and after that everything runs on your computer, even offline. There are no accounts and no usage tracking. This tour takes about 60 seconds.',
  },
  {
    id: 'search',
    title: 'Search by gene, term, or field',
    body: 'Plain words search gene names, descriptions, and synonyms. To search one field, put a prefix before the word: pheno:daf-c (phenotype), tissue:motoneuron, ortho:HSF1 (ortholog, the matching gene in another species), name:daf-2, desc:kinase (description), expressed:AVA>10 (expression in the AVA neuron above 10, in the bulk RNA-seq values from CeNGEN, the C. elegans Neuronal Gene Expression Network). Use ~ for a wildcard: seq~Y110A7A.*',
    selector: '[placeholder^="Search by gene name"]',
    route: '/',
    placement: 'bottom',
  },
  {
    id: 'drag-drop',
    title: 'Drop files anywhere relevant',
    body: 'Drag a gene-list .txt file onto the search bar to show only those genes. Drag a DESeq2 (differential expression) .csv file onto /enrichment or /gsea to load it. Files are read in your browser and are not uploaded.',
    selector: '[placeholder^="Search by gene name"]',
    route: '/',
    placement: 'bottom',
  },
  {
    id: 'sidebar',
    title: 'Tools live in the sidebar',
    body: 'Over-representation tests whether a gene list has more genes of a term than expected by chance. Ranked-list enrichment (gene set enrichment analysis, GSEA) does the same for a list ranked by a score. Custom gene sets lets you upload your own sets. Gene overlap and Annotation overlap compare several lists (Venn diagram, or UpSet plot, a bar chart of which lists share which items). Ranked-list consensus lists the terms found in more than one comparison.',
    selector: 'aside, nav[aria-label="Sidebar"]',
    route: '/',
    placement: 'right',
  },
  {
    id: 'gsea-paste',
    title: 'Ranked-list enrichment from one paste',
    body: 'Paste a DESeq2 CSV (comma-separated values) table, or drop the file. The tool finds the stat column on its own. Click "Resolve & run" to match your gene names to WormBase gene IDs (WBGene IDs) and run the analysis.',
    selector: 'textarea',
    route: '/gsea',
    placement: 'top',
  },
  {
    id: 'gsea-defaults',
    title: 'Default settings match fgsea',
    body: 'The defaults follow fgsea, the R package for fast GSEA. Terms with fewer than 15 or more than 500 genes are skipped (minSize, maxSize). Multilevel is on: it gives more exact very small p-values than permutation alone (Korotkevich et al.). Collapse is off by default. Turn it on to merge terms whose leading-edge genes overlap strongly, measured by the Jaccard index (shared genes divided by all genes in either set).',
    route: '/gsea',
    placement: 'bottom',
  },
  {
    id: 'gsea-share',
    title: 'Share or save your analysis',
    body: 'Share link copies a web address that restores the ranked list when opened. The data sits after the # in the address, so it is never sent to a server. JSON saves the results as a file that /gsea/intersect can load to combine several comparisons.',
    route: '/gsea',
    placement: 'bottom',
  },
  {
    id: 'data-freshness',
    title: 'Know what version you are reading',
    body: 'The header shows the WormBase release and the date the database was built. Hover over it to see the version of each source: Gene Ontology (GO), the Biological General Repository for Interaction Datasets (BioGRID), phenotype annotations, and Alliance of Genome Resources expression data.',
    selector: 'header span[class*="cursor-help"]',
    route: '/',
    placement: 'bottom',
  },
  {
    id: 'shortcuts',
    title: 'Keyboard shortcuts',
    body: 'Press / to focus search, ? to see all shortcuts, and Cmd+K (Ctrl+K on Windows) to open the command palette, a box for jumping to any page. Press "g" then a letter to switch views (c=cards, t=table, o=Gene Ontology terms, w=WormCat, n=neuronal genes).',
  },
];

const STORAGE_KEY = 'wb.tour.complete';

class TourStore {
  active = $state<boolean>(false);
  stepIndex = $state<number>(0);
  step = $derived<TourStep | null>(this.active ? (TOUR_STEPS[this.stepIndex] ?? null) : null);
  hasCompleted = $state<boolean>(false);

  init() {
    try {
      this.hasCompleted = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      this.hasCompleted = false;
    }
  }

  async start(fromStep = 0) {
    this.stepIndex = fromStep;
    this.active = true;
    await this.maybeNavigate();
  }

  stop() {
    this.active = false;
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // ignore
    }
    this.hasCompleted = true;
  }

  async next() {
    if (this.stepIndex >= TOUR_STEPS.length - 1) {
      this.stop();
      return;
    }
    this.stepIndex++;
    await this.maybeNavigate();
  }

  async prev() {
    if (this.stepIndex === 0) return;
    this.stepIndex--;
    await this.maybeNavigate();
  }

  private async maybeNavigate() {
    const s = TOUR_STEPS[this.stepIndex];
    if (!s?.route) return;
    if (typeof window === 'undefined') return;
    if (window.location.pathname !== s.route) {
      await goto(resolve(s.route as '/'));
    }
  }
}

export const tour = new TourStore();
