import { test, expect } from './fixtures';
import { resetClientStorage } from './helpers';

// Requires the SQLite DB. Uses syd-2 (WBGene00006364) which is in the
// 04_active_zone class of the panel.

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

test('gene page shows synaptogenesis panel card for a paneled gene', async ({ page }) => {
  // syd-2 is the Liprin-alpha scaffold, in the panel as active_zone.
  await page.goto('/gene/syd-2');
  await expect(page.getByRole('heading', { name: 'Synaptogenesis panel' })).toBeVisible({
    timeout: 60_000,
  });
  // The class badge surfaces the curated label "Active zone scaffolding".
  await expect(page.getByText(/Active zone scaffolding/i)).toBeVisible();
});

test('home page synaptogenesis tree view loads with references', async ({ page }) => {
  await page.goto('/?view=synaptogenesis');
  // Tree class rows show the numeric prefix and curated label. Scoping by
  // the prefix avoids matching the quick-start chip strip up top.
  await expect(
    page.getByRole('button', { name: /Activity-regulated \/ feed-forward synaptogenesis TFs/i }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /Active zone scaffolding/i })).toBeVisible();
  // "Show references" toggle reveals the reference list.
  await page.getByRole('button', { name: /Show references/i }).click();
  await expect(page.getByText(/Yee.*2024.*activity-regulated transcriptional/i)).toBeVisible();
});

test('search filter syn: returns paneled genes', async ({ page }) => {
  // Single-word case: syn:innexin should match class 06_innexin (15 genes).
  await page.goto('/?q=syn%3Ainnexin');
  // The result table should show at least one of the inx-* genes; inx-7
  // is in the panel and a canonical hit.
  await expect(page.getByText('inx-7').first()).toBeVisible({ timeout: 60_000 });
});

test('search filter syn: with quoted multi-word value', async ({ page }) => {
  // Quoted multi-word matches the underscore-joined class via the
  // whitespace→underscore mapping in opSubquery.
  await page.goto('/?q=syn%3A%22active%20zone%22');
  // syd-2 is a canonical active-zone scaffold in class 04_active_zone.
  await expect(page.getByText('syd-2').first()).toBeVisible({ timeout: 60_000 });
});
