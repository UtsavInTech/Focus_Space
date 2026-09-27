import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

/**
 * Usage/entitlement storage (Layer 2C) — its own `node:sqlite` connection to
 * the SAME file `server/auth/db.ts` uses (`DB_PATH`, default
 * `data/focusspace.db`). Two connections to one WAL-mode file is a supported,
 * safe SQLite pattern (WAL exists precisely for concurrent readers/writers),
 * and it's the smallest change that keeps this file from touching
 * `server/auth/db.ts` at all — see docs/LAYER_2C_USAGE_ENTITLEMENTS.md.
 *
 * Loaded via `createRequire`, same reason as server/auth/db.ts: `node:sqlite`
 * isn't yet in Vite/Vitest's builtin-module list for the non-server configs.
 */
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

export type UsageStatus = 'reserved' | 'committed' | 'failed';

/** A purchase as the server started it — see the `checkouts` table. `ref` is the Razorpay order or subscription id. */
export interface CheckoutRow {
  ref: string;
  kind: 'order' | 'subscription';
  user_id: string;
  plan: string;
  period: string;
  currency: string;
  amount_minor: number;
  remote_plan_id: string | null;
  created_at: number;
}

export interface EntitlementRow {
  user_id: string;
  plan: string;
  updated_at: number;
  /** When the paid plan lapses back to free. Null for a plan with no expiry. */
  expires_at: number | null;
  /** The Razorpay payment that granted this, for support and reconciliation. */
  payment_id: string | null;
  /** The Razorpay subscription renewing this, when there is one. */
  subscription_id: string | null;
  /** 1 while that subscription is live. Cleared on cancellation, which leaves the paid period intact. */
  auto_renew: number;
}

/**
 * The Razorpay plan objects we have created, one per (plan, period, currency)
 * and per key mode. Cached because creating a plan is idempotent only if we
 * remember the id — Razorpay would happily make a second identical plan.
 */
export interface RemotePlanRow {
  key: string;
  razorpay_plan_id: string;
  created_at: number;
}

/** One successful payment. Exists to make granting idempotent: a webhook and the client can both report the same payment. */
export interface PaymentRow {
  id: string;
  user_id: string;
  order_id: string;
  plan: string;
  period: string;
  currency: string;
  amount_minor: number;
  status: string;
  created_at: number;
}

export interface SpaceRow {
  user_id: string;
  space_id: string;
  name: string | null;
  created_at: number;
}

