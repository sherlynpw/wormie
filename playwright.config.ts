import { defineConfig, devices } from '@playwright/test';

// Uses the system chromium (matches the existing scripts/smoke-*.mjs pattern)
// so we don't need to download Playwright-managed browsers. Tests target the
// Vite dev server on port 5173; CI / one-off runs can override via BASE_URL.

const PORT = Number(process.env.E2E_PORT ?? 5173);
// Use `localhost` (not 127.0.0.1) because vite dev binds to ::1 by default in
// some Linux setups; localhost resolves dual-stack and works in both.
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/usr/sbin/chromium';

export default defineConfig({
  testDir: 'tests/e2e',
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
