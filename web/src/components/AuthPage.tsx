import { useState } from 'react';
import { navigate, onLinkClick } from '../router';
import { useAuth } from '../auth';
import * as api from '../api';
import { Logo } from './Logo';

/**
 * Sign in and sign up, on one page.
 *
 * Sign-up is the server's three steps — address → code → password — shown as
 * three screens, because the account only exists after the third. That means
 * an abandoned sign-up leaves nothing behind, and it is why the password field
 * comes last rather than first.
 */

type Mode = 'signin' | 'signup';
type Step = 'email' | 'code' | 'password';

export function AuthPage({ mode: initialMode }: { mode: Mode }) {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>('email');

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [ticket, setTicket] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setStep('email');
    setError(null);
    setCode('');
    setPassword('');
  }

  /** One place to run a request: it owns the busy flag and turns any failure into a sentence. */
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    if (mode === 'signin') {
      return void run(async () => {
        await auth.signIn(email.trim(), password);
        navigate('/account');
      });
    }

    if (step === 'email') {
      return void run(async () => {
        const result = await api.signupStart(email.trim());
        // Only a development server ever returns the code; in production this is undefined
        // and the person genuinely has to open their email.
        setDevCode(result.devCode ?? null);
        setStep('code');
      });
    }

    if (step === 'code') {
      return void run(async () => {
        const result = await api.signupVerify(email.trim(), code.trim());
        setTicket(result.ticket);
        setStep('password');
      });
    }

    return void run(async () => {
      await auth.completeSignup(ticket, password);
      navigate('/account');
    });
  };

  return (
    <section className="fsw-auth">
      <div className="fsw-auth-card">
        <a className="fsw-brand fsw-auth-brand" href="/" onClick={onLinkClick('/')}>
          <Logo />
          <span>FocusSpace</span>
        </a>

        <h1>{mode === 'signin' ? 'Sign in' : step === 'password' ? 'Choose a password' : step === 'code' ? 'Check your email' : 'Create your account'}</h1>
        <p className="fsw-auth-sub">
          {mode === 'signin'
            ? 'Your spaces, notes and monthly allowance, on every device.'
            : step === 'password'
              ? 'Last step. Your account is created when you set this.'
              : step === 'code'
                ? `We sent a 6-digit code to ${email}.`
                : 'Free: 5 modes and a monthly AI allowance. No card needed.'}
        </p>

        {!api.apiConfigured && (
          <p className="fsw-auth-error">
            This build has no API configured, so accounts are unavailable. The extension still works fully signed out.
          </p>
        )}

        <form onSubmit={submit} className="fsw-auth-form">
          {(mode === 'signin' || step === 'email') && (
            <label>
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com" disabled={busy} />
            </label>
          )}

          {mode === 'signup' && step === 'code' && (
            <label>
              <span>6-digit code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                disabled={busy}
              />
            </label>
          )}

          {(mode === 'signin' || step === 'password') && (
            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === 'signup' ? 10 : undefined}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder={mode === 'signup' ? 'At least 10 characters' : ''}
                disabled={busy}
              />
            </label>
          )}

          {devCode && step === 'code' && (
            <p className="fsw-auth-dev">
              Development server — no email was sent. Your code is <strong>{devCode}</strong>.
            </p>
          )}

          {error && <p className="fsw-auth-error">{error}</p>}

          <button type="submit" className="fsw-btn fsw-btn-primary fsw-btn-block fsw-btn-lg" disabled={busy || !api.apiConfigured}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : step === 'email' ? 'Send me a code' : step === 'code' ? 'Verify' : 'Create account'}
          </button>
        </form>

        <p className="fsw-auth-switch">
          {mode === 'signin' ? (
            <>
              No account yet?{' '}
              <button type="button" className="fsw-link" onClick={() => switchMode('signup')}>
                Create one, free
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button type="button" className="fsw-link" onClick={() => switchMode('signin')}>
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </section>
  );
}