export interface UsageEventRow {
  id: string;
  user_id: string;
  action: string;
  units: number;
  period: string;
  status: UsageStatus;
  idempotency_key: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  created_at: number;
  updated_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entitlements (
  user_id    TEXT PRIMARY KEY REFERENCES users(id),
  plan       TEXT NOT NULL DEFAULT 'free',
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,
  payment_id TEXT,
  subscription_id TEXT,
  auto_renew INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS remote_plans (
  key              TEXT PRIMARY KEY,
  razorpay_plan_id TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);

-- What a checkout was started for, recorded by the server before the browser ever sees the order.
-- Confirmation grants exactly this row — never a plan named by the browser — and only to its owner.
CREATE TABLE IF NOT EXISTS checkouts (
  ref            TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  user_id        TEXT NOT NULL REFERENCES users(id),
  plan           TEXT NOT NULL,
  period         TEXT NOT NULL,
  currency       TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL,
  remote_plan_id TEXT,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  order_id     TEXT NOT NULL,
  plan         TEXT NOT NULL,
  period       TEXT NOT NULL,
  currency     TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  status       TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS payments_user ON payments(user_id, created_at);

CREATE TABLE IF NOT EXISTS usage_events (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  action            TEXT NOT NULL,
  units             INTEGER NOT NULL,
  period            TEXT NOT NULL,
  status            TEXT NOT NULL,
  idempotency_key   TEXT,
  model             TEXT,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS spaces (
  user_id    TEXT NOT NULL REFERENCES users(id),
  space_id   TEXT NOT NULL,
  name       TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, space_id)
);

-- Anonymous AI allowance: keyed by a salted hash of the caller's IP, never the IP itself, and
-- reset daily. Deliberately not in usage_events — that table is per-account (user_id REFERENCES
-- users) and feeds the learner's own monthly usage view; this is an abuse/goodwill limit only.
CREATE TABLE IF NOT EXISTS anon_usage (
  key        TEXT NOT NULL,
  period     TEXT NOT NULL,
  units      INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (key, period)
);

-- Seconds of speech (both directions) per month ("2026-09"). \`key\` is a user id, or a salted
-- anonymous key ("guest:…") for setup-only voice without an account.
CREATE TABLE IF NOT EXISTS voice_usage (
  key        TEXT NOT NULL,
  period     TEXT NOT NULL,
  seconds    INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (key, period)
);

CREATE UNIQUE INDEX IF NOT EXISTS usage_events_user_idem_idx ON usage_events(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS usage_events_user_period_idx ON usage_events(user_id, period);
`;

export class UsageDb {
  private readonly db: DatabaseSyncType;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /**
   * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists,
   * so columns added after the first deploy need this. Same approach as
   * server/auth/db.ts's own migrate(); adding a nullable column is the one
   * SQLite ALTER that is always safe.
   */
  private migrate(): void {
    const columns = new Set((this.db.prepare('PRAGMA table_info(entitlements)').all() as { name: string }[]).map((c) => c.name));
    if (!columns.has('expires_at')) this.db.exec('ALTER TABLE entitlements ADD COLUMN expires_at INTEGER');
    if (!columns.has('payment_id')) this.db.exec('ALTER TABLE entitlements ADD COLUMN payment_id TEXT');
    if (!columns.has('subscription_id')) this.db.exec('ALTER TABLE entitlements ADD COLUMN subscription_id TEXT');
    if (!columns.has('auto_renew')) this.db.exec('ALTER TABLE entitlements ADD COLUMN auto_renew INTEGER NOT NULL DEFAULT 0');
  }

  close(): void {
    this.db.close();
  }

  // ── entitlements ───────────────────────────────────────────────────────

  getEntitlement(userId: string): EntitlementRow | undefined {
    return this.db.prepare('SELECT * FROM entitlements WHERE user_id = ?').get(userId) as EntitlementRow | undefined;
  }

  setPlan(
    userId: string,
    plan: string,
    at: number,
    expiresAt: number | null = null,
    paymentId: string | null = null,
    subscriptionId: string | null = null,
    autoRenew = false,
  ): void {
    this.db
      .prepare(
        `INSERT INTO entitlements (user_id, plan, updated_at, expires_at, payment_id, subscription_id, auto_renew) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, updated_at = excluded.updated_at, expires_at = excluded.expires_at,
           payment_id = excluded.payment_id, subscription_id = excluded.subscription_id, auto_renew = excluded.auto_renew`,
      )
      .run(userId, plan, at, expiresAt, paymentId, subscriptionId, autoRenew ? 1 : 0);
  }

  /** Stops renewal without touching the paid-for period — cancelling is not a refund. */
  clearAutoRenew(userId: string, at: number): void {
    this.db.prepare('UPDATE entitlements SET auto_renew = 0, updated_at = ? WHERE user_id = ?').run(at, userId);
  }

  findBySubscription(subscriptionId: string): EntitlementRow | undefined {
    return this.db.prepare('SELECT * FROM entitlements WHERE subscription_id = ?').get(subscriptionId) as EntitlementRow | undefined;
  }

  // ── Razorpay plan cache ────────────────────────────────────────────────

  getRemotePlan(key: string): string | undefined {
    const row = this.db.prepare('SELECT razorpay_plan_id FROM remote_plans WHERE key = ?').get(key) as { razorpay_plan_id: string } | undefined;
    return row?.razorpay_plan_id;
  }

  putRemotePlan(key: string, razorpayPlanId: string, at: number): void {
    this.db.prepare('INSERT OR REPLACE INTO remote_plans (key, razorpay_plan_id, created_at) VALUES (?, ?, ?)').run(key, razorpayPlanId, at);
  }

  // ── checkouts ──────────────────────────────────────────────────────────

  putCheckout(row: CheckoutRow): void {
    this.db
      .prepare('INSERT INTO checkouts (ref, kind, user_id, plan, period, currency, amount_minor, remote_plan_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.ref, row.kind, row.user_id, row.plan, row.period, row.currency, row.amount_minor, row.remote_plan_id, row.created_at);
  }

  getCheckout(ref: string): CheckoutRow | undefined {
    return this.db.prepare('SELECT * FROM checkouts WHERE ref = ?').get(ref) as CheckoutRow | undefined;
  }

  // ── payments ───────────────────────────────────────────────────────────

  getPayment(paymentId: string): PaymentRow | undefined {
    return this.db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as PaymentRow | undefined;
  }

  /** Insert-or-ignore, so the webhook and the client callback racing on the same payment grant it once. */
  recordPayment(row: PaymentRow): boolean {
    const result = this.db
      .prepare('INSERT OR IGNORE INTO payments (id, user_id, order_id, plan, period, currency, amount_minor, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.user_id, row.order_id, row.plan, row.period, row.currency, row.amount_minor, row.status, row.created_at);
    return Number(result.changes) > 0;
  }

  listPayments(userId: string, limit = 20): PaymentRow[] {
    return this.db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit) as unknown as PaymentRow[];
  }

  // ── spaces ─────────────────────────────────────────────────────────────

  countSpaces(userId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM spaces WHERE user_id = ?').get(userId) as { n: number }).n;
  }

  listSpaces(userId: string): SpaceRow[] {
    return this.db.prepare('SELECT * FROM spaces WHERE user_id = ? ORDER BY created_at').all(userId) as unknown as SpaceRow[];
  }

  findSpace(userId: string, spaceId: string): SpaceRow | undefined {
    return this.db.prepare('SELECT * FROM spaces WHERE user_id = ? AND space_id = ?').get(userId, spaceId) as SpaceRow | undefined;
  }

  insertSpace(row: SpaceRow): void {
    this.db.prepare('INSERT INTO spaces (user_id, space_id, name, created_at) VALUES (?, ?, ?, ?)').run(row.user_id, row.space_id, row.name, row.created_at);
  }

  renameSpace(userId: string, spaceId: string, name: string, at: number): void {
    this.db.prepare('UPDATE spaces SET name = ?, created_at = MIN(created_at, ?) WHERE user_id = ? AND space_id = ?').run(name, at, userId, spaceId);
  }

  deleteSpace(userId: string, spaceId: string): void {
    this.db.prepare('DELETE FROM spaces WHERE user_id = ? AND space_id = ?').run(userId, spaceId);
  }

  // ── anonymous allowance ────────────────────────────────────────────────

  anonUnits(key: string, period: string): number {
    const row = this.db.prepare('SELECT units FROM anon_usage WHERE key = ? AND period = ?').get(key, period) as { units: number } | undefined;
    return row?.units ?? 0;
  }

  addAnonUnits(key: string, period: string, units: number, at: number): void {
    this.db
      .prepare('INSERT INTO anon_usage (key, period, units, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key, period) DO UPDATE SET units = units + excluded.units, updated_at = excluded.updated_at')
      .run(key, period, units, at);
  }

  /** Yesterday's anonymous rows are of no further use — dropped opportunistically rather than by a cron. */
  pruneAnonUsage(beforePeriod: string): void {
    this.db.prepare('DELETE FROM anon_usage WHERE period < ?').run(beforePeriod);
  }

  // ── usage ──────────────────────────────────────────────────────────────

  findByIdempotencyKey(userId: string, key: string): UsageEventRow | undefined {
    return this.db.prepare('SELECT * FROM usage_events WHERE user_id = ? AND idempotency_key = ?').get(userId, key) as UsageEventRow | undefined;
  }

  findById(id: string): UsageEventRow | undefined {
    return this.db.prepare('SELECT * FROM usage_events WHERE id = ?').get(id) as UsageEventRow | undefined;
  }

  /** Committed usage plus any reservation still fresher than `reservedCutoff` — see service.ts for why. */
  sumUnitsForPeriod(userId: string, period: string, reservedCutoff: number): number {
    const row = this.db
      .prepare(`SELECT COALESCE(SUM(units), 0) AS total FROM usage_events WHERE user_id = ? AND period = ? AND (status = 'committed' OR (status = 'reserved' AND created_at > ?))`)
      .get(userId, period, reservedCutoff) as { total: number };
    return row.total;
  }

  insertReservation(row: UsageEventRow): void {
    this.db
      .prepare(
        'INSERT INTO usage_events (id, user_id, action, units, period, status, idempotency_key, model, prompt_tokens, completion_tokens, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        row.id,
        row.user_id,
        row.action,
        row.units,
        row.period,
        row.status,
        row.idempotency_key,
        row.model,
        row.prompt_tokens,
        row.completion_tokens,
        row.created_at,
        row.updated_at,
      );
  }

  /** Reuses an abandoned (stale-reserved or failed) row for a fresh attempt under the same idempotency key, instead of leaking a dead row forever. */
  reuseReservation(id: string, action: string, units: number, period: string, at: number): void {
    this.db
      .prepare(`UPDATE usage_events SET action = ?, units = ?, period = ?, status = 'reserved', model = NULL, prompt_tokens = NULL, completion_tokens = NULL, created_at = ?, updated_at = ? WHERE id = ?`)
      .run(action, units, period, at, at, id);
  }

  commit(id: string, at: number, model: string | null, promptTokens: number | null, completionTokens: number | null): void {
    this.db
      .prepare(`UPDATE usage_events SET status = 'committed', model = ?, prompt_tokens = ?, completion_tokens = ?, updated_at = ? WHERE id = ?`)
      .run(model, promptTokens, completionTokens, at, id);
  }

  release(id: string, at: number): void {
    this.db.prepare(`UPDATE usage_events SET status = 'failed', updated_at = ? WHERE id = ?`).run(at, id);
  }

  voiceSeconds(key: string, period: string): number {
    const row = this.db.prepare('SELECT seconds FROM voice_usage WHERE key = ? AND period = ?').get(key, period) as { seconds: number } | undefined;
    return row?.seconds ?? 0;
  }

  addVoiceSeconds(key: string, period: string, seconds: number, now = Date.now()): void {
    this.db
      .prepare('INSERT INTO voice_usage (key, period, seconds, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key, period) DO UPDATE SET seconds = seconds + excluded.seconds, updated_at = excluded.updated_at')
      .run(key, period, Math.max(0, Math.round(seconds)), now);
  }
}

let shared: UsageDb | null = null;

/** The process-wide handle, opened once — same `DB_PATH` env var and default as server/auth/db.ts's getDb(). */
export function getUsageDb(): UsageDb {
  if (!shared) shared = new UsageDb(process.env.DB_PATH ?? 'data/focusspace.db');
  return shared;
}
