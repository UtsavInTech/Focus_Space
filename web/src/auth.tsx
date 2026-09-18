import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as api from './api';
import type { PlanId, Session, User } from './api';

/**
 * Who is signed in, for the whole site.
 *
 * The session lives in `localStorage` rather than a cookie because the API is
 * on a different origin from the site (and will stay that way — the extension
 * is a third client of the same API), so a same-site cookie was never an
 * option. The access token is short-lived and refreshed silently; a refresh
 * that fails for a real reason signs the person out, while one that fails
 * because the network is down leaves the session alone.
 */

const STORAGE_KEY = 'fs.session';

/** Refresh this long before expiry, so a request never goes out with a token about to die. */
const REFRESH_MARGIN_MS = 60_000;

interface AuthState {
  user: User | null;
  /** What they are entitled to right now. 'free' until the server says otherwise. */
  plan: PlanId;
  planExpiresAt: number | null;
  /** False until the stored session has been checked, so the nav does not flash "Sign in" at someone who is. */
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  completeSignup: (ticket: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads the account from the server — after a purchase, or a profile edit. */
  reload: () => Promise<void>;
  setProfile: (patch: { name?: string | null; city?: string | null }) => Promise<void>;
  /** A valid access token, refreshed if needed. Null when signed out. */
  token: () => Promise<string | null>;
}

const AuthContext = createContext<AuthState | null>(null);

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function writeSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A session that cannot be persisted still works for this tab.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [plan, setPlan] = useState<PlanId>('free');
  const [planExpiresAt, setPlanExpiresAt] = useState<number | null>(null);

  useEffect(() => {
    const stored = readSession();
    setSession(stored);
    setReady(true);
  }, []);

  const apply = useCallback((next: Session | null) => {
    setSession(next);
    writeSession(next);
  }, []);

  const token = useCallback(async (): Promise<string | null> => {
    const current = readSession();
    if (!current) return null;
    if (current.accessTokenExpiresAt - REFRESH_MARGIN_MS > Date.now()) return current.accessToken;

    try {
      const refreshed = await api.refresh(current.refreshToken);
      const next: Session = { ...current, accessToken: refreshed.accessToken, accessTokenExpiresAt: refreshed.accessTokenExpiresAt, refreshToken: refreshed.refreshToken };
      apply(next);
      return next.accessToken;
    } catch (err) {
      // Only a refusal means the session is genuinely dead. A network blip must
      // never sign someone out — they would lose their place for being offline.
      if (err instanceof api.ApiError && err.status >= 400 && err.status < 500) {
        apply(null);
        return null;
      }
      return current.accessToken;
    }
  }, [apply]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await api.login(email, password);
      apply({ user: result.user, accessToken: result.accessToken, accessTokenExpiresAt: result.accessTokenExpiresAt, refreshToken: result.refreshToken });
    },
    [apply],
  );

  const completeSignup = useCallback(
    async (ticket: string, password: string) => {
      const result = await api.signupComplete(ticket, password);
      apply({ user: result.user, accessToken: result.accessToken, accessTokenExpiresAt: result.accessTokenExpiresAt, refreshToken: result.refreshToken });
    },
    [apply],
  );

  const signOut = useCallback(async () => {
    const current = readSession();
    setPlan('free');
    setPlanExpiresAt(null);
    apply(null); // locally first: signing out must never depend on the network
    if (current) await api.logout(current.refreshToken).catch(() => undefined);
  }, [apply]);

  /**
   * Pulls the account fresh. Called once a session exists and again after a
   * purchase, so the plan the UI shows is the server's answer rather than
   * something the client inferred from a checkout it just ran.
   */
  const reload = useCallback(async () => {
    const current = await token();
    if (!current) return;
    try {
      const result = await api.me(current);
      setPlan(result.plan);
      setPlanExpiresAt(result.planExpiresAt);
      setSession((prev) => (prev ? { ...prev, user: result.user } : prev));
    } catch {
      // A failed refresh of the profile must never disturb the session itself.
    }
  }, [token]);

  useEffect(() => {
    if (session) void reload();
    // Only when the identity changes — not on every token rotation.
  }, [session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setProfile = useCallback(
    async (patch: { name?: string | null; city?: string | null }) => {
      const current = await token();
      if (!current) throw new api.ApiError('You are signed out.', 'unauthorized', 401);
      const result = await api.updateProfile(current, patch);
      setSession((prev) => (prev ? { ...prev, user: result.user } : prev));
    },
    [token],
  );

  const value = useMemo<AuthState>(
    () => ({ user: session?.user ?? null, plan, planExpiresAt, ready, signIn, completeSignup, signOut, token, reload, setProfile }),
    [session, plan, planExpiresAt, ready, signIn, completeSignup, signOut, token, reload, setProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
