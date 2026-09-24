/**
 * The website's client for the FocusSpace API.
 *
 * Same server the extension talks to (`server/index.ts`), same routes, same
 * token model — the site is a second client, never a second backend. The base
 * URL is baked in at build time so a deploy points at its own API without
 * anyone configuring anything.
 */

const RAW_BASE = (import.meta.env?.VITE_API_URL as string | undefined) ?? '';
export const API_BASE = RAW_BASE.replace(/\/$/, '');

/** True when this build knows where its API is. Nothing that needs an account can work without it. */
export const apiConfigured = !!API_BASE;

export interface User {
  id: string;
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  /** True once this account can also be signed into with Google. */
  google: boolean;
  name: string | null;
  city: string | null;
  createdAt: number;
}

export type PlanId = 'free' | 'pro' | 'unlimited' | 'max';

export interface Session {
  user: User;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
}

export interface UsageStatus {
  plan: string;
  period: string;
  used: number;
  /** `null` means unlimited — never "unknown", and never to be defaulted to 0. */
  limit: number | null;
}

/**
 * An error the caller can act on: `code` is the server's own machine-readable
 * reason (`conflict`, `rate_limited`, `invalid_credentials`, …) and `message`
 * is the server's sentence, which is already written for a person to read —
 * so the UI shows it rather than inventing its own wording.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!apiConfigured) {
    throw new ApiError('FocusSpace accounts are not available on this build yet.', 'not_configured', 0);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    // A bare "Failed to fetch" tells a person nothing about what to do next.
    throw new ApiError('Could not reach FocusSpace. Check your connection and try again.', 'network', 0);
  }

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `Something went wrong (HTTP ${res.status}).`;
    throw new ApiError(message, typeof body?.code === 'string' ? body.code : 'unknown', res.status);
  }
  return body as T;
}

const post = <T>(path: string, payload: unknown, token?: string) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(payload), ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) });

/** Step 1 of sign-up: prove the address. `devCode` is only ever present on a development server. */
export const signupStart = (email: string) => post<{ ok: true; delivery: string; devCode?: string; expiresAt: number }>('/v1/auth/signup/start', { email });

/** Step 2: the code buys a short-lived ticket. No account exists yet, so an abandoned sign-up leaves nothing behind. */
export const signupVerify = (email: string, code: string) => post<{ ok: true; ticket: string; expiresAt: number }>('/v1/auth/signup/verify', { email, code });

/** Step 3: the password creates the account, and the response is a real session. */
export const signupComplete = (ticket: string, password: string) => post<{ ok: true } & Session>('/v1/auth/signup/complete', { ticket, password });

/** Reset: the same three steps as sign-up, ending in a new password and a fresh session. */
export const resetStart = (email: string) => post<{ ok: true; delivery: string; devCode?: string; expiresAt: number }>('/v1/auth/reset/start', { email });
export const resetVerify = (email: string, code: string) => post<{ ok: true; ticket: string; expiresAt: number }>('/v1/auth/reset/verify', { email, code });
export const resetComplete = (ticket: string, password: string) => post<{ ok: true } & Session>('/v1/auth/reset/complete', { ticket, password });

export const login = (email: string, password: string) => post<{ ok: true } & Session>('/v1/auth/login', { email, password });

/**
 * One FocusSpace account across the website and the extension.
 *
 * `handoffCreate` asks the server, as this signed-in person, for a one-time code; whoever redeems it
 * gets their own session for the same account. The code is what crosses between surfaces — never this
 * site's refresh token. See server/auth/handoff.ts.
 */
export const handoffCreate = (token: string, origin: string) => post<{ ok: true; code: string; expiresAt: number }>('/v1/auth/handoff/create', { origin }, token);

export const handoffRedeem = (code: string) => post<{ ok: true } & Session>('/v1/auth/handoff/redeem', { code });

/**
 * Where "Continue with Google" sends the browser. The whole OAuth exchange happens on the server — this
 * is a plain navigation, and no client secret, authorization code or Google token ever touches this page.
 */
export const googleStartUrl = (returnTo: string): string => `${API_BASE}/v1/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;

export const refresh = (refreshToken: string) => post<{ ok: true; accessToken: string; accessTokenExpiresAt: number; refreshToken: string }>('/v1/auth/refresh', { refreshToken });

export const logout = (refreshToken: string) => post<{ ok: true }>('/v1/auth/logout', { refreshToken });

/** The plan rides along so a page never has to make a second call just to know what to offer. */
export const me = (token: string) =>
  request<{ ok: true; user: User; plan: PlanId; planExpiresAt: number | null; autoRenew: boolean }>('/v1/me', { headers: { Authorization: `Bearer ${token}` } });

export const updateProfile = (token: string, patch: { name?: string | null; city?: string | null }) => post<{ ok: true; user: User }>('/v1/me/profile', patch, token);

/** Billing. The server prices the plan — the client never sends an amount. */
export interface CheckoutSession {
  orderId: string;
  amountMinor: number;
  currency: 'INR' | 'USD';
  keyId: string;
  test: boolean;
  planId: string;
  period: string;
  description: string;
}

export const startCheckout = (token: string, body: { planId: string; period: string; currency: string }) =>
  post<{ ok: true } & CheckoutSession>('/v1/billing/checkout', body, token);

export const confirmPayment = (token: string, body: { orderId: string; paymentId: string; signature: string; planId: string; period: string; currency: string }) =>
  post<{ ok: true; plan: PlanId; expiresAt: number; granted: boolean }>('/v1/billing/confirm', body, token);

export interface SubscriptionSession {
  subscriptionId: string;
  keyId: string;
  test: boolean;
  planId: string;
  period: string;
  currency: 'INR' | 'USD';
  amountMinor: number;
  description: string;
}

export const startSubscription = (token: string, body: { planId: string; period: string; currency: string }) =>
  post<{ ok: true } & SubscriptionSession>('/v1/billing/subscribe', body, token);

export const confirmSubscription = (token: string, body: { subscriptionId: string; paymentId: string; signature: string; planId: string; period: string; currency: string }) =>
  post<{ ok: true; plan: PlanId; expiresAt: number; granted: boolean; autoRenew: boolean }>('/v1/billing/subscribe/confirm', body, token);

export const cancelPlan = (token: string) => post<{ ok: true; expiresAt: number | null }>('/v1/billing/cancel', {}, token);

export interface Payment {
  id: string;
  plan: string;
  period: string;
  currency: string;
  amount_minor: number;
  created_at: number;
}

export const payments = (token: string) => request<{ ok: true; payments: Payment[] }>('/v1/me/payments', { headers: { Authorization: `Bearer ${token}` } });

/** An authenticated, self-contained HTML receipt for one of the caller's own payments (server/billing/receipt.ts). */
export const paymentReceipt = (token: string, paymentId: string) =>
  request<{ ok: true; paymentId: string; html: string }>(`/v1/me/payments/${encodeURIComponent(paymentId)}/receipt`, { headers: { Authorization: `Bearer ${token}` } });

export const usage = (token: string) => request<{ ok: true } & UsageStatus>('/v1/me/usage', { headers: { Authorization: `Bearer ${token}` } });
