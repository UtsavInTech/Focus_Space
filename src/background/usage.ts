import type { UsageStatusView } from '@/types/usage';
import { apiBaseUrl, status as authStatus } from './auth';

/**
 * FocusSpace account usage (Layer 2C) — GET /v1/me/usage. Purely informational (Settings → Account);
 * nothing in the product enforces anything client-side based on this, the server already does that at
 * the point of the actual AI request. Fails silently to `null` (no server configured, signed out, or
 * unreachable) — this is a nice-to-have display, never a gate.
 */
export async function status(): Promise<UsageStatusView | null> {
  const base = await apiBaseUrl();
  if (!base) return null;
  const { accessToken } = await authStatus();
  if (!accessToken) return null;
  try {
    const res = await fetch(`${base}/v1/me/usage`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as Partial<UsageStatusView> & { ok?: boolean };
    if (!json?.ok || typeof json.used !== 'number' || (typeof json.limit !== 'number' && json.limit !== null)) return null;
    return { plan: json.plan ?? 'free', period: json.period ?? '', used: json.used, limit: json.limit };
  } catch {
    return null;
  }
}
