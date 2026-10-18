'use client';
import { useEffect, useState } from 'react';
export default function Callback() {
  const [message, setMessage] = useState('Completing sign-in…');
  useEffect(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    const access = params.get('access_token');
    const refresh = params.get('refresh_token');
    history.replaceState(null, '', '/auth/callback');
    if (!access || !refresh) {
      setMessage(
        'This sign-in link is missing a session. Request another link.',
      );
      return;
    }
    fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'session',
        access_token: access,
        refresh_token: refresh,
      }),
    })
      .then(async (response) => {
        const result = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(result.error || 'Sign-in failed.');
        location.replace('/');
      })
      .catch((error) => setMessage(error.message));
  }, []);
  return (
    <main className="desk initial-state">
      <h1>Passforth</h1>
      <p role="status">{message}</p>
      <a href="/login">Return to sign-in</a>
    </main>
  );
}
