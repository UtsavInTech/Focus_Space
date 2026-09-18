import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from '../http';
import type { UsageDb } from './db';
import { costOf } from './cost';
import { currentPeriod } from './period';
import { limitsFor, resolvePlan } from './entitlements';

/**
 * Reserve → commit/release usage accounting (Layer 2C). See
 * docs/LAYER_2C_USAGE_ENTITLEMENTS.md for the full reasoning; the short
 * version: `reserveUsage` is fully synchronous (no `await` inside it), which
 * is what makes it safe against two "concurrent" HTTP requests — Node's
 * single-threaded event loop can never interleave two synchronous calls, so
 * whichever request's reserveUsage() runs first completes its quota check
 * *and* insert before the other can even start (the same argument
 * server/auth/service.ts's refresh() rotation already relies on).
 */

/** Real OpenRouter calls finish in seconds; a 'reserved' row older than this is treated as abandoned (a crash between reserve and commit/release), not a live request. */
export const RESERVATION_STALE_MS = 2 * 60_000;

export interface UsageStatusView {
  plan: string;
  period: string;
  used: number;
  limit: number;
}

export function usageStatus(db: UsageDb, userId: string, now = Date.now()): UsageStatusView {
  const plan = resolvePlan(db.getEntitlement(userId));
  const period = currentPeriod(now);
  const used = db.sumUnitsForPeriod(userId, period, now - RESERVATION_STALE_MS);
  return { plan, period, used, limit: limitsFor(plan).aiUnitsPerPeriod };
}

export type Reservation =
  | { kind: 'ok'; id: string }
  /** The identical logical request already succeeded once — give it a fresh answer without charging again. */
  | { kind: 'duplicate-committed' };

function quotaExceeded(limit: number): ApiError {
  return new ApiError(429, 'quota_exceeded', `You've used all ${limit} AI actions included this period. It resets at the start of next month.`);
}

function assertWithinQuota(db: UsageDb, userId: string, period: string, units: number, now: number): void {
  const plan = resolvePlan(db.getEntitlement(userId));
  const limit = limitsFor(plan).aiUnitsPerPeriod;
  const used = db.sumUnitsForPeriod(userId, period, now - RESERVATION_STALE_MS);
  if (used + units > limit) throw quotaExceeded(limit);
}

/**
 * Throws `ApiError(429, 'quota_exceeded', …)` when the plan's period allowance is exhausted, or
 * `ApiError(409, 'conflict', …)` is left to the caller to raise for a `duplicate-in-flight`-style
 * concurrent retry — see the `idempotencyKey` branch below, which instead returns a typed result the
 * caller decides how to respond to (kept as a thrown error only for the quota case, matching how every
 * other route-level failure in this codebase already flows into the shared ApiError catch block).
 */
export function reserveUsage(db: UsageDb, userId: string, action: string, idempotencyKey: string | null, now = Date.now()): Reservation {
  const period = currentPeriod(now);
  const units = costOf(action);

  if (idempotencyKey) {
    const existing = db.findByIdempotencyKey(userId, idempotencyKey);
    if (existing) {
      if (existing.status === 'committed') return { kind: 'duplicate-committed' };
      if (existing.status === 'reserved' && now - existing.created_at <= RESERVATION_STALE_MS) {
        throw new ApiError(409, 'conflict', 'This request is already being processed. Please wait and try again.');
      }
      // status === 'failed', or an abandoned stale 'reserved' row (a crash between reserve and commit/release) — safe to reuse.
      assertWithinQuota(db, userId, period, units, now);
      db.reuseReservation(existing.id, action, units, period, now);
      return { kind: 'ok', id: existing.id };
    }
  }

  assertWithinQuota(db, userId, period, units, now);
  const id = randomUUID();
  db.insertReservation({
    id,
    user_id: userId,
    action,
    units,
    period,
    status: 'reserved',
    idempotency_key: idempotencyKey,
    model: null,
    prompt_tokens: null,
    completion_tokens: null,
    created_at: now,
    updated_at: now,
  });
  return { kind: 'ok', id };
}

export function commitUsage(db: UsageDb, id: string, meta: { model: string | null; promptTokens: number | null; completionTokens: number | null }, now = Date.now()): void {
  db.commit(id, now, meta.model, meta.promptTokens, meta.completionTokens);
}

export function releaseUsage(db: UsageDb, id: string, now = Date.now()): void {
  db.release(id, now);
}


/* ─── Anonymous allowance ──────────────────────────────────────────────────── */

/**
 * Signed-out learners can try the AI companion, with a small daily allowance — enough to see what it
 * does, deliberately less than a free account gets, which is what makes signing in worth something.
 *
 * Kept apart from the per-account system above: no reservation rows, no idempotency, a *daily* window,
 * and keyed by a salted hash of the caller's IP (never the IP itself, and never stored in a table that
 * belongs to a user). Anonymous usage can only ever be approximate — that's inherent to having no
 * account — so it is a goodwill limit, while the account-backed quota stays the real one.
 */
export const ANON_DAILY_AI_UNITS = Number(process.env.ANON_DAILY_AI_UNITS ?? 10);

export function anonymousKey(ip: string, secret: string): string {
  return createHash('sha256').update(`${secret}:${ip}`).digest('base64url').slice(0, 22);
}

const anonymousPeriod = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Throws before any upstream call is made, so a refused request costs nothing. */
export function assertAnonymousQuota(db: UsageDb, key: string, action: string, now = Date.now()): void {
  const used = db.anonUnits(key, anonymousPeriod(now));
  if (used + costOf(action) > ANON_DAILY_AI_UNITS) {
    throw new ApiError(429, 'quota_exceeded', "That's all the AI actions FocusSpace can give without an account today. Create a free account for more.");
  }
}

/** Called only after a successful answer — a failed request must never consume the allowance. */
export function recordAnonymousUsage(db: UsageDb, key: string, action: string, now = Date.now()): void {
  db.addAnonUnits(key, anonymousPeriod(now), costOf(action), now);
  db.pruneAnonUsage(anonymousPeriod(now - 7 * 24 * 60 * 60 * 1000));
}
