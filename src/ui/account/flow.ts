import { useCallback, useEffect, useState } from 'react';
import type { SpaceAllowanceView } from '@/types/account';
import type { AuthState } from '@/types/auth';
import type { UsageStatusView } from '@/types/usage';
import { sendMessage } from '@/messaging/runtime';
import { useStorage } from '@/ui/hooks';

/**
 * The FocusSpace account state machine. Settings → Account
 * (dashboard/pages/SettingsPage.tsx) is the surface that uses it today.
 * `content/ui/AccountEntry.tsx` is the same flow rendered in YouTube's
 * sidebar; it is currently unmounted — sign-up moved to the website, where an
 * account is actually created and managed — and kept because the hook is
 * deliberately surface-agnostic and the panel may return.
 *
 * Every call goes through the existing `auth/*`, `usage/status` and
 * `spaces/allowance` messages — this hook adds no backend surface of its own.
 */

export const ANONYMOUS: AuthState = { user: null, accessToken: null, accessTokenExpiresAt: null, refreshToken: null };

/** Where the learner is in signing in or creating an account. */
export type AccountStep =
  | { view: 'menu' }
  | { view: 'email-signin' }
  | { view: 'email-signup'; step: 'email' | 'code' | 'password'; email: string; ticket?: string }
  | { view: 'phone'; step: 'phone' | 'code'; phone: string };

export interface AccountFields {
  email: string;
  password: string;
  code: string;
  phone: string;
}

const EMPTY: AccountFields = { email: '', password: '', code: '', phone: '' };

/**
 * The question a guest is asked the first time they sign in on a browser that already holds their work
 * (background/ownership.ts). Shared so the YouTube panel and Settings say exactly the same thing.
 */
export const CLAIM_COPY = {
  title: 'Keep what’s in this browser?',
  body: 'You used FocusSpace here before signing in. Keep those Spaces, notes and watch history with this account, or start fresh. They will be here again if you sign out.',
  keep: 'Keep with my account',
  fresh: 'Start fresh',
} as const;

export function useAccountFlow() {
  /** undefined = still checking (first paint, or a refresh in flight). */
  const [auth, setAuth] = useState<AuthState | undefined>(undefined);
  const [usage, setUsage] = useState<UsageStatusView | null | undefined>(undefined);
  const [spaces, setSpaces] = useState<SpaceAllowanceView | null | undefined>(undefined);
  const [step, setStep] = useState<AccountStep>({ view: 'menu' });
  const [fields, setFields] = useState<AccountFields>(EMPTY);
  /** Only set when the server runs the development sender — see server/notify/sender.ts. */
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claimStore = useStorage(['pendingClaim'] as const);

  const loadAccountDetails = useCallback(() => {
    sendMessage('usage/status', {})
      .then(setUsage)
      .catch(() => setUsage(null));
    sendMessage('spaces/allowance', {})
      .then(setSpaces)
      .catch(() => setSpaces(null));
  }, []);

  const refresh = useCallback(() => {
    sendMessage('auth/status', {})
      .then((state) => {
        setAuth(state);
        if (state.user) loadAccountDetails();
        else {
          setUsage(undefined);
          setSpaces(undefined);
        }
      })
      .catch(() => setAuth(ANONYMOUS));
  }, [loadAccountDetails]);

  useEffect(refresh, [refresh]);

  const go = useCallback((next: AccountStep) => {
    setStep(next);
    setError(null);
    setDevCode(null);
    setFields((f) => ({ ...f, password: '', code: '' }));
  }, []);

  const set = useCallback((patch: Partial<AccountFields>) => setFields((f) => ({ ...f, ...patch })), []);

  /** One place owns busy/error handling, so no caller can forget either. */
  const run = useCallback(async <T extends { ok: boolean }>(action: () => Promise<T>, onSuccess: (result: T & { ok: true }) => void) => {
    setBusy(true);
    setError(null);
    const result = await action().catch(
      () => ({ ok: false, error: 'FocusSpace couldn’t reach its server. Check your connection, and the server address in Settings.' }) as T & { ok: false; error: string },
    );
    setBusy(false);
    if (result.ok) onSuccess(result as T & { ok: true });
    else setError('error' in result && typeof result.error === 'string' ? result.error : 'Something went wrong. Please try again.');
  }, []);

  const signedIn = useCallback(
    (state: AuthState) => {
      setAuth(state);
      setFields(EMPTY);
      setStep({ view: 'menu' });
      setError(null);
      setDevCode(null);
      loadAccountDetails();
    },
    [loadAccountDetails],
  );

  const captureDevCode = (result: { devCode?: string }) => setDevCode(typeof result.devCode === 'string' ? result.devCode : null);

  const actions = {
    signIn: () => run(() => sendMessage('auth/login', { email: fields.email.trim(), password: fields.password }), (r) => signedIn(r.state)),

    /** Step 1 of creating an account: the code proves the address before anything is created. */
    sendSignupCode: (email = fields.email.trim()) =>
      run(
        () => sendMessage('auth/signup-start', { email }),
        (r) => {
          captureDevCode(r);
          setStep({ view: 'email-signup', step: 'code', email });
        },
      ),
    verifySignupCode: (email: string) =>
      run(
        () => sendMessage('auth/signup-verify', { email, code: fields.code.trim() }),
        (r) => setStep({ view: 'email-signup', step: 'password', email, ticket: r.ticket }),
      ),
    completeSignup: (ticket: string) => run(() => sendMessage('auth/signup-complete', { ticket, password: fields.password }), (r) => signedIn(r.state)),

    sendPhoneCode: (phone = fields.phone.trim()) =>
      run(
        () => sendMessage('auth/phone-start', { phone }),
        (r) => {
          captureDevCode(r);
          setStep({ view: 'phone', step: 'code', phone });
        },
      ),
    verifyPhoneCode: (phone: string) => run(() => sendMessage('auth/phone-verify', { phone, code: fields.code.trim() }), (r) => signedIn(r.state)),

    signOut: () =>
      run(
        () => sendMessage('auth/logout', {}),
        () => {
          setAuth(ANONYMOUS);
          setUsage(undefined);
          setSpaces(undefined);
        },
      ),

    openSettings: () => void sendMessage('dashboard/open', { route: '/settings' }),

    /** Answers CLAIM_COPY. Either way the page may reload, since the data in use can change hands. */
    resolveClaim: (keep: boolean) => run(() => sendMessage('account/claim', { keep }), () => loadAccountDetails()),
  };

  const user = auth?.user ?? null;
  // Only ever the offer made to the account signed in here.
  const claim = user && claimStore?.pendingClaim?.userId === user.id ? claimStore.pendingClaim : null;

  return { auth, user, usage, spaces, claim, step, go, fields, set, busy, error, devCode, refresh, actions };
}

export type AccountFlow = ReturnType<typeof useAccountFlow>;

/** "you@example.com" or "+91 98765 43210" — whichever identifies this account. */
export const accountIdentity = (flow: AccountFlow) => flow.user?.email ?? flow.user?.phone ?? '';
