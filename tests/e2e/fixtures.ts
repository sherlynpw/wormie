import { test as base, chromium, type BrowserContext } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// One persistent browser context shared by every test in the worker.
//
// The default fixture gives each test an ephemeral context, so each test
// re-downloads and re-imports the gene database into its own OPFS (640 MB
// decompressed). Across the suite that multiplies into tens of gigabytes of
// origin storage on one runner, and once the browser's quota is exhausted
// every IndexedDB write fails with QuotaExceededError (session saves were the
// first casualty in CI). Sharing one profile means the database imports once,
// every later test finds it warm, and quota pressure never builds.
//
// Cross-test isolation is handled explicitly: every spec's beforeEach runs
// resetClientStorage (clears IndexedDB + localStorage); the imported database
// persisting in OPFS is deliberate, exactly like a returning user.

const PORT = Number(process.env.E2E_PORT ?? 5173);
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const CHROMIUM =
  process.env.CHROMIUM_PATH ??
  (existsSync('/usr/sbin/chromium') ? '/usr/sbin/chromium' : undefined);

export const test = base.extend<object, { persistentContext: BrowserContext }>({
  persistentContext: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const dir = mkdtempSync(join(tmpdir(), 'wormie-e2e-'));
      const context = await chromium.launchPersistentContext(dir, {
        executablePath: CHROMIUM,
        args: ['--no-sandbox'],
        baseURL: BASE_URL,
        viewport: { width: 1280, height: 720 },
      });
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  context: async ({ persistentContext }, use) => {
    await use(persistentContext);
  },
  page: async ({ persistentContext }, use) => {
    const page = await persistentContext.newPage();
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
export type { Page } from '@playwright/test';
