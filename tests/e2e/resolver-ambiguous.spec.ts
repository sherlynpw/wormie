import { test, expect } from './fixtures';
import { resetClientStorage } from './helpers';

// syt-1 is an alias WormBase gives to both snt-1 and nos-3; ric-2 is another alias of snt-1.

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

test('resolver lists an alias that matches two genes as ambiguous', async ({ page }) => {
  await page.goto('/lookup');
  await page.locator('textarea').fill('ric-2\nsyt-1\nunc-13');
  await page.getByRole('button', { name: /^Look up$/ }).click();

  const group = page.getByTestId('ambiguous-group');
  await expect(group).toBeVisible({ timeout: 60_000 });
  await expect(group).toContainText('Ambiguous');
  await expect(group).toContainText('syt-1');
  await expect(group.getByRole('link', { name: /snt-1/ })).toBeVisible();
  await expect(group.getByRole('link', { name: /nos-3/ })).toBeVisible();
  await expect(group.getByRole('checkbox')).toHaveCount(2);
  await expect(group.getByRole('checkbox').first()).toBeChecked();

  // snt-1 is reached by ric-2 and syt-1 but shows once in the match list.
  await expect(page.getByRole('heading', { name: /^2 genes · 1 ambiguous$/ })).toBeVisible();
  await expect(page.locator('a[href$="/gene/WBGene00004921"]')).toHaveCount(2);
  await expect(page.locator('a[href$="/gene/WBGene00003785"]')).toHaveCount(1);
});

test('unchecking a candidate keeps it out of the selection unless another entry matched it', async ({
  page,
}) => {
  await page.goto('/lookup');
  await page.locator('textarea').fill('ric-2\nsyt-1\nunc-13');
  await page.getByRole('button', { name: /^Look up$/ }).click();
  const group = page.getByTestId('ambiguous-group');
  await expect(group).toBeVisible({ timeout: 60_000 });

  await group.getByRole('checkbox', { name: /Keep nos-3 for syt-1/ }).uncheck();
  await group.getByRole('checkbox', { name: /Keep snt-1 for syt-1/ }).uncheck();
  await page.getByRole('button', { name: /Add all to selection/ }).click();
  // snt-1 stays because ric-2 matched it on its own; nos-3 is gone, so 2 genes.
  await expect(page.getByText('2 unique genes')).toBeVisible();
});
