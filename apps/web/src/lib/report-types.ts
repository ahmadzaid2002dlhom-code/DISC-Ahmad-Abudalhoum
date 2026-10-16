// Public stored-report response types. No scoring or private assessment imports.
export type ReportDimension = 'D' | 'I' | 'S' | 'C';
export type StoredReport = {
  scores: Record<ReportDimension, number>;
  totalPoints: number;
  scoreRanking: { rank: number; score: number; dimensions: ReportDimension[] }[];
  tiedScoreGroups: { score: number; dimensions: ReportDimension[] }[];
  profileStatus: 'SINGLE' | 'TIED';
  profileCode: string | null;
  candidateProfileCodes: string[];
  candidateProfiles: { code: string; nameAr: string; descriptionAr: string; descriptionEn: string | null }[];
  completedAt: string;
  assessmentVersion: string;
  scoringPolicyVersion: string;
  profileTextPolicyVersion: string;
};
export type ReportResponse = { result: StoredReport; participant?: { id: string; name: string; status: 'COMPLETED' } };
