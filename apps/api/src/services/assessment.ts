import type { Participant, Prisma, PrismaClient } from '../generated/prisma/client.ts';
import { loadAssessmentSeed } from '../data/assessment.ts';
import { AssessmentValidationError, scoreAssessment, toPublicAssessment, validateGroupAnswer } from '../domain/scoring.ts';
import { HttpError } from '../http/errors.ts';
import { resultDto } from '../http/reports.ts';

function pinnedSeed(participant: Participant) {
  try {
    const seed = loadAssessmentSeed(participant.assessmentVersion);
    if (seed.scoringPolicyVersion !== participant.scoringPolicyVersion ||
        seed.profileTextPolicyVersion !== participant.profileTextPolicyVersion) throw new Error();
    return seed;
  } catch { throw new HttpError(409, 'The pinned assessment version is not available.'); }
}

async function lockParticipant(tx: Prisma.TransactionClient, participantId: string): Promise<Participant> {
  const rows = await tx.$queryRaw<Participant[]>`SELECT * FROM "Participant" WHERE id = ${participantId}::uuid FOR UPDATE`;
  if (!rows[0]) throw new HttpError(404, 'Participant not found.');
  return rows[0];
}

function ensureInProgress(participant: Participant): void {
  if (participant.status === 'COMPLETED') throw new HttpError(409, 'Assessment is completed; answers cannot be changed.');
  if (participant.status !== 'IN_PROGRESS') throw new HttpError(409, 'Start your invitation before answering.');
}

export async function readAssessment(db: PrismaClient, participantId: string) {
  return db.$transaction(async tx => {
    const participant = await tx.participant.findUniqueOrThrow({ where: { id: participantId } });
    // Completed participants never need the current seed or re-scoring to resume.
    if (participant.status === 'COMPLETED') return { status: 'COMPLETED' as const, redirectTo: '/result' };
    ensureInProgress(participant);
    const seed = pinnedSeed(participant);
    const answers = await tx.answer.findMany({ where: { participantId }, orderBy: { groupId: 'asc' } });
    return {
      status: 'IN_PROGRESS' as const,
      ...toPublicAssessment(seed),
      answers: answers.map(answer => ({
        groupId: answer.groupId, rankedWordIds: answer.rankedWordIds,
        confirmedAt: answer.confirmedAt, updatedAt: answer.updatedAt,
      })),
    };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function saveAnswer(db: PrismaClient, participantId: string, groupId: string, rankedWordIds: unknown) {
  return db.$transaction(async tx => {
    // Do not use status read by authorization middleware: it may predate a submit.
    const participant = await lockParticipant(tx, participantId);
    ensureInProgress(participant);
    const seed = pinnedSeed(participant);
    const answer = { groupId, rankedWordIds };
    try { validateGroupAnswer(seed, answer); }
    catch (error) {
      if (error instanceof AssessmentValidationError) throw new HttpError(400, error.message);
      throw error;
    }
    const confirmedAt = new Date();
    const saved = await tx.answer.upsert({
      where: { participantId_groupId: { participantId, groupId } },
      create: { participantId, groupId, rankedWordIds: [...answer.rankedWordIds], confirmedAt },
      update: { rankedWordIds: [...answer.rankedWordIds], confirmedAt },
    });
    return { groupId: saved.groupId, rankedWordIds: saved.rankedWordIds, confirmedAt: saved.confirmedAt, updatedAt: saved.updatedAt };
  }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 });
}

export async function submitAssessment(db: PrismaClient, participantId: string) {
  return db.$transaction(async tx => {
    // Both mutation paths lock exactly this row before any status decisions.
    const participant = await lockParticipant(tx, participantId);
    if (participant.status === 'COMPLETED') {
      return resultDto(await tx.result.findUniqueOrThrow({ where: { participantId } }));
    }
    ensureInProgress(participant);
    const seed = pinnedSeed(participant);
    const rows = await tx.answer.findMany({ where: { participantId } });
    if (rows.length !== seed.groups.length) throw new HttpError(409, 'Confirm all 14 groups before submitting.');
    let scored;
    try {
      scored = scoreAssessment(seed, rows.map(row => ({ groupId: row.groupId, rankedWordIds: row.rankedWordIds })));
    } catch (error) {
      if (error instanceof AssessmentValidationError) throw new HttpError(409, 'Saved answers are invalid; review and confirm all groups.');
      throw error;
    }
    const completedAt = new Date();
    const result = await tx.result.create({ data: {
      participantId,
      scoreD: scored.scores.D, scoreI: scored.scores.I, scoreS: scored.scores.S, scoreC: scored.scores.C,
      scoreRanking: scored.scoreRanking as Prisma.InputJsonValue,
      tiedScoreGroups: scored.tiedScoreGroups as Prisma.InputJsonValue,
      profileStatus: scored.profileStatus, profileCode: scored.profileCode,
      candidateProfileCodes: scored.candidateProfileCodes,
      candidateProfiles: scored.candidateProfiles as unknown as Prisma.InputJsonValue,
      assessmentVersion: scored.assessmentVersion, scoringPolicyVersion: scored.scoringPolicyVersion,
      profileTextPolicyVersion: scored.profileTextPolicyVersion, completedAt,
    } });
    await tx.participant.update({ where: { id: participantId }, data: { status: 'COMPLETED', completedAt } });
    return resultDto(result);
  }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 });
}
