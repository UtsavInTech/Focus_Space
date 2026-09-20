import { useEffect, useState } from 'react';
import { ExternalLink, Pencil } from 'lucide-react';
import type { ApiSettings, Settings } from '@/types/domain';
import type { AuthUser } from '@/types/auth';
import type { PaymentRecord } from '@/types/account';
import type { DashboardData } from '../DashboardApp';
import { Meter, Section, patch, isHttpUrl } from './section';
import { API_URL, PHONE_SIGN_IN } from '@/config';
import { isPaidPlan, PlanName } from '@/ui/components/PlanName';
import { planLabel } from '@/billing/plans';
import { sendMessage } from '@/messaging/runtime';
import { accountIdentity, CLAIM_COPY, useAccountFlow } from '@/ui/account/flow';
import { Button, Segmented, SettingRow, TextInput } from '@/ui/components/primitives';

/**
 * FocusSpace's own account page: signing in, the plan and its allowances, what the learner paid, and the
 * details they gave. All of it used to live on the website, which meant leaving the product to see it.
 */

export function AccountPage({ data }: { data: DashboardData }) {
  const { settings } = data;
  return (
    <div className="fs-stack fs-page-narrow fs-settings" style={{ width: '100%', margin: '0 auto' }}>
      <div className="fs-page-head">
        <div>
          <h1 className="fs-h1">Account</h1>
          <p>Your plan, what you have paid, and the details you gave us. Your Spaces, notes and history stay in this browser.</p>
        </div>
      </div>
      <SignInSection settings={settings} />
      <ProfileSection />
      <PaymentsSection />
    </div>
  );
}

/**
 * Details the learner gave, shown as text once they exist — a form that never goes away reads like the
 * product forgot what you told it. "Edit" brings the fields back. Email and phone are sign-in
 * credentials, so they change through their own verified flow, never here.
 */
function ProfileSection() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void sendMessage('account/profile', {})
      .then((u) => {
        if (!alive) return;
        setUser(u);
        setName(u?.name ?? '');
        setCity(u?.city ?? '');
      })
      .catch(() => alive && setUser(null));
    return () => {
      alive = false;
    };
  }, []);

  if (user === undefined || user === null) return null;
  const filled = !!(user.name || user.city);

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await sendMessage('account/profile-update', { name: name.trim() || null, city: city.trim() || null }).catch(() => null);
    setBusy(false);
    if (!result || !result.ok) {
      setError(result && !result.ok ? result.error : 'Your details could not be saved. Try again.');
      return;
    }
    setUser(result.user);
    setEditing(false);
  };

  return (
    <Section id="details" title="Your details" description="Optional, and only ever shown to you.">
      {filled && !editing ? (
        <>
          <SettingRow title="Name" description={user.name || 'Not added'}>
            <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEditing(true)}>
              Edit
            </Button>
          </SettingRow>
          <SettingRow title="City" description={user.city || 'Not added'}>
            <span />
          </SettingRow>
        </>
      ) : (
        <>
          <SettingRow title="Name" description="What FocusSpace calls you.">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Optional" style={{ width: 220 }} aria-label="Name" />
          </SettingRow>
          <SettingRow title="City" description="Optional.">
            <TextInput value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} placeholder="Optional" style={{ width: 220 }} aria-label="City" />
          </SettingRow>
          <SettingRow title="" description={error ?? ''}>
            <div className="fs-row">
              <Button size="sm" loading={busy} onClick={() => void save()}>
                Save
              </Button>
              {filled && (
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setName(user.name ?? ''); setCity(user.city ?? ''); setError(null); }}>
                  Cancel
                </Button>
              )}
            </div>
          </SettingRow>
        </>
      )}
      <SettingRow title="Email" description={user.email ?? 'Not added'}>
        <span className="fs-caption">How you sign in</span>
      </SettingRow>
      <SettingRow title="Phone" description={user.phone ?? 'Not added'}>
        <span className="fs-caption">{PHONE_SIGN_IN ? 'How you sign in' : 'Signing in by phone is coming'}</span>
      </SettingRow>
    </Section>
  );
}

const money = (currency: string, minor: number) => `${currency === 'INR' ? '₹' : '$'}${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: currency === 'INR' ? 0 : 2 })}`;

