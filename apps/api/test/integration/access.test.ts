import '../../../../scripts/load-env.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client.ts';
import { createApp, inviteHash } from '../../src/app.ts';
import { seedStaff } from '../../src/auth/seed.ts';
import { getSecurityConfig } from '../../src/env.ts';
import { scoreAssessment } from '../../src/domain/scoring.ts';
import { seed, order, mixed } from '../helpers/assessment.ts';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('Set TEST_DATABASE_URL to run real PostgreSQL integration tests. No tests are silently skipped.');
const schema = `disc_test_${randomBytes(8).toString('hex')}`;
const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 1, connectionTimeoutMillis: 5000 });
const makeDb = () => new PrismaClient({ adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}`, max: 5 }, { schema }) });
let db = makeDb();
const config = getSecurityConfig({ SESSION_SECRET: randomBytes(48).toString('base64url'), PUBLIC_APP_URL: 'http://localhost:3000' });
const users = { FACILITATOR_SEED_EMAIL: 'facilitator@example.test', FACILITATOR_SEED_PASSWORD: 'fictional-facilitator-password', MANAGER_SEED_EMAIL: 'manager@example.test', MANAGER_SEED_PASSWORD: 'fictional-manager-password' };
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let origin: string;

async function start(production = false) {
  const security = production ? getSecurityConfig({ SESSION_SECRET: config.sessionSecret, PUBLIC_APP_URL: 'https://disc.example.test', NODE_ENV: 'production', TRUSTED_PROXY_CIDRS: '127.0.0.1/32', PROXY_CONFIGURATION_VERIFIED: 'true' }) : config;
  server = createApp({ db, config: security }).listen(0, '127.0.0.1');
  if (!server.listening) await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function stop() {
  await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); });
}
class Browser {
  cookie = '';
  async request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(origin + path, { method, headers: {
      ...(this.cookie ? { Cookie: this.cookie } : {}),
      ...(method !== 'GET' ? { Origin: config.appOrigin, 'Content-Type': 'application/json' } : {}), ...headers,
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0]!;
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response;
  }
  async login(role: 'FACILITATOR' | 'MANAGER') {
    const response = await this.request('/api/auth/login', 'POST', { email: users[`${role}_SEED_EMAIL`], password: users[`${role}_SEED_PASSWORD`] });
    assert.equal(response.status, 200);
    return response;
  }
}
async function invite(browser: Browser, name = 'Fictional participant') {
  const response = await browser.request('/api/participants', 'POST', { name });
  assert.equal(response.status, 201);
  const body = await response.json() as { participant: { id: string; status: string }; invitationUrl: string };
  const token = new URL(body.invitationUrl).pathname.split('/').at(-1)!;
  assert.equal(token.length, 43);
  return { ...body, token };
}
async function completed(participantId: string, tied: boolean) {
  const scores = scoreAssessment(seed, tied ? mixed(['D', 'I', 'S', 'C'], ['I', 'D', 'S', 'C']) : order(['C', 'D', 'S', 'I']));
  const completedAt = new Date();
  await db.$transaction(async tx => {
    await tx.result.create({ data: {
      participantId, scoreD: scores.scores.D, scoreI: scores.scores.I, scoreS: scores.scores.S, scoreC: scores.scores.C,
      scoreRanking: scores.scoreRanking as Prisma.InputJsonValue, tiedScoreGroups: scores.tiedScoreGroups as Prisma.InputJsonValue,
      profileStatus: scores.profileStatus, profileCode: scores.profileCode, candidateProfileCodes: scores.candidateProfileCodes,
      candidateProfiles: scores.candidateProfiles as unknown as Prisma.InputJsonValue, completedAt,
      assessmentVersion: scores.assessmentVersion, scoringPolicyVersion: scores.scoringPolicyVersion, profileTextPolicyVersion: scores.profileTextPolicyVersion,
    } });
    await tx.participant.update({ where: { id: participantId }, data: { status: 'COMPLETED', startedAt: completedAt, completedAt } });
  });
  return scores;
}

before(async () => {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(`SET search_path TO "${schema}"`);
  await pool.query(readFileSync(new URL('../../prisma/migrations/202610160001_phase3_access/migration.sql', import.meta.url), 'utf8'));
  await seedStaff(db, users);
  await start();
});
after(async () => {
  if (server) await stop();
  await db.$disconnect();
  // Only this test's cryptographically random schema is removed; never public/data.
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
});

test('staff seeding is distinct, hashed and idempotent without resetting passwords', async () => {
  const before = await db.staffUser.findMany({ orderBy: { email: 'asc' } });
  assert.deepEqual(new Set(before.map(u => u.role)), new Set(['FACILITATOR', 'MANAGER']));
  assert.ok(before.every(u => u.passwordHash.startsWith('scrypt:')));
  await seedStaff(db, { ...users, MANAGER_SEED_PASSWORD: 'different-fixture-password' });
  assert.deepEqual(await db.staffUser.findMany({ orderBy: { email: 'asc' } }), before);
  await assert.rejects(seedStaff(db, { ...users, FACILITATOR_SEED_EMAIL: users.MANAGER_SEED_EMAIL, MANAGER_SEED_EMAIL: users.FACILITATOR_SEED_EMAIL }), /different role/);
});

test('both roles authenticate, share invitations and enforce manager-only boundaries', async () => {
  const facilitator = new Browser(); const manager = new Browser();
  for (const [browser, role] of [[facilitator, 'FACILITATOR'], [manager, 'MANAGER']] as const) {
    const login = await browser.login(role);
    assert.equal((await login.json()).principal.role, role);
    const cookie = login.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Lax/i); assert.match(cookie, /Path=\//i);
    assert.doesNotMatch(cookie, /Domain=/i);
    assert.equal((await browser.request('/api/auth/me')).status, 200);
    assert.equal((await browser.request('/api/assessment/result')).status, 403);
  }
  assert.equal((await facilitator.request('/api/manager/summary')).status, 403);
  assert.equal((await manager.request('/api/manager/summary')).status, 200);
  const first = await invite(facilitator);
  const second = await invite(manager);
  for (const browser of [facilitator, manager]) {
    const body = await (await browser.request('/api/participants')).json();
    assert.ok(body.participants.some((p: { id: string }) => p.id === first.participant.id));
    assert.ok(body.participants.some((p: { id: string }) => p.id === second.participant.id));
    assert.ok(body.participants.every((p: { result: unknown }) => p.result === null));
    assert.doesNotMatch(JSON.stringify(body), /inviteTokenHash|invitationUrl|passwordHash/);
  }
});

test('invalid login and payloads fail without exposing credentials', async () => {
  const browser = new Browser();
  for (const email of [users.FACILITATOR_SEED_EMAIL, 'unknown@example.test']) {
    const response = await browser.request('/api/auth/login', 'POST', { email, password: 'wrong password' });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Invalid email or password.' });
  }
  await browser.login('MANAGER');
  for (const body of [{ name: '' }, { name: 'x', email: 'bad' }, { name: 'x', role: 'MANAGER' }]) assert.equal((await browser.request('/api/participants', 'POST', body)).status, 400);
  assert.equal((await browser.request('/api/participants/not-a-uuid/report')).status, 404);
  assert.equal((await browser.request(`/api/participants/${randomUUID()}/report`)).status, 404);
});

test('invitation stores only a hash; GET never redeems; wrong, expired and malformed tokens fail', async () => {
  const staff = new Browser(); await staff.login('FACILITATOR');
  const created = await invite(staff);
  const before = await db.participant.findUniqueOrThrow({ where: { id: created.participant.id } });
  assert.equal(before.inviteTokenHash, inviteHash(created.token));
  assert.notEqual(before.inviteTokenHash, created.token);
  assert.equal(before.status, 'INVITED'); assert.equal(before.startedAt, null);
  const browser = new Browser();
  assert.equal((await browser.request('/api/invitations/redeem')).status, 404);
  assert.equal((await db.participant.findUniqueOrThrow({ where: { id: before.id } })).status, 'INVITED');
  for (const token of ['bad', randomBytes(32).toString('base64url')]) assert.equal((await browser.request('/api/invitations/redeem', 'POST', { token })).status, 400);
  await db.participant.update({ where: { id: before.id }, data: { inviteExpiresAt: new Date(0) } });
  assert.equal((await browser.request('/api/invitations/redeem', 'POST', { token: created.token })).status, 400);
  assert.equal((await browser.request('/api/auth/me')).status, 401);
});

test('staff -> participant -> another participant -> staff rotates and persists exactly one principal', async () => {
  const browser = new Browser(); await browser.login('MANAGER');
  const first = await invite(browser); const second = await invite(browser);
  const staleCookies: string[] = [browser.cookie];
  for (const created of [first, second]) {
    const response = await browser.request('/api/invitations/redeem', 'POST', { token: created.token });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { redirectTo: '/assessment' });
    assert.notEqual(browser.cookie, staleCookies.at(-1));
    assert.equal((await browser.request('/api/participants')).status, 403);
    const me = await (await browser.request('/api/auth/me')).json();
    assert.equal(me.principal.type, 'PARTICIPANT'); assert.equal(me.principal.id, created.participant.id);
    assert.equal(me.principal.role, undefined);
    staleCookies.push(browser.cookie);
    const row = await db.participant.findUniqueOrThrow({ where: { id: created.participant.id } });
    assert.equal(row.status, 'IN_PROGRESS'); assert.ok(row.startedAt);
    await browser.request('/api/invitations/redeem', 'POST', { token: created.token });
    assert.deepEqual((await db.participant.findUniqueOrThrow({ where: { id: row.id } })).startedAt, row.startedAt);
  }
  await browser.login('FACILITATOR');
  assert.equal((await browser.request('/api/assessment/result')).status, 403);
  for (const cookie of staleCookies) {
    const stale = new Browser(); stale.cookie = cookie;
    assert.equal((await stale.request('/api/auth/me')).status, 401);
  }
  const me = await (await browser.request('/api/auth/me')).json();
  assert.equal(me.principal.role, 'FACILITATOR'); assert.equal(me.principal.participantId, undefined);
  for (const row of await db.session.findMany()) {
    assert.match(row.id, /^[a-f\d]{64}$/);
    const data = row.data as { principal: Record<string, unknown> };
    assert.equal(Object.keys(data.principal).length, 2);
    assert.ok(data.principal.type === 'STAFF' || data.principal.type === 'PARTICIPANT');
  }
});

test('stored sessions survive a new API instance/store and database connection; logout revokes them', async () => {
  const browser = new Browser(); await browser.login('MANAGER');
  const cookie = browser.cookie;
  await stop(); await db.$disconnect(); db = makeDb(); await start();
  assert.equal((await browser.request('/api/auth/me')).status, 200);
  const response = await browser.request('/api/auth/logout', 'POST', {});
  assert.equal(response.status, 204); assert.match(response.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/);
  browser.cookie = cookie; assert.equal((await browser.request('/api/auth/me')).status, 401);
});

test('expired server sessions cannot authenticate', async () => {
  const browser = new Browser(); await browser.login('MANAGER');
  const raw = decodeURIComponent(browser.cookie.slice(browser.cookie.indexOf('=') + 1));
  const sid = raw.slice(2, raw.lastIndexOf('.'));
  const id = createHash('sha256').update(sid).digest('hex');
  await db.session.update({ where: { id }, data: { expiresAt: new Date(0) } });
  assert.equal((await browser.request('/api/auth/me')).status, 401);
  assert.equal(await db.session.findUnique({ where: { id } }), null);
});

test('unavailable pinned versions fail explicitly; a failed redemption retains the staff principal', async () => {
  const browser = new Browser(); await browser.login('MANAGER');
  const created = await invite(browser);
  await db.participant.update({ where: { id: created.participant.id }, data: { assessmentVersion: 'old-unavailable-assessment' } });
  const response = await browser.request('/api/invitations/redeem', 'POST', { token: created.token });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /pinned assessment version/);
  assert.equal((await (await browser.request('/api/auth/me')).json()).principal.role, 'MANAGER');
  assert.equal((await db.participant.findUniqueOrThrow({ where: { id: created.participant.id } })).status, 'INVITED');
});

test('failed durable session save returns no redirect or new authenticated cookie', async () => {
  await pool.query(`CREATE FUNCTION reject_test_session_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test storage failure'; END; $$`);
  await pool.query('CREATE TRIGGER test_session_failure BEFORE INSERT ON "Session" FOR EACH ROW EXECUTE FUNCTION reject_test_session_insert()');
  try {
    const browser = new Browser();
    const response = await browser.request('/api/auth/login', 'POST', { email: users.MANAGER_SEED_EMAIL, password: users.MANAGER_SEED_PASSWORD });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Internal server error.' });
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('location'), null);
    assert.equal((await browser.request('/api/auth/me')).status, 401);
  } finally {
    await pool.query('DROP TRIGGER test_session_failure ON "Session"');
    await pool.query('DROP FUNCTION reject_test_session_insert()');
  }
});

