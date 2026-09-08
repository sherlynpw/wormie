import { test, expect, type Page } from '@playwright/test';
import { resetClientStorage } from './helpers';

// One test per data-carrying edge between pages. Each asserts the payload
// actually appears at the destination, not merely that navigation happened;
// silent-drop bugs (a sender whose reader ignores the parameter) pass a
// URL-only assertion and fail these.
//
// Pipeline edges counts->de, de->gsea and de->de/diff live in handoff.spec.ts;
// this spec covers the remaining arrows: selection-bar and home-page sends,
// de->enrichment, de->ssgsea, enrichment->overlap, de/diff->enrichment,
// gene-overlap segments, cell-type->enrichment, the "From selection" fills,
// and the /datasets "Open in" dispatcher.

// Verified against the shipped build: daf-2, daf-16, age-1.
const GENES = ['WBGene00000898', 'WBGene00000912', 'WBGene00000090'];

test.beforeEach(async ({ page }) => {
  // DB-dependent destinations can take over a minute on a cold OPFS; the
  // default 30s per-test budget is tighter than the expect timeouts below.
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('wb.tour.complete', '1');
    localStorage.setItem('wb.hints.v2', JSON.stringify({ dismissed: [], allOff: true }));
  });
  await page.goto('/');
  await resetClientStorage(page);
  await page.evaluate(() => {
    localStorage.setItem('wb.tour.complete', '1');
    localStorage.setItem('wb.hints.v2', JSON.stringify({ dismissed: [], allOff: true }));
  });
});

// Seed the selection store's backing key, then reload so selection.init()
// picks it up and the bar renders.
async function seedSelection(page: Page, ids: string[]) {
  await page.evaluate((v) => localStorage.setItem('wb_selection', JSON.stringify(v)), ids);
  await page.goto('/');
  await expect(page.getByText(`${ids.length} selected`)).toBeVisible({ timeout: 15_000 });
}

