'use client';

import { useRef, useState, type FormEvent } from 'react';
import { apiJson, jsonMutation } from '../lib/http';
import styles from './staff.module.css';

export default function InviteForm({ onCreated }: { onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [invitationUrl, setInvitationUrl] = useState('');
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setMessage('');
    try {
      const response = await apiJson<{ invitationUrl: string }>('/api/participants', jsonMutation('POST', {
        name: data.get('name'), email: String(data.get('email') ?? '').trim() || null,
      }));
      setInvitationUrl(response.invitationUrl);
      setMessage('Invitation created. Copy this link now; existing links cannot be retrieved later.');
      form.reset(); onCreated();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to create invitation.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(invitationUrl); setMessage('Invitation copied.'); }
    catch { setMessage('Select and copy the invitation link below.'); }
  }

  return <section className={styles.panel} aria-label="Create invitation">
    <h2>Create invitation</h2>
    <form onSubmit={event => void create(event)} aria-busy={busy}>
      <fieldset className={styles.fields} disabled={busy}>
        <legend>Participant details</legend>
        <label htmlFor="participant-name">Name<input id="participant-name" name="name" required maxLength={200} autoComplete="off" /></label>
        <label htmlFor="participant-email">Email (optional)<input id="participant-email" name="email" type="email" maxLength={254} autoComplete="off" /></label>
        <button type="submit">{busy ? 'Creating…' : 'Create invitation'}</button>
      </fieldset>
    </form>
    {invitationUrl && <div className={styles.invitation}>
      <label htmlFor="invitation-link">New invitation link</label>
      <input className={styles.link} id="invitation-link" value={invitationUrl} readOnly dir="ltr" onFocus={event => event.currentTarget.select()} />
      <button type="button" onClick={() => void copy()}>Copy invitation link</button>
    </div>}
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
