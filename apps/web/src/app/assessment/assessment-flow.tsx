'use client';

import { useEffect, useRef, useState } from 'react';
import RankedWords from '../../components/ranked-words';
import { ApiError, apiJson, jsonMutation } from '../../lib/http';
import type { ActiveAssessment, AssessmentResponse, ConfirmedAnswer } from '../../lib/assessment-types';
import styles from '../../components/assessment.module.css';

const same = (left: readonly string[], right: readonly string[] | undefined): boolean =>
  !!right && left.length === right.length && left.every((value, index) => value === right[index]);

export default function AssessmentFlow() {
  const [assessment, setAssessment] = useState<ActiveAssessment | null>(null);
  const [saved, setSaved] = useState<Record<string, ConfirmedAnswer>>({});
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [index, setIndex] = useState(0);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false); setError('');
    void apiJson<AssessmentResponse>('/api/assessment', { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      if (data.status === 'COMPLETED') { window.location.replace('/result'); return; }
      setAssessment(data);
      const answers = Object.fromEntries(data.answers.map(answer => [answer.groupId, answer]));
      setSaved(answers); setDrafts({});
      const firstUnconfirmed = data.groups.findIndex(group => !answers[group.id]);
      setIndex(firstUnconfirmed === -1 ? data.groups.length - 1 : firstUnconfirmed);
      setLoaded(true);
    }).catch(failure => {
      if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : 'Unable to load your assessment.'); setLoaded(true); }
    });
    return () => controller.abort();
  }, [loadAttempt]);

  useEffect(() => { if (assessment) heading.current?.focus(); }, [index, assessment]);

  async function recoverCompletion(failure: unknown) {
    if (failure instanceof ApiError && failure.status === 409) {
      // Handles another tab completing, or a committed submit whose response was lost.
      try {
        await apiJson('/api/assessment/result');
        window.location.replace('/result');
        return;
      } catch { /* Keep the original save/submit error when still in progress. */ }
    }
    setError(failure instanceof Error ? failure.message : 'Unable to save. Please retry.');
  }

  const group = assessment?.groups[index];
  const ids = group ? drafts[group.id] ?? saved[group.id]?.rankedWordIds ?? group.words.map(word => word.id) : [];
  const confirmedCount = assessment?.groups.filter(g => saved[g.id]).length ?? 0;
  const currentConfirmed = !!group && same(ids, saved[group.id]?.rankedWordIds);
  const otherDraftsUnconfirmed = assessment?.groups.some(g => g.id !== group?.id && drafts[g.id] && !same(drafts[g.id]!, saved[g.id]?.rankedWordIds)) ?? false;
  const last = !!assessment && index === assessment.groups.length - 1;

  async function persistCurrent(): Promise<void> {
    if (!group) return;
    const { answer } = await apiJson<{ answer: ConfirmedAnswer }>(`/api/assessment/answers/${encodeURIComponent(group.id)}`,
      jsonMutation('PUT', { rankedWordIds: [...ids] }));
    setSaved(previous => ({ ...previous, [answer.groupId]: answer }));
    setDrafts(previous => ({ ...previous, [answer.groupId]: [...answer.rankedWordIds] }));
  }

  async function confirm(submit: boolean) {
    if (inFlight.current || dragging || !group) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      // Always PUT, including untouched defaults and the final flush before submit.
      await persistCurrent();
      if (submit) {
        await apiJson('/api/assessment/submit', jsonMutation('POST', {}));
        window.location.replace('/result');
      } else {
        setAnnouncement(`Group ${index + 1} confirmed and saved.`);
        if (!last) setIndex(value => value + 1);
      }
    } catch (failure) { await recoverCompletion(failure); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function move(from: number, to: number) {
    if (inFlight.current || !group || from === to || to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [wordId] = next.splice(from, 1);
    next.splice(to, 0, wordId!);
    setDrafts(previous => ({ ...previous, [group.id]: next }));
    const word = group.words.find(word => word.id === wordId)!;
    setAnnouncement(`${word.textEn} moved to position ${to + 1}. Confirm to save this order.`);
    setError('');
  }

  if (!loaded) return <main className={styles.page}><p role="status">Loading your assessment…</p></main>;
  if (!assessment || !group) return <main className={styles.page}>
    <h1>DISC assessment</h1><p role="alert">{error}</p>
    <p>Open your invitation and choose Start or continue to restore your participant session.</p>
    <button type="button" onClick={() => setLoadAttempt(value => value + 1)}>Retry loading</button>
  </main>;

  const words = ids.map(id => group.words.find(word => word.id === id)!);
  return <main className={styles.page} aria-busy={busy}>
    <h1>DISC assessment</h1>
    <p>{confirmedCount} of {assessment.groups.length} groups confirmed</p>
    <progress aria-label="Confirmed groups" max={assessment.groups.length} value={confirmedCount} />
    <h2 ref={heading} tabIndex={-1}>Group {index + 1} of {assessment.groups.length}</h2>
    <p id="reorder-help">Put MOST like you at the top and LEAST like you at the bottom. Drag a handle or use Move Up and Move Down.</p>
    <p><strong>MOST like me</strong></p>
    <RankedWords key={group.id} words={words} disabled={busy} moving={dragging} onMove={move} onDragging={setDragging} />
    <p><strong>LEAST like me</strong></p>
    <p className={styles.hint}>{currentConfirmed ? 'This order is confirmed and saved.' : 'This order is not confirmed yet.'}</p>
    {error && <p role="alert" className={styles.error}>{error} Your order has been kept; retry confirmation.</p>}
    <div className={styles.navigation}>
      <button type="button" disabled={busy || dragging || index === 0} onClick={() => { if (!inFlight.current) { setIndex(value => value - 1); setError(''); } }}>Back</button>
      <button className={styles.primary} type="button" disabled={busy || dragging} onClick={() => void confirm(false)}>
        {busy ? 'Saving…' : error ? 'Retry confirmation' : last ? 'Confirm last group' : 'Next — confirm and save'}
      </button>
    </div>
    {last && <section aria-label="Submit assessment">
      <p>Confirm all 14 groups, including any changed orders, before submitting.</p>
      <button className={styles.primary} type="button" disabled={busy || dragging || confirmedCount !== assessment.groups.length || !currentConfirmed || otherDraftsUnconfirmed}
        onClick={() => void confirm(true)}>Submit assessment</button>
    </section>}
    <p role="status" aria-live="polite" className={styles.message}>{announcement}</p>
  </main>;
}
