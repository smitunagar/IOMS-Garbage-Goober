// @ts-check
'use strict';

const { defineConfig, devices } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

module.exports = defineConfig({
  testDir: './tests/e2e',
  // Max time for a single test
  timeout: 45_000,
  // Max time for expect() assertions
  expect: { timeout: 8_000 },
  // Run tests serially in CI to avoid session conflicts on a shared DB
  fullyParallel: !process.env.CI,
  // Fail fast in CI if a spec is accidentally committed with `.only`
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'on-failure' }]],

  use: {
    baseURL: BASE_URL,
    // Keep a trace on the first retry so failures are diagnosable in CI
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // When BASE_URL is not overridden (local dev / CI without external URL),
  // spin up the server automatically before Playwright starts.
  webServer: BASE_URL === 'http://localhost:3000'
    ? {
        command: 'node server.js',
        url: 'http://localhost:3000/login',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
        env: {
          PORT: '3000',
          NODE_ENV: 'test',
        },
      }
    : undefined,
});
