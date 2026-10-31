import { test, expect } from './fixtures';
import { resetClientStorage } from './helpers';

// Requires the SQLite DB. Uses syd-2 (WBGene00006364), in the active zone class
// of the panel.
//
// CI runs against the live database, which can lag a panel change by one
// deploy. The UI falls back to the raw class id when it has no label for it,
// so assertions match the words shared by the label and the id rather than the
// numbered id or the exact label.

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
  await expect(page.getByRole('heading', { name: 'Synaptic genes' })).toBeVisible({
    timeout: 60_000,
  });
  // Label "Active zone scaffolding" or the raw id "NN_active_zone".
  await expect(page.getByText(/active.zone/i).first()).toBeVisible();
});

test('home page synaptogenesis tree view loads with references', async ({ page }) => {
  await page.goto('/?view=synaptogenesis');
  // Tree class rows show the curated label, or the raw id on a lagging database.
  await expect(page.getByRole('button', { name: /activity.regulated/i })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('button', { name: /active.zone/i })).toBeVisible();
  // "Show references" toggle reveals the reference list.
  await page.getByRole('button', { name: /Show references/i }).click();
  await expect(page.getByText(/Yee.*2024.*activity-regulated transcriptional/i)).toBeVisible();
});

test('search filter syn: returns paneled genes', async ({ page }) => {
  // Single-word case: syn:innexin should match the innexin class (15 genes).
  await page.goto('/?q=syn%3Ainnexin');
  // The result table should show at least one of the inx-* genes; inx-7
  // is in the panel and a canonical hit.
  await expect(page.getByText('inx-7').first()).toBeVisible({ timeout: 60_000 });
});

test('search filter syn: with quoted multi-word value', async ({ page }) => {
  // Quoted multi-word matches the underscore-joined class via the
  // whitespace→underscore mapping in opSubquery.
  await page.goto('/?q=syn%3A%22active%20zone%22');
  // syd-2 is a canonical active-zone scaffold in the active zone class.
  await expect(page.getByText('syd-2').first()).toBeVisible({ timeout: 60_000 });
});
