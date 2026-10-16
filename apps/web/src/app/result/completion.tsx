'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '../../lib/http';
import type { CompletionReceipt } from '../../lib/assessment-types';
import styles from '../../components/assessment.module.css';

// Phase 4 completion receipt. Full scores/ranking/chart/report UI is Phase 5.
export default function Completion() {
  const [result, setResult] = useState<CompletionReceipt | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void apiJson<{ result: CompletionReceipt }>('/api/assessment/result', { signal: controller.signal })
      .then(body => { if (!controller.signal.aborted) setResult(body.result); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load completion.'); });
    return () => controller.abort();
  }, []);
  return <main className={styles.page}>
    <h1>{result ? 'Assessment completed' : 'Assessment completion'}</h1>
    {error ? <><p role="alert">{error}</p><a href="/assessment">Return to assessment</a></> : !result ? <p role="status">Loading your saved result…</p> : <>
      <p>Your result has been saved. Your answers are now locked.</p>
      <h2>{result.profileStatus === 'TIED' ? 'TIED — all candidate profiles' : `SINGLE — ${result.profileCode}`}</h2>
      {result.candidateProfiles.map(profile => <section key={profile.code} className={styles.receipt}>
        <h3>{profile.code} — <span lang="ar" dir="rtl">{profile.nameAr}</span></h3>
        <p lang="ar" dir="rtl">{profile.descriptionAr}</p>
      </section>)}
    </>}
  </main>;
}
