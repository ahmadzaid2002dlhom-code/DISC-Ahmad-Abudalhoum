import { defineConfig } from '@playwright/test';

const value = process.env.HOSTED_BASE_URL;
if (!value) throw new Error('Set HOSTED_BASE_URL to the real HTTPS frontend origin.');
const url = new URL(value);
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('HOSTED_BASE_URL must be an HTTPS origin without credentials, path, query or fragment.');
}

export default defineConfig({
  testDir: '.', testMatch: 'full-flow.spec.ts', workers: 1, fullyParallel: false,
  timeout: 600000, expect: { timeout: 20000 }, retries: 0,
  outputDir: '../../node_modules/.cache/disc-hosted-results', reporter: 'list',
  // Authentication and invitation secrets stay in memory. Never write storage state or traces.
  use: { baseURL: url.origin, headless: true, trace: 'off', video: 'off', screenshot: 'off',
    navigationTimeout: 90000, actionTimeout: 20000 },
});
