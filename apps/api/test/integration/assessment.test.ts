import '../../../../scripts/load-env.mjs';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client.ts';
import { createApp, inviteHash } from '../../src/app.ts';
import { getSecurityConfig } from '../../src/env.ts';
import { scoreAssessment, type Answer, type AssessmentScores } from '../../src/domain/scoring.ts';
import { seed, order, mixed, visibleProfiles } from '../helpers/assessment.ts';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('Set TEST_DATABASE_URL for real PostgreSQL assessment tests.');
const schema = `disc_test_${randomBytes(8).toString('hex')}`;
const admin = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 3, connectionTimeoutMillis: 5000 });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}`, application_name: schema, max: 8 }, { schema }) });
const config = getSecurityConfig({ SESSION_SECRET: randomBytes(48).toString('base64url'), PUBLIC_APP_URL: 'http://localhost:3000' });
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let origin: string;

class ParticipantBrowser {
  constructor(id: string, cookie: string) { this.id = id; this.cookie = cookie; }
  readonly id: string;
  readonly cookie: string;
  async request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(origin + path, { method, headers: {
      Cookie: this.cookie,
      ...(method === 'GET' ? {} : { Origin: config.appOrigin, 'Content-Type': 'application/json' }), ...headers,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response;
  }
  save(answer: Answer) { return this.request(`/api/assessment/answers/${answer.groupId}`, 'PUT', { rankedWordIds: answer.rankedWordIds }); }
  submit() { return this.request('/api/assessment/submit', 'POST', {}); }
}

async function participant() {
  const token = randomBytes(32).toString('base64url');
  const row = await db.participant.create({ data: {
    name: 'Fictional phase four participant', inviteTokenHash: inviteHash(token), inviteExpiresAt: new Date(Date.now() + 3600000),
    assessmentVersion: seed.assessmentVersion, scoringPolicyVersion: seed.scoringPolicyVersion, profileTextPolicyVersion: seed.profileTextPolicyVersion,
  } });
  const response = await fetch(origin + '/api/invitations/redeem', { method: 'POST', headers: { Origin: config.appOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.equal(response.status, 200);
  return new ParticipantBrowser(row.id, response.headers.get('set-cookie')!.split(';')[0]!);
}

async function saveAll(browser: ParticipantBrowser, answers = order(['D', 'I', 'S', 'C'])) {
  for (const answer of answers) assert.equal((await browser.save(answer)).status, 200);
}

async function assertStored(browser: ParticipantBrowser, expected: AssessmentScores) {
  const participant = await db.participant.findUniqueOrThrow({ where: { id: browser.id }, include: { result: true } });
  assert.equal(participant.status, 'COMPLETED');
  assert.ok(participant.completedAt); assert.ok(participant.result);
  assert.deepEqual(participant.completedAt, participant.result.completedAt);
  assert.equal(await db.result.count({ where: { participantId: browser.id } }), 1);
  const { result } = await (await browser.request('/api/assessment/result')).json();
  for (const key of ['scores', 'profileStatus', 'profileCode', 'scoreRanking', 'tiedScoreGroups', 'candidateProfileCodes', 'candidateProfiles', 'assessmentVersion', 'scoringPolicyVersion', 'profileTextPolicyVersion'] as const) {
    assert.deepEqual(result[key], key === 'candidateProfiles' ? visibleProfiles(expected.candidateProfiles) : expected[key]);
  }
  return result;
}

async function holdParent(id: string) {
  const connection = await admin.connect();
  await connection.query('BEGIN');
  await connection.query('SELECT id FROM "Participant" WHERE id = $1 FOR UPDATE', [id]);
  return async () => { await connection.query('COMMIT'); connection.release(); };
}

async function waitForBlocked(count: number) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const rows = await admin.query<{ count: string }>(`SELECT count(*) FROM pg_stat_activity
      WHERE application_name = $1 AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'`, [schema]);
    if (Number(rows.rows[0]!.count) >= count) return;
    await setTimeout(15);
  }
  assert.fail(`Expected ${count} actual PostgreSQL lock waiters`);
}

