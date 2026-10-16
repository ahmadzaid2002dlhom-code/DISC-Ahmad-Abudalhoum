import type { Result } from '../generated/prisma/client.ts';

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
    candidateProfiles: result.candidateProfiles,
    completedAt: result.completedAt,
    assessmentVersion: result.assessmentVersion,
    scoringPolicyVersion: result.scoringPolicyVersion,
    profileTextPolicyVersion: result.profileTextPolicyVersion,
  };
}
