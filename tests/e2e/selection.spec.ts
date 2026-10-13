import { test, expect, type Page } from './fixtures';
import { resetClientStorage } from './helpers';

// daf-2, daf-16, age-1.
const GENES = ['WBGene00000898', 'WBGene00000912', 'WBGene00000090'];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('wb.tour.complete', '1');
    localStorage.setItem('wb.hints.v2', JSON.stringify({ dismissed: [], allOff: true }));
  });
  await page.goto('/');
  await resetClientStorage(page);
  await page.evaluate((v) => localStorage.setItem('wb_selection', JSON.stringify(v)), GENES);
  await page.goto('/');
  await expect(page.getByText(`${GENES.length} selected`)).toBeVisible({ timeout: 15_000 });
});

async function storedSelection(page: Page): Promise<string[]> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('wb_selection') ?? '[]'));
}

test('saving a selection releases it, and undo brings it back', async ({ page }) => {
  await page.getByTitle('Saved gene lists').click();
  await page.getByPlaceholder('Name this selection...').fill('insulin trio');
  await page.getByRole('button', { name: /Save 3/ }).click();

  await expect(page.getByText('Selection saved and cleared')).toBeVisible();
  await expect(page.getByText(`${GENES.length} selected`)).toBeHidden();
  expect(await storedSelection(page)).toEqual([]);

  await page.getByRole('button', { name: 'Undo clear' }).click();
  await expect(page.getByText(`${GENES.length} selected`)).toBeVisible();
  expect(await storedSelection(page)).toEqual(GENES);
});

test('clear button unselects everything, with undo', async ({ page }) => {
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByText('Selection cleared')).toBeVisible();
  await expect(page.getByText(`${GENES.length} selected`)).toBeHidden();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText(`${GENES.length} selected`)).toBeVisible();
  expect(await storedSelection(page)).toEqual(GENES);
});

test('a saved selection is a gene list everywhere lists are picked', async ({ page }) => {
  await page.getByTitle('Saved gene lists').click();
  await page.getByPlaceholder('Name this selection...').fill('insulin trio');
  await page.getByRole('button', { name: /Save 3/ }).click();
  await expect(page.getByText('Selection saved and cleared')).toBeVisible();

  // Enrichment overlap: the list loads into a slot from "From saved list".
  await page.goto('/enrichment/overlap');
  await expect(page.getByRole('heading', { name: 'Inputs' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'From saved list' }).first().click();
  await page.getByRole('menu').getByText('insulin trio').click();
  await expect(page.locator('textarea').first()).toHaveValue(GENES.join('\n'));

  // Datasets page: listed as a gene list and can become the selection again.
  await page.goto('/datasets');
  const row = page.locator('tr', { hasText: 'insulin trio' });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole('button', { name: 'Use as selection' }).click();
  await expect(page.getByText(`${GENES.length} selected`)).toBeVisible();
  expect(await storedSelection(page)).toEqual(GENES);
});

test('selections saved before the move to datasets are migrated', async ({ page }) => {
  await page.evaluate(() =>
    localStorage.setItem(
      'wb_selection_presets',
      JSON.stringify([{ id: 'old', name: 'legacy list', ids: ['WBGene00000898'], created_at: 1 }]),
    ),
  );
  await page.goto('/datasets');
  await expect(page.locator('tr', { hasText: 'legacy list' })).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => localStorage.getItem('wb_selection_presets'))).toBeNull();
});
