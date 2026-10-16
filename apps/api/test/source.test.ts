import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadAssessmentSeed, SEED_SHA256 } from '../src/data/assessment.ts';
import { AssessmentValidationError, type AssessmentSeed } from '../src/domain/scoring.ts';
import { changedAt, seed } from './helpers/assessment.ts';
import { readWorkbookCells, validateWorkbookAgainstSeed } from './helpers/workbook.ts';

const workbook = readFileSync(new URL('../../../reference/New_DISC_online.xlsx', import.meta.url));
const source = readFileSync(new URL('../../../data/disc-assessment-seed.json', import.meta.url));

test('seed matches original JSON fingerprint and every workbook word/profile cell', () => {
  assert.equal(createHash('sha256').update(source).digest('hex'), SEED_SHA256);
  assert.deepEqual(validateWorkbookAgainstSeed(seed, workbook), {
    groups: 14, words: 56, profiles: 12,
    sha256: '57b23a2a2b8679ba669e3657d282c053bb26ec6a7da5965388adf6f89dcdaf60',
  });
});

test('row 1 is a descriptor, C6/C7 is joined, and both Daring IDs survive', () => {
  const cells = readWorkbookCells(workbook);
  assert.equal(cells.get('A1'), 'Cautious');
  assert.ok(seed.groups.every(group => group.sourceRow !== 1));
  assert.equal(cells.get('C6'), 'Straight-');
  assert.equal(cells.get('C7'), 'Forward');
  assert.equal(seed.groups[2]!.words.find(word => word.dimension === 'D')!.textEn, 'Straight-Forward');
  assert.deepEqual(seed.groups.flatMap(group => group.words
    .filter(word => word.textEn === 'Daring').map(word => ({ group: group.id, id: word.id }))), [
    { group: 'g06', id: 'w_f563b9e87ca3eba6' },
    { group: 'g09', id: 'w_3d55137c8421ae01' },
  ]);
  assert.equal(seed.groups[10]!.words.find(word => word.textEn === 'Extroverted')!.dimension, 'D');
});

test('changing any of the 112 word translations fails the independent cell audit', () => {
  seed.groups.forEach((group, groupIndex) => group.words.forEach((_word, wordIndex) => {
    for (const language of ['textEn', 'textAr']) {
      const changed = changedAt(seed, ['groups', groupIndex, 'words', wordIndex, language], 'changed') as AssessmentSeed;
      assert.throws(() => validateWorkbookAgainstSeed(changed, workbook));
    }
  }));
});

test('changing any N label/name/description or raw P/Q/R fails the cell audit', () => {
  seed.profiles.forEach((_profile, index) => {
    for (const field of ['labelAr', 'nameAr', 'descriptionAr', 'rawP', 'rawQ', 'rawR']) {
      const changed = changedAt(seed, ['profiles', index, field], 'changed') as AssessmentSeed;
      assert.throws(() => validateWorkbookAgainstSeed(changed, workbook));
    }
  });
});

test('workbook tampering is rejected before parsing', () => {
  const changed = Uint8Array.from(workbook);
  changed[0] = changed[0]! ^ 1;
  assert.throws(() => readWorkbookCells(changed), /Workbook byte fingerprint/);
});

test('private seed loader freezes nested content and rejects unavailable versions', () => {
  const loaded = loadAssessmentSeed();
  for (const value of [loaded, loaded.groups, loaded.groups[0]!, loaded.groups[0]!.words[0]!, loaded.profiles[0]!]) {
    assert.ok(Object.isFrozen(value));
  }
  assert.throws(() => loadAssessmentSeed('unknown-version'), AssessmentValidationError);
  assert.equal(Reflect.set(loaded.groups[0]!.words[0]!, 'textEn', 'changed'), false);
});
