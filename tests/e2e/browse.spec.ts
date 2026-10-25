import { test, expect } from './fixtures';
import { resetClientStorage } from './helpers';

// Needs the SQLite DB imported (first run is a cold import, ~30-60s).

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

test('sidebar links to the four annotation browsers', async ({ page }) => {
  await page.goto('/');
  const aside = page.locator('aside').first();
  for (const [name, href] of [
    ['Neuron classes', '/cell-type'],
    ['Phenotypes', '/phenotype'],
    ['Human diseases', '/disease'],
    ['Tissues', '/tissue'],
  ]) {
    await expect(aside.getByRole('link', { name })).toHaveAttribute('href', href);
  }
});

// CI tests against the deployed DB, which gains anatomy_relations only with the build after
// this change; without it /tissue lists tissues flat. Each test checks the mode it got.
const FLAT_NOTE = /has no anatomy hierarchy/;

async function openTissueIndex(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/tissue');
  const tree = page.getByText('Anatomy', { exact: true }).first();
  await expect(tree.or(page.getByText(FLAT_NOTE))).toBeVisible({ timeout: 120_000 });
  return tree.isVisible();
}

test('tissue index shows the anatomy tree, or a flat list on a build without it', async ({
  page,
}) => {
  if (await openTissueIndex(page)) {
    await expect(page.getByText('Cell', { exact: true }).first()).toBeVisible();
  } else {
    await expect(page.getByText(/gonad/i).first()).toBeVisible({ timeout: 60_000 });
  }
});

test('tissue detail page shows its genes, and its parents when the build has the tree', async ({
  page,
}) => {
  const tree = await openTissueIndex(page);
  await page.goto('/tissue/WBbt:0005175');
  await expect(page.getByRole('heading', { name: /gonad/ })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('a[href^="/gene/"]').first()).toBeVisible({ timeout: 60_000 });
  if (tree) await expect(page.getByRole('link', { name: /^organ/ })).toBeVisible();
});

test('phenotype index shows a tree', async ({ page }) => {
  await page.goto('/phenotype');
  const nodes = page.getByRole('button', { name: /^(Expand|Collapse) / });
  await expect(nodes.first()).toBeVisible({ timeout: 120_000 });
  expect(await nodes.count()).toBeGreaterThan(1);
});

test('disease index lists diseases', async ({ page }) => {
  await page.goto('/disease');
  await expect(page.locator('a[href^="/disease/"]').first()).toBeVisible({ timeout: 120_000 });
});
