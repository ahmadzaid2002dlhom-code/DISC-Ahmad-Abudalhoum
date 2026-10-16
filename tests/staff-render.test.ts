import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { scoreAssessment, PROFILE_CODES } from '../apps/api/src/domain/scoring.ts';
import { seed, order, mixed } from '../apps/api/test/helpers/assessment.ts';
import type { StaffParticipant, ManagerSummary } from '../apps/web/src/lib/staff-types.ts';

const cache = fileURLToPath(new URL('../node_modules/.cache/', import.meta.url));
mkdirSync(cache, { recursive: true });
const folder = mkdtempSync(join(cache, 'disc-staff-render-'));
const modules: string[] = [];
async function component<Props>(name: string): Promise<ComponentType<Props>> {
  const source = readFileSync(new URL(`../apps/web/src/components/${name}.tsx`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const stubbed = compiled.replace(/import styles from ['"][^'"]+\.module\.css['"];?/, 'const styles = new Proxy({}, {get: (_target, key) => String(key)});');
  assert.notEqual(stubbed, compiled);
  const modulePath = join(folder, `${name}.mjs`); writeFileSync(modulePath, stubbed); modules.push(modulePath);
  return (await import(pathToFileURL(modulePath).href)).default;
}
after(() => { for (const name of modules) unlinkSync(name); rmdirSync(folder); });
const Table = await component<{ participants: StaffParticipant[] }>('participant-table');
const Metrics = await component<{ summary: ManagerSummary }>('manager-metrics');
const table = (participants: StaffParticipant[]) => renderToStaticMarkup(createElement(Table, { participants }));
const metrics = (summary: ManagerSummary) => renderToStaticMarkup(createElement(Metrics, { summary }));
const stored = (answers = order(['D', 'I', 'S', 'C'])) => ({ ...scoreAssessment(seed, answers), completedAt: '2026-10-16T12:00:00Z' });
const participant = (name: string, result: StaffParticipant['result'] = null, status: StaffParticipant['status'] = result ? 'COMPLETED' : 'INVITED'): StaffParticipant => ({
  id: `fictional-${name}`, name, status, email: null, result,
});
const distribution = () => Object.fromEntries([...PROFILE_CODES, 'TIED'].map(code => [code, 0]));
const empty = (): ManagerSummary => ({ totalInvited: 0, completed: 0, pending: 0, completionPercentage: 0, distribution: distribution(), means: null, participants: [] });

test('empty cohort renders invitation guidance, 13 zero categories and unavailable means', () => {
  assert.match(table([]), /No invitations yet/);
  const html = metrics(empty());
  assert.match(html, /0\.00%/); assert.match(html, /Score means are unavailable/);
  assert.equal([...html.matchAll(/aria-label="[A-Z]+: 0 participants"/g)].length, 13);
  assert.doesNotMatch(html, /NaN|Infinity|Mean raw points/);
});

test('pending rows show no final scores, codes or report links', () => {
  const html = table([participant('Invited'), participant('Started', null, 'IN_PROGRESS')]);
  assert.match(html, /INVITED/); assert.match(html, /IN_PROGRESS/);
  assert.equal([...html.matchAll(/<td>—<\/td>/g)].length, 8);
  assert.doesNotMatch(html, /SINGLE|TIED|href=|<td>0<\/td>/);
});

test('completed rows render persisted scores, distinct DI/ID slogans and full-report URLs', () => {
  const html = table([participant('DI', stored()), participant('ID', stored(order(['I', 'D', 'S', 'C'])))]);
  assert.match(html, /SINGLE — DI/); assert.match(html, /SINGLE — ID/);
  assert.match(html, /المقنع/); assert.match(html, /الملهم/);
  assert.match(html, /<td>56<\/td><td>42<\/td><td>28<\/td><td>14<\/td>/);
  assert.match(html, /href="\/staff\/participants\/fictional-DI\/report"/);
  assert.match(html, /aria-label="Full report for ID"/);
});

test('tied table rows keep every candidate source name and do not show a SINGLE winner', () => {
  const result = stored(mixed(['D', 'I', 'S', 'C'], ['C', 'S', 'I', 'D']));
  const html = table([participant('All equal', result)]);
  assert.equal([...html.matchAll(/<tr>/g)].length, 2, 'One header and one participant row');
  assert.equal([...html.matchAll(/<li>/g)].length, 12);
  for (const code of PROFILE_CODES) assert.ok(html.includes(`<bdi>${code}</bdi>`));
  for (const profile of result.candidateProfiles) assert.ok(html.includes(profile.nameAr));
  assert.doesNotMatch(html, /SINGLE|missing.description|winner/i);
});

test('six-person metrics render exact counts, rounded percent, means and an exclusive tied category', () => {
  const counts = distribution(); for (const code of ['CD', 'DI', 'IS', 'TIED']) counts[code] = 1;
  const html = metrics({ ...empty(), totalInvited: 6, completed: 4, pending: 2, completionPercentage: 100 * 4 / 6,
    distribution: counts, means: { D: 40.25, I: 40.25, S: 31.5, C: 28 } });
  assert.match(html, /Total invited \(N\)<\/dt><dd>6/); assert.match(html, /Completed \(K\)<\/dt><dd>4/);
  assert.match(html, /Pending \(P\)<\/dt><dd>2/); assert.match(html, /66\.67%/);
  assert.match(html, /40\.25/); assert.match(html, /31\.50/); assert.match(html, /28\.00/);
  assert.match(html, /Distribution total: 4 completed participants/);
  assert.match(html, /aria-label="DI: 1 participants"/); assert.match(html, /aria-label="ID: 0 participants"/);
  assert.match(html, /aria-label="TIED: 1 participants"/);
});

test('all-tied metrics fill only TIED and include tied score means', () => {
  const counts = distribution(); counts.TIED = 2;
  const html = metrics({ ...empty(), totalInvited: 2, completed: 2, completionPercentage: 100, distribution: counts, means: { D: 42, I: 42, S: 31.5, C: 24.5 } });
  assert.match(html, /TIED<\/strong><div[^>]*><span[^>]*style="width:100%"/);
  assert.equal([...html.matchAll(/style="width:0%"/g)].length, 12);
  assert.match(html, /100\.00%/); assert.match(html, /All 2 completed results, including ties/);
});

test('nonempty cohort without completions displays null-mean guidance instead of zero averages', () => {
  const html = metrics({ ...empty(), totalInvited: 2, pending: 2 });
  assert.match(html, /Score means are unavailable/); assert.doesNotMatch(html, /Mean raw points/);
  assert.doesNotMatch(html, /No invitations yet/);
});

test('table uses passed historical source names without current seed substitution', () => {
  const result: NonNullable<StaffParticipant['result']> = stored(); result.candidateProfiles[0]!.nameAr = 'نص محفوظ سابق';
  const html = table([participant('Historical', result)]);
  assert.match(html, /نص محفوظ سابق/); assert.doesNotMatch(html, /المقنع/);
});
