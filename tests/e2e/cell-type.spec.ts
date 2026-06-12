import { test, expect } from '@playwright/test';
import { resetClientStorage } from './helpers';

// This spec needs the SQLite DB to be downloaded + imported, since the
// /cell-type pages query cengen_calls / cengen_neurons. The first run will
// trigger a cold DB import (~30-60s); subsequent runs hit OPFS cache.

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

test('cell-type index lists neuron types', async ({ page }) => {
  await page.goto('/cell-type');
  // Wait for the table to populate; the title shows the count once loaded.
  await expect(page.getByRole('heading', { name: /Neuron types \(\d+/ })).toBeVisible({
    timeout: 120_000,
  });
  // CeNGEN has 128 neuron classes; even if the count varies, expect a few canonical ones.
  await expect(page.getByRole('link', { name: 'ADL' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'AVA' })).toBeVisible();
});

test('cell-type detail page lists genes', async ({ page }) => {
  await page.goto('/cell-type/ADL');
  // Title shows the neuron class.
  await expect(page.getByRole('heading', { name: 'ADL' })).toBeVisible({ timeout: 120_000 });
  // Wait for gene rows to load; we don't assert specific genes, just that some appear.
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 60_000 });
  const rowCount = await page.locator('table tbody tr').count();
  expect(rowCount).toBeGreaterThan(10);
});