test('SINGLE and TIED are immutable completed snapshots; participants see only their own report', async () => {
  const staff = new Browser(); await staff.login('FACILITATOR');
  const first = await invite(staff); const second = await invite(staff); const pending = await invite(staff);
  const single = await completed(first.participant.id, false); const tied = await completed(second.participant.id, true);
  assert.equal((await staff.request(`/api/participants/${pending.participant.id}/report`)).status, 409);
  const alice = new Browser(); const bob = new Browser();
  for (const [browser, created, expected] of [[alice, first, single], [bob, second, tied]] as const) {
    const redeem = await browser.request('/api/invitations/redeem', 'POST', { token: created.token });
    assert.deepEqual(await redeem.json(), { redirectTo: '/result' });
    const response = await browser.request('/api/assessment/result?participantId=' + (created === first ? second : first).participant.id);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.result.scores, expected.scores);
    assert.equal(body.result.profileStatus, expected.profileStatus);
    assert.equal(body.result.profileCode, expected.profileCode);
    assert.deepEqual(body.result.scoreRanking, expected.scoreRanking);
    assert.deepEqual(body.result.tiedScoreGroups, expected.tiedScoreGroups);
    assert.deepEqual(body.result.candidateProfileCodes, expected.candidateProfileCodes);
    assert.deepEqual(body.result.candidateProfiles, expected.candidateProfiles);
    assert.equal(body.result.assessmentVersion, seed.assessmentVersion);
    assert.equal(body.result.scoringPolicyVersion, seed.scoringPolicyVersion);
    assert.equal(body.result.profileTextPolicyVersion, seed.profileTextPolicyVersion);
    assert.equal((await browser.request(`/api/participants/${second.participant.id}/report`)).status, 403);
  }
  for (const role of ['FACILITATOR', 'MANAGER'] as const) {
    await staff.login(role);
    const body = await (await staff.request(`/api/participants/${second.participant.id}/report`)).json();
    assert.equal(body.participant.status, 'COMPLETED'); assert.equal(body.result.profileStatus, 'TIED'); assert.equal(body.result.profileCode, null);
  }
  await assert.rejects(db.result.update({ where: { participantId: first.participant.id }, data: { scoringPolicyVersion: 'changed' } }));
  await assert.rejects(db.result.delete({ where: { participantId: first.participant.id } }));
  await assert.rejects(db.participant.update({ where: { id: second.participant.id }, data: { status: 'IN_PROGRESS', completedAt: null } }));
  await assert.rejects(db.participant.update({ where: { id: pending.participant.id }, data: { status: 'COMPLETED', startedAt: new Date(), completedAt: new Date() } }));
});

