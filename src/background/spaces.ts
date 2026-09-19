import type { SpaceAllowanceView, SpaceAuthorization } from '@/types/account';
import { apiBaseUrl, status as authStatus } from './auth';

/**
 * Space allowance (Layer 2C, server/usage/spaces.ts) as seen from the extension.
 *
 * The Spaces themselves never leave `chrome.storage.local`; this only asks the
 * server "may this account keep one more?" and tells it when one is deleted.
 * The server is authoritative — the client's job is to ask first so the learner
 * gets a product explanation instead of a failure after the fact.
 */

/**
 * The number quoted in copy when there is no account to ask (Settings, the account panel). It is
 * only a label: the real limit always comes from the server's entitlement for the signed-in account.
 */
export const FREE_SPACE_LIMIT_HINT = 4;
const LIMIT_MESSAGE = `Your plan includes ${FREE_SPACE_LIMIT_HINT} spaces on your account. Delete one you no longer use to make room — more spaces will come with a paid plan.`;

async function account(): Promise<{ base: string; token: string } | null> {
  const base = await apiBaseUrl();
  if (!base) return null;
  const { accessToken } = await authStatus();
  return accessToken ? { base, token: accessToken } : null;
}

export async function allowance(): Promise<SpaceAllowanceView | null> {
  const session = await account();
  if (!session) return null;
  try {
    const res = await fetch(`${session.base}/v1/me/spaces`, { headers: { Authorization: `Bearer ${session.token}` } });
    const json = (await res.json().catch(() => null)) as (SpaceAllowanceView & { ok?: boolean }) | null;
    if (!res.ok || !json?.ok || typeof json.used !== 'number' || (typeof json.limit !== 'number' && json.limit !== null)) return null;
    return { plan: json.plan ?? 'free', used: json.used, limit: json.limit };
  } catch {
    return null;
  }
}

/**
 * Asks whether one more Space may be created.
 *
 * A refusal from the server is final — that's the enforcement. A *transport* failure is not: being
 * offline must never stop someone from organising their own YouTube, so an unanswerable question
 * resolves to "yes" rather than blocking the learner on FocusSpace's own infrastructure.
 */
export async function authorize(spaceId: string, name?: string): Promise<SpaceAuthorization> {
  const session = await account();
  // Signed out there is no account to hold an allowance, and the spaces already in this browser
  // (including FocusSpace's built-in ones) must keep working — so nothing is enforced here. Building a
  // second, client-side quota would be exactly the parallel system the entitlement layer exists to avoid.
  if (!session) return { ok: true, allowance: null };
  try {
    const res = await fetch(`${session.base}/v1/me/spaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ spaceId, name: name ?? null }),
    });
    const json = (await res.json().catch(() => null)) as ({ ok: true } & SpaceAllowanceView) | { ok: false; code?: string; error?: string } | null;
    if (json && json.ok) return { ok: true, allowance: { plan: json.plan, used: json.used, limit: json.limit } };
    if (json && !json.ok && json.code === 'space_limit') return { ok: false, code: 'space_limit', error: json.error ?? LIMIT_MESSAGE, allowance: null };
    if (res.status === 401) return { ok: true, allowance: null }; // stale session: never block creating a Space over it
    return { ok: false, code: 'error', error: json && !json.ok && json.error ? json.error : 'FocusSpace couldn’t check your plan just now. Try again in a moment.', allowance: null };
  } catch {
    return { ok: true, allowance: null };
  }
}

/** Frees the slot when a Space is deleted. Best-effort: local deletion always succeeds. */
export async function release(spaceId: string): Promise<{ ok: true }> {
  const session = await account();
  if (session) {
    try {
      await fetch(`${session.base}/v1/me/spaces?spaceId=${encodeURIComponent(spaceId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.token}` } });
    } catch {
      // ignored — the slot is reconciled the next time a Space is registered
    }
  }
  return { ok: true };
}