before(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(readFileSync(new URL('../../prisma/migrations/202610160001_phase3_access/migration.sql', import.meta.url), 'utf8'));
  server = createApp({ db, config }).listen(0, '127.0.0.1');
  if (!server.listening) await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); });
  await db.$disconnect();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
});

test('GET returns only public word fields and own confirmed rows; untouched defaults are not answers', async () => {
  const first = await participant(); const second = await participant();
  const response = await first.request('/api/assessment');
  assert.equal(response.status, 200);
  const initial = await response.json();
  assert.deepEqual(Object.keys(initial).sort(), ['answers', 'assessmentVersion', 'groups', 'status']);
  assert.equal(initial.groups.length, 14); assert.deepEqual(initial.answers, []);
  for (const group of initial.groups) {
    assert.deepEqual(Object.keys(group).sort(), ['id', 'sequence', 'words']);
    assert.equal(group.words.length, 4);
    for (const word of group.words) assert.deepEqual(Object.keys(word).sort(), ['id', 'textAr', 'textEn']);
  }
  assert.equal(await db.answer.count({ where: { participantId: first.id } }), 0);
  const defaultAnswer = { groupId: seed.groups[0]!.id, rankedWordIds: seed.groups[0]!.words.map(word => word.id) };
  const savedResponse = await first.save(defaultAnswer);
  assert.equal(savedResponse.status, 200);
  const saved = (await savedResponse.json()).answer;
  assert.deepEqual(saved.rankedWordIds, defaultAnswer.rankedWordIds); assert.ok(saved.confirmedAt);
  assert.equal(await db.answer.count({ where: { participantId: first.id } }), 1);
  assert.equal((await first.save(defaultAnswer)).status, 200);
  assert.equal(await db.answer.count({ where: { participantId: first.id } }), 1);
  const resumed = await (await first.request(`/api/assessment?participantId=${second.id}`)).json();
  assert.equal(resumed.answers.length, 1); assert.deepEqual(resumed.answers[0].rankedWordIds, defaultAnswer.rankedWordIds);
  assert.deepEqual((await (await second.request('/api/assessment')).json()).answers, []);
  assert.equal((await first.submit()).status, 409);
  assert.equal((await db.participant.findUniqueOrThrow({ where: { id: first.id } })).status, 'IN_PROGRESS');
});

