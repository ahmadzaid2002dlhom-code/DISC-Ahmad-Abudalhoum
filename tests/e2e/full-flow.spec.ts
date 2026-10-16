import assert from 'node:assert/strict';
import { mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect, type Browser, type BrowserContext, type Page, type APIResponse } from '@playwright/test';
import pg from 'pg';
import { seed } from '../../apps/api/test/helpers/assessment.ts';
import type { Dimension } from '../../apps/api/src/domain/scoring.ts';

test.describe.configure({ mode: 'serial' });
const evidence = resolve('artifacts/phase7');
if (!process.env.E2E_DATABASE_URL || !process.env.E2E_BASE_URL) throw new Error('Use npm run test:e2e to provision an isolated test database.');
const pool = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL, max: 3 });
const baseURL = process.env.E2E_BASE_URL!;
const contexts: BrowserContext[] = [];
const cacheViolations: string[] = [];
const consoleErrors: string[] = [];
test.afterAll(async () => { for (const context of contexts) await context.close(); await pool.end(); });

async function context(browser: Browser, mobile = false) {
  const value = await browser.newContext({ baseURL, viewport: mobile ? { width: 375, height: 812 } : { width: 1280, height: 900 } });
  contexts.push(value);
  value.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === baseURL && url.pathname.startsWith('/api/') && response.headers()['cache-control'] !== 'no-store') cacheViolations.push(url.pathname);
  });
  value.on('page', page => page.on('pageerror', error => consoleErrors.push(error.message)));
  return value;
}
async function checked(response: APIResponse, status: number) {
  expect(response.status()).toBe(status); expect(response.headers()['cache-control']).toBe('no-store');
  return response;
}
async function login(page: Page, role: 'facilitator' | 'manager') {
  await page.goto('/login'); await page.getByLabel('Email', { exact: true }).fill(`${role}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(`fictional-${role}-password`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText(`${role}@example.test (${role.toUpperCase()})`, { exact: false })).toBeVisible();
}
async function invite(staff: BrowserContext, name: string) {
  const response = await checked(await staff.request.post('/api/participants', { headers: { Origin: baseURL }, data: { name } }), 201);
  return await response.json() as { participant: { id: string }; invitationUrl: string };
}
async function row(id: string) {
  const result = await pool.query('SELECT p.status, count(a.*)::int AS answers, count(DISTINCT r.id)::int AS results FROM "Participant" p LEFT JOIN "Answer" a ON a."participantId"=p.id LEFT JOIN "Result" r ON r."participantId"=p.id WHERE p.id=$1 GROUP BY p.id', [id]);
  return result.rows[0] as { status: string; answers: number; results: number };
}
const wordRows = (page: Page) => page.getByRole('list', { name: 'Words from most to least like you', exact: true }).getByRole('listitem');
async function orderOnScreen(page: Page) {
  return (await wordRows(page).locator('strong').allTextContents()).map(text => text.replace(/^\d+\. /, ''));
}
async function rank(page: Page, groupIndex: number, dimensions: readonly Dimension[]) {
  const names = dimensions.map(d => seed.groups[groupIndex]!.words.find(w => w.dimension === d)!.textEn);
  for (const [target, name] of names.entries()) {
    let index = (await orderOnScreen(page)).indexOf(name);
    while (index > target) {
      await page.getByRole('button', { name: `Move ${name} up`, exact: true }).press('Enter');
      await expect.poll(async () => (await orderOnScreen(page)).indexOf(name)).toBe(index - 1);
      index--;
    }
  }
  await expect.poll(() => orderOnScreen(page)).toEqual(names);
}
async function fault(id: string, groupId: string, enabled: boolean) {
  if (enabled) await pool.query('INSERT INTO "E2EFailure" VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, groupId]);
  else await pool.query('DELETE FROM "E2EFailure" WHERE "participantId"=$1 AND "groupId"=$2', [id, groupId]);
}
async function capture(page: Page, name: string) {
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, name), fullPage: true, type: 'jpeg' });
}
function publicResult(result: { candidateProfiles: Record<string, unknown>[] }) {
  for (const candidate of result.candidateProfiles) expect(Object.keys(candidate).sort()).toEqual(['code', 'descriptionAr', 'descriptionEn', 'nameAr']);
}

test('isolated staff and two mobile participant contexts complete SINGLE/TIED, failures, resume and reports', async ({ browser }) => {
  const staff = await context(browser); const manager = await context(browser);
  const alice = await context(browser, true); const bob = await context(browser, true);
  const staffPage = await staff.newPage(); const managerPage = await manager.newPage();
  const alicePage = await alice.newPage(); const bobPage = await bob.newPage();
  await login(staffPage, 'facilitator'); await login(managerPage, 'manager');
  await checked(await staff.request.get('/api/manager/summary'), 403);
  await checked(await alice.request.get('/api/auth/me'), 401);
  await pool.query('CREATE TABLE "E2EFailure" ("participantId" uuid, "groupId" text, PRIMARY KEY ("participantId","groupId"))');
  await pool.query(`CREATE FUNCTION e2e_fail_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF EXISTS (SELECT 1 FROM "E2EFailure" f WHERE f."participantId"=NEW."participantId" AND f."groupId"=NEW."groupId") THEN RAISE EXCEPTION 'fictional E2E failure'; END IF; RETURN NEW; END $$`);
  await pool.query('CREATE TRIGGER e2e_fail_save BEFORE INSERT OR UPDATE ON "Answer" FOR EACH ROW EXECUTE FUNCTION e2e_fail_save()');
  const single = await invite(staff, 'Fictional E2E single'); const tied = await invite(staff, 'Fictional E2E tied');
  await alicePage.goto(single.invitationUrl);
  expect(await row(single.participant.id)).toEqual({ status: 'INVITED', answers: 0, results: 0 });
  await checked(await alice.request.get('/api/auth/me'), 401);
  const assessmentResponse = alicePage.waitForResponse(r => new URL(r.url()).pathname === '/api/assessment' && r.request().method() === 'GET');
  await alicePage.getByRole('button', { name: 'Start or continue', exact: true }).click();
  await expect(alicePage).toHaveURL(`${baseURL}/assessment`);
  const assessment = await (await assessmentResponse).json();
  expect(assessment.groups).toHaveLength(14); expect(assessment.answers).toEqual([]);
  for (const group of assessment.groups) {
    expect(Object.keys(group).sort()).toEqual(['id', 'sequence', 'words']);
    for (const word of group.words) expect(Object.keys(word).sort()).toEqual(['id', 'textAr', 'textEn']);
  }
  for (const ids of [[], seed.groups[0]!.words.slice(0, 3).map(w => w.id), Array(4).fill(seed.groups[0]!.words[0]!.id), seed.groups[1]!.words.map(w => w.id)]) {
    await checked(await alice.request.put('/api/assessment/answers/g01', { headers: { Origin: baseURL }, data: { rankedWordIds: ids } }), 400);
  }
  await checked(await alice.request.post('/api/assessment/submit', { headers: { Origin: baseURL }, data: {} }), 409);
  await expect(alicePage.getByRole('heading', { name: 'Group 1 of 14', exact: true })).toBeVisible();
  const firstNames = await orderOnScreen(alicePage);
  await alicePage.getByRole('button', { name: `Move ${firstNames[1]} up`, exact: true }).press('Enter');
  await expect.poll(() => orderOnScreen(alicePage)).not.toEqual(firstNames);
  const handles = alicePage.getByRole('button', { name: /^Drag .* to reorder$/ });
  const from = (await handles.nth(0).boundingBox())!; const to = (await handles.nth(2).boundingBox())!;
  const beforeDrag = await orderOnScreen(alicePage);
  await alicePage.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await alicePage.mouse.down();
  await alicePage.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 }); await alicePage.mouse.up();
  await expect(alicePage.getByRole('status').filter({ hasText: `${beforeDrag[0]} moved to position 3.` })).toBeVisible();
  await expect.poll(() => orderOnScreen(alicePage)).not.toEqual(beforeDrag);
  await expect(wordRows(alicePage)).toHaveCount(4);
  expect(await wordRows(alicePage).locator('strong').allTextContents())
    .toEqual((await orderOnScreen(alicePage)).map((name, index) => `${index + 1}. ${name}`));
  await rank(alicePage, 0, ['D', 'I', 'S', 'C']);
  const edited = await orderOnScreen(alicePage);
  await fault(single.participant.id, 'g01', true);
  await alicePage.getByRole('button', { name: 'Next — confirm and save', exact: true }).click();
  await expect(alicePage.getByRole('main').getByRole('alert')).toContainText('Your order has been kept');
  expect(await orderOnScreen(alicePage)).toEqual(edited); expect((await row(single.participant.id)).answers).toBe(0);
  await capture(alicePage, 'failed-save-mobile.jpg');
  await fault(single.participant.id, 'g01', false);
  await alicePage.getByRole('button', { name: 'Retry confirmation', exact: true }).click();
  await expect(alicePage.getByRole('heading', { name: 'Group 2 of 14', exact: true })).toBeVisible();
  await alicePage.reload(); await expect(alicePage.getByRole('heading', { name: 'Group 2 of 14', exact: true })).toBeVisible();
  await alicePage.getByRole('button', { name: 'Back', exact: true }).click(); expect(await orderOnScreen(alicePage)).toEqual(edited);
  await alicePage.getByRole('button', { name: 'Next — confirm and save', exact: true }).click();
  for (let index = 1; index < 13; index++) {
    await expect(alicePage.getByRole('heading', { name: `Group ${index + 1} of 14`, exact: true })).toBeVisible();
    await rank(alicePage, index, ['D', 'I', 'S', 'C']);
    await alicePage.getByRole('button', { name: 'Next — confirm and save', exact: true }).click();
  }
  await expect(alicePage.getByRole('heading', { name: 'Group 14 of 14', exact: true })).toBeVisible();
  expect((await row(single.participant.id)).answers).toBe(13);
  await expect(alicePage.getByRole('button', { name: 'Submit assessment', exact: true })).toBeDisabled();
  await rank(alicePage, 13, ['D', 'I', 'S', 'C']); await fault(single.participant.id, 'g14', true);
  await alicePage.getByRole('button', { name: 'Confirm last group', exact: true }).click();
  await expect(alicePage.getByRole('main').getByRole('alert')).toBeVisible(); expect((await row(single.participant.id)).answers).toBe(13);
  await fault(single.participant.id, 'g14', false);
  await alicePage.getByRole('button', { name: 'Retry confirmation', exact: true }).click();
  await expect(alicePage.getByRole('button', { name: 'Submit assessment', exact: true })).toBeEnabled();
  await fault(single.participant.id, 'g14', true);
  await alicePage.getByRole('button', { name: 'Submit assessment', exact: true }).click();
  await expect(alicePage.getByRole('main').getByRole('alert')).toBeVisible();
  expect(await row(single.participant.id)).toEqual({ status: 'IN_PROGRESS', answers: 14, results: 0 });
  await capture(alicePage, 'failed-final-flush.jpg');
  await fault(single.participant.id, 'g14', false);
  await alicePage.getByRole('button', { name: 'Submit assessment', exact: true }).click();
  await expect(alicePage.getByRole('heading', { name: 'SINGLE — DI', exact: true })).toBeVisible();
  expect(await row(single.participant.id)).toEqual({ status: 'COMPLETED', answers: 14, results: 1 });
  await capture(alicePage, 'single-result-mobile.jpg');
  await bobPage.goto(tied.invitationUrl); await bobPage.getByRole('button', { name: 'Start or continue', exact: true }).click();
  for (let index = 0; index < 14; index++) {
    await expect(bobPage.getByRole('heading', { name: `Group ${index + 1} of 14`, exact: true })).toBeVisible();
    await rank(bobPage, index, index < 7 ? ['D', 'I', 'S', 'C'] : ['I', 'D', 'S', 'C']);
    await bobPage.getByRole('button', { name: index === 13 ? 'Confirm last group' : 'Next — confirm and save', exact: true }).click();
  }
  await expect(bobPage.getByRole('button', { name: 'Submit assessment', exact: true })).toBeEnabled();
  const concurrent = Promise.all(Array.from({ length: 8 }, () => bob.request.post('/api/assessment/submit', { headers: { Origin: baseURL }, data: {} })));
  await bobPage.getByRole('button', { name: 'Submit assessment', exact: true }).click();
  for (const response of await concurrent) { const result = (await (await checked(response, 200)).json()).result; publicResult(result); expect(result.profileStatus).toBe('TIED'); expect(result.profileCode).toBeNull(); }
  await expect(bobPage.getByRole('heading', { name: 'TIED — 2 candidate profiles', exact: true })).toBeVisible();
  expect(await row(tied.participant.id)).toEqual({ status: 'COMPLETED', answers: 14, results: 1 });
  await capture(bobPage, 'tied-result-mobile.jpg');
  const frozen = (await pool.query('SELECT * FROM "Result" WHERE "participantId"=$1', [tied.participant.id])).rows[0];
  await checked(await bob.request.put('/api/assessment/answers/g01', { headers: { Origin: baseURL }, data: { rankedWordIds: seed.groups[0]!.words.map(w => w.id) } }), 409);
  await expect(pool.query('UPDATE "Result" SET "scoreD"=50 WHERE "participantId"=$1', [tied.participant.id])).rejects.toThrow();
  await checked(await alice.request.get(`/api/assessment/result?participantId=${tied.participant.id}`), 200);
  expect((await (await alice.request.get('/api/assessment/result')).json()).result.profileCode).toBe('DI');
  await checked(await alice.request.get(`/api/participants/${tied.participant.id}/report`), 403);
  await staffPage.goto('/facilitator'); await expect(staffPage.getByRole('row').filter({ hasText: 'Fictional E2E tied' })).toContainText('COMPLETED');
  await staffPage.getByRole('link', { name: 'Full report for Fictional E2E tied', exact: true }).click();
  await expect(staffPage.getByRole('heading', { name: 'TIED — 2 candidate profiles', exact: true })).toBeVisible();
  await capture(staffPage, 'staff-tied-report.jpg');
  await managerPage.goto('/manager'); await expect(managerPage.getByRole('heading', { name: 'Cohort overview', exact: true })).toBeVisible();
  const summary = await (await checked(await manager.request.get('/api/manager/summary'), 200)).json();
  expect([summary.totalInvited, summary.completed, summary.pending, summary.completionPercentage]).toEqual([2, 2, 0, 100]);
  expect(summary.distribution.DI).toBe(1); expect(summary.distribution.ID).toBe(0); expect(summary.distribution.TIED).toBe(1);
  expect(Object.values<number>(summary.distribution).reduce((a, b) => a + b, 0)).toBe(2);
  expect(summary.means).toEqual({ D: 52.5, I: 45.5, S: 28, C: 14 });
  await capture(managerPage, 'manager-single-tied.jpg');
  expect((await (await staff.request.get('/api/auth/me')).json()).principal.type).toBe('STAFF');
  expect((await (await bob.request.get('/api/auth/me')).json()).principal.status).toBe('COMPLETED');
  await login(alicePage, 'facilitator'); await checked(await alice.request.get('/api/assessment/result'), 403);
  const token = new URL(tied.invitationUrl).pathname.split('/').at(-1)!;
  await checked(await alice.request.post('/api/invitations/redeem', { headers: { Origin: baseURL }, data: { token } }), 200);
  await checked(await alice.request.get('/api/participants'), 403);
  expect((await (await alice.request.get('/api/assessment/result')).json()).result.profileStatus).toBe('TIED');
  expect((await pool.query('SELECT * FROM "Result" WHERE "participantId"=$1', [tied.participant.id])).rows[0]).toEqual(frozen);
  expect(await bobPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect(cacheViolations).toEqual([]); expect(consoleErrors).toEqual([]);
});

test('all four tied dimensions show every N slogan in participant and staff UI as one completion', async ({ browser }) => {
  const staff = await context(browser); const participant = await context(browser); const manager = await context(browser);
  const staffPage = await staff.newPage(); const page = await participant.newPage(); const managerPage = await manager.newPage();
  await login(staffPage, 'facilitator'); await login(managerPage, 'manager');
  const invited = await invite(staff, 'Fictional E2E all-four tie'); const token = new URL(invited.invitationUrl).pathname.split('/').at(-1)!;
  await checked(await participant.request.post('/api/invitations/redeem', { headers: { Origin: baseURL }, data: { token } }), 200);
  for (const [index, group] of seed.groups.entries()) {
    const dimensions = index < 7 ? ['D', 'I', 'S', 'C'] : ['C', 'S', 'I', 'D'];
    await checked(await participant.request.put(`/api/assessment/answers/${group.id}`, { headers: { Origin: baseURL }, data: { rankedWordIds: dimensions.map(d => group.words.find(w => w.dimension === d)!.id) } }), 200);
  }
  const stored = (await (await checked(await participant.request.post('/api/assessment/submit', { headers: { Origin: baseURL }, data: {} }), 200)).json()).result;
  publicResult(stored); expect(stored.candidateProfiles).toHaveLength(12);
  for (const target of [page, staffPage]) {
    await target.goto(target === page ? '/result' : `/staff/participants/${invited.participant.id}/report`);
    await expect(target.getByRole('heading', { name: 'TIED — 12 candidate profiles', exact: true })).toBeVisible();
    for (const profile of seed.profiles) {
      const card = target.getByRole('article', { name: `Profile ${profile.code}`, exact: true });
      await expect(card).toContainText(profile.labelAr); expect((await card.innerText()).split(profile.labelAr)).toHaveLength(2);
    }
    await expect(target.getByText(/missing.description|description.missing|winner/i)).toHaveCount(0);
  }
  await capture(page, 'all-twelve-source-slogans.jpg');
  await managerPage.goto('/manager'); await expect(managerPage.getByRole('heading', { name: 'Cohort overview', exact: true })).toBeVisible();
  const summary = await (await manager.request.get('/api/manager/summary')).json();
  expect(summary.completed).toBe(3); expect(summary.pending).toBe(0); expect(summary.distribution.TIED).toBe(2);
  expect(Object.values<number>(summary.distribution).reduce((a, b) => a + b, 0)).toBe(3);
  const listed = summary.participants.find((p: { id: string }) => p.id === invited.participant.id);
  expect(listed.status).toBe('COMPLETED'); expect(listed.result.candidateProfileCodes).toHaveLength(12);
  await capture(managerPage, 'manager-three-completions.jpg');
  expect(cacheViolations).toEqual([]); expect(consoleErrors).toEqual([]);
});

test('served production JS/CSS and personalized HTML contain no seed, scoring map or secret canaries', async ({ request }) => {
  const root = resolve('apps/web/.next/static');
  const markers = [seed.sourceSha256, seed.sourceWorkbook, seed.sourceSheet, '5c6cec273ef5282e3cf926ba4b72032c45407e149d197497bcc3e4d6d5895e37',
    'phase7_private_build_canary_8e1beaf5', 'phase7_database_canary_13f1ebdd', 'rawP', 'rawQ', 'rawR', ...seed.groups.flatMap(g => g.words.map(w => w.id))];
  const files = readdirSync(root, { recursive: true }).filter((file): file is string => typeof file === 'string' && /\.(js|css|map)$/.test(file));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const response = await request.get('/_next/static/' + file.replaceAll('\\', '/')); expect(response.ok()).toBeTruthy();
    const body = await response.text(); for (const marker of markers) assert.ok(!body.includes(marker), `Private marker in production asset ${file}`);
  }
  for (const path of ['/login', '/assessment', '/result', '/facilitator', '/manager', '/staff/participants/00000000-0000-0000-0000-000000000000/report']) {
    const response = await request.get(path); expect(response.ok()).toBeTruthy(); expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
    const html = await response.text(); for (const marker of markers) assert.ok(!html.includes(marker), `Private marker in initial HTML ${path}`);
  }
  console.log(`Inspected ${files.length} served production assets and 6 dynamic HTML routes; no private markers.`);
});
