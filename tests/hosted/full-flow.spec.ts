import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect, type Browser, type BrowserContext, type Page, type APIResponse } from '@playwright/test';
import { seed } from '../../apps/api/test/helpers/assessment.ts';
import type { Dimension } from '../../apps/api/src/domain/scoring.ts';
import type { StoredReport } from '../../apps/web/src/lib/report-types.ts';
import type { ManagerSummary, StaffParticipant } from '../../apps/web/src/lib/staff-types.ts';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} securely in the process environment.`);
  return value;
}
const origin = new URL(required('HOSTED_BASE_URL')).origin;
const accounts = {
  FACILITATOR: { email: required('HOSTED_FACILITATOR_EMAIL'), password: required('HOSTED_FACILITATOR_PASSWORD') },
  MANAGER: { email: required('HOSTED_MANAGER_EMAIL'), password: required('HOSTED_MANAGER_PASSWORD') },
};
const contexts: BrowserContext[] = [];
const cacheViolations: string[] = [];
const browserErrors: string[] = [];
const evidence = resolve('artifacts/phase8');
const headers = { Origin: origin };
const run = randomBytes(5).toString('hex');
const vectors: Record<string, readonly Dimension[]> = {
  single: ['D', 'I', 'S', 'C'], reversed: ['I', 'D', 'S', 'C'], allFour: ['C', 'S', 'I', 'D'],
};
type Invitation = { participant: StaffParticipant; invitationUrl: string };
type Principal = { type: 'STAFF' | 'PARTICIPANT'; role?: string; id: string; status?: string };

test.afterAll(async () => { for (const value of contexts) await value.close(); });

async function context(browser: Browser, mobile = false) {
  const value = await browser.newContext({ baseURL: origin, viewport: mobile ? { width: 375, height: 812 } : { width: 1280, height: 900 } });
  contexts.push(value);
  value.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === origin && url.pathname.startsWith('/api/') && response.headers()['cache-control'] !== 'no-store') {
      // Store the route only; no invitation token, cookie, body or query is recorded.
      cacheViolations.push(url.pathname);
    }
  });
  value.on('page', page => page.on('pageerror', error => browserErrors.push(error.name)));
  return value;
}
async function checked(response: APIResponse, status: number) {
  expect(response.status()).toBe(status);
  expect(response.headers()['cache-control']).toBe('no-store');
  return response;
}
async function identity(value: BrowserContext) {
  return (await (await checked(await value.request.get('/api/auth/me'), 200)).json() as { principal: Principal }).principal;
}
async function login(page: Page, role: keyof typeof accounts) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(accounts[role].email);
  await page.getByLabel('Password', { exact: true }).fill(accounts[role].password);
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toBe('no-store');
  const setCookie = (await response.allHeaders())['set-cookie'] ?? '';
  // Boolean assertions prevent a failing assertion from printing a secret cookie value.
  expect(setCookie.startsWith('__Host-disc.sid=')).toBe(true);
  for (const flag of [/;\s*Secure(?:;|$)/i, /;\s*HttpOnly(?:;|$)/i, /;\s*SameSite=Lax(?:;|$)/i, /;\s*Path=\/(?:;|$)/i]) {
    expect(flag.test(setCookie)).toBe(true);
  }
  expect(/;\s*Domain=/i.test(setCookie)).toBe(false);
  await expect(page.getByRole('region', { name: 'Current session' })).toContainText(`(${role})`);
  const cookie = (await page.context().cookies(origin)).find(value => value.name === '__Host-disc.sid');
  expect(Boolean(cookie && cookie.secure && cookie.httpOnly && cookie.sameSite === 'Lax' && cookie.path === '/' && cookie.domain === new URL(origin).hostname)).toBe(true);
  expect((await identity(page.context())).role).toBe(role);
}
async function summary(value: BrowserContext): Promise<ManagerSummary> {
  return await (await checked(await value.request.get('/api/manager/summary'), 200)).json() as ManagerSummary;
}
async function participants(value: BrowserContext): Promise<StaffParticipant[]> {
  return (await (await checked(await value.request.get('/api/participants'), 200)).json() as { participants: StaffParticipant[] }).participants;
}
async function invite(value: BrowserContext, label: string): Promise<Invitation> {
  return await (await checked(await value.request.post('/api/participants', { headers, data: { name: `Phase 8 QA ${label} ${run}` } }), 201)).json() as Invitation;
}
async function capture(page: Page, name: string) {
  // Only post-completion/result/dashboard pages are captured, never login/invitation pages.
  expect(new URL(page.url()).pathname.startsWith('/invite/')).toBe(false);
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, name), fullPage: true, type: 'jpeg' });
}
async function result(value: BrowserContext): Promise<StoredReport> {
  return (await (await checked(await value.request.get('/api/assessment/result'), 200)).json() as { result: StoredReport }).result;
}
function verifyReport(stored: StoredReport, expected: { scores: StoredReport['scores']; codes: string[]; status: 'SINGLE' | 'TIED' }) {
  expect(stored.scores).toEqual(expected.scores); expect(stored.totalPoints).toBe(140);
  expect(stored.profileStatus).toBe(expected.status);
  expect(stored.profileCode).toBe(expected.status === 'SINGLE' ? expected.codes[0] : null);
  expect([...stored.candidateProfileCodes].sort()).toEqual([...expected.codes].sort());
  expect(stored.assessmentVersion).toBe(seed.assessmentVersion);
  expect(stored.scoringPolicyVersion).toBe(seed.scoringPolicyVersion);
  expect(stored.profileTextPolicyVersion).toBe(seed.profileTextPolicyVersion);
  expect(stored.candidateProfiles).toHaveLength(expected.codes.length);
  for (const candidate of stored.candidateProfiles) {
    const source = seed.profiles.find(profile => profile.code === candidate.code)!;
    expect(Object.keys(candidate).sort()).toEqual(['code', 'descriptionAr', 'descriptionEn', 'nameAr']);
    expect(candidate.nameAr).toBe(source.labelAr); expect(candidate.descriptionAr).toBe(source.labelAr);
    expect(candidate.descriptionEn).toBeNull();
  }
}
async function visibleReport(page: Page, stored: StoredReport) {
  const heading = stored.profileStatus === 'SINGLE' ? `SINGLE — ${stored.profileCode}` : `TIED — ${stored.candidateProfiles.length} candidate profiles`;
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  for (const profile of stored.candidateProfiles) {
    const card = page.getByRole('article', { name: `Profile ${profile.code}`, exact: true });
    await expect(card).toContainText(profile.nameAr);
    expect((await card.innerText()).split(profile.nameAr)).toHaveLength(2);
  }
  await expect(page.getByText(/missing.description|description.missing|winner/i)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Score table', exact: true })).toBeVisible();
}
const wordRows = (page: Page) => page.getByRole('list', { name: 'Words from most to least like you', exact: true }).getByRole('listitem');
async function orderOnScreen(page: Page) {
  return (await wordRows(page).locator('strong').allTextContents()).map(text => text.replace(/^\d+\. /, ''));
}
async function rank(page: Page, index: number, dimensions: readonly Dimension[]) {
  const names = dimensions.map(dimension => seed.groups[index]!.words.find(word => word.dimension === dimension)!.textEn);
  for (const [target, name] of names.entries()) {
    let position = (await orderOnScreen(page)).indexOf(name);
    expect(position >= 0).toBe(true);
    while (position > target) {
      await page.getByRole('button', { name: `Move ${name} up`, exact: true }).press('Enter');
      await expect.poll(async () => (await orderOnScreen(page)).indexOf(name)).toBe(position - 1);
      position--;
    }
  }
  await expect.poll(() => orderOnScreen(page)).toEqual(names);
}
async function start(page: Page, invitation: Invitation, staff: BrowserContext) {
  expect((await participants(staff)).find(value => value.id === invitation.participant.id)?.status).toBe('INVITED');
  try { const response = await page.goto(invitation.invitationUrl); expect(response?.headers()['cache-control']).toContain('no-store'); }
  catch { throw new Error('The hosted invitation page did not load successfully.'); }
  expect((await participants(staff)).find(value => value.id === invitation.participant.id)?.status).toBe('INVITED');
  await checked(await page.context().request.get('/api/auth/me'), 401);
  await page.getByRole('button', { name: 'Start or continue', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/assessment');
  await expect(page.getByRole('heading', { name: 'Group 1 of 14', exact: true })).toBeVisible();
  const response = await checked(await page.context().request.get('/api/assessment'), 200);
  const body = await response.json() as { groups: { id: string; sequence: number; words: Record<string, unknown>[] }[]; answers: unknown[] };
  expect(body.groups).toHaveLength(14); expect(body.answers).toEqual([]);
  for (const group of body.groups) {
    expect(Object.keys(group).sort()).toEqual(['id', 'sequence', 'words']);
    expect(group.words).toHaveLength(4);
    for (const word of group.words) expect(Object.keys(word).sort()).toEqual(['id', 'textAr', 'textEn']);
  }
}
async function completeUi(page: Page, tied: boolean) {
  for (let index = 0; index < 14; index++) {
    await expect(page.getByRole('heading', { name: `Group ${index + 1} of 14`, exact: true })).toBeVisible();
    await rank(page, index, tied && index >= 7 ? vectors.reversed! : vectors.single!);
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/assessment/answers/${seed.groups[index]!.id}` && response.request().method() === 'PUT');
    await page.getByRole('button', { name: index === 13 ? 'Confirm last group' : 'Next — confirm and save', exact: true }).click();
    expect((await saved).status()).toBe(200);
    if (index === 0) {
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Group 2 of 14', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect.poll(() => orderOnScreen(page)).toEqual(vectors.single!.map(dimension => seed.groups[0]!.words.find(word => word.dimension === dimension)!.textEn));
      await page.getByRole('button', { name: 'Next — confirm and save', exact: true }).click();
    }
  }
  await expect(page.getByRole('button', { name: 'Submit assessment', exact: true })).toBeEnabled();
  const assessment = await (await checked(await page.context().request.get('/api/assessment'), 200)).json() as { answers: { groupId: string; confirmedAt: string }[] };
  expect(assessment.answers).toHaveLength(14);
  expect(assessment.answers.map(answer => answer.groupId).sort()).toEqual(seed.groups.map(group => group.id).sort());
  expect(assessment.answers.every(answer => Boolean(answer.confirmedAt))).toBe(true);
  const finalFlush = page.waitForResponse(response => new URL(response.url()).pathname === '/api/assessment/answers/g14' && response.request().method() === 'PUT');
  const submitted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/assessment/submit' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Submit assessment', exact: true }).click();
  expect((await finalFlush).status()).toBe(200); expect((await submitted).status()).toBe(200);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/result');
}

