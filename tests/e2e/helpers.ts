import type { Page } from '@playwright/test';

// Clear IndexedDB + localStorage between tests so saved-dataset state from a
// prior test doesn't bleed in. The datasets store is `wb-rs-ht`; lastInputs
// lives in localStorage.
export async function resetClientStorage(page: Page) {
  await page.evaluate(async () => {
    localStorage.clear();
    const dbs = await indexedDB.databases?.();
    if (dbs) {
      await Promise.all(
        dbs.map(
          (d) =>
            new Promise<void>((resolve) => {
              if (!d.name) return resolve();
              const req = indexedDB.deleteDatabase(d.name);
              req.onsuccess = req.onerror = req.onblocked = () => resolve();
            }),
        ),
      );
    }
  });
}

// Click the "Save session" popover button on the current page, type a name,
// and submit. Returns the saved name so tests can match it later.
export async function saveSession(page: Page, name: string) {
  await page.getByRole('button', { name: /save session/i }).click();
  const input = page.locator('input[placeholder="session name"]');
  await input.fill(name);
  await input.press('Enter');
}
