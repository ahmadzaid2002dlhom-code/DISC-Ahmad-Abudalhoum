import '../../scripts/load-env.mjs';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/src/generated/prisma/client.ts';
import { seedStaff } from '../../apps/api/src/auth/seed.ts';

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) throw new Error('Set TEST_DATABASE_URL to a separate PostgreSQL test instance with CREATE DATABASE permission.');
const database = `disc_e2e_${randomBytes(8).toString('hex')}`;
assert.match(database, /^disc_e2e_[a-f0-9]{16}$/);
const url = new URL(adminUrl); url.pathname = `/${database}`;
const admin = new pg.Client({ connectionString: adminUrl });
const children = [];
let created = false;
const users = {
  FACILITATOR_SEED_EMAIL: 'facilitator@example.test', FACILITATOR_SEED_PASSWORD: 'fictional-facilitator-password',
  MANAGER_SEED_EMAIL: 'manager@example.test', MANAGER_SEED_PASSWORD: 'fictional-manager-password',
};

async function freePort(port) {
  const probe = createServer();
  await new Promise((done, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', done); });
  await new Promise(done => probe.close(done));
}
function start(args, env, cwd = process.cwd()) {
  const child = spawn(process.execPath, args, { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => process.stdout.write(data)); child.stderr.on('data', data => process.stderr.write(data));
  children.push(child); return child;
}
async function ready(path) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (children.some(child => child.exitCode !== null)) throw new Error('E2E service exited before readiness.');
    try { if ((await fetch(`http://localhost:3000${path}`)).ok) return; } catch { /* starting */ }
    await setTimeout(100);
  }
  throw new Error('E2E service readiness timeout.');
}
try {
  await Promise.all([freePort(3000), freePort(4000)]);
  // Fail before provisioning if the production artifacts have not been built.
  readFileSync('apps/web/.next/BUILD_ID'); readFileSync('apps/api/dist/server.js');
  await admin.connect(); await admin.query(`CREATE DATABASE "${database}"`); created = true;
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.href }) });
  const migration = new pg.Client({ connectionString: url.href });
  try {
    await migration.connect();
    await migration.query(readFileSync('apps/api/prisma/migrations/202610160001_phase3_access/migration.sql', 'utf8'));
    await seedStaff(db, users);
  } finally { await db.$disconnect(); await migration.end(); }
  const env = {
    ...process.env, DATABASE_URL: url.href, SESSION_SECRET: randomBytes(48).toString('base64url'),
    NODE_ENV: 'development', PUBLIC_APP_URL: 'http://localhost:3000', API_HOST: '127.0.0.1', API_PORT: '4000',
    E2E_DATABASE_URL: url.href, E2E_BASE_URL: 'http://localhost:3000', PORT: '',
  };
  delete env.PORT; // A host's PORT must not override the isolated test API port.
  start(['apps/api/dist/server.js'], env);
  start([resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3000'],
    { ...env, NODE_ENV: 'production' }, resolve('apps/web'));
  await ready('/api/health'); await ready('/login');
  const runner = start(['node_modules/@playwright/test/cli.js', 'test', '--config', 'tests/e2e/playwright.config.ts'], env);
  const [code] = await once(runner, 'exit');
  if (code !== 0) process.exitCode = code ?? 1;
} finally {
  for (const child of children.reverse()) {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  }
  if (created) {
    // Only this exact, freshly created disposable database can be removed.
    assert.match(database, /^disc_e2e_[a-f0-9]{16}$/);
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [database]);
    await admin.query(`DROP DATABASE "${database}"`);
  }
  await admin.end();
}
