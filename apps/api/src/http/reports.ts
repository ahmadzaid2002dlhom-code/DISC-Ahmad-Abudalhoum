import type { Prisma, Result } from '../generated/prisma/client.ts';

/** Stored provenance stays private; export only the candidate content used by reports. */
function candidateDto(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) throw new Error('Invalid stored candidate snapshots.');
  return value.map(profile => {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Invalid stored candidate.');
    const { code, nameAr, descriptionAr, descriptionEn } = profile;
    if (typeof code !== 'string' || typeof nameAr !== 'string' || typeof descriptionAr !== 'string' ||
        (descriptionEn !== null && typeof descriptionEn !== 'string')) throw new Error('Invalid stored candidate text.');
    return { code, nameAr, descriptionAr, descriptionEn };
  });
}

/** Return stored snapshots only. Reading a report never loads or re-scores a seed. */
export function resultDto(result: Result) {
  return {
    scores: { D: result.scoreD, I: result.scoreI, S: result.scoreS, C: result.scoreC },
    totalPoints: result.scoreD + result.scoreI + result.scoreS + result.scoreC,
    scoreRanking: result.scoreRanking,
    tiedScoreGroups: result.tiedScoreGroups,
    profileStatus: result.profileStatus,
    profileCode: result.profileCode,
    candidateProfileCodes: result.candidateProfileCodes,
    candidateProfiles: candidateDto(result.candidateProfiles),
    completedAt: result.completedAt,
    assessmentVersion: result.assessmentVersion,
    scoringPolicyVersion: result.scoringPolicyVersion,
    profileTextPolicyVersion: result.profileTextPolicyVersion,
  };
}
