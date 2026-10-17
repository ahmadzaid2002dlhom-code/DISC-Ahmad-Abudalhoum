import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';

// This file is ignored and is loaded only by an explicitly requested hosted check.
if (existsSync('.env.production.local')) loadEnvFile('.env.production.local');
process.env.HOSTED_BASE_URL ??= process.env.PUBLIC_APP_URL;
for (const role of ['FACILITATOR', 'MANAGER']) {
  for (const field of ['EMAIL', 'PASSWORD']) {
    process.env[`HOSTED_${role}_${field}`] ??= process.env[`${role}_SEED_${field}`];
  }
}
const args = process.argv.includes('--persistence') ? ['tests/hosted/persistence.mjs']
  : ['node_modules/@playwright/test/cli.js', 'test', '--config', 'tests/hosted/playwright.config.ts'];
const child = spawn(process.execPath, args, { env: process.env, stdio: 'inherit', windowsHide: true });
child.on('exit', code => { process.exitCode = code ?? 1; });
child.on('error', () => { console.error('Hosted verification could not start.'); process.exitCode = 1; });
