import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ASSESSMENT_VERSION, AssessmentValidationError, DIMENSIONS, PROFILE_CODES,
  SCORING_POLICY_VERSION, PROFILE_TEXT_POLICY_VERSION, scoreAssessment,
  toPublicAssessment, validateAssessmentSeed, validateGroupAnswer,
  type Answer, type Dimension,
} from '../src/domain/scoring.ts';
import { allOrders, changedAt, mixed, order, seed } from './helpers/assessment.ts';

test('validated seed pins all three policies and retains exact N and raw profile text', () => {
  validateAssessmentSeed(seed);
  assert.equal(seed.assessmentVersion, ASSESSMENT_VERSION);
  assert.equal(seed.scoringPolicyVersion, SCORING_POLICY_VERSION);
  assert.equal(seed.profileTextPolicyVersion, PROFILE_TEXT_POLICY_VERSION);
  assert.deepEqual(new Set(seed.profiles.map(profile => profile.code)), new Set(PROFILE_CODES));
  for (const profile of seed.profiles) {
    assert.equal(profile.nameAr, profile.labelAr);
    assert.equal(profile.descriptionAr, profile.labelAr);
    assert.equal(profile.descriptionEn, null);
  }
  assert.equal(seed.profiles.find(profile => profile.code === 'CI')!.labelAr,
    seed.profiles.find(profile => profile.code === 'IC')!.labelAr);
  assert.equal(seed.profiles.filter(profile => profile.rawP !== null).length, 8);
  assert.equal(seed.profiles.filter(profile => profile.rawQ !== null).length, 8);
  assert.equal(seed.profiles.filter(profile => profile.rawR !== null).length, 3);
  assert.equal(seed.profiles.find(profile => profile.code === 'DC')!.rawP, 'acheiver');
  assert.equal(seed.profiles.find(profile => profile.code === 'CS')!.rawQ, 'perfecionist');
  assert.equal(seed.profiles.find(profile => profile.code === 'IS')!.rawP, 'councler');
});

for (const vector of [
  { dimensions: ['C', 'D', 'S', 'I'], scores: { D: 42, I: 14, S: 28, C: 56 }, code: 'CD' },
  { dimensions: ['D', 'I', 'S', 'C'], scores: { D: 56, I: 42, S: 28, C: 14 }, code: 'DI' },
  { dimensions: ['I', 'S', 'C', 'D'], scores: { D: 14, I: 56, S: 42, C: 28 }, code: 'IS' },
] as const) {
  test(`golden participant ranking gives exact scores and SINGLE ${vector.code}`, () => {
    const result = scoreAssessment(seed, order(vector.dimensions));
    assert.deepEqual(result.scores, vector.scores);
    assert.equal(result.totalPoints, 140);
    assert.equal(result.profileStatus, 'SINGLE');
    assert.equal(result.profileCode, vector.code);
    assert.equal(result.profile!.descriptionAr, seed.profiles.find(profile => profile.code === vector.code)!.labelAr);
    assert.deepEqual(result.candidateProfileCodes, [vector.code]);
    assert.deepEqual(result.scoreRanking.map(entry => entry.dimensions[0]), vector.dimensions);
    assert.deepEqual(result.tiedScoreGroups, []);
    assert.equal(result.hasScoreTie, false);
    assert.equal(result.assessmentVersion, seed.assessmentVersion);
    assert.equal(result.scoringPolicyVersion, seed.scoringPolicyVersion);
    assert.equal(result.profileTextPolicyVersion, seed.profileTextPolicyVersion);
  });
}

for (const dimensions of allOrders) {
  test(`uniform ranking ${dimensions.join('')} resolves its ordered top two`, () => {
    assert.equal(scoreAssessment(seed, order(dimensions)).profileCode, dimensions.slice(0, 2).join(''));
  });
}

test('first-place tie keeps DI/ID, shared competition ranks, and both source descriptions', () => {
  const result = scoreAssessment(seed, mixed(['D', 'I', 'S', 'C'], ['I', 'D', 'S', 'C']));
  assert.deepEqual(result.scores, { D: 49, I: 49, S: 28, C: 14 });
  assert.equal(result.profileStatus, 'TIED');
  assert.equal(result.profileCode, null);
  assert.equal(result.profile, null);
  assert.deepEqual(result.candidateProfileCodes, ['DI', 'ID']);
  assert.deepEqual(result.candidateProfiles.map(profile => profile.descriptionAr), ['المقنع', 'الملهم']);
  assert.deepEqual(result.scoreRanking, [
    { rank: 1, score: 49, dimensions: ['D', 'I'] },
    { rank: 3, score: 28, dimensions: ['S'] },
    { rank: 4, score: 14, dimensions: ['C'] },
  ]);
  assert.deepEqual(result.tiedScoreGroups, [{ score: 49, dimensions: ['D', 'I'] }]);
  assert.equal(result.hasScoreTie, true);
});

