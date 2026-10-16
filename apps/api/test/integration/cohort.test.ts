import '../../../../scripts/load-env.mjs';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client.ts';
import { createApp, inviteHash } from '../../src/app.ts';
import { seedStaff } from '../../src/auth/seed.ts';
import { getSecurityConfig } from '../../src/env.ts';
import { scoreAssessment, PROFILE_CODES, DIMENSIONS, type Answer } from '../../src/domain/scoring.ts';
import { seed, order, mixed } from '../helpers/assessment.ts';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('Set TEST_DATABASE_URL for real cohort tests.');
const schema = `disc_test_${randomBytes(8).toString('hex')}`;
const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 1 });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}`, max: 8 }, { schema }) });
const config = getSecurityConfig({ SESSION_SECRET: randomBytes(48).toString('base64url'), PUBLIC_APP_URL: 'http://localhost:3000' });
const users = { FACILITATOR_SEED_EMAIL: 'facilitator@example.test', FACILITATOR_SEED_PASSWORD: 'fictional-facilitator-password', MANAGER_SEED_EMAIL: 'manager@example.test', MANAGER_SEED_PASSWORD: 'fictional-manager-password' };
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let origin: string;

class Browser {
  cookie = '';
  async request(path: string, body?: unknown) {
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST', headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(body === undefined ? {} : { Origin: config.appOrigin, 'Content-Type': 'application/json' }),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0]!;
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response;
  }
  async login(role: 'FACILITATOR' | 'MANAGER') {
    assert.equal((await this.request('/api/auth/login', { email: users[`${role}_SEED_EMAIL`], password: users[`${role}_SEED_PASSWORD`] })).status, 200);
  }
  async summary() {
    const response = await this.request('/api/manager/summary');
    assert.equal(response.status, 200);
    return response.json();
  }
}

async function complete(tx: Prisma.TransactionClient, id: string, answers: Answer[]) {
  const result = scoreAssessment(seed, answers);
  const completedAt = new Date();
  await tx.result.create({ data: {
    participantId: id, scoreD: result.scores.D, scoreI: result.scores.I, scoreS: result.scores.S, scoreC: result.scores.C,
    scoreRanking: result.scoreRanking as Prisma.InputJsonValue, tiedScoreGroups: result.tiedScoreGroups as Prisma.InputJsonValue,
    profileStatus: result.profileStatus, profileCode: result.profileCode, candidateProfileCodes: result.candidateProfileCodes,
    candidateProfiles: result.candidateProfiles as unknown as Prisma.InputJsonValue, completedAt,
    assessmentVersion: seed.assessmentVersion, scoringPolicyVersion: seed.scoringPolicyVersion, profileTextPolicyVersion: seed.profileTextPolicyVersion,
  } });
  await tx.participant.update({ where: { id }, data: { status: 'COMPLETED', startedAt: completedAt, completedAt } });
}
async function fixture(name: string, answers?: Answer[], started = false) {
  const token = randomBytes(32).toString('base64url');
  const participant = await db.participant.create({ data: {
    name, inviteTokenHash: inviteHash(token), inviteExpiresAt: new Date(Date.now() + 3600000),
    assessmentVersion: seed.assessmentVersion, scoringPolicyVersion: seed.scoringPolicyVersion, profileTextPolicyVersion: seed.profileTextPolicyVersion,
    ...(started ? { status: 'IN_PROGRESS', startedAt: new Date() } : {}),
  } });
  if (answers) await db.$transaction(tx => complete(tx, participant.id, answers));
  return { participant, token };
}
async function sixPeople() {
  const invited = await fixture('Fictional invited');
  await fixture('Fictional in progress', undefined, true);
  await fixture('Fictional CD', order(['C', 'D', 'S', 'I']));
  await fixture('Fictional DI', order(['D', 'I', 'S', 'C']));
  await fixture('Fictional IS', order(['I', 'S', 'C', 'D']));
  await fixture('Fictional DI / ID', mixed(['D', 'I', 'S', 'C'], ['I', 'D', 'S', 'C']));
  return invited;
}
function assertDistribution(summary: Awaited<ReturnType<Browser['summary']>>) {
  assert.deepEqual(Object.keys(summary.distribution), [...PROFILE_CODES, 'TIED']);
  assert.equal(Object.values<number>(summary.distribution).reduce((sum, count) => sum + count, 0), summary.completed);
  assert.equal(summary.completed + summary.pending, summary.totalInvited);
}

before(async () => {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(readFileSync(new URL('../../prisma/migrations/202610160001_phase3_access/migration.sql', import.meta.url), 'utf8'));
  await seedStaff(db, users);
  server = createApp({ db, config }).listen(0, '127.0.0.1');
  if (!server.listening) await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  // Only disposable fictional records in this suite's random schema are reset.
  await pool.query('TRUNCATE "Session", "Answer", "Result", "Participant"');
});
after(async () => {
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); });
  await db.$disconnect();
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end();
});

test('empty cohort has zero counts, zero percent, 13 zero categories and null means', async () => {
  const manager = new Browser(); await manager.login('MANAGER');
  const summary = await manager.summary(); assertDistribution(summary);
  assert.equal(summary.totalInvited, 0); assert.equal(summary.completed, 0); assert.equal(summary.pending, 0);
  assert.equal(summary.completionPercentage, 0); assert.equal(summary.means, null); assert.deepEqual(summary.participants, []);
  assert.ok(Object.values(summary.distribution).every(count => count === 0));
});

test('invitations without completions stay pending with null results and means', async () => {
  await fixture('Fictional invited'); await fixture('Fictional started', undefined, true);
  const manager = new Browser(); await manager.login('MANAGER');
  const summary = await manager.summary(); assertDistribution(summary);
  assert.equal(summary.totalInvited, 2); assert.equal(summary.completed, 0); assert.equal(summary.pending, 2);
  assert.equal(summary.completionPercentage, 0); assert.equal(summary.means, null);
  assert.ok(summary.participants.every((p: { result: unknown }) => p.result === null));
});

test('six-person fixture has exact counts, exclusive distribution, means and shared staff rows', async () => {
  await sixPeople();
  const manager = new Browser(); await manager.login('MANAGER');
  const summary = await manager.summary(); assertDistribution(summary);
  assert.equal(summary.totalInvited, 6); assert.equal(summary.completed, 4); assert.equal(summary.pending, 2);
  assert.equal(summary.completionPercentage, 100 * 4 / 6);
  assert.deepEqual(summary.means, { D: 40.25, I: 40.25, S: 31.5, C: 28 });
  assert.equal(Object.values<number>(summary.means).reduce((sum, value) => sum + value, 0), 140);
  for (const [code, count] of Object.entries(summary.distribution)) assert.equal(count, ['CD', 'DI', 'IS', 'TIED'].includes(code) ? 1 : 0);
  for (const role of ['FACILITATOR', 'MANAGER'] as const) {
    const staff = new Browser(); await staff.login(role);
    const listed = await staff.request('/api/participants'); assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).participants, summary.participants);
  }
  for (const participant of summary.participants) {
    assert.equal('inviteTokenHash' in participant, false); assert.equal('invitationUrl' in participant, false);
    if (participant.status !== 'COMPLETED') { assert.equal(participant.result, null); continue; }
    for (const candidate of participant.result.candidateProfiles) assert.equal(candidate.nameAr, seed.profiles.find(p => p.code === candidate.code)!.labelAr);
  }
  const tied = summary.participants.find((p: { result: { profileStatus: string } | null }) => p.result?.profileStatus === 'TIED');
  assert.equal(tied.result.profileCode, null); assert.deepEqual(tied.result.candidateProfileCodes, ['DI', 'ID']);
});

test('all-tied cohort counts each result once regardless of two or twelve candidate codes', async () => {
  await fixture('Fictional first-place tie', mixed(['D', 'I', 'S', 'C'], ['I', 'D', 'S', 'C']));
  await fixture('Fictional second-place tie', mixed(['D', 'I', 'S', 'C'], ['D', 'S', 'I', 'C']));
  await fixture('Fictional all-four tie', mixed(['D', 'I', 'S', 'C'], ['C', 'S', 'I', 'D']));
  const manager = new Browser(); await manager.login('MANAGER');
  const summary = await manager.summary(); assertDistribution(summary);
  assert.equal(summary.totalInvited, 3); assert.equal(summary.completed, 3); assert.equal(summary.pending, 0); assert.equal(summary.completionPercentage, 100);
  for (const [code, count] of Object.entries(summary.distribution)) assert.equal(count, code === 'TIED' ? 3 : 0);
  assert.deepEqual(summary.means, { D: 140 / 3, I: 119 / 3, S: 98 / 3, C: 63 / 3 });
});

test('every ordered SINGLE code occupies its own distribution category', async () => {
  for (const code of PROFILE_CODES) {
    const dimensions = [...code, ...DIMENSIONS.filter(d => !code.includes(d))] as typeof DIMENSIONS[number][];
    await fixture(`Fictional ${code}`, order(dimensions));
  }
  const manager = new Browser(); await manager.login('MANAGER');
  const summary = await manager.summary(); assertDistribution(summary);
  assert.equal(summary.completed, 12); assert.equal(summary.distribution.TIED, 0);
  for (const code of PROFILE_CODES) assert.equal(summary.distribution[code], 1);
  // The fixed order of the remaining two dimensions gives nonuniform lower ranks.
  assert.deepEqual(summary.means, { D: 462 / 12, I: 434 / 12, S: 406 / 12, C: 378 / 12 });
});

test('analytics is manager-only and permission is checked on every existing session', async () => {
  const record = await fixture('Fictional pending');
  assert.equal((await new Browser().request('/api/manager/summary')).status, 401);
  const facilitator = new Browser(); await facilitator.login('FACILITATOR');
  assert.equal((await facilitator.request('/api/manager/summary')).status, 403);
  const participant = new Browser(); await participant.request('/api/invitations/redeem', { token: record.token });
  assert.equal((await participant.request('/api/manager/summary')).status, 403);
  assert.equal((await participant.request('/api/participants')).status, 403);
  const manager = new Browser(); await manager.login('MANAGER'); await manager.summary();
  await db.staffUser.update({ where: { email: users.MANAGER_SEED_EMAIL }, data: { role: 'FACILITATOR' } });
  try { assert.equal((await manager.request('/api/manager/summary')).status, 403); }
  finally { await db.staffUser.update({ where: { email: users.MANAGER_SEED_EMAIL }, data: { role: 'MANAGER' } }); }
});

test('both staff roles create persisted invitations; only the creation response exposes the link', async () => {
  const tokens: string[] = [];
  for (const role of ['FACILITATOR', 'MANAGER'] as const) {
    const staff = new Browser(); await staff.login(role);
    const created = await staff.request('/api/participants', { name: `Fictional ${role} invitation`, email: null });
    assert.equal(created.status, 201); const body = await created.json();
    const token = new URL(body.invitationUrl).pathname.split('/').at(-1)!; tokens.push(token);
    const persisted = await db.participant.findUniqueOrThrow({ where: { id: body.participant.id } });
    assert.equal(persisted.inviteTokenHash, inviteHash(token)); assert.ok(persisted.inviteExpiresAt > new Date());
    assert.equal(persisted.status, 'INVITED');
  }
  const manager = new Browser(); await manager.login('MANAGER');
  const summary = await manager.summary(); assert.equal(summary.totalInvited, 2); assert.equal(summary.pending, 2);
  for (const token of tokens) assert.equal(JSON.stringify(summary).includes(token), false);
});

test('a completion committed during a blocked summary read cannot mix counts, rows or means', async () => {
  const invited = await sixPeople();
  const manager = new Browser(); await manager.login('MANAGER');
  let release!: () => void; let ready!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const locked = new Promise<void>(resolve => { ready = resolve; });
  const writer = db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`LOCK TABLE "${schema}"."Result" IN ACCESS EXCLUSIVE MODE`);
    await complete(tx, invited.participant.id, order(['D', 'I', 'S', 'C']));
    ready(); await gate;
  }, { timeout: 15000 });
  await locked;
  const reading = manager.summary();
  try {
    let waiting = false;
    const deadline = Date.now() + 5000;
    while (!waiting && Date.now() < deadline) {
      const rows = await pool.query(`SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE $1`, [`%"${schema}"."Result"%`]);
      waiting = rows.rowCount !== 0;
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting, 'The real HTTP cohort read must be blocked behind the Result table lock');
  } finally { release(); await writer; }
  const snapshot = await reading; assertDistribution(snapshot);
  assert.equal(snapshot.completed, 4); assert.equal(snapshot.pending, 2);
  assert.deepEqual(snapshot.means, { D: 40.25, I: 40.25, S: 31.5, C: 28 });
  const previous = snapshot.participants.find((p: { id: string }) => p.id === invited.participant.id);
  assert.equal(previous.status, 'INVITED'); assert.equal(previous.result, null);
  const next = await manager.summary(); assertDistribution(next);
  assert.equal(next.completed, 5); assert.equal(next.pending, 1); assert.equal(next.distribution.DI, 2);
});