test('real HTTPS frontend: isolated staff and participant sessions, persisted SINGLE/TIED reports and exclusive manager counts', async ({ browser }) => {
  const facilitator = await context(browser); const manager = await context(browser);
  const single = await context(browser, true); const tied = await context(browser, true); const allFour = await context(browser);
  const facilitatorPage = await facilitator.newPage(); const managerPage = await manager.newPage();
  const singlePage = await single.newPage(); const tiedPage = await tied.newPage(); const allFourPage = await allFour.newPage();
  const health = await checked(await single.request.get('/api/health'), 200);
  expect(await health.json()).toEqual({ status: 'ok', service: 'disc-api' });
  await checked(await single.request.get('/api/manager/summary'), 401);
  await login(facilitatorPage, 'FACILITATOR'); await login(managerPage, 'MANAGER');
  await checked(await facilitator.request.get('/api/manager/summary'), 403);
  const before = await summary(manager);
  for (const badOrigin of [undefined, 'https://wrong-origin.invalid']) {
    await checked(await facilitator.request.post('/api/participants', {
      ...(badOrigin ? { headers: { Origin: badOrigin } } : {}), data: { name: 'Rejected hosted origin check' },
    }), 403);
  }
  const invitedSingle = await invite(facilitator, 'single'); const invitedTied = await invite(facilitator, 'DI-ID tie');
  const invitedAll = await invite(facilitator, 'all-four tie');
  await start(singlePage, invitedSingle, facilitator); await start(tiedPage, invitedTied, facilitator);
  await checked(await single.request.get('/api/manager/summary'), 403);
  await completeUi(singlePage, false); await completeUi(tiedPage, true);
  const savedSingle = await result(single); const savedTied = await result(tied);
  verifyReport(savedSingle, { scores: { D: 56, I: 42, S: 28, C: 14 }, codes: ['DI'], status: 'SINGLE' });
  verifyReport(savedTied, { scores: { D: 49, I: 49, S: 28, C: 14 }, codes: ['DI', 'ID'], status: 'TIED' });
  expect(savedTied.scoreRanking[0]?.dimensions.slice().sort()).toEqual(['D', 'I']);
  await visibleReport(singlePage, savedSingle); await visibleReport(tiedPage, savedTied);
  await capture(singlePage, 'hosted-single-mobile.jpg'); await capture(tiedPage, 'hosted-tied-mobile.jpg');
  await checked(await single.request.get(`/api/participants/${invitedTied.participant.id}/report`), 403);
  const isolated = (await (await checked(await single.request.get(`/api/assessment/result?participantId=${invitedTied.participant.id}`), 200)).json() as { result: StoredReport }).result;
  expect(isolated).toEqual(savedSingle);
  await checked(await tied.request.put('/api/assessment/answers/g01', { headers, data: { rankedWordIds: seed.groups[0]!.words.map(word => word.id) } }), 409);
  const retry = (await (await checked(await tied.request.post('/api/assessment/submit', { headers, data: {} }), 200)).json() as { result: StoredReport }).result;
  expect(retry).toEqual(savedTied);
  await tiedPage.reload(); await visibleReport(tiedPage, savedTied);
  expect((await identity(tied)).status).toBe('COMPLETED');

  await start(allFourPage, invitedAll, facilitator);
  for (const [index, group] of seed.groups.entries()) {
    const dimensions = index < 7 ? vectors.single! : vectors.allFour!;
    await checked(await allFour.request.put(`/api/assessment/answers/${group.id}`, { headers,
      data: { rankedWordIds: dimensions.map(dimension => group.words.find(word => word.dimension === dimension)!.id) } }), 200);
  }
  const storedAll = (await (await checked(await allFour.request.post('/api/assessment/submit', { headers, data: {} }), 200)).json() as { result: StoredReport }).result;
  verifyReport(storedAll, { scores: { D: 35, I: 35, S: 35, C: 35 }, codes: seed.profiles.map(profile => profile.code), status: 'TIED' });
  expect(storedAll.scoreRanking).toHaveLength(1); expect(storedAll.scoreRanking[0]?.rank).toBe(1);
  expect(storedAll.scoreRanking[0]?.dimensions).toHaveLength(4);
  await allFourPage.goto('/result'); await visibleReport(allFourPage, storedAll);
  await capture(allFourPage, 'hosted-all-twelve-slogans.jpg');
  for (const [invitation, stored] of [[invitedSingle, savedSingle], [invitedTied, savedTied], [invitedAll, storedAll]] as const) {
    const report = (await (await checked(await facilitator.request.get(`/api/participants/${invitation.participant.id}/report`), 200)).json() as { participant: StaffParticipant; result: StoredReport });
    expect(report.participant.status).toBe('COMPLETED'); expect(report.result).toEqual(stored);
  }
  await facilitatorPage.goto(`/staff/participants/${invitedTied.participant.id}/report`);
  await visibleReport(facilitatorPage, savedTied); await capture(facilitatorPage, 'hosted-staff-tied-report.jpg');
  const after = await summary(manager);
  expect([after.totalInvited - before.totalInvited, after.completed - before.completed, after.pending - before.pending]).toEqual([3, 3, 0]);
  expect(after.completionPercentage).toBe(100 * after.completed / after.totalInvited);
  expect(Object.keys(after.distribution).sort()).toEqual([...seed.profiles.map(profile => profile.code), 'TIED'].sort());
  expect(after.distribution.DI! - before.distribution.DI!).toBe(1); expect(after.distribution.TIED! - before.distribution.TIED!).toBe(2);
  expect(after.distribution.ID).toBe(before.distribution.ID);
  expect(Object.values(after.distribution).reduce((sum, value) => sum + value, 0)).toBe(after.completed);
  for (const invitation of [invitedSingle, invitedTied, invitedAll]) expect(after.participants.find(value => value.id === invitation.participant.id)?.status).toBe('COMPLETED');
  for (const dimension of ['D', 'I', 'S', 'C'] as const) {
    const expected = ((before.means?.[dimension] ?? 0) * before.completed + savedSingle.scores[dimension] + savedTied.scores[dimension] + storedAll.scores[dimension]) / after.completed;
    expect(after.means?.[dimension]).toBeCloseTo(expected, 8);
  }
  await managerPage.goto('/manager'); await expect(managerPage.getByRole('heading', { name: 'Cohort overview', exact: true })).toBeVisible();
  await capture(managerPage, 'hosted-manager-exclusive-tied.jpg');

  // A new incognito browser context restores only the saved secure cookie in memory.
  // No storage-state JSON or authentication artifact is written to disk.
  const resumed = await context(browser, true); await checked(await resumed.request.get('/api/auth/me'), 401);
  await resumed.addCookies(await tied.cookies(origin));
  expect((await identity(resumed)).status).toBe('COMPLETED'); expect(await result(resumed)).toEqual(savedTied);
  const resumedPage = await resumed.newPage(); await resumedPage.goto('/result'); await visibleReport(resumedPage, savedTied);
  const fresh = await context(browser, true); const completedToken = new URL(invitedSingle.invitationUrl).pathname.split('/').at(-1)!;
  await checked(await fresh.request.post('/api/invitations/redeem', { headers, data: { token: completedToken } }), 200);
  expect(await result(fresh)).toEqual(savedSingle);
  // Switch an independently redeemed session, not the context sharing the original cookie.
  const switchPage = await fresh.newPage(); await login(switchPage, 'FACILITATOR');
  await checked(await fresh.request.get('/api/assessment/result'), 403);
  const tiedToken = new URL(invitedTied.invitationUrl).pathname.split('/').at(-1)!;
  await checked(await fresh.request.post('/api/invitations/redeem', { headers, data: { token: tiedToken } }), 200);
  await checked(await fresh.request.get('/api/participants'), 403);
  expect((await identity(fresh)).type).toBe('PARTICIPANT'); expect(await result(fresh)).toEqual(savedTied);
  expect((await identity(tied)).status).toBe('COMPLETED');
  expect((await identity(facilitator)).role).toBe('FACILITATOR'); expect((await identity(manager)).role).toBe('MANAGER');
  await checked(await single.request.post('/api/auth/logout', { headers, data: {} }), 204);
  await checked(await single.request.get('/api/auth/me'), 401);
  expect((await identity(manager)).role).toBe('MANAGER');
  expect(await tiedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const path of ['/login', '/assessment', '/result', '/facilitator', '/manager']) {
    const response = await fresh.request.get(path);
    expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
  }
  expect(cacheViolations).toEqual([]); expect(browserErrors).toEqual([]);
  console.log('Hosted HTTPS verification passed: 3 fictional completed participants, SINGLE DI, TIED DI/ID, all 12 slogans, isolated sessions, protected routes, no-store, stored report restoration and exclusive TIED counts.');
});