test('PUT rejects invalid/foreign permutations and client-supplied identity, points or scores', async () => {
  const browser = await participant();
  const answer = order(['D', 'I', 'S', 'C'])[0]!;
  for (const rankedWordIds of [null, [], answer.rankedWordIds.slice(0, 3), [...answer.rankedWordIds, 'extra'], Array(4).fill(answer.rankedWordIds[0]), order(['D', 'I', 'S', 'C'])[1]!.rankedWordIds]) {
    assert.equal((await browser.request(`/api/assessment/answers/${answer.groupId}`, 'PUT', { rankedWordIds })).status, 400);
  }
  assert.equal((await browser.save({ ...answer, groupId: 'unknown' })).status, 400);
  for (const extra of [{ participantId: browser.id }, { scores: {} }, { confirmedAt: new Date().toISOString() }, { points: [4, 3, 2, 1] }]) {
    assert.equal((await browser.request(`/api/assessment/answers/${answer.groupId}`, 'PUT', { rankedWordIds: answer.rankedWordIds, ...extra })).status, 400);
  }
  assert.equal((await browser.request('/api/assessment/submit', 'POST', { scores: { D: 56 } })).status, 400);
  assert.equal((await browser.save(answer)).status, 200);
  const withoutOrigin = await fetch(origin + `/api/assessment/answers/${answer.groupId}`, { method: 'PUT', headers: { Cookie: browser.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ rankedWordIds: answer.rankedWordIds }) });
  assert.equal(withoutOrigin.status, 403);
  const anonymous = await fetch(origin + '/api/assessment/submit', { method: 'POST', headers: { Origin: config.appOrigin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(anonymous.status, 401);
});

test('failed answer write rolls back and retry saves the same edited order; fresh GET resumes it', async () => {
  const browser = await participant();
  const original = order(['C', 'D', 'S', 'I'])[0]!;
  const edited = order(['I', 'S', 'D', 'C'])[0]!;
  await browser.save(original);
  await admin.query(`CREATE FUNCTION test_fail_answer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test save failure'; END; $$`);
  await admin.query('CREATE TRIGGER test_fail_answer BEFORE INSERT OR UPDATE ON "Answer" FOR EACH ROW EXECUTE FUNCTION test_fail_answer()');
  try {
    const response = await browser.save(edited);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Internal server error.' });
    assert.deepEqual((await db.answer.findUniqueOrThrow({ where: { participantId_groupId: { participantId: browser.id, groupId: edited.groupId } } })).rankedWordIds, original.rankedWordIds);
  } finally {
    await admin.query('DROP TRIGGER test_fail_answer ON "Answer"');
    await admin.query('DROP FUNCTION test_fail_answer()');
  }
  assert.equal((await browser.save(edited)).status, 200);
  const resumed = await (await browser.request('/api/assessment')).json();
  assert.deepEqual(resumed.answers[0].rankedWordIds, edited.rankedWordIds);
  assert.equal(resumed.answers.length, 1);
});

test('submit waits for the last confirmed group and validates the exact 14 saved groups', async () => {
  const browser = await participant();
  const answers = order(['D', 'I', 'S', 'C']);
  for (const answer of answers.slice(0, -1)) await browser.save(answer);
  assert.equal((await browser.submit()).status, 409);
  assert.equal(await db.result.count({ where: { participantId: browser.id } }), 0);
  await browser.save(answers.at(-1)!);
  await db.answer.update({ where: { participantId_groupId: { participantId: browser.id, groupId: answers[0]!.groupId } }, data: { rankedWordIds: answers[1]!.rankedWordIds as string[] } });
  assert.equal((await browser.submit()).status, 409);
  assert.equal(await db.result.count({ where: { participantId: browser.id } }), 0);
  await browser.save(answers[0]!);
  assert.equal((await browser.submit()).status, 200);
  await assertStored(browser, scoreAssessment(seed, answers));
});

for (const [name, answers] of [
  ['SINGLE', order(['C', 'D', 'S', 'I'])],
  ['first-place TIED', mixed(['D', 'I', 'S', 'C'], ['I', 'D', 'S', 'C'])],
  ['second-place TIED', mixed(['D', 'I', 'S', 'C'], ['D', 'S', 'I', 'C'])],
  ['all-four TIED', mixed(['D', 'I', 'S', 'C'], ['C', 'S', 'I', 'D'])],
  ['lower-score-only tie', mixed(['D', 'I', 'S', 'C'], ['D', 'I', 'C', 'S'])],
] as const) {
  test(`completion stores ${name} with exact source snapshots and rejects later edits`, async () => {
    const browser = await participant(); await saveAll(browser, answers);
    const response = await browser.submit(); assert.equal(response.status, 200);
    const result = await assertStored(browser, scoreAssessment(seed, answers));
    assert.deepEqual((await response.json()).result, result);
    assert.equal((await browser.save(answers[0]!)).status, 409);
    for (let i = 0; i < 2; i++) assert.deepEqual((await (await browser.submit()).json()).result, result);
    assert.deepEqual(await (await browser.request('/api/assessment')).json(), { status: 'COMPLETED', redirectTo: '/result' });
  });
}

test('concurrent submits block on the same parent row and return one identical result', async () => {
  const browser = await participant(); await saveAll(browser);
  const release = await holdParent(browser.id);
  const responses = Array.from({ length: 8 }, () => browser.submit());
  try { await waitForBlocked(2); } finally { await release(); }
  const bodies = await Promise.all(responses.map(async response => { const r = await response; assert.equal(r.status, 200); return r.json(); }));
  for (const body of bodies) assert.deepEqual(body, bodies[0]);
  await assertStored(browser, scoreAssessment(seed, order(['D', 'I', 'S', 'C'])));
});

test('answer queued before submit commits its edited order before scoring', async () => {
  const browser = await participant(); const answers = order(['D', 'I', 'S', 'C']); await saveAll(browser, answers);
  const changed = order(['C', 'S', 'I', 'D'])[0]!;
  const release = await holdParent(browser.id);
  let save!: Promise<Response>; let submit!: Promise<Response>;
  try {
    save = browser.save(changed); await waitForBlocked(1);
    submit = browser.submit(); await waitForBlocked(2);
  } finally { await release(); }
  assert.equal((await save).status, 200); assert.equal((await submit).status, 200);
  await assertStored(browser, scoreAssessment(seed, [changed, ...answers.slice(1)]));
});

test('submit queued before answer freezes the old order and rejects the late write', async () => {
  const browser = await participant(); const answers = order(['D', 'I', 'S', 'C']); await saveAll(browser, answers);
  const release = await holdParent(browser.id);
  let submit!: Promise<Response>; let save!: Promise<Response>;
  try {
    submit = browser.submit(); await waitForBlocked(1);
    save = browser.save(order(['C', 'S', 'I', 'D'])[0]!); await waitForBlocked(2);
  } finally { await release(); }
  assert.equal((await submit).status, 200); assert.equal((await save).status, 409);
  await assertStored(browser, scoreAssessment(seed, answers));
});

test('failed result insertion rolls back completion; retry completes exactly once', async () => {
  const browser = await participant(); await saveAll(browser);
  await admin.query(`CREATE FUNCTION test_fail_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test completion failure'; END; $$`);
  await admin.query('CREATE TRIGGER test_fail_result BEFORE INSERT ON "Result" FOR EACH ROW EXECUTE FUNCTION test_fail_result()');
  try {
    assert.equal((await browser.submit()).status, 500);
    const row = await db.participant.findUniqueOrThrow({ where: { id: browser.id } });
    assert.equal(row.status, 'IN_PROGRESS'); assert.equal(row.completedAt, null);
    assert.equal(await db.answer.count({ where: { participantId: browser.id } }), 14);
    assert.equal(await db.result.count({ where: { participantId: browser.id } }), 0);
  } finally { await admin.query('DROP TRIGGER test_fail_result ON "Result"'); await admin.query('DROP FUNCTION test_fail_result()'); }
  assert.equal((await browser.submit()).status, 200);
  await assertStored(browser, scoreAssessment(seed, order(['D', 'I', 'S', 'C'])));
});

test('retry of an older completed snapshot needs neither current policies nor saved answers', async () => {
  const browser = await participant();
  const scored = scoreAssessment(seed, mixed(['D', 'I', 'S', 'C'], ['I', 'D', 'S', 'C']));
  const completedAt = new Date();
  const versions = { assessmentVersion: 'previous-assessment', scoringPolicyVersion: 'previous-scoring', profileTextPolicyVersion: 'previous-text' };
  await db.$transaction(async tx => {
    await tx.result.create({ data: {
      participantId: browser.id, scoreD: scored.scores.D, scoreI: scored.scores.I, scoreS: scored.scores.S, scoreC: scored.scores.C,
      scoreRanking: scored.scoreRanking as Prisma.InputJsonValue, tiedScoreGroups: scored.tiedScoreGroups as Prisma.InputJsonValue,
      profileStatus: scored.profileStatus, profileCode: scored.profileCode, candidateProfileCodes: scored.candidateProfileCodes,
      candidateProfiles: scored.candidateProfiles as unknown as Prisma.InputJsonValue, completedAt, ...versions,
    } });
    await tx.participant.update({ where: { id: browser.id }, data: { status: 'COMPLETED', completedAt, ...versions } });
  });
  assert.equal(await db.answer.count({ where: { participantId: browser.id } }), 0);
  const stored = (await (await browser.request('/api/assessment/result')).json()).result;
  assert.deepEqual((await (await browser.submit()).json()).result, stored);
  assert.equal(stored.profileStatus, 'TIED'); assert.equal(stored.assessmentVersion, versions.assessmentVersion);
  assert.equal((await browser.save(order(['D', 'I', 'S', 'C'])[0]!)).status, 409);
});
