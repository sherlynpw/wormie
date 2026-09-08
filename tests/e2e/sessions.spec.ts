import { test, expect } from '@playwright/test';
import { resetClientStorage, saveSession } from './helpers';

// These tests exercise the session save/restore round-trip without depending
// on the SQLite DB being downloaded/imported. They write into the textarea,
// save, navigate to /datasets, click Open, and assert state is restored.

test.beforeEach(async ({ page }) => {
  // Dismiss the first-load tour and any control hints before any page JS
  // runs, otherwise their overlays intercept clicks during the test.
  await page.addInitScript(() => {
    localStorage.setItem('wb.tour.complete', '1');
    localStorage.setItem('wb.hints.v2', JSON.stringify({ dismissed: [], allOff: true }));
  });
  // Land on the homepage first so resetClientStorage has a same-origin
  // execution context.
  await page.goto('/');
  await resetClientStorage(page);
  // resetClientStorage clears localStorage; re-seed the dismissals.
  await page.evaluate(() => {
    localStorage.setItem('wb.tour.complete', '1');
    localStorage.setItem('wb.hints.v2', JSON.stringify({ dismissed: [], allOff: true }));
  });
});

test('enrichment paste-mode session round-trip', async ({ page }) => {
  await page.goto('/enrichment');
  await page.getByRole('button', { name: 'Paste gene list' }).click();
  const paste = page.locator('textarea').first();
  await paste.fill('daf-16\ndaf-2\nage-1');

  await saveSession(page, 'enrich-test');
  await expect(page.getByText(/session saved/i)).toBeVisible();

  await page.goto('/datasets');
  await expect(page.getByText('enrich-test')).toBeVisible();
  await page.getByRole('button', { name: 'Over-representation' }).first().click();

  await expect(page).toHaveURL(/\/enrichment\?load=session/);
  await expect(page.locator('textarea').first()).toHaveValue('daf-16\ndaf-2\nage-1');
});

test('gsea session round-trip', async ({ page }) => {
  await page.goto('/gsea');
  const paste = page.locator('textarea').first();
  await paste.fill('daf-16\t8.5\ndaf-2\t-7.2\nage-1\t-5.6');

  await saveSession(page, 'gsea-test');
  await expect(page.getByText(/session saved/i)).toBeVisible();

  await page.goto('/datasets');
  await expect(page.getByText('gsea-test')).toBeVisible();
  await page.getByRole('button', { name: 'Ranked-list enrichment' }).first().click();

  await expect(page).toHaveURL(/\/gsea\?load=session/);
  await expect(page.locator('textarea').first()).toHaveValue(
    'daf-16\t8.5\ndaf-2\t-7.2\nage-1\t-5.6',
  );
});

test('gmt session round-trip', async ({ page }) => {
  await page.goto('/gmt');
  const paste = page.locator('textarea').first();
  await paste.fill('SET_A\tdesc\tdaf-16\tdaf-2\nSET_B\tdesc\tage-1\tlin-4');

  await saveSession(page, 'gmt-test');
  await expect(page.getByText(/session saved/i)).toBeVisible();

  await page.goto('/datasets');
  await expect(page.getByText('gmt-test')).toBeVisible();
  await page.getByRole('button', { name: 'Custom gene sets' }).first().click();

  await expect(page).toHaveURL(/\/gmt\?load=session/);
  await expect(page.locator('textarea').first()).toHaveValue(
    'SET_A\tdesc\tdaf-16\tdaf-2\nSET_B\tdesc\tage-1\tlin-4',
  );
});

test('gsea session restores geneCol and scoreCol', async ({ page }) => {
  await page.goto('/gsea');
  await page.locator('textarea').first().fill('daf-16\t8.5\ndaf-2\t-7.2');
  // Override defaults so we can prove restoration changes the inputs.
  const geneCol = page.locator('input[type="number"]').nth(0);
  const scoreCol = page.locator('input[type="number"]').nth(1);
  await geneCol.fill('3');
  await scoreCol.fill('7');

  await saveSession(page, 'gsea-cols');
  await expect(page.getByText(/session saved/i)).toBeVisible();

  await page.goto('/datasets');
  await page.getByRole('button', { name: 'Ranked-list enrichment' }).first().click();
  await expect(page).toHaveURL(/\/gsea\?load=session/);

  await expect(page.locator('input[type="number"]').nth(0)).toHaveValue('3');
  await expect(page.locator('input[type="number"]').nth(1)).toHaveValue('7');
});

test('gmt session restores mode and nperm', async ({ page }) => {
  await page.goto('/gmt');
  await page
    .locator('textarea')
    .first()
    .fill('SET_A\tdesc\tdaf-16\tdaf-2\tage-1\nSET_B\tdesc\tlin-4\thsf-1');
  // Wait for parse to complete and the mode tabs to render.
  await expect(page.getByRole('button', { name: 'GSEA (preranked)' })).toBeVisible();
  await page.getByRole('button', { name: 'GSEA (preranked)' }).click();
  // Change permutations away from the 1000 default.
  await page.locator('select').selectOption('2500');

  await saveSession(page, 'gmt-params');
  await expect(page.getByText(/session saved/i)).toBeVisible();

  await page.goto('/datasets');
  await page.getByRole('button', { name: 'Custom gene sets' }).first().click();
  await expect(page).toHaveURL(/\/gmt\?load=session/);

  // The GSEA tab should be active again, and nperm should be 2500.
  await expect(page.getByRole('button', { name: 'GSEA (preranked)' })).toHaveClass(/font-medium/);
  await expect(page.locator('select')).toHaveValue('2500');
});

test('enrichment deseq2 mode restores padj and lfc filters', async ({ page }) => {
  const csv = [
    'gene_id,baseMean,log2FoldChange,lfcSE,stat,pvalue,padj',
    'daf-16,1000,2.5,0.3,8.5,1e-10,1e-8',
    'daf-2,800,-3.1,0.4,-7.2,1e-12,1e-10',
    'age-1,600,1.8,0.5,3.6,3e-4,4e-3',
    'lin-4,200,0.2,0.6,0.3,0.7,0.8',
  ].join('\n');

  await page.goto('/enrichment');
  await page.getByRole('button', { name: 'DE table / volcano' }).click();
  await page.locator('textarea').first().fill(csv);
  await page.getByRole('button', { name: 'Render' }).click();

  // DE filter inputs become visible after Render parses the table.
  const padjInput = page.locator('input[type="number"]').first();
  await expect(padjInput).toBeVisible();
  await padjInput.fill('0.42');
  const lfcInput = page.locator('input[type="number"]').nth(1);
  await lfcInput.fill('1.5');

  await saveSession(page, 'enrich-deseq2');
  await expect(page.getByText(/session saved/i)).toBeVisible();

  await page.goto('/datasets');
  await page.getByRole('button', { name: 'Over-representation' }).first().click();
  await expect(page).toHaveURL(/\/enrichment\?load=session/);

  // After restore, importText is populated; click Render to surface DE inputs.
  await page.getByRole('button', { name: 'Render' }).click();
  await expect(page.locator('input[type="number"]').first()).toHaveValue('0.42');
  await expect(page.locator('input[type="number"]').nth(1)).toHaveValue('1.5');
});
