import { test, expect } from '@playwright/test';
import { resetClientStorage } from './helpers';

// Two-input UpSet smoke test for /gsea/overlap. We paste two synthetic GSEA
// result TSVs (the wormie.rs.ht export format) and verify the leading-edge gene
// intersections.

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

const HEADER = ['term_id', 'name', 'namespace', 'size', 'es', 'nes', 'p', 'q', 'leading_edge'].join(
  '\t',
);
function row(id: string, name: string, nes: string, q: string, leading: string[]) {
  return [id, name, 'BP', '20', '0.5', nes, '0.001', q, leading.join('|')].join('\t');
}

// Slot A passing terms drive {a, b, c}. Slot B drives {b, c, d}. Overlap = {b, c}.
const TSV_A = [
  HEADER,
  row('GO:0001', 'term 1', '2.1', '0.001', ['a', 'b']),
  row('GO:0002', 'term 2', '1.8', '0.01', ['b', 'c']),
  row('GO:0003', 'noisy', '0.5', '0.4', ['x', 'y']), // dropped (q > cutoff)
].join('\n');

const TSV_B = [
  HEADER,
  row('GO:0010', 'term 10', '2.3', '0.001', ['b', 'd']),
  row('GO:0011', 'term 11', '1.7', '0.02', ['c', 'd']),
].join('\n');

test('gsea overlap computes leading-edge intersections', async ({ page }) => {
  await page.goto('/gsea/overlap');
  await expect(page.getByRole('heading', { name: 'Inputs' })).toBeVisible({ timeout: 30_000 });

  await page.locator('textarea').nth(0).fill(TSV_A);
  await page.locator('textarea').nth(1).fill(TSV_B);

  // A union {a,b,c} = 3 genes from 2 passing terms. B union {b,c,d} = 3 from 2.
  await expect(page.getByText(/Contrast A:\s*3\s*genes\s*\/\s*2\s*terms/)).toBeVisible();
  await expect(page.getByText(/Contrast B:\s*3\s*genes\s*\/\s*2\s*terms/)).toBeVisible();

  // Intersection table: A∩B has 2 genes (b, c); A-only has 1 (a); B-only has 1 (d).
  const table = page.locator('table').last();
  await expect(table).toContainText('a');
  await expect(table).toContainText('b');
  await expect(table).toContainText('c');
  await expect(table).toContainText('d');
});

test('gsea overlap renders leading-edge co-occurrence heatmap', async ({ page }) => {
  await page.goto('/gsea/overlap');
  await expect(page.getByRole('heading', { name: 'Inputs' })).toBeVisible({ timeout: 30_000 });

  await page.locator('textarea').nth(0).fill(TSV_A);
  await page.locator('textarea').nth(1).fill(TSV_B);

  await page.getByRole('button', { name: /genes × terms heatmap/i }).click();
  await expect(page.locator('svg[aria-label*="co-occurrence"]')).toBeVisible();
});

test('gsea overlap direction filter excludes negative NES', async ({ page }) => {
  const tsvMixed = [
    HEADER,
    row('GO:0001', 'pos term', '2.0', '0.001', ['a', 'b']),
    row('GO:0002', 'neg term', '-2.0', '0.001', ['c', 'd']),
  ].join('\n');

  await page.goto('/gsea/overlap');
  await expect(page.getByRole('heading', { name: 'Inputs' })).toBeVisible({ timeout: 30_000 });
  await page.locator('textarea').nth(0).fill(tsvMixed);
  await page.locator('textarea').nth(1).fill(tsvMixed);

  // Both direction: 4 genes / 2 terms per slot.
  await expect(page.getByText(/Contrast A:\s*4\s*genes\s*\/\s*2\s*terms/)).toBeVisible();
  // Switch to positive NES only: 2 genes / 1 term.
  await page.getByRole('button', { name: 'NES > 0' }).click();
  await expect(page.getByText(/Contrast A:\s*2\s*genes\s*\/\s*1\s*terms?/)).toBeVisible();
});