test('second-place tie keeps DI/DS and their exact source descriptions', () => {
  const result = scoreAssessment(seed, mixed(['D', 'I', 'S', 'C'], ['D', 'S', 'I', 'C']));
  assert.deepEqual(result.scores, { D: 56, I: 35, S: 35, C: 14 });
  assert.equal(result.profileStatus, 'TIED');
  assert.equal(result.profileCode, null);
  assert.deepEqual(result.candidateProfileCodes, ['DI', 'DS']);
  assert.deepEqual(result.candidateProfiles.map(profile => profile.descriptionAr), ['المقنع', 'النتائج بمنهجية']);
  assert.deepEqual(result.tiedScoreGroups, [{ score: 35, dimensions: ['I', 'S'] }]);
});

test('all-four tie retains all 12 candidates with exact source content and no winner', () => {
  const result = scoreAssessment(seed, mixed(['D', 'I', 'S', 'C'], ['C', 'S', 'I', 'D']));
  assert.deepEqual(result.scores, { D: 35, I: 35, S: 35, C: 35 });
  assert.equal(result.profileStatus, 'TIED');
  assert.equal(result.profileCode, null);
  assert.equal(result.profile, null);
  assert.deepEqual(new Set(result.candidateProfileCodes), new Set(PROFILE_CODES));
  assert.equal(result.candidateProfiles.length, 12);
  for (const profile of result.candidateProfiles) {
    assert.deepEqual(profile, seed.profiles.find(source => source.code === profile.code));
  }
  assert.deepEqual(result.scoreRanking, [{ rank: 1, score: 35, dimensions: ['D', 'I', 'S', 'C'] }]);
  assert.equal('rankCounts' in result, false);
  assert.equal('tieBreakApplied' in result, false);
});

test('lower-score-only tie keeps SINGLE DI while preserving the S/C tie', () => {
  const result = scoreAssessment(seed, mixed(['D', 'I', 'S', 'C'], ['D', 'I', 'C', 'S']));
  assert.deepEqual(result.scores, { D: 56, I: 42, S: 21, C: 21 });
  assert.equal(result.profileStatus, 'SINGLE');
  assert.equal(result.profileCode, 'DI');
  assert.deepEqual(result.candidateProfileCodes, ['DI']);
  assert.deepEqual(result.scoreRanking[2], { rank: 3, score: 21, dimensions: ['S', 'C'] });
  assert.equal(result.hasScoreTie, true);
});

function sequenceAnswers(sequence: readonly (readonly Dimension[])[]): Answer[] {
  assert.equal(sequence.length, 14);
  return sequence.map((dimensions, index) => order(dimensions)[index]!);
}

test('three highest dimensions yield all six ordered candidates', () => {
  const cycle: Dimension[][] = [['D', 'I', 'S', 'C'], ['I', 'S', 'D', 'C'], ['S', 'D', 'I', 'C']];
  const answers = sequenceAnswers([...Array.from({ length: 4 }, () => cycle).flat(), ['D', 'I', 'S', 'C'], ['S', 'I', 'D', 'C']]);
  const result = scoreAssessment(seed, answers);
  assert.deepEqual(result.scores, { D: 42, I: 42, S: 42, C: 14 });
  assert.equal(result.profileStatus, 'TIED');
  assert.equal(result.profileCode, null);
  assert.deepEqual(new Set(result.candidateProfileCodes), new Set(['DI', 'DS', 'ID', 'IS', 'SD', 'SI']));
  assert.deepEqual(result.scoreRanking.map(entry => entry.rank), [1, 4]);
});

test('a unique first with three tied seconds yields exactly three candidates', () => {
  const cycle: Dimension[][] = [['D', 'I', 'S', 'C'], ['D', 'S', 'C', 'I'], ['D', 'C', 'I', 'S']];
  const answers = sequenceAnswers([...Array.from({ length: 4 }, () => cycle).flat(), ['D', 'I', 'S', 'C'], ['D', 'C', 'S', 'I']]);
  const result = scoreAssessment(seed, answers);
  assert.deepEqual(result.scores, { D: 56, I: 28, S: 28, C: 28 });
  assert.equal(result.profileStatus, 'TIED');
  assert.equal(result.profileCode, null);
  assert.deepEqual(result.candidateProfileCodes, ['DI', 'DS', 'DC']);
  assert.deepEqual(result.scoreRanking.map(entry => entry.rank), [1, 2]);
});

