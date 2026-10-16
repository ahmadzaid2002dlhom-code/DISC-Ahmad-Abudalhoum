'use client';

import { useEffect, useState } from 'react';
import { ApiError, apiJson } from '../lib/http';
import type { ReportResponse } from '../lib/report-types';
import StoredReport from './stored-report';
import styles from './report.module.css';

export default function ReportScreen({ participantId }: { participantId?: string }) {
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [failure, setFailure] = useState<{ status: number; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const staff = participantId !== undefined;
  const endpoint = staff ? `/api/participants/${encodeURIComponent(participantId)}/report` : '/api/assessment/result';

  useEffect(() => {
    const controller = new AbortController();
    setReport(null); setFailure(null);
    void apiJson<ReportResponse>(endpoint, { signal: controller.signal })
      .then(body => { if (!controller.signal.aborted) setReport(body); })
      .catch(error => {
        if (!controller.signal.aborted) setFailure({
          status: error instanceof ApiError ? error.status : 0,
          message: error instanceof Error ? error.message : 'Unable to load the report. Please retry.',
        });
      });
    return () => controller.abort();
  }, [endpoint, attempt]);

  return <main className={styles.page}>
    <h1>{staff ? 'Participant report' : 'Your DISC result'}</h1>
    {staff && <nav aria-label="Staff navigation"><a href="/facilitator">Participant management</a></nav>}
    {report ? <>
      {report.participant && <p>{report.participant.name}</p>}
      <StoredReport result={report.result} />
    </> : failure ? <section className={styles.notice} aria-label="Report availability">
      <h2>{failure.status === 409 ? 'Report pending' : failure.status === 401 ? 'Sign in required' : failure.status === 403 ? 'Report access denied' : failure.status === 404 ? 'Report not found' : 'Unable to load report'}</h2>
      <p role={failure.status === 409 ? 'status' : 'alert'}>{failure.status === 409
        ? 'This assessment has not been completed. The report will be available after submission.' : failure.message}</p>
      {failure.status === 401 && <p>{staff
        ? <a href="/login">Sign in as a facilitator or manager</a>
        : 'Open your participant invitation and choose Start or continue to restore your session.'}</p>}
      {failure.status === 409 && !staff && <p><a href="/assessment">Continue assessment</a></p>}
      <button type="button" onClick={() => setAttempt(value => value + 1)}>Reload report</button>
    </section> : <p role="status">Loading the stored report…</p>}
  </main>;
}
