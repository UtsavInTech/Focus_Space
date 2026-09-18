import type { UsageLog } from '@/types/domain';

/** Focused YouTube time per mode per local day. */

export function dateKey(ts = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const secondsToday = (usage: UsageLog, modeId: string | null, now = Date.now()) => (modeId ? usage[dateKey(now)]?.[modeId] ?? 0 : 0);

export const minutesToday = (usage: UsageLog, modeId: string | null, now = Date.now()) => Math.floor(secondsToday(usage, modeId, now) / 60);

export function addUsage(usage: UsageLog, modeId: string, seconds: number, now = Date.now(), keepDays = 90): UsageLog {
  const key = dateKey(now);
  const next: UsageLog = { ...usage, [key]: { ...(usage[key] ?? {}), [modeId]: (usage[key]?.[modeId] ?? 0) + seconds } };
  const keys = Object.keys(next).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - keepDays))) delete next[old];
  return next;
}

/** Last `days` days of total minutes for a mode (oldest first) — for the weekly chart. */
export function recentMinutes(usage: UsageLog, modeId: string | null, days = 7, now = Date.now()): { key: string; label: string; minutes: number }[] {
  const out: { key: string; label: string; minutes: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const ts = now - i * 86_400_000;
    const key = dateKey(ts);
    const label = new Date(ts).toLocaleDateString('en', { weekday: 'narrow' });
    const day = usage[key] ?? {};
    const seconds = modeId ? day[modeId] ?? 0 : Object.values(day).reduce((a, b) => a + b, 0);
    out.push({ key, label, minutes: Math.round(seconds / 60) });
  }
  return out;
}
