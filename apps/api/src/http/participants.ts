import type { Participant } from '../generated/prisma/client.ts';

export function participantDto(participant: Participant) {
  return {
    id: participant.id, name: participant.name, email: participant.email, status: participant.status,
    assessmentVersion: participant.assessmentVersion, scoringPolicyVersion: participant.scoringPolicyVersion,
    profileTextPolicyVersion: participant.profileTextPolicyVersion, inviteExpiresAt: participant.inviteExpiresAt,
    createdAt: participant.createdAt, startedAt: participant.startedAt, completedAt: participant.completedAt,
  };
}
