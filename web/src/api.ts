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
  createdAt: number;
}

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
  limit: number;
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

export const login = (email: string, password: string) => post<{ ok: true } & Session>('/v1/auth/login', { email, password });

export const refresh = (refreshToken: string) => post<{ ok: true; accessToken: string; accessTokenExpiresAt: number; refreshToken: string }>('/v1/auth/refresh', { refreshToken });

export const logout = (refreshToken: string) => post<{ ok: true }>('/v1/auth/logout', { refreshToken });

export const me = (token: string) => request<{ ok: true; user: User }>('/v1/me', { headers: { Authorization: `Bearer ${token}` } });

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
  post<{ ok: true; plan: 'free' | 'pro' | 'unlimited' | 'max'; expiresAt: number; granted: boolean }>('/v1/billing/confirm', body, token);

export interface Payment {
  id: string;
  plan: string;
  period: string;
  currency: string;
  amount_minor: number;
  created_at: number;
}

export const payments = (token: string) => request<{ ok: true; payments: Payment[] }>('/v1/me/payments', { headers: { Authorization: `Bearer ${token}` } });

export const usage = (token: string) => request<{ ok: true } & UsageStatus>('/v1/me/usage', { headers: { Authorization: `Bearer ${token}` } });
