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
import type { StoredReport } from '../apps/web/src/lib/report-types.ts';

// Render the real TSX component with React. Only its CSS-module import is stubbed;
// no browser bundle imports the private test seed or server scoring implementation.
const source = readFileSync(new URL('../apps/web/src/components/stored-report.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const cssStubbed = compiled.replace(/import styles from ['"][^'"]+\.module\.css['"];?/, 'const styles = new Proxy({}, {get: (_target, key) => String(key)});');
assert.notEqual(cssStubbed, compiled, 'CSS import stub must match the actual component import');
const cache = fileURLToPath(new URL('../node_modules/.cache/', import.meta.url));
mkdirSync(cache, { recursive: true });
const folder = mkdtempSync(join(cache, 'disc-report-render-'));
const modulePath = join(folder, 'stored-report.mjs');
writeFileSync(modulePath, cssStubbed);
const { default: Report } = await import(pathToFileURL(modulePath).href) as { default: ComponentType<{ result: StoredReport }> };
after(() => { unlinkSync(modulePath); rmdirSync(folder); });

function result(answers = order(['D', 'I', 'S', 'C'])): StoredReport {
  return { ...scoreAssessment(seed, answers), completedAt: '2026-10-16T12:00:00.000Z' };
}
const render = (snapshot: StoredReport): string => renderToStaticMarkup(createElement(Report, { result: snapshot }));

for (const [name, snapshot, status, codes] of [
  ['DI', result(), 'SINGLE', ['DI']],
  ['ID', result(order(['I', 'D', 'S', 'C'])), 'SINGLE', ['ID']],
  ['DI/ID tie', result(mixed(['D', 'I', 'S', 'C'], ['I', 'D', 'S', 'C'])), 'TIED', ['DI', 'ID']],
  ['DI/DS tie', result(mixed(['D', 'I', 'S', 'C'], ['D', 'S', 'I', 'C'])), 'TIED', ['DI', 'DS']],
  ['all-four tie', result(mixed(['D', 'I', 'S', 'C'], ['C', 'S', 'I', 'D'])), 'TIED', PROFILE_CODES],
  ['lower-only tie', result(mixed(['D', 'I', 'S', 'C'], ['D', 'I', 'C', 'S'])), 'SINGLE', ['DI']],
] as const) {
  test(`report renders stored ${name}, every candidate and exact shared rank groups`, () => {
    const original = structuredClone(snapshot);
    const html = render(snapshot);
    assert.match(html, new RegExp(`<h2>${status} —`));
    assert.equal([...html.matchAll(/aria-label="Profile ([A-Z]{2})"/g)].length, codes.length);
    for (const code of codes) {
      assert.ok(html.includes(`aria-label="Profile ${code}"`));
      assert.ok(html.includes(seed.profiles.find(profile => profile.code === code)!.nameAr));
    }
    for (const group of snapshot.scoreRanking) {
      assert.ok(html.includes(`Rank ${group.rank}${group.dimensions.length > 1 ? ' (shared)' : ''}`));
      assert.ok(html.includes(`${group.dimensions.join(' = ')} · ${group.score} points`));
    }
    assert.deepEqual(snapshot, original, 'Rendering must never mutate or re-score a stored snapshot');
    assert.doesNotMatch(html, /missing.{0,30}description|description.{0,30}missing|pending|winner/i);
  });
}

test('DI and ID render their distinct source slogans', () => {
  const di = render(result()); const id = render(result(order(['I', 'D', 'S', 'C'])));
  assert.match(di, /المقنع/); assert.doesNotMatch(di, /الملهم/);
  assert.match(id, /الملهم/); assert.doesNotMatch(id, /المقنع/);
});

test('all 12 N slogans render once per card when name/description share the text and English is null', () => {
  for (const code of PROFILE_CODES) {
    const snapshot = result();
    const profile = seed.profiles.find(profile => profile.code === code)!;
    // Presentation must use the passed snapshot rather than selecting text from scores.
    snapshot.profileCode = code; snapshot.candidateProfileCodes = [code]; snapshot.candidateProfiles = [{ ...profile }];
    const html = render(snapshot);
    assert.equal(html.split(profile.nameAr).length - 1, 1, `Duplicate N text for ${code}`);
    assert.match(html, /lang="ar" dir="rtl"/);
    assert.doesNotMatch(html, /null|not supplied|missing/i);
  }
});

test('raw chart uses fixed 0–56 widths and an accessible score table with equal ranks', () => {
  const single = render(result());
  assert.deepEqual([...single.matchAll(/style="width:([^%]+)%"/g)].map(match => Number(match[1])), [100, 75, 50, 25]);
  assert.match(single, /role="img" aria-label="D: 56 of 56; I: 42 of 56; S: 28 of 56; C: 14 of 56"/);
  assert.match(single, /<caption>Four raw scores and shared ranks<\/caption>/);
  assert.match(single, /<th scope="row">D<\/th><td>56<\/td><td>1<\/td>/);
  assert.match(single, /<th scope="row">Total points<\/th><td>140<\/td>/);
  const tied = render(result(mixed(['D', 'I', 'S', 'C'], ['I', 'D', 'S', 'C'])));
  assert.match(tied, /<th scope="row">D<\/th><td>49<\/td><td>1<\/td>/);
  assert.match(tied, /<th scope="row">I<\/th><td>49<\/td><td>1<\/td>/);
  assert.match(tied, /<th scope="row">S<\/th><td>28<\/td><td>3<\/td>/);
});

test('renderer preserves older source text and stored ranking without looking up current profiles', () => {
  const snapshot = result();
  snapshot.assessmentVersion = 'previous-assessment';
  snapshot.scoringPolicyVersion = 'previous-scoring';
  snapshot.profileTextPolicyVersion = 'previous-text';
  snapshot.candidateProfiles = [{ ...seed.profiles.find(profile => profile.code === 'ID')! }];
  snapshot.profileCode = 'ID'; snapshot.candidateProfileCodes = ['ID'];
  const html = render(snapshot);
  assert.match(html, /SINGLE — ID/); assert.match(html, /الملهم/); assert.doesNotMatch(html, /المقنع/);
  assert.match(html, /D · 56 points/);
});
