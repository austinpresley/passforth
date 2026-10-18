'use client';
import { useState } from 'react';
export default function Login() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main className="desk initial-state">
      <h1>Sign in to Passforth</h1>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            const response = await fetch('/api/session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'email', email }),
            });
            const data = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(data.error || 'Sign-in failed.');
            setMessage('Check your email for the private sign-in link.');
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Email
          <input
            style={{ display: 'block', width: '100%', margin: '8px 0 16px' }}
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? 'Sending…' : 'Email sign-in link'}
        </button>
        <p role="status">{message}</p>
      </form>
    </main>
  );
}