// Insert a dataset row directly into the wb-rs-ht IndexedDB (same schema as
// src/lib/idb.ts) so /datasets "Open in" targets can be exercised without
// driving the producing tool first.
async function seedDataset(
  page: Page,
  ds: { id: string; name: string; type: string; createdAt: number; body: string },
) {
  await page.evaluate(async (row) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('wb-rs-ht', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('datasets')) {
          const s = db.createObjectStore('datasets', { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('datasets', 'readwrite');
        tx.objectStore('datasets').put(row);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, ds);
}

async function seedPipelineHandoff(page: Page, expr: string) {
  await page.waitForFunction(
    () => !!(window as unknown as { __pipelineHandoff?: object }).__pipelineHandoff,
  );
  await page.evaluate(expr);
}

async function spaGoto(page: Page, url: string) {
  await page.evaluate((u) => {
    return (window as unknown as { __goto: (u: string) => Promise<void> }).__goto(u);
  }, url);
}

// ---------- Selection bar sends ----------

test('selection bar -> Over-representation carries the selection', async ({ page }) => {
  await seedSelection(page, GENES);
  await page.getByRole('button', { name: 'Over-representation' }).click();
  await expect(page).toHaveURL(/\/enrichment\?(ids|gz)=/);
  await expect(page.getByText(/of 3 resolved/)).toBeVisible({ timeout: 60_000 });
});

test('selection bar -> Annotation overlap loads the genes', async ({ page }) => {
  await seedSelection(page, GENES);
  await page.getByRole('button', { name: 'Annotation overlap' }).click();
  await expect(page).toHaveURL(/\/compare\?(ids|gz)=/);
  await expect(page.getByText('daf-16').first()).toBeVisible({ timeout: 60_000 });
});

test('selection bar -> Network connectivity pre-fills the paste box', async ({ page }) => {
  await seedSelection(page, GENES);
  await page.getByRole('button', { name: 'Network connectivity' }).click();
  await expect(page).toHaveURL(/\/nta\?(ids|gz)=/);
  await expect(page.locator('textarea').first()).toHaveValue(/WBGene00000898/, {
    timeout: 15_000,
  });
});

test('selection bar -> Gene name resolver pre-fills and resolves', async ({ page }) => {
  await seedSelection(page, GENES);
  await page.getByRole('button', { name: 'Gene name resolver' }).click();
  await expect(page).toHaveURL(/\/lookup\?(ids|gz)=/);
  await expect(page.locator('textarea').first()).toHaveValue(/WBGene00000898/, {
    timeout: 15_000,
  });
  // Auto-resolution against the DB: hits table names the genes.
  await expect(page.getByText('daf-2').first()).toBeVisible({ timeout: 60_000 });
});

// ---------- Home page "Send all matches" ----------

test('home matched results -> Over-representation', async ({ page }) => {
  await page.goto('/?view=table');
  const input = page.getByPlaceholder(/Search by gene name/i);
  await input.fill('daf-16, daf-2, age-1');
  await expect(page.getByText(/of\s+[1-9]/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Over-representation' }).click();
  await expect(page).toHaveURL(/\/enrichment\?(ids|gz)=/, { timeout: 15_000 });
  await expect(page.getByText(/of [\d,]+ resolved/)).toBeVisible({ timeout: 60_000 });
});

// ---------- Pipeline handoffs not covered by handoff.spec.ts ----------

test('de -> enrichment handoff imports the DE table', async ({ page }) => {
  await page.goto('/de');
  await page.locator('input[type="file"]').first().waitFor({ state: 'attached', timeout: 30_000 });
  await seedPipelineHandoff(
    page,
    `(() => {
      const lines = ['gene\\tbaseMean\\tlog2FoldChange\\tlfcSE\\tstat\\tpvalue\\tpadj'];
      for (let i = 0; i < 30; i++) {
        const lfc = (i % 5) - 2;
        lines.push(['WBGene' + String(i).padStart(8, '0'), 100, lfc, 0.4, lfc * 4, 0.01, 0.02].join('\\t'));
      }
      window.__pipelineHandoff.deseq2.set({ tsv: lines.join('\\n') });
    })()`,
  );
  await spaGoto(page, '/enrichment?from=de');
  await expect(page.getByText(/Loaded DESeq2 results from \/de/i)).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.locator('textarea').first()).toHaveValue(/log2FoldChange/);
});

test('de -> ssgsea handoff loads the expression matrix', async ({ page }) => {
  await page.goto('/de');
  await page.locator('input[type="file"]').first().waitFor({ state: 'attached', timeout: 30_000 });
  await seedPipelineHandoff(
    page,
    `(() => {
      const rows = ['gene\\ts1\\ts2\\ts3'];
      for (let i = 0; i < 20; i++) rows.push(['g' + i, i, i + 1, i + 2].join('\\t'));
      window.__pipelineHandoff.ssgsea.set({ tsv: rows.join('\\n'), label: 'VST from test' });
    })()`,
  );
  await spaGoto(page, '/ssgsea?from=de');
  await expect(page.getByText(/Loaded expression matrix from \/de/i)).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.locator('textarea').first()).toHaveValue(/s1\ts2\ts3/);
});

// ---------- Enrichment results -> Enrichment overlap ----------

const CP_HEADER = 'ID,Description,GeneRatio,BgRatio,pvalue,p.adjust,Count,ontology';
const CP_TABLE = [
  CP_HEADER,
  'GO:0001,term one,10/100,200/9826,1e-5,0.001,10,BP',
  'GO:0002,term two,8/100,150/9826,1e-4,0.01,8,BP',
].join('\n');

test('enrichment imported results -> Send results to overlap fills a slot', async ({ page }) => {
  await page.goto('/enrichment');
  await page.getByRole('button', { name: 'Imported results' }).click();
  await page.locator('textarea').first().fill(CP_TABLE);
  await page.getByRole('button', { name: 'Render' }).click();
  const send = page.getByRole('button', { name: /Send results to overlap/i });
  await expect(send).toBeVisible({ timeout: 10_000 });
  await send.click();
  await expect(page).toHaveURL(/\/enrichment\/overlap/);
  await expect(page.getByText(/Results loaded from Over-representation/i)).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.locator('textarea').first()).toHaveValue(/GO:0001/);
});

// ---------- Contrast comparison -> enrichment (flipped genes) ----------

test('contrast comparison sends flipped genes to enrichment', async ({ page }) => {
  const header = 'gene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj';
  const mk = (flip: boolean) =>
    [
      header,
      `WBGene00000898\t100\t${flip ? -3 : 3}\t0.4\t12\t1e-8\t1e-6`,
      `WBGene00000912\t100\t${flip ? -2 : 2}\t0.4\t8\t1e-6\t1e-4`,
      'WBGene00000090\t100\t1.5\t0.4\t6\t1e-4\t0.01',
    ].join('\n');
  await page.goto('/de/diff');
  const areas = page.locator('textarea');
  await areas.nth(0).fill(mk(false));
  await areas.nth(1).fill(mk(true));
  await page.getByRole('button', { name: 'Parse', exact: true }).click();
  await page.getByRole('button', { name: /Test for enrichment/i }).click();
  await expect(page).toHaveURL(/\/enrichment\?(ids|gz)=/, { timeout: 15_000 });
  await expect(page.getByText(/of 2 resolved/)).toBeVisible({ timeout: 60_000 });
});

// ---------- Gene overlap segment -> enrichment ----------

test('gene overlap segment -> Over-representation', async ({ page }) => {
  await page.goto('/compare/lists');
  const areas = page.locator('textarea');
  await areas.nth(0).fill('daf-2\ndaf-16\nage-1');
  await areas.nth(1).fill('daf-2\ndaf-16\nhsf-1');
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.getByText('Intersections')).toBeVisible({ timeout: 60_000 });
  await page.getByTitle('Run over-representation on these genes').first().click();
  await expect(page).toHaveURL(/\/enrichment\?(ids|gz)=/, { timeout: 15_000 });
  await expect(page.getByText(/of [\d,]+ resolved/)).toBeVisible({ timeout: 60_000 });
});

// ---------- "From selection" fills ----------

test('gene overlap slot fills from the selection', async ({ page }) => {
  await seedSelection(page, GENES);
  await page.goto('/compare/lists');
  await page
    .getByRole('button', { name: `From selection (${GENES.length})` })
    .first()
    .click();
  await expect(page.locator('textarea').first()).toHaveValue(/WBGene00000898/);
});

test('custom gene sets list fills from the selection', async ({ page }) => {
  await seedSelection(page, GENES);
  await page.goto('/gmt');
  // The run card (and its gene-list input) only renders once a GMT parses.
  await page.locator('textarea').first().fill('SET_A\tdemo set\tdaf-2\tdaf-16\tage-1');
  await page.getByRole('button', { name: `From selection (${GENES.length})` }).click();
  // The gene-list textarea is the second one (the GMT body is first).
  await expect(page.locator('textarea').nth(1)).toHaveValue(/WBGene00000898/);
});

// ---------- Neuron type page -> enrichment ----------

test('neuron type page sends expressed genes to enrichment', async ({ page }) => {
  await page.goto('/cell-type/AVA');
  const btn = page.getByRole('link', { name: /Run enrichment on these genes/ });
  await expect(btn).toBeVisible({ timeout: 120_000 });
  // Regression: the href once lacked the '?' and produced /enrichmentids=...
  await expect(btn).toHaveAttribute('href', /\/enrichment\?/);
  await btn.click();
  await expect(page.getByText(/of [\d,]+ resolved/)).toBeVisible({ timeout: 60_000 });
});

// ---------- Datasets "Open in" dispatcher ----------

test('datasets Open in -> ssGSEA loads a counts matrix', async ({ page }) => {
  const body = ['gene\tsampleA\tsampleB', 'daf-2\t10\t20', 'daf-16\t5\t2'].join('\n');
  await seedDataset(page, {
    id: 'conn-counts',
    name: 'conn counts',
    type: 'counts',
    createdAt: Date.now(),
    body,
  });
  await page.goto('/datasets');
  await expect(page.getByText('conn counts')).toBeVisible({ timeout: 15_000 });
  // Single-target rows label their button "Open"; the target is in the tooltip.
  await page.getByTitle('Open in ssGSEA').click();
  await expect(page).toHaveURL(/\/ssgsea\?load=counts/, { timeout: 15_000 });
  await expect(page.locator('textarea').first()).toHaveValue(/sampleA\tsampleB/, {
    timeout: 15_000,
  });
});

test('datasets Open in -> GSEA intersect loads a bundle', async ({ page }) => {
  const bundle = {
    format: 'wb.gsea.bundle.v1',
    kind: 'go',
    params: {},
    n_genes: 3,
    terms: [
      {
        term_id: 'GO:0001',
        name: 'term one',
        namespace: 'BP',
        size: 10,
        nes: 2.1,
        q: 0.01,
        leading_edge: ['WBGene00000898'],
      },
    ],
  };
  await seedDataset(page, {
    id: 'conn-bundle',
    name: 'conn bundle',
    type: 'gsea-bundle',
    createdAt: Date.now(),
    body: JSON.stringify(bundle),
  });
  await page.goto('/datasets');
  await expect(page.getByText('conn bundle')).toBeVisible({ timeout: 15_000 });
  await page.getByTitle('Open in GSEA intersect').click();
  await expect(page).toHaveURL(/\/gsea\/intersect\?load=bundle/, { timeout: 15_000 });
  // The loaded-toast names the bundle and its term count; exact-match the row label.
  await expect(page.getByText('conn bundle', { exact: true })).toBeVisible({ timeout: 15_000 });
});
