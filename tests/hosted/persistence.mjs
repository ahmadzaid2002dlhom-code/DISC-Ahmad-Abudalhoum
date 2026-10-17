import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

const origin = new URL(process.env.HOSTED_BASE_URL).origin;
assert.equal(new URL(origin).protocol, 'https:');
const ready = 'node_modules/.cache/disc-phase8-restart.ready';
const resumed = 'node_modules/.cache/disc-phase8-restart.complete';
mkdirSync('node_modules/.cache', { recursive: true });
for (const file of [ready, resumed]) if (existsSync(file)) unlinkSync(file);
let cookie;
async function request(path, data) {
  const response = await fetch(`${origin}${path}`, {
    method: data ? 'POST' : 'GET', redirect: 'error',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data ? { Origin: origin, 'Content-Type': 'application/json' } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  assert.equal(response.status, 200, `Unexpected response from ${path}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  if (path === '/api/auth/login') cookie = response.headers.get('set-cookie')?.split(';')[0];
  return response.json();
}
await request('/api/auth/login', { email: process.env.HOSTED_MANAGER_EMAIL, password: process.env.HOSTED_MANAGER_PASSWORD });
assert.ok(cookie?.startsWith('__Host-disc.sid='));
const identity = await request('/api/auth/me');
const before = await request('/api/manager/summary');
assert.ok(before.completed >= 3);
const snapshots = before.participants.filter(value => value.result).map(value => [value.id, value.result]);
writeFileSync(ready, 'Ready for an explicit API redeploy; no credentials in this file.\n');
console.log('PERSISTENCE_READY: authenticated cookie retained in memory; waiting for confirmed service replacement.');
const deadline = Date.now() + 600000;
while (!existsSync(resumed)) {
  if (Date.now() > deadline) throw new Error('Service replacement confirmation timed out.');
  await setTimeout(1000);
}
assert.deepEqual(await request('/api/auth/me'), identity);
const after = await request('/api/manager/summary');
assert.deepEqual(after, before);
for (const [id, snapshot] of snapshots) {
  const report = await request(`/api/participants/${id}/report`);
  assert.equal(report.participant.status, 'COMPLETED');
  assert.deepEqual(report.result, snapshot);
}
for (const file of [ready, resumed]) if (existsSync(file)) unlinkSync(file);
console.log(`PASS: existing PostgreSQL session, manager summary and ${snapshots.length} immutable results survived the API service replacement.`);
