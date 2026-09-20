import type { AuthUser } from '@/types/auth';
import type { PaymentRecord, ProfilePatch } from '@/types/account';
import { apiBaseUrl, status as authStatus } from './auth';
import { setItem, getItem } from '@/storage/storage';

/**
 * The account's own details — profile and payment history — read from the FocusSpace API so the
 * extension can show them where the learner already is, instead of sending them to the website.
 * Everything here needs a signed-in account; signed out, each call answers "nothing", never an error.
 */

async function session(): Promise<{ base: string; token: string } | null> {
  const [base, { accessToken }] = await Promise.all([apiBaseUrl(), authStatus()]);
  return base && accessToken ? { base, token: accessToken } : null;
}

/** The signed-in learner as the server knows them (name and city included) — null when signed out. */
export async function profile(): Promise<AuthUser | null> {
  const s = await session();
  if (!s) return null;
  try {
    const res = await fetch(`${s.base}/v1/me`, { headers: { Authorization: `Bearer ${s.token}` } });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; user?: AuthUser } | null;
    if (!res.ok || !json?.ok || !json.user) return null;
    await rememberUser(json.user);
    return json.user;
  } catch {
    return null;
  }
}

export async function updateProfile(patch: ProfilePatch): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  const s = await session();
  if (!s) return { ok: false, error: 'Sign in to change your details.' };
  try {
    const res = await fetch(`${s.base}/v1/me/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` },
      body: JSON.stringify({ name: patch.name ?? null, city: patch.city ?? null }),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; user?: AuthUser; error?: string } | null;
    if (!res.ok || !json?.ok || !json.user) return { ok: false, error: json?.error ?? 'Your details could not be saved. Try again.' };
    await rememberUser(json.user);
    return { ok: true, user: json.user };
  } catch {
    return { ok: false, error: 'FocusSpace couldn’t reach its server. Check your connection and try again.' };
  }
}

export async function payments(): Promise<PaymentRecord[]> {
  const s = await session();
  if (!s) return [];
  try {
    const res = await fetch(`${s.base}/v1/me/payments`, { headers: { Authorization: `Bearer ${s.token}` } });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; payments?: PaymentRecord[] } | null;
    return res.ok && json?.ok && Array.isArray(json.payments) ? json.payments : [];
  } catch {
    return [];
  }
}

/** Keeps the cached session in step with the server's copy, so the name shows without a round trip next time. */
async function rememberUser(user: AuthUser): Promise<void> {
  const auth = await getItem('auth');
  if (auth.user?.id === user.id) await setItem('auth', { ...auth, user });
}
