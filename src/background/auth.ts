import type { AuthState } from '@/types/auth';
import type { CodeSent, SignupTicket } from '@/types/account';
import { getItem, setItem } from '@/storage/storage';
import { API_URL } from '@/config';

/**
 * FocusSpace account (Layer 2B) — the background service worker owns all
 * outbound HTTP to the FocusSpace identity API, same pattern as `./ai.ts`'s
 * `endpointProvider`. Content scripts/UI never call the API directly; they
 * go through `auth/*` messages (see service-worker.ts).
 *
 * Anonymous stays the default, fully-working state: every function below is
 * additive on top of `settings.api.baseUrl` — an empty/unset base URL simply
 * means there is no FocusSpace account server configured, and every call
 * here becomes a no-op/failure that the caller already handles gracefully.
 */

const ANONYMOUS: AuthState = { user: null, accessToken: null, accessTokenExpiresAt: null, refreshToken: null };
/** Refresh a bit before actual expiry so a request made right at the boundary doesn't race the clock. */
const REFRESH_SKEW_MS = 60_000;

/** Exported for background/usage.ts (Layer 2C) — reuses this exact origin-validation instead of duplicating it. */
export async function apiBaseUrl(): Promise<string | null> {
  const { api } = await getItem('settings');
  // A store build signs in against FocusSpace's own API unless the learner pointed Settings somewhere else.
  const trimmed = (api.baseUrl.trim() || API_URL).replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    return ['http:', 'https:'].includes(new URL(trimmed).protocol) ? trimmed : null;
  } catch {
    return null;
  }
}

interface ServerAuthSuccess {
  ok: true;
  user: { id: string; email: string | null; phone?: string | null; emailVerified?: boolean; createdAt: number };
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
}
interface ServerRefreshSuccess {
  ok: true;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
}
interface ServerError {
  ok: false;
  error: string;
  /** Present only for a real server response (server/http.ts's ApiErrorResponse); absent for a synthesized network/parse failure below — that distinction is what tells a dead session apart from "we don't actually know". */
  code?: string;
}

async function postJson<T>(url: string, body: unknown, accessToken?: string): Promise<T | ServerError> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'Could not reach the FocusSpace server. Check your connection and the server address in Settings.' };
  }
  const json = (await res.json().catch(() => null)) as (T & { ok: true }) | ServerError | null;
  if (!json) return { ok: false, error: `The FocusSpace server returned an unexpected response (HTTP ${res.status}).` };
  return json;
}

async function persist(success: ServerAuthSuccess): Promise<AuthState> {
  const state: AuthState = {
    user: { id: success.user.id, email: success.user.email, phone: success.user.phone ?? null, emailVerified: success.user.emailVerified ?? false },
    accessToken: success.accessToken,
    accessTokenExpiresAt: success.accessTokenExpiresAt,
    refreshToken: success.refreshToken,
  };
  await setItem('auth', state);
  return state;
}

export async function login(email: string, password: string): Promise<{ ok: true; state: AuthState } | { ok: false; error: string }> {
  const base = await apiBaseUrl();
  if (!base) return { ok: false, error: 'No FocusSpace server is configured. Add one in Settings → Account.' };
  const result = await postJson<ServerAuthSuccess>(`${base}/v1/auth/login`, { email, password });
  if (!result.ok) return result;
  return { ok: true, state: await persist(result) };
}

/* ─── Verified sign-up (email → code → password) and phone sign-in ─────────── */

const NO_SERVER = 'No FocusSpace server is configured. Add one in Settings → Account.';

/** Step 1: FocusSpace emails a 6-digit code. Nothing is created yet. */
export async function startEmailSignup(email: string): Promise<CodeSent | { ok: false; error: string }> {
  const base = await apiBaseUrl();
  if (!base) return { ok: false, error: NO_SERVER };
  return postJson<CodeSent>(`${base}/v1/auth/signup/start`, { email });
}

/** Step 2: the code is checked server-side; the ticket is what proves it for step 3. */
export async function verifyEmailSignup(email: string, code: string): Promise<SignupTicket | { ok: false; error: string }> {
  const base = await apiBaseUrl();
  if (!base) return { ok: false, error: NO_SERVER };
  return postJson<SignupTicket>(`${base}/v1/auth/signup/verify`, { email, code });
}

