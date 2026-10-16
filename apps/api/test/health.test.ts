import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { app } from '../src/app.ts';

const server = app.listen(0, '127.0.0.1');
let origin: string;

before(async () => {
  if (!server.listening) await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeIdleConnections();
  });
});

test('health serves minimal JSON without configuration or caching', async () => {
  const response = await fetch(`${origin}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'disc-api' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('unknown routes return a JSON 404', async () => {
  const response = await fetch(`${origin}/api/unknown`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Not found' });
});
