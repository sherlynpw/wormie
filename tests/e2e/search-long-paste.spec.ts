import { test, expect } from '@playwright/test';
import { resetClientStorage } from './helpers';

// Verifies the long-paste fallback: when the search box receives a very long
// gene list, the bar switches to `?gz=<encoded>` instead of `?q=<list>` so
// the URL stays small and the query continues to resolve. Previously a
// ~1500-char paste would either silently truncate or fall into FTS-hybrid
// mode where one off-spec token broke the whole match.

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

test('long gene-list paste routes through ?gz= and resolves', async ({ page }) => {
  await page.goto('/');
  // Build ~200 well-formed WBGene IDs. Real IDs would need to exist in the
  // DB for results to render; we generate from a real-looking range and
  // expect at least the URL+routing parts to work even if some IDs miss.
  const ids: string[] = [];
  // Use a mix of canonical worm genes (will hit the DB) so we see results.
  const seedNames = [
    'daf-16',
    'daf-2',
    'daf-7',
    'age-1',
    'akt-1',
    'sgk-1',
    'pdk-1',
    'hsf-1',
    'skn-1',
    'lin-32',
    'unc-3',
    'che-1',
    'ttx-3',
    'mec-3',
    'ceh-10',
    'unc-30',
  ];
  while (ids.length < 400) ids.push(...seedNames);
  const longPaste = ids.join(',');
  expect(longPaste.length).toBeGreaterThan(1500);

  // Find the main search input and paste.
  const search = page.getByPlaceholder(/Search by gene name/i);
  await search.fill(longPaste);

  // Debounce is 200ms; give it a beat then check the URL switched to gz.
  await page.waitForFunction(() => new URL(window.location.href).searchParams.has('gz'), null, {
    timeout: 5_000,
  });
  const url = new URL(page.url());
  expect(url.searchParams.get('gz')).toBeTruthy();
  expect(url.searchParams.get('q')).toBeNull();

  // The actual result table should populate (we pasted real worm genes).
  // Wait for a known gene to appear in the results list.
  await expect(page.getByText('daf-16').first()).toBeVisible({ timeout: 30_000 });
});

test('short query stays in ?q=', async ({ page }) => {
  await page.goto('/');
  const search = page.getByPlaceholder(/Search by gene name/i);
  await search.fill('daf-16');
  await page.waitForFunction(
    () => new URL(window.location.href).searchParams.get('q') === 'daf-16',
    null,
    {
      timeout: 5_000,
    },
  );
  const url = new URL(page.url());
  expect(url.searchParams.get('gz')).toBeNull();
});
