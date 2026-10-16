'use client';

import { useEffect, useState } from 'react';
import { ApiError, apiJson } from '../lib/http';
import type { Cohort, ManagerSummary } from '../lib/staff-types';
import InviteForm from './invite-form';
import ParticipantTable from './participant-table';
import ManagerMetrics from './manager-metrics';
import styles from './staff.module.css';

export default function StaffScreen({ manager = false }: { manager?: boolean }) {
  const [snapshot, setSnapshot] = useState<Cohort | ManagerSummary | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ status: number; message: string } | null>(null);
  const endpoint = manager ? '/api/manager/summary' : '/api/participants';
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setFailure(null);
    void apiJson<Cohort | ManagerSummary>(endpoint, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setSnapshot(data);
    }).catch(error => {
      if (controller.signal.aborted) return;
      const status = error instanceof ApiError ? error.status : 0;
      if (status === 401 || status === 403) setSnapshot(null);
      setFailure({ status, message: error instanceof Error ? error.message : 'Unable to load cohort.' });
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, attempt]);
  const refresh = () => setAttempt(value => value + 1);
  return <main className={styles.page}>
    <h1>{manager ? 'Manager dashboard' : 'Participant management'}</h1>
    <nav aria-label="Staff navigation"><a href="/login">Account / sign out</a>{manager && <a href="/facilitator">Participant management</a>}</nav>
    <p>One shared demo cohort. Refresh to load the latest saved records.</p>
    <button type="button" disabled={loading} onClick={refresh}>Refresh cohort</button>
    {loading && <p role="status">{snapshot ? 'Refreshing cohort…' : 'Loading cohort…'}</p>}
    {failure && <section className={styles.error} aria-label="Cohort availability">
      <h2>{failure.status === 401 ? 'Sign in required' : failure.status === 403 ? 'Access denied' : 'Unable to refresh cohort'}</h2>
      <p role="alert">{failure.message}</p>{snapshot && <p>Showing the previous snapshot. Refresh to retry.</p>}
      {failure.status === 401 && <a href="/login">Staff sign in</a>}
    </section>}
    {snapshot && <>
      <InviteForm onCreated={refresh} />
      {manager && 'totalInvited' in snapshot && <ManagerMetrics summary={snapshot} />}
      <ParticipantTable participants={snapshot.participants} />
    </>}
  </main>;
}
