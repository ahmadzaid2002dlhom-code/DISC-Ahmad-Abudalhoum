import { ProfileCode } from '../generated/prisma/enums.ts';
import type { PrismaClient } from '../generated/prisma/client.ts';
import { participantDto } from '../http/participants.ts';
import { resultDto } from '../http/reports.ts';

/** All staff share one cohort. Relation queries see the same PostgreSQL snapshot. */
export async function readCohort(db: PrismaClient) {
  return db.$transaction(async tx => {
    const records = await tx.participant.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { result: true },
    });
    return records.map(p => ({ ...participantDto(p), result: p.status === 'COMPLETED' && p.result ? resultDto(p.result) : null }));
  }, { isolationLevel: 'RepeatableRead' });
}

export async function readManagerSummary(db: PrismaClient) {
  // The response table and every metric use this same materialized snapshot.
  const participants = await readCohort(db);
  const totalInvited = participants.length;
  const completedRows = participants.filter(p => p.status === 'COMPLETED' && p.result);
  const completed = completedRows.length;
  const pending = participants.filter(p => p.status === 'INVITED' || p.status === 'IN_PROGRESS').length;
  const distribution = Object.fromEntries([...Object.values(ProfileCode), 'TIED'].map(code => [code, 0])) as Record<ProfileCode | 'TIED', number>;
  const totals = { D: 0, I: 0, S: 0, C: 0 };
  for (const participant of completedRows) {
    const result = participant.result!;
    const category = result.profileStatus === 'TIED' ? 'TIED' : result.profileCode;
    if (!category) throw new Error('Completed SINGLE result has no code.');
    distribution[category]++;
    for (const dimension of ['D', 'I', 'S', 'C'] as const) totals[dimension] += result.scores[dimension];
  }
  if (completed + pending !== totalInvited || Object.values(distribution).reduce((sum, count) => sum + count, 0) !== completed) {
    throw new Error('Inconsistent stored cohort.');
  }
  return {
    totalInvited, completed, pending, completionPercentage: totalInvited ? 100 * completed / totalInvited : 0,
    distribution,
    means: completed ? { D: totals.D / completed, I: totals.I / completed, S: totals.S / completed, C: totals.C / completed } : null,
    participants,
  };
}
