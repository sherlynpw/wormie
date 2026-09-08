import type { Page } from '@playwright/test';

// Clear IndexedDB + localStorage between tests so saved-dataset state from a
// prior test doesn't bleed in. The datasets store is `wb-rs-ht`; lastInputs
// lives in localStorage.
//
// Deliberately clears object stores rather than calling deleteDatabase: the
// current page's own stores hold open connections, so a delete issued from it
// is always "blocked" and stays pending, and every later open() on the same
// database queues behind that pending delete. On slow CI runners the old
// document's connection can outlive the navigation, which left session saves
// hanging forever with no toast.
export async function resetClientStorage(page: Page) {
  await page.evaluate(async () => {
    localStorage.clear();
    const dbs = (await indexedDB.databases?.()) ?? [];
    await Promise.all(
      dbs.map(
        (d) =>
          new Promise<void>((resolve) => {
            if (!d.name) return resolve();
            const req = indexedDB.open(d.name);
            req.onsuccess = () => {
              const db = req.result;
              try {
                const names = [...db.objectStoreNames];
                if (names.length === 0) {
                  db.close();
                  return resolve();
                }
                const tx = db.transaction(names, 'readwrite');
                for (const n of names) tx.objectStore(n).clear();
                tx.oncomplete = () => {
                  db.close();
                  resolve();
                };
                tx.onabort = tx.onerror = () => {
                  db.close();
                  resolve();
                };
              } catch {
                db.close();
                resolve();
              }
            };
            req.onerror = req.onblocked = () => resolve();
          }),
      ),
    );
  });
}

// Click the "Save session" popover button on the current page, type a name,
// and submit. Returns the saved name so tests can match it later.
export async function saveSession(page: Page, name: string) {
  await page.getByRole('button', { name: /save session/i }).click();
  const input = page.locator('input[placeholder="session name"]');
  await input.fill(name);
  await page.getByRole('menu').getByRole('button', { name: 'Save', exact: true }).click();
}
