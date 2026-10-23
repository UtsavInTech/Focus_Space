import { useEffect, useState } from 'react';
import { CircleUser, Crown, ExternalLink, Layers, LogIn, LogOut, Pencil, Receipt, ShieldCheck, Sparkles, UserPen } from 'lucide-react';
import { ActionCard, CardGrid, jumpTo } from './cards';
import { navigate } from '../router';
import type { ApiSettings, Settings } from '@/types/domain';
import type { AuthUser } from '@/types/auth';
import type { PaymentRecord } from '@/types/account';
import type { DashboardData } from '../DashboardApp';
import { Meter, Section, patch, isHttpUrl } from './section';
import { API_URL, PHONE_SIGN_IN } from '@/config';
import { isPaidPlan, PlanName } from '@/ui/components/PlanName';
import { planLabel } from '@/billing/plans';
import { sendMessage } from '@/messaging/runtime';
import { accountIdentity, CLAIM_COPY, useAccountFlow, type AccountFlow } from '@/ui/account/flow';
import { ACCOUNT_DATA_FACTS, ANONYMOUS_AI_SUMMARY, LOCAL_DATA_SUMMARY } from '@/ui/account/data-facts';
import { Button, Segmented, SettingRow, TextInput } from '@/ui/components/primitives';

/**
 * FocusSpace's own account page: signing in, the plan and its allowances, what the learner paid, and the
 * details they gave. All of it used to live on the website, which meant leaving the product to see it.
 *
 * One `useAccountFlow()` call for the whole page (not one per section) — SignInSection and PaymentsSection
 * both need to know whether someone is signed in before they can tell "no payments yet" apart from
 * "nothing to show because nobody's signed in", and a single hook instance is what keeps that answer
 * consistent between them without a second round trip.
 */
export function AccountPage({ data }: { data: DashboardData }) {
  const { settings } = data;
  const flow = useAccountFlow();
  return (
    <div className="fs-stack fs-page-narrow fs-settings" style={{ width: '100%', margin: '0 auto' }}>
      <div className="fs-page-head">
        <div>
          <h1 className="fs-h1">Account</h1>
          <p>Your plan, what you have paid, and the details you gave us. Your Spaces, notes and history stay in this browser.</p>
        </div>
      </div>
      <AccountCards flow={flow} />
      <SignInSection settings={settings} flow={flow} />
      <ProfileSection />
      <PaymentsSection signedIn={!!flow.user} />
      <DataNote signedIn={!!flow.user} />
    </div>
  );
}

/**
 * The account at a glance, as cards: who is signed in, the plan, how much of it is used, and one tap to
 * each thing people come here to do. The sections below hold the detail.
 */
