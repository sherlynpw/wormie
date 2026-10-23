import { test, expect, type Page } from './fixtures';
import { resetClientStorage } from './helpers';

// Three gene-page panels fed by WormBase release files: the gene model from the
// canonical gene set, median FPKM per life stage, and protein domains (with the
// domain: prefix and the Protein domains enrichment kind). The deployed database
// can predate these tables by up to a week, so each test skips when the panel
// it needs is absent on the daf-16 page rather than failing on an older build.

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

async function openDaf16(page: Page) {
  await page.goto('/gene/WBGene00000912');
  await expect(page.getByText('WBGene00000912').first()).toBeVisible({ timeout: 120_000 });
}

test('gene model: isoform badges and the transcript table', async ({ page }) => {
  await openDaf16(page);
  const card = page.locator('#model');
  // The empty panel keeps the heading, so the table is the sign the build has the data.
  test.skip(!(await card.locator('tbody tr').count()), 'build has no gene_transcript table');
  // daf-16 has 11 coding isoforms in WS298; the header badge counts them.
  await expect(page.getByText(/^\d+ isoforms$/).first()).toBeVisible();
  await expect(card.getByRole('cell', { name: 'R13H8.1a.1' })).toBeVisible();
  await expect(card.getByRole('cell', { name: /\d+ aa/ }).first()).toBeVisible();
});

test('life stages: a bar per stage with the library count', async ({ page }) => {
  await openDaf16(page);
  const card = page.locator('#stages');
  test.skip(!(await card.locator('svg').count()), 'build has no stage_expression table');
  for (const stage of ['embryo', 'L1', 'L4', 'adult', 'dauer']) {
    await expect(card.locator('svg text', { hasText: new RegExp(`^${stage}$`) })).toBeVisible();
  }
  await expect(card.locator('svg text', { hasText: /^n=\d+$/ }).first()).toBeVisible();
});

test('protein domains: InterPro entries with sources, linked to the domain: search', async ({
  page,
}) => {
  await openDaf16(page);
  const card = page.locator('#domains');
  test.skip(!(await card.locator('a').count()), 'build has no gene_domain table');
  await expect(card.getByText(/Fork head domain/i).first()).toBeVisible();
  await expect(card.getByText('IPR001766')).toBeVisible();
  await expect(card.getByText('Pfam').first()).toBeVisible();
  await card.getByRole('link', { name: 'IPR001766' }).click();
  await expect(page).toHaveURL(/q=domain%3AIPR001766/);
  // Every forkhead gene carries the entry, so daf-16 is among the hits and fkh-2 too.
  await expect(page.getByText('daf-16').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^fkh-\d+$/).first()).toBeVisible();
});

test('domain: prefix matches a domain name and the enrichment kind exists', async ({ page }) => {
  await openDaf16(page);
  test.skip(!(await page.locator('#domains a').count()), 'build has no gene_domain table');
  await page.goto('/?view=table&q=' + encodeURIComponent('domain:forkhead AND chr:I'));
  await expect(page.getByText('daf-16').first()).toBeVisible({ timeout: 60_000 });
  await page.goto('/enrichment?ids=WBGene00000912,WBGene00000898');
  await expect(page.getByRole('button', { name: 'Protein domains' }).first()).toBeVisible({
    timeout: 60_000,
  });
});
