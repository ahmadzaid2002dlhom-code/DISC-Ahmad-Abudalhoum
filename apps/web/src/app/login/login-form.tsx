'use client';

import { useEffect, useState, type FormEvent } from 'react';

type Principal = { type: 'STAFF'; email: string; role: 'FACILITATOR' | 'MANAGER' } |
  { type: 'PARTICIPANT'; name: string };

export default function LoginForm() {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/auth/me', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (response.ok) setPrincipal((await response.json() as { principal: Principal }).principal);
        else if (response.status !== 401) setMessage('Unable to check your session. Please try again.');
      }).catch(() => { if (!controller.signal.aborted) setMessage('Unable to connect. Please try again.'); });
    return () => controller.abort();
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ email: values.get('email'), password: values.get('password') }),
      });
      const body = await response.json() as { error?: string; redirectTo?: string };
      if (!response.ok) { setMessage(body.error ?? 'Login failed.'); return; }
      form.reset();
      // The API has rotated and saved the PostgreSQL session before responding.
      window.location.assign('/login');
    } catch { setMessage('Unable to connect. Please try again.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store',
      });
      if (!response.ok) { setMessage('Logout failed. Please try again.'); return; }
      setPrincipal(null);
      setMessage('Signed out.');
    } catch { setMessage('Unable to connect. Please try again.'); }
    finally { setBusy(false); }
  }

  return <main style={{ maxWidth: '28rem', margin: '3rem auto', padding: '1rem', fontFamily: 'system-ui' }}>
    <h1>DISC staff login</h1>
    <p>Facilitators and managers use their separate staff accounts.</p>
    {principal && <section aria-label="Current session">
      <p>Signed in as {principal.type === 'STAFF' ? `${principal.email} (${principal.role})` : principal.name}.</p>
      {principal.type === 'STAFF' && <nav aria-label="Staff pages">
        <p><a href="/facilitator">Participant management</a></p>
        {principal.role === 'MANAGER' && <p><a href="/manager">Manager dashboard</a></p>}
      </nav>}
      <button type="button" onClick={() => void logout()} disabled={busy}>Sign out</button>
      <p>Signing in below replaces this session.</p>
    </section>}
    <form onSubmit={event => void login(event)} aria-busy={busy}>
      <fieldset disabled={busy} style={{ display: 'grid', gap: '0.75rem' }}>
        <legend>Staff credentials</legend>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required maxLength={254} />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={256} />
        <button type="submit">{busy ? 'Please wait…' : 'Sign in'}</button>
      </fieldset>
    </form>
    <p role="status" aria-live="polite">{message}</p>
  </main>;
}
