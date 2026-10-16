'use client';

import { useEffect, useRef, useState } from 'react';
import { apiJson, jsonMutation } from '../../lib/http';
import styles from '../../components/assessment.module.css';

export default function InviteStart({ token }: { token?: string }) {
  const [inviteToken, setInviteToken] = useState(token ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  useEffect(() => {
    // Preserve invitations created in Phase 3. Reading a fragment never redeems it.
    if (!token) setInviteToken(new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  }, [token]);
  const valid = /^[A-Za-z0-9_-]{43}$/.test(inviteToken);

  async function start() {
    if (inFlight.current || !valid) return;
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      const result = await apiJson<{ redirectTo: string }>('/api/invitations/redeem', jsonMutation('POST', { token: inviteToken }));
      // Remove the token from this history entry only after the session was saved.
      window.location.replace(result.redirectTo === '/result' ? '/result' : '/assessment');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to start. Please retry.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <main className={styles.page}>
    <h1>Your DISC invitation</h1>
    <p>Rank four words in each of 14 groups from MOST to LEAST like you.</p>
    <p>Start or continue to open your saved progress. Opening this page alone does not start the assessment.</p>
    <button className={styles.primary} type="button" disabled={busy || !valid} onClick={() => void start()}>
      {busy ? 'Opening your assessment…' : 'Start or continue'}
    </button>
    <p role="status" aria-live="polite">{!valid ? 'This invitation link is incomplete or invalid.' : error}</p>
  </main>;
}
