import { createHash, timingSafeEqual } from 'node:crypto';
import { PLANS, type PlanId } from '@/billing/plans';
import type { UsageDb } from './db';
import { resolvePlan } from './entitlements';

/**
 * How many people actually use FocusSpace, and whether they come back — the numbers that decide
 * whether it is working (and what it is worth).
 *
 * The extension says "this install was used today" at most once a day (src/background/activity.ts).
 * What is kept is a salted hash of its random install id and the date — never an account id, an
 * address, or anything about what was watched. From that alone: daily, weekly and monthly active
 * installs, new installs per day, and retention (of the installs first seen in a week, how many were
 * back a day, a week and a month later). Paying users come from the entitlements that already exist.
 *
 * The numbers are read with an admin token (ADMIN_TOKEN) — never exposed to users.
 */

const DAY = 86_400_000;
export const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The stored subject: install ids are hashed with the server's secret, so the table can't be joined to anything. */
export function activitySubject(installId: string, secret: string): string {
  return createHash('sha256').update(`${secret}:activity:${installId}`).digest('base64url').slice(0, 24);
}

export function recordActive(db: UsageDb, subject: string, signedIn: boolean, now = Date.now()): void {
  db.recordActivity(subject, isoDay(now), signedIn);
}

/** Constant-time check of the admin bearer token; false when no token is configured at all. */
export function isAdmin(authorization: string | undefined, token: string | undefined): boolean {
  if (!token || token.length < 24 || !authorization?.startsWith('Bearer ')) return false;
  const given = Buffer.from(authorization.slice(7));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

export interface RetentionRow {
  /** Monday of the week these installs were first seen. */
  week: string;
  size: number;
  /** Share (0–1) active again the next day, 7–13 days and 28–34 days after their own first day; null when too recent to know. */
  day1: number | null;
  day7: number | null;
  day30: number | null;
}

export interface Metrics {
  asOf: string;
  active: { day: number; week: number; month: number; weekSignedIn: number };
  /** Weekly actives ÷ monthly actives: how much of the month's audience is here every week. */
  stickiness: number | null;
  newInstalls: { day: string; n: number }[];
  retention: RetentionRow[];
  paying: { total: number; byPlan: Partial<Record<PlanId, number>>; mrrInr: number };
}

const share = (returned: number, size: number) => (size ? Math.round((returned / size) * 1000) / 1000 : null);

export function metrics(db: UsageDb, now = Date.now()): Metrics {
  const today = isoDay(now);
  const back = (days: number) => isoDay(now - days * DAY);
  const day = db.activeBetween(today, today);
  const week = db.activeBetween(back(6), today);
  const month = db.activeBetween(back(29), today);

  // Weekly cohorts for the last 8 full-or-current weeks, Monday-based.
  const monday = new Date(now);
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const retention: RetentionRow[] = [];
  for (let w = 7; w >= 0; w--) {
    const start = monday.getTime() - w * 7 * DAY;
    const end = start + 6 * DAY;
    // Relative to each install's own first day; reported only once every install in the week has had
    // the whole window, so a young cohort never shows a falsely low number.
    const window = (fromDays: number, toDays: number) => (end + toDays * DAY > now ? null : share(db.cohortReturned(isoDay(start), isoDay(end), fromDays, toDays).returned, size));
    const size = db.cohortReturned(isoDay(start), isoDay(end), 0, 0).size;
    if (!size) continue;
    retention.push({ week: isoDay(start), size, day1: window(1, 1), day7: window(7, 13), day30: window(28, 34) });
  }

  const byPlan: Partial<Record<PlanId, number>> = {};
  let mrrInr = 0;
  for (const row of db.allEntitlements()) {
    const plan = resolvePlan(row, now);
    if (plan === 'free') continue;
    byPlan[plan] = (byPlan[plan] ?? 0) + 1;
    mrrInr += PLANS.find((p) => p.id === plan)?.price?.monthly.inr ?? 0;
  }

  return {
    asOf: today,
    active: { day, week, month, weekSignedIn: db.activeBetween(back(6), today, true) },
    stickiness: month ? Math.round((week / month) * 100) / 100 : null,
    newInstalls: db.newSubjectsSince(back(29)),
    retention,
    paying: { total: Object.values(byPlan).reduce((a, b) => a + (b ?? 0), 0), byPlan, mrrInr },
  };
}
