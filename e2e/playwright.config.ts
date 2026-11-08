// H-16: end-to-end tests of the real web UI (pnpm test:e2e = build, then this suite).
// The server (server.ts) uses a throw-away database: nothing of data/ is touched.
// First time: `pnpm exec playwright install chromium`. On a machine without Chromium's system libraries
// (and no sudo), extract them somewhere and set LD_LIBRARY_PATH to that folder before running.
import { defineConfig } from '@playwright/test';
import { E2E_PORT as PORT } from './constants.ts';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // One server, one database: the specs run one after the other, each creating its own data.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  outputDir: './test-results',
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    acceptDownloads: true,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'pnpm exec tsx e2e/server.ts',
    cwd: '..',
    url: `http://127.0.0.1:${PORT}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
  },
});
