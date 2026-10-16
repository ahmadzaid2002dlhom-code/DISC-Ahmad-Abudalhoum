import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', workers: 1, fullyParallel: false,
  timeout: 180000, expect: { timeout: 10000 }, retries: 0,
  outputDir: '../../node_modules/.cache/disc-e2e-results', reporter: 'list',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', headless: true, trace: 'off', video: 'off', screenshot: 'only-on-failure' },
});
