import { useState } from 'react';
import { navigate, onLinkClick } from '../router';
import { useAuth } from '../auth';
import * as api from '../api';
import { Logo } from './Logo';
import { FREE_SPACE_LIMIT } from '../content/plans';

/**
 * Sign in, sign up and password reset, on one page.
 *
 * Sign-up and reset are the same three server steps — address → code →
 * password — shown as three screens. For sign-up, the account only exists
 * after the third, so an abandoned attempt leaves nothing behind; that is why
 * the password field comes last rather than first. Reset reuses the shape
 * because it is the same proof of control over the same mailbox.
 *
 * The code screen deliberately says "if there is an account for this address",
 * never "we sent you a code" — the server gives an identical answer either
 * way, and the wording must not undo that.
 */

type Mode = 'signin' | 'signup' | 'reset';
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

  /**
   * Returns to the email step within the *same* mode (sign-up or reset) — the control the flow was
   * missing: previously the only way back to the email field was `switchMode`, which also changes what
   * kind of flow you're in. `code` and `ticket` are discarded here because they are single-use and tied
   * to the email that was just left; the server would reject them for a different address anyway, so
   * there is nothing to preserve by keeping them around.
   */
  function backToEmail() {
    setStep('email');
    setError(null);
    setCode('');
    setPassword('');
    setTicket('');
    setDevCode(null);
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

    // Reset mirrors sign-up exactly — address, code, password — because it is the
    // same proof of control over the same mailbox, ending somewhere different.
    if (mode === 'reset') {
      if (step === 'email') {
        return void run(async () => {
          const result = await api.resetStart(email.trim());
          setDevCode(result.devCode ?? null);
          setStep('code');
        });
      }
      if (step === 'code') {
        return void run(async () => {
          const result = await api.resetVerify(email.trim(), code.trim());
          setTicket(result.ticket);
          setStep('password');
        });
      }
      return void run(async () => {
        await auth.completeReset(ticket, password);
        navigate('/account');
      });
    }

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

        <h1>
          {mode === 'signin'
            ? 'Sign in'
            : step === 'password'
              ? mode === 'reset'
                ? 'Choose a new password'
                : 'Choose a password'
              : step === 'code'
                ? 'Check your email'
                : mode === 'reset'
                  ? 'Reset your password'
                  : 'Create your account'}
        </h1>
        <p className="fsw-auth-sub">
          {mode === 'signin'
            ? 'Your plan and monthly AI allowance, wherever you sign in.'
            : step === 'password'
              ? mode === 'reset'
                ? 'This also signs you out everywhere else, which is the point of resetting.'
                : 'Last step. Your account is created when you set this.'
              : step === 'code'
                ? `If there is an account for ${email}, a 6-digit code is on its way.`
                : mode === 'reset'
                  ? 'Tell us your email and we will send a code to set a new password.'
                  : `Free: ${FREE_SPACE_LIMIT} Spaces and a monthly AI allowance. No card needed.`}
        </p>

        {/* Only the email step is a dead end otherwise: once you've moved past it, `switchMode` (below,
            "Sign in" / "Create one, free") changed what flow you were in as a side effect of the only way
            back. This is the direct, same-flow way back that was missing. */}
        {mode !== 'signin' && (step === 'code' || step === 'password') && (
          <button type="button" className="fsw-link fsw-auth-back" onClick={backToEmail} disabled={busy}>
            ← {step === 'code' ? `Not ${email}? Change it` : 'Back to email'}
          </button>
        )}

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

          {mode !== 'signin' && step === 'code' && (
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
                minLength={mode === 'signin' ? undefined : 10}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder={mode === 'signin' ? '' : 'At least 10 characters'}
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
            {busy
              ? 'Working…'
              : mode === 'signin'
                ? 'Sign in'
                : step === 'email'
                  ? 'Send me a code'
                  : step === 'code'
                    ? 'Verify'
                    : mode === 'reset'
                      ? 'Set new password'
                      : 'Create account'}
          </button>
        </form>

        <p className="fsw-auth-switch">
          {mode === 'signin' ? (
            <>
              <button type="button" className="fsw-link" onClick={() => switchMode('reset')}>
                Forgot your password?
              </button>
              <br />
              No account yet?{' '}
              <button type="button" className="fsw-link" onClick={() => switchMode('signup')}>
                Create one, free
              </button>
            </>
          ) : (
            <>
              {mode === 'reset' ? 'Remembered it?' : 'Already have an account?'}{' '}
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
