import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Result, Prisma } from '../src/generated/prisma/client.ts';
import { resultDto } from '../src/http/reports.ts';
import { scoreAssessment } from '../src/domain/scoring.ts';
import { seed, mixed } from './helpers/assessment.ts';

test('all 12 stored candidate slogans survive the public allowlist without raw source provenance', () => {
  const scored = scoreAssessment(seed, mixed(['D', 'I', 'S', 'C'], ['C', 'S', 'I', 'D']));
  const stored: Result = {
    id: 'fixture-result', participantId: 'fixture-participant', scoreD: 35, scoreI: 35, scoreS: 35, scoreC: 35,
    scoreRanking: scored.scoreRanking as Prisma.JsonValue, tiedScoreGroups: scored.tiedScoreGroups as Prisma.JsonValue,
    profileStatus: 'TIED', profileCode: null, candidateProfileCodes: scored.candidateProfileCodes,
    candidateProfiles: scored.candidateProfiles as unknown as Prisma.JsonValue, completedAt: new Date(),
    assessmentVersion: scored.assessmentVersion, scoringPolicyVersion: scored.scoringPolicyVersion, profileTextPolicyVersion: scored.profileTextPolicyVersion,
  };
  const before = structuredClone(stored);
  const dto = resultDto(stored);
  assert.equal(dto.candidateProfiles.length, 12); assert.equal(dto.profileCode, null);
  for (const [index, candidate] of dto.candidateProfiles.entries()) {
    assert.deepEqual(Object.keys(candidate).sort(), ['code', 'descriptionAr', 'descriptionEn', 'nameAr']);
    assert.equal(candidate.nameAr, scored.candidateProfiles[index]!.labelAr);
    assert.equal(candidate.descriptionAr, candidate.nameAr); assert.equal(candidate.descriptionEn, null);
  }
  assert.deepEqual(stored, before, 'Reading never rewrites the full stored snapshot');
});
