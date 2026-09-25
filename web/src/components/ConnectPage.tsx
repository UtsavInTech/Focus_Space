import { useCallback, useEffect, useRef, useState } from 'react';
import { navigate } from '../router';
import { useAuth } from '../auth';
import * as api from '../api';
import { installedExtensionId, sendHandoffToExtension, type ConnectOutcome } from '../connect';
import { Logo, Wordmark } from './Logo';

/**
 * `/connect` — where the extension sends someone to finish signing in.
 *
 * It is one page because there is one question behind all of it: *is this browser signed in to
 * FocusSpace?* If it is, the extension can have a session in one round trip and nobody types anything.
 * If it is not, the ordinary sign-in page runs first and comes back here.
 *
 * The extension never shows a second login. It opens this, and this either finishes silently or hands
 * over to the sign-in the website already has — including "Continue with Google", which the extension
 * gets for free precisely because the whole OAuth flow lives on the server and the website.
 */
export function ConnectPage() {
  const auth = useAuth();
  const [state, setState] = useState<'working' | ConnectOutcome>('working');
  const [error, setError] = useState<string | null>(null);
  /** Strict mode mounts effects twice; a handoff code is single-use, so it must be asked for once. */
  const started = useRef(false);

  const connect = useCallback(async () => {
    setState('working');
    setError(null);
    const token = await auth.token();
    if (!token) return; // signed out: the sign-in prompt below is the next step, not an error
    try {
      const { code } = await api.handoffCreate(token, 'extension');
      setState(await sendHandoffToExtension(code));
    } catch (err) {
      setState('failed');
      setError(err instanceof api.ApiError ? err.message : 'Something went wrong. Try again.');
    }
  }, [auth]);

  useEffect(() => {
    if (!auth.ready || started.current) return;
    if (!auth.user) {
      // Sign in first, then come straight back and finish — never two logins in a row.
      navigate(`/signin?next=${encodeURIComponent('/connect')}`);
      return;
    }
    started.current = true;
    void connect();
  }, [auth.ready, auth.user, connect]);

  const installed = installedExtensionId() !== null;

  return (
    <section className="fsw-auth">
      <div className="fsw-auth-card">
        <a className="fsw-brand fsw-auth-brand" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
          <Logo />
          <Wordmark />
        </a>

        {state === 'working' && (
          <>
            <h1>Connecting FocusSpace</h1>
            <p className="fsw-auth-sub">Signing the extension in to your account…</p>
          </>
        )}

        {state === 'connected' && (
          <>
            <h1>You’re signed in</h1>
            <p className="fsw-auth-sub">
              FocusSpace in this browser is now on your account{auth.user?.email ? `, ${auth.user.email}` : ''}. Your plan and AI allowance apply everywhere you
              sign in. You can close this tab.
            </p>
            <button type="button" className="fsw-btn fsw-btn-primary fsw-btn-block fsw-btn-lg" onClick={() => window.close()}>
              Close this tab
            </button>
          </>
        )}

        {(state === 'no-extension' || state === 'failed') && (
          <>
            <h1>{state === 'no-extension' ? 'FocusSpace isn’t installed here' : 'That didn’t connect'}</h1>
            <p className="fsw-auth-sub">
              {state === 'no-extension'
                ? 'This browser has no FocusSpace extension to sign in. Add it from the Chrome Web Store, then come back.'
                : (error ?? 'The extension did not accept the sign-in. It may need reloading.')}
            </p>
            {installed && (
              <button type="button" className="fsw-btn fsw-btn-primary fsw-btn-block fsw-btn-lg" onClick={() => void connect()}>
                Try again
              </button>
            )}
            <p className="fsw-auth-switch">
              You are signed in on this website either way —{' '}
              <button type="button" className="fsw-link" onClick={() => navigate('/account')}>
                open your account
              </button>
              .
            </p>
          </>
        )}
      </div>
    </section>
  );
}