test('database rejects invalid score ranges, totals, tie codes and mixed session principals', async () => {
  const staff = new Browser(); await staff.login('MANAGER');
  const created = await invite(staff);
  const original = await db.result.findFirstOrThrow();
  const { id: _id, ...data } = original;
  void _id;
  for (const invalid of [{ scoreD: 57 }, { scoreD: 14, scoreI: 14, scoreS: 14, scoreC: 14 }, { profileStatus: 'TIED' as const, profileCode: 'DI' as const }]) {
    await assert.rejects(db.result.create({ data: { ...data, participantId: created.participant.id, scoreRanking: data.scoreRanking as Prisma.InputJsonValue, tiedScoreGroups: data.tiedScoreGroups as Prisma.InputJsonValue, candidateProfiles: data.candidateProfiles as Prisma.InputJsonValue, ...invalid } }));
  }
  await assert.rejects(db.session.create({ data: { id: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 60000), data: { cookie: {}, principal: { type: 'STAFF', staffUserId: randomUUID(), participantId: randomUUID() } } } }));
});

test('production secure cookies require a trusted HTTPS proxy, and generic DB failures reveal no data', async () => {
  await stop(); await start(true);
  const browser = new Browser();
  const response = await browser.request('/api/auth/login', 'POST', { email: users.MANAGER_SEED_EMAIL, password: users.MANAGER_SEED_PASSWORD }, { Origin: 'https://disc.example.test', 'X-Forwarded-Proto': 'https' });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /^__Host-disc\.sid=/); assert.match(cookie, /; Secure/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.doesNotMatch(cookie, /Domain=/);
  await stop(); await start();
  await pool.query('ALTER TABLE "StaffUser" RENAME TO "StaffUser_temporarily_unavailable"');
  try {
    const failed = await new Browser().request('/api/auth/login', 'POST', { email: users.MANAGER_SEED_EMAIL, password: users.MANAGER_SEED_PASSWORD });
    assert.equal(failed.status, 500); assert.deepEqual(await failed.json(), { error: 'Internal server error.' });
  } finally { await pool.query('ALTER TABLE "StaffUser_temporarily_unavailable" RENAME TO "StaffUser"'); }
});
