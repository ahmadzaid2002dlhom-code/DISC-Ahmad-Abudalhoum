import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { createApp } from '../src/app.ts';
import { getSecurityConfig } from '../src/env.ts';
import { hashPassword, verifyPassword } from '../src/auth/password.ts';
import { seedStaff } from '../src/auth/seed.ts';

const env = { SESSION_SECRET: 'test-only-secret-with-at-least-32-characters', PUBLIC_APP_URL: 'http://localhost:3000' };
// These tests exercise pre-DB boundaries; no database request is expected or mocked.
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused', connectionTimeoutMillis: 100 }) });
after(async () => db.$disconnect());

test('password hashes are salted, verify correctly and reject malformed hashes', async () => {
  const first = await hashPassword('a fictional long password');
  const second = await hashPassword('a fictional long password');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('a fictional long password', first), true);
  assert.equal(await verifyPassword('incorrect password', first), false);
  for (const bad of ['', 'scrypt:short:bad', first + ':extra']) assert.equal(await verifyPassword('x', bad), false);
});

test('staff seed validates both accounts before any database writes', async () => {
  await assert.rejects(seedStaff(db, {}), /FACILITATOR/);
  await assert.rejects(seedStaff(db, { FACILITATOR_SEED_EMAIL: 'same@example.test', FACILITATOR_SEED_PASSWORD: 'fixture-password-long', MANAGER_SEED_EMAIL: 'same@example.test', MANAGER_SEED_PASSWORD: 'another-fixture-password' }), /distinct/);
});

test('security configuration fails closed for insecure or unverified production', () => {
  assert.throws(() => getSecurityConfig({}), /SESSION_SECRET/);
  assert.throws(() => getSecurityConfig({ ...env, NODE_ENV: 'production' }), /HTTPS/);
  for (const proxy of ['true', '1', '0.0.0.0/0', '::/0']) {
    assert.throws(() => getSecurityConfig({ ...env, TRUSTED_PROXY_CIDRS: proxy }), /CIDRs/);
  }
  assert.throws(() => getSecurityConfig({ ...env, PUBLIC_APP_URL: 'https://disc.example.test', NODE_ENV: 'production' }), /verified/);
  assert.throws(() => getSecurityConfig({ ...env, PUBLIC_APP_URL: 'https://disc.example.test/path' }), /origin/);
});

test('anonymous routes, exact mutation Origin, JSON, no-store and proxy spoof protection', async t => {
  const config = getSecurityConfig(env);
  const server = createApp({ db, config }).listen(0, '127.0.0.1');
  if (!server.listening) await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); }));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const path of ['/api/auth/me', '/api/participants', '/api/assessment/result', '/api/manager/summary']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
  }
  for (const path of ['/api/auth/login', '/api/auth/logout', '/api/invitations/redeem', '/api/participants']) {
    for (const supplied of [undefined, 'null', 'https://evil.example.test', config.appOrigin + '.evil.test', config.appOrigin + '/']) {
      const response = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(supplied ? { Origin: supplied } : {}) }, body: '{}' });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  }
  assert.equal((await fetch(origin + '/api/auth/login', { method: 'POST', headers: { Origin: config.appOrigin }, body: '{}' })).status, 415);
  assert.equal((await fetch(origin + '/api/auth/login', { method: 'POST', headers: { Origin: config.appOrigin, 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(origin + '/api/invitations/redeem', { method: 'POST', headers: { Origin: config.appOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'wrong' }) })).status, 400);
});

test('production ignores forwarded HTTPS from an untrusted remote address', async t => {
  const config = getSecurityConfig({ ...env, NODE_ENV: 'production', PUBLIC_APP_URL: 'https://disc.example.test', TRUSTED_PROXY_CIDRS: '192.0.2.0/24', PROXY_CONFIGURATION_VERIFIED: 'true' });
  const server = createApp({ db, config }).listen(0, '127.0.0.1');
  if (!server.listening) await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); }));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const response = await fetch(origin + '/api/auth/me', { headers: { 'X-Forwarded-Proto': 'https' } });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('set-cookie'), null);
});