/** What the learner actually paid — the receipts, in the product rather than only on the website. */
function PaymentsSection() {
  const [payments, setPayments] = useState<PaymentRecord[] | null>(null);
  useEffect(() => {
    let alive = true;
    void sendMessage('account/payments', {})
      .then((list) => alive && setPayments(list))
      .catch(() => alive && setPayments([]));
    return () => {
      alive = false;
    };
  }, []);

  if (!payments?.length) return null;
  return (
    <Section id="payments" title="Payments" description="Every charge on this account.">
      {payments.map((p) => (
        <SettingRow
          key={p.id}
          title={`${planLabel(p.plan)} · ${p.period === 'annual' ? '12 months' : '1 month'}`}
          description={`${new Date(p.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}${p.status === 'paid' ? '' : ` · ${p.status}`}`}
        >
          <span className="fs-label">{money(p.currency, p.amount_minor)}</span>
        </SettingRow>
      ))}
      <SettingRow title="Invoices and refunds" description="Handled on the FocusSpace website.">
        <Button size="sm" variant="ghost" icon={<ExternalLink />} onClick={() => void sendMessage('site/open', { path: '/account' }).catch(() => undefined)}>
          Open on the web
        </Button>
      </SettingRow>
    </Section>
  );
}

export function SignInSection({ settings }: { settings: Settings }) {
  const flow = useAccountFlow();
  const { user, usage, spaces, claim, step, go, fields, set, busy, error, devCode, actions } = flow;
  const [baseUrl, setBaseUrl] = useState(settings.api.baseUrl);
  useEffect(() => setBaseUrl(settings.api.baseUrl), [settings.api.baseUrl]);
  useEffect(flow.refresh, [settings.api.baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const setApi = (p: Partial<ApiSettings>) => patch({ api: { ...settings.api, ...p } });
  const trimmedBaseUrl = baseUrl.trim();
  // A store build already knows its server; the address field is only for someone running their own.
  const hasServer = !!settings.api.baseUrl || !!API_URL;
  const method = step.view === 'phone' ? 'phone' : step.view === 'email-signup' ? 'create' : 'signin';

  return (
    <Section
      id="signin"
      title={user ? 'Signed in' : 'Sign in'}
      description={user ? undefined : 'Optional. FocusSpace works fully signed out; an account raises your Space and AI allowance.'}
    >
      {user ? (
        <>
          <SettingRow title={accountIdentity(flow)} description={user.email && user.emailVerified === false ? 'Email not verified' : 'Signed in'}>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void actions.signOut()}>
              Sign out
            </Button>
          </SettingRow>
          {claim && (
            <SettingRow title={CLAIM_COPY.title} description={CLAIM_COPY.body}>
              <div className="fs-row">
                <Button size="sm" disabled={busy} onClick={() => void actions.resolveClaim(true)}>
                  {CLAIM_COPY.keep}
                </Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void actions.resolveClaim(false)}>
                  {CLAIM_COPY.fresh}
                </Button>
              </div>
            </SettingRow>
          )}
          {error && user && <p className="fs-form-error">{error}</p>}
          <SettingRow title="Plan" description={usage ? <PlanName plan={usage.plan} /> : 'Checking…'}>
            <Button size="sm" variant="secondary" onClick={() => void sendMessage('site/open', { path: usage && isPaidPlan(usage.plan) ? '/account' : '/pricing' }).catch(() => undefined)}>
              {usage && isPaidPlan(usage.plan) ? 'Manage plan' : 'See plans'}
            </Button>
          </SettingRow>
          {usage && <Meter label={planLabel(usage.plan)} used={usage.used} limit={usage.limit} unit="AI actions this period" />}
          {spaces && <Meter label="Spaces on your account" used={spaces.used} limit={spaces.limit} unit="spaces" />}
        </>
      ) : (
        <>
          {!hasServer && <p className="fs-account-form-rows fs-hint">Add your FocusSpace server address below to create an account or sign in.</p>}
          {hasServer && (
            <div className="fs-account-form-rows">
              <Segmented
                label="Sign-in method"
                value={method}
                onChange={(next) => go(next === 'phone' ? { view: 'phone', step: 'phone', phone: '' } : next === 'create' ? { view: 'email-signup', step: 'email', email: fields.email } : { view: 'email-signin' })}
                options={[
                  { value: 'signin', label: 'Sign in' },
                  { value: 'create', label: 'New account' },
                  ...(PHONE_SIGN_IN ? [{ value: 'phone' as const, label: 'Phone' }] : []),
                ]}
              />
              {error && <p className="fs-form-error">{error}</p>}

              {/* The flow starts in 'menu' (the panel inside YouTube opens there). Settings has no menu —
                  its tabs *are* the choice — so 'menu' shows the sign-in form the "Sign in" tab implies. */}
              {(step.view === 'email-signin' || step.view === 'menu') && (
                <div className="fs-row-wrap">
                  <TextInput value={fields.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@example.com" type="email" autoComplete="username" aria-label="Email" style={{ width: 220 }} />
                  <TextInput value={fields.password} onChange={(e) => set({ password: e.target.value })} placeholder="Password" type="password" autoComplete="current-password" aria-label="Password" style={{ width: 180 }} />
                  <Button size="sm" loading={busy} disabled={!fields.email.trim() || fields.password.length < 8} onClick={() => void actions.signIn()}>
                    Sign in
                  </Button>
                </div>
              )}

              {step.view === 'email-signup' && (
                <>
                  <p className="fs-hint">Step {step.step === 'email' ? '1 of 3 — confirm your email' : step.step === 'code' ? '2 of 3 — enter the code' : '3 of 3 — choose a password'}</p>
                  {step.step === 'email' && (
                    <div className="fs-row-wrap">
                      <TextInput value={fields.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@example.com" type="email" autoComplete="username" aria-label="Email" style={{ width: 220 }} />
                      <Button size="sm" loading={busy} disabled={!fields.email.trim()} onClick={() => void actions.sendSignupCode()}>
                        Send code
                      </Button>
                    </div>
                  )}
                  {step.step === 'code' && (
                    <div className="fs-row-wrap">
                      <TextInput value={fields.code} onChange={(e) => set({ code: e.target.value })} placeholder="6-digit code" inputMode="numeric" maxLength={6} aria-label="Verification code" style={{ width: 140 }} />
                      <Button size="sm" loading={busy} disabled={fields.code.trim().length !== 6} onClick={() => void actions.verifySignupCode(step.email)}>
                        Verify
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void actions.sendSignupCode(step.email)}>
                        Send a new code
                      </Button>
                    </div>
                  )}
                  {step.step === 'password' && (
                    <div className="fs-row-wrap">
                      <TextInput value={fields.password} onChange={(e) => set({ password: e.target.value })} placeholder="At least 8 characters" type="password" autoComplete="new-password" aria-label="Password" style={{ width: 220 }} />
                      <Button size="sm" loading={busy} disabled={fields.password.length < 8 || !step.ticket} onClick={() => void actions.completeSignup(step.ticket ?? '')}>
                        Create account
                      </Button>
                    </div>
                  )}
                </>
              )}

              {step.view === 'phone' && (
                <div className="fs-row-wrap">
                  {step.step === 'phone' ? (
                    <>
                      <TextInput value={fields.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+91 98765 43210" type="tel" autoComplete="tel" aria-label="Phone number" style={{ width: 220 }} />
                      <Button size="sm" loading={busy} disabled={fields.phone.replace(/\D/g, '').length < 8} onClick={() => void actions.sendPhoneCode()}>
                        Send code
                      </Button>
                    </>
                  ) : (
                    <>
                      <TextInput value={fields.code} onChange={(e) => set({ code: e.target.value })} placeholder="6-digit code" inputMode="numeric" maxLength={6} aria-label="Verification code" style={{ width: 140 }} />
                      <Button size="sm" loading={busy} disabled={fields.code.trim().length !== 6} onClick={() => void actions.verifyPhoneCode(step.phone)}>
                        Continue
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void actions.sendPhoneCode(step.phone)}>
                        Send a new code
                      </Button>
                    </>
                  )}
                </div>
              )}

              {devCode && (
                <p className="fs-hint">
                  Development server — no email or SMS provider is configured, so your code is <b>{devCode}</b>.
                </p>
              )}
            </div>
          )}
        </>
      )}

      <SettingRow title="Your name" description="Optional. FocusSpace’s Home greets you with it. Stays in this browser.">
        <TextInput value={settings.displayName} onChange={(e) => patch({ displayName: e.target.value })} maxLength={40} placeholder="Optional" style={{ width: 200 }} aria-label="Your name" />
      </SettingRow>
      {(!API_URL || settings.api.baseUrl) && (
        <SettingRow title="FocusSpace server" description="Where your account lives. Reference server: server/index.ts.">
          <div className="fs-row">
            <TextInput value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-server.example" style={{ width: 240 }} aria-label="FocusSpace server URL" />
            <Button size="sm" variant="secondary" disabled={trimmedBaseUrl === settings.api.baseUrl || (trimmedBaseUrl !== '' && !isHttpUrl(trimmedBaseUrl))} onClick={() => setApi({ baseUrl: trimmedBaseUrl })}>
              Save
            </Button>
          </div>
        </SettingRow>
      )}
    </Section>
  );
}

