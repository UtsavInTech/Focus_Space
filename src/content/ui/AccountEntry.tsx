import { useContext, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, User, X } from 'lucide-react';
import { OverlayRootContext } from '@/ui/components/Modal';
import { accountIdentity, useAccountFlow } from '@/ui/account/flow';
import { planLabel } from '@/billing/plans';

/**
 * The FocusSpace account, in FocusSpace's own sidebar header — the one place in
 * the YouTube-embedded UI that belongs to FocusSpace rather than to a video.
 * Signing in has to be discoverable without knowing the browser toolbar icon
 * exists, so this says "Sign in" in words rather than showing only an avatar.
 *
 * State and every server call live in the shared hook (src/ui/account/flow.ts),
 * which Settings → Account uses too. Deliberately a menu, not a dashboard:
 * anything longer belongs in Settings.
 */


export function AccountEntry() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayRoot = useContext(OverlayRootContext);
  const flow = useAccountFlow();
  const { auth, user, usage, spaces, step, go, fields, set, busy, error, devCode, actions } = flow;

  // Re-checked whenever the panel opens: catches a sign-in/out made in Settings while it was closed.
  useEffect(() => {
    if (open) flow.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const path = event.composedPath();
      if (!(wrapRef.current && path.includes(wrapRef.current)) && !(panelRef.current && path.includes(panelRef.current))) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const identity = accountIdentity(flow);
  const title = step.view === 'menu' ? 'FocusSpace account' : step.view === 'email-signin' ? 'Sign in' : step.view === 'phone' ? 'Continue with phone' : 'Create account';

  return (
    <div className="fs-account" ref={wrapRef}>
      <button
        type="button"
        className={`fs-account-trigger${open ? ' is-open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            const rect = wrapRef.current?.getBoundingClientRect();
            if (rect) setPosition({ top: rect.bottom + 6, left: rect.left });
            go({ view: 'menu' });
          }
          setOpen((o) => !o);
        }}
      >
        {user ? (
          <span className="fs-account-avatar" aria-hidden>
            {(identity[0] ?? '?').toUpperCase()}
          </span>
        ) : (
          <User size={15} aria-hidden />
        )}
        <span>{user ? 'Account' : 'Sign in'}</span>
      </button>

      {open &&
        position &&
        createPortal(
          <div ref={panelRef} className="fs-top-ai-panel" style={{ top: position.top, left: position.left }}>
            <div className="fs-account-panel" role="dialog" aria-label="FocusSpace account">
              <div className="fs-account-head">
                <span>
                  {step.view !== 'menu' && (
                    <button type="button" className="fs-account-back" aria-label="Back" onClick={() => go({ view: 'menu' })}>
                      <ChevronLeft size={14} aria-hidden />
                    </button>
                  )}
                  {title}
                </span>
                <button type="button" className="fs-icon-plain" aria-label="Close" onClick={() => setOpen(false)}>
                  <X size={15} aria-hidden />
                </button>
              </div>

              <div className="fs-account-body">
                {error && <p className="fs-account-error">{error}</p>}

                {auth === undefined ? (
                  <p className="fs-account-note">Checking your account…</p>
                ) : user && step.view === 'menu' ? (
                  <>
                    <div className="fs-account-id">{identity}</div>
                    <Meter label={usage ? planLabel(usage.plan) : 'Plan'} used={usage?.used} limit={usage?.limit} unit="AI actions" loading={usage === undefined} />
                    <Meter label="Spaces on your account" used={spaces?.used} limit={spaces?.limit} unit="spaces" loading={spaces === undefined} />
                    <div className="fs-account-actions">
                      <button type="button" className="fs-pill-button" onClick={actions.openSettings}>
                        Manage account
                      </button>
                      <button type="button" className="fs-link" disabled={busy} onClick={() => void actions.signOut()}>
                        Sign out
                      </button>
                    </div>
                  </>
                ) : step.view === 'menu' ? (
                  <>
                    <p className="fs-account-note">An account carries your AI allowance and spaces across devices. Everything else in FocusSpace works signed out.</p>
                    <div className="fs-account-actions">
                      <button type="button" className="fs-pill-button" onClick={() => go({ view: 'email-signup', step: 'email', email: '' })}>
                        Create account
                      </button>
                      <button type="button" className="fs-link" onClick={() => go({ view: 'email-signin' })}>
                        Sign in
                      </button>
                    </div>
                    <button type="button" className="fs-link" onClick={() => go({ view: 'phone', step: 'phone', phone: '' })}>
                      Continue with a phone number
                    </button>
                  </>
                ) : step.view === 'email-signin' ? (
                  <Form
                    submitLabel="Sign in"
                    busy={busy}
                    disabled={!fields.email.trim() || fields.password.length < 8}
                    onSubmit={() => void actions.signIn()}
                    footer={
                      <button type="button" className="fs-link" onClick={() => go({ view: 'email-signup', step: 'email', email: fields.email })}>
                        Create account instead
                      </button>
                    }
                  >
                    <Line label="Email" type="email" autoComplete="username" value={fields.email} onChange={(email) => set({ email })} placeholder="you@example.com" autoFocus />
                    <Line label="Password" type="password" autoComplete="current-password" value={fields.password} onChange={(password) => set({ password })} placeholder="Your password" />
                  </Form>
                ) : step.view === 'email-signup' ? (
                  <>
                    <Steps current={step.step === 'email' ? 0 : step.step === 'code' ? 1 : 2} labels={['Email', 'Verify', 'Password']} />
                    {step.step === 'email' && (
                      <Form submitLabel="Send code" busy={busy} disabled={!fields.email.trim()} onSubmit={() => void actions.sendSignupCode()}>
                        <Line label="Email" type="email" autoComplete="username" value={fields.email} onChange={(email) => set({ email })} placeholder="you@example.com" autoFocus />
                        <p className="fs-account-note">FocusSpace sends a 6-digit code to confirm the address.</p>
                      </Form>
                    )}
                    {step.step === 'code' && (
                      <Form
                        submitLabel="Verify"
                        busy={busy}
                        disabled={fields.code.trim().length !== 6}
                        onSubmit={() => void actions.verifySignupCode(step.email)}
                        footer={
                          <button type="button" className="fs-link" onClick={() => void actions.sendSignupCode(step.email)}>
                            Send a new code
                          </button>
                        }
                      >
                        <Line label="Code" inputMode="numeric" maxLength={6} value={fields.code} onChange={(code) => set({ code })} placeholder="6-digit code" autoFocus />
                        <p className="fs-account-note">Sent to {step.email}.</p>
                        {devCode && <DevCode code={devCode} />}
                      </Form>
                    )}
                    {step.step === 'password' && (
                      <Form submitLabel="Create account" busy={busy} disabled={fields.password.length < 8 || !step.ticket} onSubmit={() => void actions.completeSignup(step.ticket ?? '')}>
                        <Line label="Password" type="password" autoComplete="new-password" value={fields.password} onChange={(password) => set({ password })} placeholder="At least 8 characters" autoFocus />
                        <p className="fs-account-note">{step.email} is verified. Choose a password to finish.</p>
                      </Form>
                    )}
                  </>
                ) : step.step === 'phone' ? (
                  <Form submitLabel="Send code" busy={busy} disabled={fields.phone.replace(/\D/g, '').length < 8} onSubmit={() => void actions.sendPhoneCode()}>
                    <Line label="Phone number" type="tel" autoComplete="tel" value={fields.phone} onChange={(phone) => set({ phone })} placeholder="+91 98765 43210" autoFocus />
                    <p className="fs-account-note">Include your country code. FocusSpace sends a 6-digit code.</p>
                  </Form>
                ) : (
                  <Form
                    submitLabel="Continue"
                    busy={busy}
                    disabled={fields.code.trim().length !== 6}
                    onSubmit={() => void actions.verifyPhoneCode(step.phone)}
                    footer={
                      <button type="button" className="fs-link" onClick={() => void actions.sendPhoneCode(step.phone)}>
                        Send a new code
                      </button>
                    }
                  >
                    <Line label="Code" inputMode="numeric" maxLength={6} value={fields.code} onChange={(code) => set({ code })} placeholder="6-digit code" autoFocus />
                    <p className="fs-account-note">Sent to {step.phone}.</p>
                    {devCode && <DevCode code={devCode} />}
                  </Form>
                )}
              </div>
            </div>
          </div>,
          overlayRoot ?? document.body,
        )}
    </div>
  );
}

function Meter({ label, used, limit, unit, loading }: { label: string; used?: number; limit?: number | null; unit: string; loading: boolean }) {
  if (loading) return <p className="fs-account-note">Checking {unit}…</p>;
  if (used === undefined || limit === undefined || limit === 0) return null;
  if (limit === null) {
    return (
      <div className="fs-account-meter">
        <div className="fs-account-meter-label">
          <span>{label}</span>
          <span>Unlimited {unit}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="fs-account-meter">
      <div className="fs-account-meter-label">
        <span>{label}</span>
        <span>
          {used} of {limit} {unit}
        </span>
      </div>
      <div className="fs-account-meter-track">
        <span className="fs-account-meter-fill" style={{ width: `${Math.min(100, Math.round((used / limit) * 100))}%` }} />
      </div>
    </div>
  );
}

function Steps({ current, labels }: { current: number; labels: string[] }) {
  return (
    <ol className="fs-account-steps">
      {labels.map((label, i) => (
        <li key={label} aria-current={i === current ? 'step' : undefined}>
          {label}
        </li>
      ))}
    </ol>
  );
}

/** The development sender prints codes to the server console; showing it beats pretending an email arrived. */
function DevCode({ code }: { code: string }) {
  return (
    <p className="fs-account-note">
      Development server — no email or SMS provider is configured, so the code is <b>{code}</b>.
    </p>
  );
}

function Form({ children, submitLabel, busy, disabled, onSubmit, footer }: { children: ReactNode; submitLabel: string; busy: boolean; disabled: boolean; onSubmit: () => void; footer?: ReactNode }) {
  return (
    <form
      className="fs-account-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && !busy) onSubmit();
      }}
    >
      {children}
      <div className="fs-account-actions">
        <button type="submit" className="fs-pill-button" disabled={disabled || busy}>
          {busy ? 'Working…' : submitLabel}
        </button>
        {footer}
      </div>
    </form>
  );
}

function Line({ label, value, onChange, ...rest }: { label: string; value: string; onChange: (value: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <label className="fs-input-line">
      <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} {...rest} />
    </label>
  );
}
