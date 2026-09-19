import type { SpaceAllowanceView, SpaceAuthorization } from '@/types/account';
import { FREE_SPACE_LIMIT, GUEST_SPACE_LIMIT } from '@/billing/plans';
import { getItem } from '@/storage/storage';
import { apiBaseUrl, status as authStatus } from './auth';

/**
 * Space allowance (Layer 2C, server/usage/spaces.ts) as seen from the extension.
 *
 * The Spaces themselves never leave `chrome.storage.local`; this only asks the
 * server "may this account keep one more?" and tells it when one is deleted.
 * The server is authoritative — the client's job is to ask first so the learner
 * gets a product explanation instead of a failure after the fact.
 */

/** Used only if the server refuses without saying why; its own message names the learner's plan. */
const LIMIT_MESSAGE = 'Your plan’s Spaces are all in use. Delete one you no longer use to make room, or upgrade for more.';

export const GUEST_LIMIT_MESSAGE = `Without an account, FocusSpace keeps ${GUEST_SPACE_LIMIT} Spaces in this browser. Delete one you no longer use, or create a free account for ${FREE_SPACE_LIMIT}.`;

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

export const UNVERIFIED_MESSAGE = 'FocusSpace couldn’t check your plan’s Space allowance. Try again when you’re online.';

/**
 * Asks whether one more Space may be created.
 *
 * Signed in, the Space allowance is the account's paid entitlement, and only the server can confirm it:
 * any answer other than the server's "yes" — offline, a timeout, a dead session — refuses the new Space.
 * (Allowing it offline let a signed-in learner create Spaces the server never counted.) Everything that
 * already exists keeps working offline; only *creating* waits for the server.
 *
 * Signed out there is no account to ask, so the guest limit is counted here, in this browser.
 */
export async function authorize(spaceId: string, name?: string): Promise<SpaceAuthorization> {
  const { user } = await getItem('auth');
  if (!user) {
    const modes = await getItem('modes');
    const used = modes.filter((m) => m.id !== spaceId).length;
    if (used >= GUEST_SPACE_LIMIT) return { ok: false, code: 'space_limit', error: GUEST_LIMIT_MESSAGE, allowance: { plan: 'guest', used, limit: GUEST_SPACE_LIMIT } };
    return { ok: true, allowance: null };
  }

  const unverified: SpaceAuthorization = { ok: false, code: 'error', error: UNVERIFIED_MESSAGE, allowance: null };
  const session = await account().catch(() => null);
  if (!session) return unverified;
  try {
    const res = await fetch(`${session.base}/v1/me/spaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ spaceId, name: name ?? null }),
    });
    const json = (await res.json().catch(() => null)) as ({ ok: true } & SpaceAllowanceView) | { ok: false; code?: string; error?: string } | null;
    if (json && json.ok) return { ok: true, allowance: { plan: json.plan, used: json.used, limit: json.limit } };
    if (json && !json.ok && json.code === 'space_limit') return { ok: false, code: 'space_limit', error: json.error ?? LIMIT_MESSAGE, allowance: null };
    if (res.status === 401) return { ok: false, code: 'error', error: 'Your session has ended. Sign in again to create a Space.', allowance: null };
    return { ok: false, code: 'error', error: json && !json.ok && json.error ? json.error : UNVERIFIED_MESSAGE, allowance: null };
  } catch {
    return unverified;
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