/** Step 3: the password creates the (verified) account and signs in. */
export async function completeEmailSignup(ticket: string, password: string): Promise<{ ok: true; state: AuthState } | { ok: false; error: string }> {
  const base = await apiBaseUrl();
  if (!base) return { ok: false, error: NO_SERVER };
  const result = await postJson<ServerAuthSuccess>(`${base}/v1/auth/signup/complete`, { ticket, password });
  if (!result.ok) return result;
  return { ok: true, state: await persist(result) };
}

export async function startPhoneSignIn(phone: string): Promise<CodeSent | { ok: false; error: string }> {
  const base = await apiBaseUrl();
  if (!base) return { ok: false, error: NO_SERVER };
  return postJson<CodeSent>(`${base}/v1/auth/phone/start`, { phone });
}

/** Signs in — and creates the account when the number is new (the number is the credential). */
export async function verifyPhoneSignIn(phone: string, code: string): Promise<{ ok: true; state: AuthState; created: boolean } | { ok: false; error: string }> {
  const base = await apiBaseUrl();
  if (!base) return { ok: false, error: NO_SERVER };
  const result = await postJson<ServerAuthSuccess & { created?: boolean }>(`${base}/v1/auth/phone/verify`, { phone, code });
  if (!result.ok) return result;
  return { ok: true, state: await persist(result), created: result.created === true };
}

/**
 * Finishes a sign-in that happened on focusspace.xyz.
 *
 * The website cannot give the extension its session — different origins, no shared storage — so it asks
 * the server for a one-time code and passes that instead (web/src/connect.ts, server/auth/handoff.ts).
 * Redeeming it here mints a session that belongs to *this* extension: its own refresh token, its own
 * row, so signing out here does not sign out the website and vice versa.
 *
 * This is also what makes "Continue with Google" work in the extension without any OAuth credential
 * ever being shipped in the extension: the whole Google exchange happened on the server.
 */
export async function redeemHandoff(code: string): Promise<{ ok: true; state: AuthState } | { ok: false; error: string }> {
  const base = await apiBaseUrl();
  if (!base) return { ok: false, error: NO_SERVER };
  const result = await postJson<ServerAuthSuccess>(`${base}/v1/auth/handoff/redeem`, { code });
  if (!result.ok) return result;
  return { ok: true, state: await persist(result) };
}

export async function logout(): Promise<{ ok: true }> {
  const [base, current] = await Promise.all([apiBaseUrl(), getItem('auth')]);
  // Best-effort revocation — local sign-out must succeed even if the server is unreachable or the
  // session was already invalid server-side; a signed-out learner should never be stuck "logged in".
  if (base && current.accessToken) {
    try {
      await fetch(`${base}/v1/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${current.accessToken}` } });
    } catch {
      // ignored — local state is cleared unconditionally below
    }
  }
  await setItem('auth', ANONYMOUS);
  return { ok: true };
}

/**
 * Rotates the refresh token and updates the stored access token. Only a server-confirmed
 * "unauthorized" (the session/token is genuinely dead — revoked, expired, or real reuse) clears local
 * state. Anything else — a network hiccup, a rate limit, or the server's own benign-race response
 * (§ concurrent refresh in server/auth/service.ts) — must never sign the learner out locally over what
 * might just be a transient failure; the caller simply keeps today's cached state and tries again later.
 */
async function refresh(base: string, current: AuthState): Promise<AuthState> {
  if (!current.refreshToken) return current;
  const result = await postJson<ServerRefreshSuccess>(`${base}/v1/auth/refresh`, { refreshToken: current.refreshToken });
  if (!result.ok) {
    if (result.code === 'unauthorized') {
      await setItem('auth', ANONYMOUS);
      return ANONYMOUS;
    }
    return current;
  }
  const state: AuthState = { ...current, accessToken: result.accessToken, accessTokenExpiresAt: result.accessTokenExpiresAt, refreshToken: result.refreshToken };
  await setItem('auth', state);
  return state;
}

/**
 * Current local account state, transparently refreshing an about-to-expire access token first —
 * this is what makes "restore login after an extension/browser restart" (§N) work: the popup/
 * dashboard never has to know a token expired, it just asks for status.
 */
export async function status(): Promise<AuthState> {
  const current = await getItem('auth');
  if (!current.user) return current;
  const base = await apiBaseUrl();
  if (!base) return current; // can't refresh without a configured server; report what's cached
  if (current.accessTokenExpiresAt !== null && current.accessTokenExpiresAt - Date.now() > REFRESH_SKEW_MS) return current;
  return refresh(base, current);
}
