import { test, expect } from './fixtures';
import { resetClientStorage } from './helpers';

// Requires the SQLite DB; uses daf-16 (a heavily-RNAi'd gene) so we know the
// evidence will be populated. The standalone "RNAi reagents" card was merged
// into the Phenotypes panel during the gene-page regrouping; RNAi evidence now
// shows as a per-phenotype count and an "N RNAi-only" tally in that panel.

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

test('gene page phenotype panel carries RNAi evidence', async ({ page }) => {
  // WBGene00000912 is daf-16, one of the most-studied C. elegans genes.
  await page.goto('/gene/WBGene00000912');
  // The panel header counts phenotypes seen only in RNAi experiments.
  await expect(page.getByText(/\d+ RNAi-only/).first()).toBeVisible({ timeout: 120_000 });
});
