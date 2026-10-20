import { test, expect } from './fixtures';
import { resetClientStorage } from './helpers';

// Genome location from the Alliance record: a line on the gene page, a chr:
// prefix, per-chromosome facet chips and a table column. The deployed database
// can predate gene_location by up to a week, so every test skips when the gene
// page shows no location rather than failing on a build that lacks the table.

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

async function hasLocation(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/gene/WBGene00000912');
  await expect(page.getByText('WBGene00000912').first()).toBeVisible({ timeout: 120_000 });
  // daf-16 is on chromosome I. The link text is "I:start-end (strand)".
  const loc = page.getByRole('link', { name: /^I:[\d,]+-[\d,]+/ });
  return (await loc.count()) > 0;
}

test('gene page shows the chromosome and coordinates with a genome browser link', async ({
  page,
}) => {
  test.skip(!(await hasLocation(page)), 'database build has no gene_location table');
  const loc = page.getByRole('link', { name: /^I:[\d,]+-[\d,]+/ });
  await expect(loc).toBeVisible();
  await expect(loc).toHaveAttribute('href', /jbrowse-simple.*loc=I%3A\d+\.\.\d+/);
});

test('chr: prefix narrows a search and the facets show per-chromosome counts', async ({ page }) => {
  test.skip(!(await hasLocation(page)), 'database build has no gene_location table');
  await page.goto('/?view=table&q=' + encodeURIComponent('daf AND chr:I'));
  // daf-16 is on I; daf-2 is on III and must not appear.
  await expect(page.getByText('daf-16').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^daf-2$/)).toHaveCount(0);
  // Facet chips: with the query narrowed to I, only I is left.
  await expect(page.getByRole('link', { name: /^I \d+$/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^III \d+$/ })).toHaveCount(0);
  // The table view carries the chromosome column.
  await expect(page.getByText('Chr', { exact: true })).toBeVisible();
});

test('facet chips cover the chromosomes of an unfiltered result', async ({ page }) => {
  test.skip(!(await hasLocation(page)), 'database build has no gene_location table');
  await page.goto('/?view=table&q=' + encodeURIComponent('type:protein_coding'));
  await expect(page.getByRole('link', { name: /^X [\d,]+$/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('link', { name: /^MtDNA [\d,]+$/ })).toBeVisible();
});

test('resolver pills carry the chromosome', async ({ page }) => {
  test.skip(!(await hasLocation(page)), 'database build has no gene_location table');
  await page.goto('/lookup');
  await page.locator('textarea').fill('daf-16\ndaf-2');
  await page.getByRole('button', { name: /^Look up$/ }).click();
  await expect(page.getByRole('heading', { name: /^2 matches$/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTitle('Chromosome').filter({ hasText: /^I$/ })).toHaveCount(1);
  await expect(page.getByTitle('Chromosome').filter({ hasText: /^III$/ })).toHaveCount(1);
});
