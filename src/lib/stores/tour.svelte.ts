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
    body: 'Plain words search gene names and IDs. Open "Search in" to also search descriptions and annotations. To search one field, put a filter name and a colon before the word: pheno:dauer (phenotype), tissue:motoneuron, ortho:HSF1 (ortholog, the matching gene in another species), go:apoptosis (Gene Ontology), expressed:AVA (expressed in the AVA neuron, from CeNGEN, the C. elegans Neuronal Gene Expression Network). A * stands for any ending, so name:daf* finds every daf gene. If no gene name matches, the page shows where the word does match.',
    selector: '[placeholder^="Search by gene name"]',
    route: '/',
    placement: 'bottom',
  },
  {
    id: 'drag-drop',
    title: 'Drop a gene list on the search bar',
    body: 'Drag a .txt file with one gene per line onto the search bar to show only those genes. The tool pages take files the same way. Files are read in your browser and are not uploaded.',
    selector: '[placeholder^="Search by gene name"]',
    route: '/',
    placement: 'bottom',
  },
  {
    id: 'explore',
    title: 'Explore genes by annotation or by list',
    body: 'Explore by annotation groups genes by Gene Ontology, WormCat, phenotype, tissue, human disease and neuron type, and by the two curated gene sets, Neuronal genes and Synaptic genes. Explore a gene list fixes the names in a list (Gene name resolver), finds the recorded interactions among its genes (Network connectivity) and shows what the genes share (Annotation overlap).',
    selector: '[data-tour="explore"]',
    route: '/',
    placement: 'right',
  },
  {
    id: 'analyses',
    title: 'Run an analysis',
    body: 'Turn reads into contrasts counts RNA-seq reads and runs DESeq2 differential expression in your browser. Test for enrichment checks a gene list (Over-representation), a ranked list (Ranked-list enrichment, also called gene set enrichment analysis or GSEA), each sample (Per-sample gene set scoring) or gene sets you upload (Custom gene set testing). Compare lists and results puts lists or enrichment results side by side.',
    selector: '[data-tour="analyses"]',
    route: '/',
    placement: 'right',
  },
  {
    id: 'saved',
    title: 'Your work stays on this computer',
    body: 'Saved locally keeps the datasets you save, the genes you mark with the star and the genes you viewed last. They are stored in this browser only and are not sent to a server.',
    selector: '[data-tour="saved"]',
    route: '/',
    placement: 'right',
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
    body: 'Press / to focus search, ? to see all shortcuts, and Cmd+K (Ctrl+K on Windows) to open the command palette, a box for jumping to any page. Press "g" then a letter to switch views (c=cards, t=table, o=Gene Ontology, w=WormCat, n=Neuronal genes, s=Synaptic genes).',
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
