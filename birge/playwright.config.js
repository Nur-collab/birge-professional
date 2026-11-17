import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  globalTeardown: './e2e/global-teardown.mjs',
  timeout: 45_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node e2e/start-backend.mjs',
      url: 'http://127.0.0.1:8765/health',
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: 'node e2e/start-frontend.mjs',
      url: 'http://127.0.0.1:4174',
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
