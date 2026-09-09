import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Uses the system chromium (matches the existing scripts/smoke-*.mjs pattern)
// so we don't need to download Playwright-managed browsers. Tests target the
// Vite dev server on port 5173; CI / one-off runs can override via BASE_URL.

const PORT = Number(process.env.E2E_PORT ?? 5173);
// Use `localhost` (not 127.0.0.1) because vite dev binds to ::1 by default in
// some Linux setups; localhost resolves dual-stack and works in both.
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
// Precedence: explicit CHROMIUM_PATH, then the system chromium, then the
// Playwright-managed browser (undefined) for hosts with neither, e.g. GitHub
// runners after `playwright install chromium`.
const CHROMIUM =
  process.env.CHROMIUM_PATH ??
  (existsSync('/usr/sbin/chromium') ? '/usr/sbin/chromium' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  // The in-browser DB import can exceed a minute on a cold OPFS, so the
  // 30s Playwright default starves any test that waits on it.
  timeout: 180_000,
  // Every fresh context re-imports the DB in a worker; on a 2-core CI runner
  // that decompression starves the main thread, so even DB-free interactions
  // (a save toast, a page shell) can exceed the 5s default.
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // Single worker: all tests share one vite dev server and one DB OPFS slot.
  // Parallel workers race on resetClientStorage and produced flaky failures.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: CHROMIUM,
      args: ['--no-sandbox'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `bun run dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
