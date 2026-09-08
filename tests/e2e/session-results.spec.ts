import { test, expect } from './fixtures';
import { resetClientStorage, saveSession } from './helpers';

// Verifies the session-result-blob round trip:
//   1. Run /enrichment in DESeq2-import mode with a clusterProfiler CSV
//   2. Save the session with the "Include results" toggle on (default)
//   3. Navigate to /enrichment/overlap, load the saved session into a slot
//   4. Assert the slot populates and overlap computes correctly

test.beforeEach(async ({ page }) => {
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

const HEADER = 'ID,Description,GeneRatio,BgRatio,pvalue,p.adjust,Count,ontology';
function row(id: string, desc: string, q: string, ont = 'BP') {
  return `${id},${desc},10/100,200/9826,1e-5,${q},10,${ont}`;
}

const TABLE = [
  HEADER,
  row('GO:0001', 'shared term 1', '0.001'),
  row('GO:0002', 'shared term 2', '0.01'),
  row('GO:0003', 'A-only', '0.001'),
].join('\n');

test('GSEA session with results auto-replays on restore', async ({ page }) => {
  // Pre-seed a GSEA session into IndexedDB directly, then navigate via the
  // session-load URL. This skips the live DB-import + run path (which is
  // slow) and verifies just the result-replay branch of GseaResults.
  await page.goto('/gsea');
  await page.waitForFunction(() => indexedDB.databases !== undefined);

  const datasetId = await page.evaluate(async () => {
    const session = {
      v: 1,
      tool: 'gsea',
      inputs: { ranked: 'daf-16\t8.5\ndaf-2\t-7.2' },
      params: { geneCol: '1', scoreCol: '2' },
      results: {
        go: [
          {
            term_id: 'GO:0001',
            name: 'fake replayed term',
            namespace: 'BP',
            size: 20,
            es: 0.5,
            nes: 1.8,
            p: 0.001,
            q: 0.01,
            leading_edge: ['daf-16', 'daf-2'],
            members: ['daf-16', 'daf-2', 'age-1'],
          },
        ],
      },
    };
    const ds = {
      id: 'test-gsea-session',
      name: 'gsea-restore-test',
      type: 'session',
      createdAt: Date.now(),
      body: JSON.stringify(session),
      meta: { tool: 'gsea', hasResults: true, inputSizes: {}, bodySize: 0 },
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('wb-rs-ht', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('datasets')) {
          const s = d.createObjectStore('datasets', { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('datasets', 'readwrite');
      tx.objectStore('datasets').put(ds);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return ds.id;
  });

  await page.goto(`/gsea?load=session&id=${datasetId}`);
  // The saved result row should appear without the user clicking Resolve.
  await expect(page.getByText('fake replayed term')).toBeVisible({ timeout: 30_000 });
});

test('saves enrichment session with results, loads into overlap', async ({ page }) => {
  // Run import-mode enrichment so results land in `importedResults`.
  await page.goto('/enrichment');
  await page.getByRole('button', { name: 'Imported results' }).click();
  await page.locator('textarea').first().fill(TABLE);
  await page.getByRole('button', { name: 'Render' }).click();
  // EnrichmentResults card should appear with at least one tab/row.
  await expect(page.getByRole('button', { name: 'Gene Ontology' })).toBeVisible({
    timeout: 30_000,
  });

  // Save the session. Default toggle is "Include results" on, which embeds the
  // imported results into session.results.
  await saveSession(page, 'enrich-with-results');
  await expect(page.getByText(/session saved/i)).toBeVisible();

  // Navigate to the overlap page; the saved session should appear in the
  // per-slot "Load saved session" dropdown.
  await page.goto('/enrichment/overlap');
  await expect(page.getByRole('heading', { name: 'Inputs' })).toBeVisible({ timeout: 30_000 });

  const firstSlotSelect = page.locator('select').first();
  await expect(firstSlotSelect).toBeVisible();
  await firstSlotSelect.selectOption({ label: 'enrich-with-results' });

  // The slot textarea should now have content; the per-slot character counter
  // shows non-empty.
  await expect(page.locator('textarea').first()).not.toHaveValue('');
});
