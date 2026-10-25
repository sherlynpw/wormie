import { test, expect } from './fixtures';
import { resetClientStorage } from './helpers';

// Needs the SQLite DB imported (first run is a cold import, ~30-60s). The
// /tissue tree tests also need a DB built with anatomy_relations.

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

test('tissue index shows the top of the anatomy tree', async ({ page }) => {
  await page.goto('/tissue');
  await expect(page.getByText('Anatomy', { exact: true }).first()).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByText('Cell', { exact: true }).first()).toBeVisible();
});

test('tissue detail page shows parent and genes', async ({ page }) => {
  await page.goto('/tissue/WBbt:0005175');
  await expect(page.getByRole('heading', { name: /gonad/ })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('link', { name: /^organ/ })).toBeVisible();
  await expect(page.locator('a[href^="/gene/"]').first()).toBeVisible({ timeout: 60_000 });
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
