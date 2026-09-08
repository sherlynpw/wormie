import { test, expect } from './fixtures';
import { resetClientStorage } from './helpers';

// Two-input UpSet smoke test: paste the same clusterProfiler-style table into
// two slots, vary one term, and check the intersection counts match the
// known overlap.

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

const TABLE_A = [
  HEADER,
  row('GO:0001', 'shared sig term 1', '0.001'),
  row('GO:0002', 'shared sig term 2', '0.01'),
  row('GO:0003', 'A only sig', '0.001'),
  row('GO:0004', 'shared non-sig', '0.5'),
].join('\n');

const TABLE_B = [
  HEADER,
  row('GO:0001', 'shared sig term 1', '0.001'),
  row('GO:0002', 'shared sig term 2', '0.001'),
  row('GO:0005', 'B only sig', '0.001'),
  row('GO:0004', 'shared non-sig', '0.5'),
].join('\n');

test('overlap page computes intersections', async ({ page }) => {
  await page.goto('/enrichment/overlap');

  const slotA = page.locator('textarea').nth(0);
  const slotB = page.locator('textarea').nth(1);
  await slotA.fill(TABLE_A);
  await slotB.fill(TABLE_B);

  // q ≤ 0.05 makes GO:0001/0002/0003 sig in A (3) and 0001/0002/0005 sig in B (3),
  // shared: 0001 + 0002 = 2. A-only: 0003. B-only: 0005.
  await expect(page.getByText(/Contrast A:\s*3\/4/)).toBeVisible();
  await expect(page.getByText(/Contrast B:\s*3\/4/)).toBeVisible();

  // The intersections table should list a "Contrast A + Contrast B" combo of size 2,
  // and "Contrast A" alone of size 1, "Contrast B" alone of size 1.
  const intersectionsTable = page.locator('table').last();
  await expect(intersectionsTable).toContainText('2');
  await expect(intersectionsTable).toContainText('shared sig term 1');

  // Click the size-2 row to expand its term list.
  await intersectionsTable.locator('tr', { hasText: 'shared sig term 1' }).first().click();
  await expect(intersectionsTable).toContainText('GO:0001');
  await expect(intersectionsTable).toContainText('GO:0002');
});

test('overlap page renders co-occurrence heatmap', async ({ page }) => {
  // Same input as the intersection test; switch view + assert SVG renders.
  await page.goto('/enrichment/overlap');
  await expect(page.getByRole('heading', { name: 'Inputs' })).toBeVisible({ timeout: 30_000 });

  // Use a small synthetic table with geneID columns so overlap arrays populate.
  const HEADER = 'ID,Description,GeneRatio,BgRatio,pvalue,p.adjust,Count,ontology,geneID';
  function row(id: string, desc: string, q: string, genes: string[]) {
    return `${id},${desc},5/100,200/9826,1e-5,${q},5,BP,${genes.join('/')}`;
  }
  const tableA = [
    HEADER,
    row('GO:0001', 'term 1', '0.001', ['daf-16', 'daf-2', 'age-1']),
    row('GO:0002', 'term 2', '0.001', ['daf-16', 'sgk-1']),
  ].join('\n');
  const tableB = [HEADER, row('GO:0010', 'term 10', '0.001', ['daf-16', 'lin-4', 'sgk-1'])].join(
    '\n',
  );

  await page.locator('textarea').nth(0).fill(tableA);
  await page.locator('textarea').nth(1).fill(tableB);

  await page.getByRole('button', { name: /genes × terms heatmap/i }).click();
  // SVG element with the heatmap aria-label should mount.
  await expect(page.locator('svg[aria-label*="co-occurrence"]')).toBeVisible();
});

test('overlap page supports adding and removing slots', async ({ page }) => {
  await page.goto('/enrichment/overlap');
  // Wait for hydration before counting textareas, since on a warm dev server
  // the page navigation can resolve before Svelte mounts the slot list.
  await expect(page.getByRole('heading', { name: 'Inputs' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('textarea')).toHaveCount(2);

  await page.getByRole('button', { name: /add input/i }).click();
  await expect(page.locator('textarea')).toHaveCount(3);

  // Remove the third slot.
  const removeBtns = page.locator('button[title="Remove slot"]');
  await removeBtns.nth(2).click();
  await expect(page.locator('textarea')).toHaveCount(2);
});