function AccountCards({ flow }: { flow: AccountFlow }) {
  const { user, usage, spaces, busy, actions } = flow;
  const paid = !!usage && isPaidPlan(usage.plan);
  const openSite = (path: string) => void sendMessage('site/open', { path }).catch(() => undefined);
  return (
    <CardGrid label="Your account">
      {user ? (
        <ActionCard
          icon={<CircleUser />}
          tone="accent"
          title="Signed in as"
          value={accountIdentity(flow)}
          hint={user.email && user.emailVerified === false ? 'Email not verified yet' : 'Your plan and receipts follow you'}
          control={
            <Button size="sm" variant="ghost" icon={<LogOut size={14} />} disabled={busy} onClick={() => void actions.signOut()}>
              Sign out
            </Button>
          }
        />
      ) : (
        <ActionCard icon={<LogIn />} tone="accent" title="Not signed in" value="Sign in or create a free account" hint="More Spaces, a daily AI allowance, saved notes" onClick={() => void openConnect()} />
      )}
      <ActionCard
        icon={<Crown />}
        tone={paid ? 'green' : 'default'}
        title="Your plan"
        value={usage ? planLabel(usage.plan) : user ? 'Checking…' : 'Free (no account)'}
        hint={paid ? 'Manage, renew or change it' : 'See what Basic, Plus and Pro add'}
        onClick={() => openSite(paid ? '/account' : '/pricing')}
      />
      {usage && (
        <ActionCard
          icon={<Sparkles />}
          tone="violet"
          title="AI credits this period"
          value={usage.limit === null ? 'Unlimited' : `${Math.max(0, usage.limit - usage.used)} left`}
          hint={<Meter label="" used={usage.used} limit={usage.limit} unit="used" />}
        />
      )}
      {spaces && (
        <ActionCard icon={<Layers />} title="Spaces" value={spaces.limit === null ? `${spaces.used}, no limit` : `${spaces.used} of ${spaces.limit}`} hint={<Meter label="" used={spaces.used} limit={spaces.limit} unit="spaces" />} onClick={() => navigate('/modes')} />
      )}
      {user && <ActionCard icon={<UserPen />} title="Your details" value="Name and city" hint="Optional, only shown to you" onClick={() => jumpTo('details')} />}
      {user && <ActionCard icon={<Receipt />} title="Payments" value="Receipts and invoices" hint="Every charge on this account" onClick={() => jumpTo('payments')} />}
      <ActionCard icon={<ShieldCheck />} title="Your data" value="What we keep" hint="Nothing sold, no ads, no tracking" onClick={() => jumpTo('data')} />
    </CardGrid>
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
    <Section id="details" icon={<UserPen />} title="Your details" description="Optional, and only ever shown to you.">
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
function PaymentsSection({ signedIn }: { signedIn: boolean }) {
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

  // Signed out, `payments` is always `[]` (background/account.ts never calls the server without a
  // session) — showing "no payments" there would just be a confusing echo of the sign-in prompt above.
  if (!signedIn || payments === null) return null;
  return (
    <Section id="payments" icon={<Receipt />} title="Payments" description="Every charge on this account.">
      {payments.length ? (
        <>
          {payments.map((p) => (
            <SettingRow
              key={p.id}
              title={`${planLabel(p.plan)} · ${p.period === 'annual' ? '12 months' : '1 month'}`}
              description={`${new Date(p.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}${p.status === 'paid' ? '' : ` · ${p.status}`}`}
            >
              <span className="fs-label">{money(p.currency, p.amount_minor)}</span>
            </SettingRow>
          ))}
          <SettingRow title="Invoices and receipts" description="View or print a receipt for any charge above, on the FocusSpace website.">
            <Button size="sm" variant="ghost" icon={<ExternalLink />} onClick={() => void sendMessage('site/open', { path: '/account' }).catch(() => undefined)}>
              Open on the web
            </Button>
          </SettingRow>
        </>
      ) : (
        <p className="fs-hint" style={{ padding: '10px 0' }}>No payments yet. FocusSpace's free plan needs no card.</p>
      )}
    </Section>
  );
}

/**
 * This page is where an email, a name and a card actually get handed over, so it is where a learner is
 * most likely to wonder what happens to them — and it answers with the same list Settings shows, from
 * ui/account/data-facts.ts, rather than its own paraphrase. The paraphrase is what previously claimed
 * FocusSpace uses your *name* to sign you in, which it has never done.
 */
function DataNote({ signedIn }: { signedIn: boolean }) {
  return (
    <Section id="data" icon={<ShieldCheck />} title="Your data" description={signedIn ? 'Everything your account holds.' : 'What an account would hold, if you create one.'}>
      <p className="fs-hint" style={{ padding: '4px 0 0' }}>{LOCAL_DATA_SUMMARY}</p>
      {ACCOUNT_DATA_FACTS.map((fact) => (
        <SettingRow key={fact.id} title={fact.label} description={fact.detail} />
      ))}
      {!signedIn && <SettingRow title="Using the AI without an account" description={ANONYMOUS_AI_SUMMARY} />}
      <SettingRow title="The full explanation" description="What goes to youtube.com, what the learning companion sends, and who else is involved.">
        <Button size="sm" variant="ghost" icon={<ExternalLink />} onClick={() => void sendMessage('site/open', { path: '/privacy#your-data' }).catch(() => undefined)}>
          Read it
        </Button>
      </SettingRow>
    </Section>
  );
}

/**
 * Sends the learner to the website to finish signing in, and lets that page hand the session back.
 *
 * Deliberately not a second implementation of anything: `/connect` is the website's own page, it uses
 * the website's own sign-in (Google included), and it returns a one-time handoff code over
 * `externally_connectable`. The extension holds no OAuth client id, no client secret, and never sees a
 * Google token — see server/auth/google.ts for why the whole exchange lives on the server.
 */
const openConnect = () => sendMessage('site/open', { path: '/connect' }).catch(() => undefined);

/** Google's mark. Inline so the extension fetches nothing from Google to draw a button. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden focusable="false">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

export function SignInSection({ settings, flow: flowProp }: { settings: Settings; flow?: AccountFlow }) {
  const ownFlow = useAccountFlow();
  // Accepts an already-instantiated flow (AccountPage passes its own so PaymentsSection can share it),
  // but still works standalone with its own — nothing else in this codebase renders SignInSection without
  // a flow today, but there's no reason to make that a hard requirement.
  const flow = flowProp ?? ownFlow;
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
      icon={<CircleUser />}
      title={user ? 'Account' : 'Sign in to FocusSpace'}
      description={user ? undefined : 'A free account raises your Space and AI allowance, and keeps your plan, payments and receipts in one place, wherever you sign in.'}
    >
      {user ? (
        <>
          {/*
            One glance: who's signed in, and the way out. Everything actionable (plan, usage, spaces) is
            still its own row below — this is identity, not a dashboard tile.
          */}
          <div className="fs-account-identity">
            <span className="fs-account-avatar-lg" aria-hidden>
              {(accountIdentity(flow)[0] ?? '?').toUpperCase()}
            </span>
            <div className="fs-grow">
              <strong>{accountIdentity(flow)}</strong>
              <span className="fs-caption">{user.email && user.emailVerified === false ? 'Email not verified' : 'Signed in'}</span>
            </div>
            <Button size="sm" variant="ghost" icon={<LogOut size={14} />} disabled={busy} onClick={() => void actions.signOut()}>
              Sign out
            </Button>
          </div>
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
          {!hasServer && (
            <p className="fs-account-form-rows fs-hint">
              Accounts are unavailable in this build. It ships without a FocusSpace server. Everything else works signed out. If you run your own server, add
              its address under Advanced below.
            </p>
          )}
          {hasServer && (
            <div className="fs-account-form-rows">
              {/*
                One FocusSpace account. Both of these finish on focusspace.xyz and hand the result back
                over the extension's existing message channel as a single-use code (web/src/connect.ts) —
                which is what lets the extension offer Google without shipping an OAuth credential, and
                what stops someone who just signed in on the website being asked to sign in again here.
              */}
              <div className="fs-signin-primary">
                <Button variant="secondary" icon={<GoogleMark />} onClick={() => void openConnect()}>
                  Continue with Google
                </Button>
                <Button variant="ghost" onClick={() => void openConnect()}>
                  Already signed in on focusspace.xyz? Connect this browser
                </Button>
              </div>
              <div className="fs-or">
                <span>or use your email</span>
              </div>
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
                  <Button size="sm" variant="primary" loading={busy} disabled={!fields.email.trim() || fields.password.length < 8} onClick={() => void actions.signIn()}>
                    Sign in
                  </Button>
                </div>
              )}

              {step.view === 'email-signup' && (
                <>
                  <p className="fs-hint">Step {step.step === 'email' ? '1 of 3: confirm your email' : step.step === 'code' ? '2 of 3: enter the code' : '3 of 3: choose a password'}</p>
                  {step.step === 'email' && (
                    <div className="fs-row-wrap">
                      <TextInput value={fields.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@example.com" type="email" autoComplete="username" aria-label="Email" style={{ width: 220 }} />
                      <Button size="sm" variant="primary" loading={busy} disabled={!fields.email.trim()} onClick={() => void actions.sendSignupCode()}>
                        Send code
                      </Button>
                    </div>
                  )}
                  {step.step === 'code' && (
                    <div className="fs-row-wrap">
                      <TextInput value={fields.code} onChange={(e) => set({ code: e.target.value })} placeholder="6-digit code" inputMode="numeric" maxLength={6} aria-label="Verification code" style={{ width: 140 }} />
                      <Button size="sm" variant="primary" loading={busy} disabled={fields.code.trim().length !== 6} onClick={() => void actions.verifySignupCode(step.email)}>
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
                      <Button size="sm" variant="primary" loading={busy} disabled={fields.password.length < 8 || !step.ticket} onClick={() => void actions.completeSignup(step.ticket ?? '')}>
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
                      <Button size="sm" variant="primary" loading={busy} disabled={fields.phone.replace(/\D/g, '').length < 8} onClick={() => void actions.sendPhoneCode()}>
                        Send code
                      </Button>
                    </>
                  ) : (
                    <>
                      <TextInput value={fields.code} onChange={(e) => set({ code: e.target.value })} placeholder="6-digit code" inputMode="numeric" maxLength={6} aria-label="Verification code" style={{ width: 140 }} />
                      <Button size="sm" variant="primary" loading={busy} disabled={fields.code.trim().length !== 6} onClick={() => void actions.verifyPhoneCode(step.phone)}>
                        Continue
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void actions.sendPhoneCode(step.phone)}>
                        Send a new code
                      </Button>
                    </>
                  )}
                </div>
              )}

              {/* Reset lives on the website (the server has the routes; the extension never had a way in). */}
              {(step.view === 'email-signin' || step.view === 'menu') && (
                <button type="button" className="fs-link" onClick={() => void sendMessage('site/open', { path: '/reset' }).catch(() => undefined)}>
                  Forgot your password?
                </button>
              )}

              {devCode && (
                <p className="fs-hint">
                  Development server: no email or SMS provider is configured, so your code is <b>{devCode}</b>.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Signed in, the name comes from the account (Your details below); this is the signed-out equivalent. */}
      {!user && (
        <SettingRow title="Your name" description="Optional. FocusSpace’s Home greets you with it. Stays in this browser.">
          <TextInput value={settings.displayName} onChange={(e) => patch({ displayName: e.target.value })} maxLength={40} placeholder="Optional" style={{ width: 200 }} aria-label="Your name" />
        </SettingRow>
      )}
      {/*
        Running your own FocusSpace server is a real capability and stays exactly as capable, but it is
        not part of signing in: a learner creating an account should never have to read the words
        "server address" to do it. Folded away behind the same disclosure Settings already uses for
        advanced filtering — open by default only for the person who has actually set one, so they can
        still find it without hunting.
      */}
      {(!API_URL || settings.api.baseUrl) && (
        <details className="fs-advanced" open={!!settings.api.baseUrl}>
          <summary className="fs-label">Advanced: run your own server</summary>
          <SettingRow
            title="FocusSpace server"
            description={
              API_URL
                ? 'Where your account lives. Leave empty to use FocusSpace’s own server. Reference server: server/index.ts.'
                : 'Where your account lives. This build has no server baked in, so an account needs one. Reference server: server/index.ts.'
            }
          >
            <div className="fs-row">
              <TextInput value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-server.example" style={{ width: 240 }} aria-label="FocusSpace server URL" />
              <Button size="sm" variant="secondary" disabled={trimmedBaseUrl === settings.api.baseUrl || (trimmedBaseUrl !== '' && !isHttpUrl(trimmedBaseUrl))} onClick={() => setApi({ baseUrl: trimmedBaseUrl })}>
                Save
              </Button>
            </div>
          </SettingRow>
        </details>
      )}
    </Section>
  );
}
