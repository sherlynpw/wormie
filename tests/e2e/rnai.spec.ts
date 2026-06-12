import { test, expect } from '@playwright/test';
import { resetClientStorage } from './helpers';

// Requires the SQLite DB; uses daf-16 (a heavily-RNAi'd gene) so we know the
// reagent table will be populated.

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

test('gene page renders RNAi reagents section', async ({ page }) => {
  // WBGene00000912 is daf-16, one of the most-studied C. elegans genes.
  await page.goto('/gene/WBGene00000912');
  // Wait for the RNAi card to appear (gene page loads many sections in parallel).
  await expect(page.getByRole('heading', { name: 'RNAi reagents' })).toBeVisible({
    timeout: 60_000,
  });
  // At least one WBRNAi link should be present and external.
  const firstRnaiLink = page
    .locator('a[href^="https://wormbase.org/species/c_elegans/rnai/"]')
    .first();
  await expect(firstRnaiLink).toBeVisible();
  const href = await firstRnaiLink.getAttribute('href');
  expect(href).toMatch(/WBRNAi\d+$/);
});