test('per-group validation accepts all 24 permutations without completing other groups', () => {
  for (const dimensions of allOrders) assert.doesNotThrow(() => validateGroupAnswer(seed, order(dimensions)[0]));
});

const valid = order(['D', 'I', 'S', 'C']);
const first = valid[0]!;
const firstIds = first.rankedWordIds;
const badRankings: [string, unknown][] = [
  ['duplicate word', [firstIds[0], firstIds[0], firstIds[2], firstIds[3]]],
  ['foreign group word', [valid[1]!.rankedWordIds[0], ...firstIds.slice(1)]],
  ['unknown word', ['unknown', ...firstIds.slice(1)]],
  ['three words', firstIds.slice(0, 3)],
  ['five words', [...firstIds, 'extra']],
  ['nonstring word', [1, ...firstIds.slice(1)]],
  ['nonarray ranking', 'DISC'],
  ['null ranking', null],
  ['sparse ranking', Array(4)],
];
for (const [name, rankedWordIds] of badRankings) {
  test(`rejects ${name} in full and single-group validation`, () => {
    const answer = { groupId: first.groupId, rankedWordIds };
    assert.throws(() => scoreAssessment(seed, [answer, ...valid.slice(1)]), AssessmentValidationError);
    assert.throws(() => validateGroupAnswer(seed, answer), AssessmentValidationError);
  });
}

const badAnswers: [string, unknown][] = [
  ['missing group', valid.slice(1)],
  ['extra group', [...valid, first]],
  ['duplicate group', [...valid.slice(0, -1), first]],
  ['unknown group', [{ ...first, groupId: 'unknown' }, ...valid.slice(1)]],
  ['null answer', [null, ...valid.slice(1)]],
  ['missing answer keys', [{}, ...valid.slice(1)]],
  ['nonstring group ID', [{ ...first, groupId: 1 }, ...valid.slice(1)]],
  ['null payload', null], ['object payload', {}], ['numeric payload', 14], ['string payload', 'DISC'],
];
for (const [name, payload] of badAnswers) {
  test(`rejects ${name}`, () => assert.throws(() => scoreAssessment(seed, payload), AssessmentValidationError));
}

type Corruption = [name: string, path: (string | number)[], value: unknown, remove?: boolean];
const badSources: Corruption[] = [
  ['wrong assessment version', ['assessmentVersion'], 'old-version'],
  ['missing scoring policy', ['scoringPolicyVersion'], undefined, true],
  ['wrong scoring policy', ['scoringPolicyVersion'], 'forced-winner'],
  ['missing text policy', ['profileTextPolicyVersion'], undefined, true],
  ['wrong text policy', ['profileTextPolicyVersion'], 'invented-text'],
  ['bad workbook hash', ['sourceSha256'], 'bad'],
  ['different valid hash', ['sourceSha256'], '0'.repeat(64)],
  ['wrong sheet', ['sourceSheet'], 'other-sheet'],
  ['wrong workbook', ['sourceWorkbook'], 'other.xlsx'],
  ['wrong weight', ['weights', 0], 5],
  ['wrong group count', ['groups'], seed.groups.slice(1)],
  ['different group ID', ['groups', 0, 'id'], 'replacement'],
  ['duplicate group ID', ['groups', 1, 'id'], seed.groups[0]!.id],
  ['wrong sequence', ['groups', 1, 'sequence'], 1],
  ['row 1 as a group', ['groups', 0, 'sourceRow'], 1],
  ['other source row', ['groups', 0, 'sourceRow'], 3],
  ['wrong word count', ['groups', 0, 'words'], seed.groups[0]!.words.slice(1)],
  ['duplicate word ID', ['groups', 0, 'words', 1, 'id'], seed.groups[0]!.words[0]!.id],
  ['cross-group duplicate ID', ['groups', 1, 'words', 0, 'id'], seed.groups[0]!.words[0]!.id],
  ['nonopaque word ID', ['groups', 0, 'words', 0, 'id'], 'word-C'],
  ['unknown dimension', ['groups', 0, 'words', 0, 'dimension'], 'X'],
  ['duplicate dimension', ['groups', 0, 'words', 1, 'dimension'], 'C'],
  ['missing translation', ['groups', 0, 'words', 0, 'textAr'], ''],
  ['invalid source cell', ['groups', 0, 'words', 0, 'source', 'arCell'], 'B0'],
  ['wrong English column', ['groups', 0, 'words', 0, 'source', 'enCells'], ['C2']],
  ['wrong Arabic column', ['groups', 0, 'words', 0, 'source', 'arCell'], 'D2'],
  ['lost C7 join', ['groups', 2, 'words', 1, 'source', 'enCells'], ['C6']],
  ['missing profile', ['profiles'], seed.profiles.slice(1)],
  ['duplicate profile', ['profiles', 1, 'code'], seed.profiles[0]!.code],
  ['self-pair code', ['profiles', 1, 'code'], 'DD'],
  ['wrong profile row', ['profiles', 0, 'sourceRow'], 4],
  ['missing N label', ['profiles', 0, 'labelAr'], null],
  ['invented description', ['profiles', 0, 'descriptionAr'], 'invented prose'],
  ['invented name', ['profiles', 0, 'nameAr'], 'invented name'],
  ['missing Arabic description', ['profiles', 0, 'descriptionAr'], null],
  ['missing raw nullable field', ['profiles', 0, 'rawP'], undefined, true],
];
for (const [name, path, value, remove] of badSources) {
  test(`rejects source: ${name}`, () => {
    const source = changedAt(seed, path, value, remove);
    assert.throws(() => scoreAssessment(source, valid), AssessmentValidationError);
    assert.throws(() => toPublicAssessment(source), AssessmentValidationError);
  });
}

