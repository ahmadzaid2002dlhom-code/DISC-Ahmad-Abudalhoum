// Public HTTP contracts only. No imports of the private API scorer or seed.
export type VisibleWord = { id: string; textEn: string; textAr: string };
export type VisibleGroup = { id: string; sequence: number; words: VisibleWord[] };
export type ConfirmedAnswer = { groupId: string; rankedWordIds: string[]; confirmedAt: string; updatedAt: string };
export type ActiveAssessment = {
  status: 'IN_PROGRESS'; assessmentVersion: string; groups: VisibleGroup[]; answers: ConfirmedAnswer[];
};
export type AssessmentResponse = ActiveAssessment | { status: 'COMPLETED'; redirectTo: string };
