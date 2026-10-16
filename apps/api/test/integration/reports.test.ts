import '../../../../scripts/load-env.mjs';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
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
import { scoreAssessment, type Answer } from '../../src/domain/scoring.ts';
import { seed, order, mixed, visibleProfiles } from '../helpers/assessment.ts';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('Set TEST_DATABASE_URL for real stored-report tests.');
const schema = `disc_test_${randomBytes(8).toString('hex')}`;
const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 1 });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}`, max: 5 }, { schema }) });
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
}

async function fixture(answers?: Answer[], legacy = false) {
  const token = randomBytes(32).toString('base64url');
  const versions = legacy ? { assessmentVersion: 'previous-assessment', scoringPolicyVersion: 'previous-scoring', profileTextPolicyVersion: 'previous-text' }
    : { assessmentVersion: seed.assessmentVersion, scoringPolicyVersion: seed.scoringPolicyVersion, profileTextPolicyVersion: seed.profileTextPolicyVersion };
  const participant = await db.participant.create({ data: {
    name: 'Fictional report participant', inviteTokenHash: inviteHash(token), inviteExpiresAt: new Date(Date.now() + 3600000), ...versions,
  } });
  if (!answers) return { participant, token, expected: null };
  const scored = scoreAssessment(seed, answers);
  const completedAt = new Date();
  await db.$transaction(async tx => {
    await tx.result.create({ data: {
      participantId: participant.id, scoreD: scored.scores.D, scoreI: scored.scores.I, scoreS: scored.scores.S, scoreC: scored.scores.C,
      scoreRanking: scored.scoreRanking as Prisma.InputJsonValue, tiedScoreGroups: scored.tiedScoreGroups as Prisma.InputJsonValue,
      profileStatus: scored.profileStatus, profileCode: scored.profileCode, candidateProfileCodes: scored.candidateProfileCodes,
      candidateProfiles: scored.candidateProfiles as unknown as Prisma.InputJsonValue, completedAt, ...versions,
    } });
    await tx.participant.update({ where: { id: participant.id }, data: { status: 'COMPLETED', startedAt: completedAt, completedAt } });
  });
  return { participant, token, expected: {
    scores: scored.scores, totalPoints: scored.totalPoints, scoreRanking: scored.scoreRanking, tiedScoreGroups: scored.tiedScoreGroups,
    profileStatus: scored.profileStatus, profileCode: scored.profileCode, candidateProfileCodes: scored.candidateProfileCodes,
    candidateProfiles: visibleProfiles(scored.candidateProfiles), completedAt: completedAt.toISOString(), ...versions,
  } };
}

before(async () => {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(readFileSync(new URL('../../prisma/migrations/202610160001_phase3_access/migration.sql', import.meta.url), 'utf8'));
  await seedStaff(db, users);
  server = createApp({ db, config }).listen(0, '127.0.0.1');
  if (!server.listening) await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); });
  await db.$disconnect();
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
});

for (const [name, answers] of [
  ['DI', order(['D', 'I', 'S', 'C'])], ['ID', order(['I', 'D', 'S', 'C'])],
  ['DI/ID', mixed(['D', 'I', 'S', 'C'], ['I', 'D', 'S', 'C'])],
  ['DI/DS', mixed(['D', 'I', 'S', 'C'], ['D', 'S', 'I', 'C'])],
  ['all-four tie', mixed(['D', 'I', 'S', 'C'], ['C', 'S', 'I', 'D'])],
  ['lower-only tie', mixed(['D', 'I', 'S', 'C'], ['D', 'I', 'C', 'S'])],
] as const) {
  test(`participant and both staff roles receive the same stored ${name} report and source slogans`, async () => {
    const record = await fixture(answers);
    const before = await db.result.findUniqueOrThrow({ where: { participantId: record.participant.id } });
    const participant = new Browser();
    assert.equal((await participant.request('/api/invitations/redeem', { token: record.token })).status, 200);
    const own = await participant.request('/api/assessment/result');
    assert.equal(own.status, 200); assert.deepEqual((await own.json()).result, record.expected);
    for (const role of ['FACILITATOR', 'MANAGER'] as const) {
      const staff = new Browser(); await staff.login(role);
      const response = await staff.request(`/api/participants/${record.participant.id}/report`);
      assert.equal(response.status, 200);
      const report = await response.json();
      assert.equal(report.participant.status, 'COMPLETED'); assert.deepEqual(report.result, record.expected);
      for (const candidate of report.result.candidateProfiles) {
        const source = seed.profiles.find(profile => profile.code === candidate.code)!;
        assert.equal(candidate.nameAr, source.labelAr); assert.equal(candidate.descriptionAr, source.labelAr);
        assert.equal(candidate.descriptionEn, null);
      }
    }
    assert.deepEqual(await db.result.findUniqueOrThrow({ where: { participantId: record.participant.id } }), before);
    assert.equal(await db.answer.count({ where: { participantId: record.participant.id } }), 0, 'Reports read snapshots without needing/re-scoring answers');
  });
}

test('pending invitations and in-progress assessments return clear pending responses without scores', async () => {
  const record = await fixture();
  for (const role of ['FACILITATOR', 'MANAGER'] as const) {
    const staff = new Browser(); await staff.login(role);
    const response = await staff.request(`/api/participants/${record.participant.id}/report`);
    assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: 'Assessment is not completed.' });
  }
  const participant = new Browser(); await participant.request('/api/invitations/redeem', { token: record.token });
  const response = await participant.request('/api/assessment/result');
  assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: 'Assessment is not completed.' });
  assert.equal(await db.result.count({ where: { participantId: record.participant.id } }), 0);
});

test('own-result selection ignores foreign IDs; staff reports require staff before disclosing existence', async () => {
  const first = await fixture(order(['D', 'I', 'S', 'C']));
  const second = await fixture(order(['I', 'D', 'S', 'C']));
  const anonymous = new Browser();
  assert.equal((await anonymous.request('/api/assessment/result')).status, 401);
  assert.equal((await anonymous.request(`/api/participants/${first.participant.id}/report`)).status, 401);
  const participant = new Browser(); await participant.request('/api/invitations/redeem', { token: first.token });
  assert.deepEqual((await (await participant.request(`/api/assessment/result?participantId=${second.participant.id}`)).json()).result, first.expected);
  for (const id of [first.participant.id, second.participant.id, randomUUID()]) assert.equal((await participant.request(`/api/participants/${id}/report`)).status, 403);
  for (const role of ['FACILITATOR', 'MANAGER'] as const) {
    const staff = new Browser(); await staff.login(role);
    assert.equal((await staff.request('/api/assessment/result')).status, 403);
    assert.equal((await staff.request(`/api/participants/${randomUUID()}/report`)).status, 404);
  }
});

test('old pinned snapshots are served unchanged even when their assessment/policies are unavailable', async () => {
  const record = await fixture(mixed(['D', 'I', 'S', 'C'], ['I', 'D', 'S', 'C']), true);
  const participant = new Browser();
  assert.equal((await participant.request('/api/invitations/redeem', { token: record.token })).status, 200);
  assert.deepEqual((await (await participant.request('/api/assessment/result')).json()).result, record.expected);
  const staff = new Browser(); await staff.login('MANAGER');
  assert.deepEqual((await (await staff.request(`/api/participants/${record.participant.id}/report`)).json()).result, record.expected);
});