test('rejects nonobject sources and malformed per-group answers', () => {
  for (const source of [null, [], 'source', 1]) {
    assert.throws(() => validateAssessmentSeed(source), AssessmentValidationError);
  }
  for (const answer of [null, {}, { ...first, groupId: 'unknown' }]) {
    assert.throws(() => validateGroupAnswer(seed, answer), AssessmentValidationError);
  }
});

test('public DTO is an allowlist of IDs/sequence/visible text, with no source mappings', () => {
  const publicData = toPublicAssessment(seed);
  assert.deepEqual(Object.keys(publicData), ['assessmentVersion', 'groups']);
  for (const group of publicData.groups) {
    assert.deepEqual(Object.keys(group), ['id', 'sequence', 'words']);
    for (const word of group.words) {
      assert.deepEqual(Object.keys(word), ['id', 'textEn', 'textAr']);
      assert.match(word.id, /^w_[a-f0-9]{16}$/);
    }
  }
  for (const field of ['dimension', 'source', 'weights', 'profiles', 'rawP', 'sourceSha256']) {
    assert.equal(JSON.stringify(publicData).includes(`"${field}"`), false);
  }
  publicData.groups[0]!.words[0]!.textEn = 'local change';
  assert.equal(seed.groups[0]!.words[0]!.textEn, 'Accurate');
});

test('scores ignore group submission order and preserve source/answer inputs', () => {
  const before = JSON.stringify({ seed, valid });
  assert.deepEqual(scoreAssessment(seed, [...valid].reverse()).scores, { D: 56, I: 42, S: 28, C: 14 });
  assert.equal(JSON.stringify({ seed, valid }), before);
});

test('candidate content is detached from source and other scoring results', () => {
  const result = scoreAssessment(seed, valid);
  const candidate = result.candidateProfiles[0]!;
  assert.notEqual(candidate, seed.profiles.find(profile => profile.code === candidate.code));
  Reflect.set(candidate, 'descriptionAr', 'local change');
  assert.equal(scoreAssessment(seed, valid).profile!.descriptionAr, 'المقنع');
});

test('1,000 mixed responses match an independent 24-permutation candidate/rank oracle', () => {
  let state = 20261014;
  for (let iteration = 0; iteration < 1000; iteration += 1) {
    const answers = seed.groups.map(group => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const dimensions = allOrders[state % allOrders.length]!;
      return { groupId: group.id, rankedWordIds: dimensions.map(d => group.words.find(word => word.dimension === d)!.id) };
    });
    const result = scoreAssessment(seed, answers);
    assert.equal(result.totalPoints, 140);
    for (const dimension of DIMENSIONS) assert.ok(result.scores[dimension] >= 14 && result.scores[dimension] <= 56);
    const allowed = allOrders.filter(dimensions => dimensions.every((d, index) =>
      index === 0 || result.scores[dimensions[index - 1]!] >= result.scores[d]));
    const expected = new Set(allowed.map(dimensions => dimensions.slice(0, 2).join('')));
    assert.deepEqual(new Set(result.candidateProfileCodes), expected);
    assert.equal(result.profileStatus, expected.size === 1 ? 'SINGLE' : 'TIED');
    assert.equal(result.profileCode !== null, expected.size === 1);
    assert.equal(result.candidateProfiles.length, expected.size);
    assert.deepEqual(new Set(result.scoreRanking.flatMap(entry => entry.dimensions)), new Set(DIMENSIONS));
    for (const entry of result.scoreRanking) {
      assert.equal(entry.rank, 1 + DIMENSIONS.filter(d => result.scores[d] > entry.score).length);
      assert.ok(entry.dimensions.every(d => result.scores[d] === entry.score));
    }
  }
});
