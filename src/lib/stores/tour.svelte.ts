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
    body: 'A local-first C. elegans gene explorer. The database (~28 MB) loads once into your browser and runs offline. No accounts, no telemetry. This tour takes ~60 seconds.',
  },
  {
    id: 'search',
    title: 'Search by gene, term, or field',
    body: 'Free text searches gene names, descriptions, and synonyms. For scoped search use prefixes: pheno:daf-c, tissue:motoneuron, ortho:HSF1, name:daf-2, desc:kinase, expressed:AVA>10 (CeNGEN neuron expression). Use ~ for glob: seq~Y110A7A.*',
    selector: '[placeholder^="Search by gene name"]',
    route: '/',
    placement: 'bottom',
  },
  {
    id: 'drag-drop',
    title: 'Drop files anywhere relevant',
    body: 'Drag a gene-list .txt onto the search bar to filter to those genes. Drag a DESeq2 .csv onto /enrichment or /gsea to load it instantly. Nothing is uploaded; parsing happens in-browser.',
    selector: '[placeholder^="Search by gene name"]',
    route: '/',
    placement: 'bottom',
  },
  {
    id: 'sidebar',
    title: 'Tools live in the sidebar',
    body: 'Enrichment (ORA), GSEA (preranked), GMT (custom sets), Compare (Venn / UpSet of multiple lists), and the GSEA Intersect for cross-comparison consensus.',
    selector: 'aside, nav[aria-label="Sidebar"]',
    route: '/',
    placement: 'right',
  },
  {
    id: 'gsea-paste',
    title: 'GSEA in one paste',
    body: 'Paste a DESeq2 CSV (or drop the file). Auto-detects the stat column. Click "Resolve & run" — your ranked list maps gene names to WBGene IDs.',
    selector: 'textarea',
    route: '/gsea',
    placement: 'top',
  },
  {
    id: 'gsea-defaults',
    title: 'Sensible defaults, matching fgsea',
    body: 'minSize=15, maxSize=500, multilevel ON, collapse ON. Multilevel refines tail p-values past the permutation floor (Korotkevich et al.). Collapse groups redundant terms by leading-edge Jaccard.',
    route: '/gsea',
    placement: 'bottom',
  },
  {
    id: 'gsea-share',
    title: 'Share or save your analysis',
    body: 'Share link copies a self-contained URL that restores the ranked list when opened (data lives in the URL fragment, never sent to a server). JSON exports a bundle for /gsea/intersect to combine multiple comparisons.',
    route: '/gsea',
    placement: 'bottom',
  },
  {
    id: 'data-freshness',
    title: 'Know what version you are reading',
    body: 'Header shows the WormBase release and build date. Hover for full source breakdown (GO date, BioGRID, Phenotype, Alliance expression).',
    selector: 'header span[class*="cursor-help"]',
    route: '/',
    placement: 'bottom',
  },
  {
    id: 'shortcuts',
    title: 'Keyboard shortcuts',
    body: 'Press / to focus search, ? to see all shortcuts, ⌘K for the command palette. Press "g" then a letter to switch views (c=cards, t=table, o=GO, w=WormCat, n=neuronal).',
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
