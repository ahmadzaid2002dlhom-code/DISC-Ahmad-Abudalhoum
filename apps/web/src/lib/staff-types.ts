import type { StoredReport, ReportDimension } from './report-types.ts';

export type StaffParticipant = {
  id: string; name: string; email: string | null;
  status: 'INVITED' | 'IN_PROGRESS' | 'COMPLETED';
  result: StoredReport | null;
};
export type Cohort = { participants: StaffParticipant[] };
export type ManagerSummary = Cohort & {
  totalInvited: number; completed: number; pending: number; completionPercentage: number;
  distribution: Record<string, number>;
  means: Record<ReportDimension, number> | null;
};
