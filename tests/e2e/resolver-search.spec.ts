import { test, expect, type Page } from './fixtures';
import { resetClientStorage } from './helpers';

// Covers three fixes made together: Entrez IDs and multi-alias names in the
// bulk resolver, AND/OR/NOT across prefixes that are not full-text ones, and
// CeNGEN neuron types as an Annotation overlap category.

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

test('resolver takes Entrez IDs and aliases of genes with several aliases', async ({ page }) => {
  await page.goto('/lookup');
  // daf-16: Entrez 172981, aliases "R13H8.1 | daf-17". syd-2: Entrez 181255, alias sad-2.
  await page.locator('textarea').fill('172981\ndaf-17\nsad-2\n181255');
  await page.getByRole('button', { name: /^Look up$/ }).click();
  // One hit per input, so four inputs resolving to two genes read as four matches.
  await expect(page.getByRole('heading', { name: /^4 matches$/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText('daf-16').first()).toBeVisible();
  await expect(page.getByText('syd-2').first()).toBeVisible();
});

async function resultTotal(page: Page, q: string): Promise<number> {
  await page.goto(`/?view=table&q=${encodeURIComponent(q)}`);
  const counter = page.getByText(/of\s+[\d,]+/).first();
  await expect(counter).toBeVisible({ timeout: 60_000 });
  const text = await counter.textContent();
  const m = /of\s+([\d,]+)/.exec(text ?? '');
  return Number((m?.[1] ?? '0').replace(/,/g, ''));
}

test('OR and NOT combine a full-text prefix with a table prefix', async ({ page }) => {
  const ava = await resultTotal(page, 'expressed:AVA');
  const loco = await resultTotal(page, 'pheno:locomotion');
  const both = await resultTotal(page, 'pheno:locomotion AND expressed:AVA');
  const either = await resultTotal(page, 'pheno:locomotion OR expressed:AVA');
  const avaNotLoco = await resultTotal(page, 'expressed:AVA NOT pheno:locomotion');
  expect(both).toBeGreaterThan(0);
  expect(both).toBeLessThanOrEqual(Math.min(ava, loco));
  expect(either).toBeGreaterThanOrEqual(Math.max(ava, loco));
  expect(either).toBe(ava + loco - both);
  expect(avaNotLoco).toBe(ava - both);
});

test('wb: prefix resolves a WormBase identifier', async ({ page }) => {
  expect(await resultTotal(page, 'wb:WBGene00000912')).toBe(1);
  await expect(page.getByText('daf-16').first()).toBeVisible({ timeout: 60_000 });
});

test('annotation overlap compares CeNGEN neuron types', async ({ page }) => {
  await page.goto('/compare?ids=WBGene00000912,WBGene00006364,WBGene00006752');
  await expect(page.getByText('Neuron types (CeNGEN)').first()).toBeVisible({ timeout: 60_000 });
  await page.goto('/compare?ids=WBGene00000912,WBGene00006364');
  await expect(page.getByText(/^Neuron types\b/).first()).toBeVisible({ timeout: 60_000 });
});
