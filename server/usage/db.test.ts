import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IdentityDb } from '../auth/db';
import { UsageDb, type UsageEventRow } from './db';

/**
 * UsageDb opens its own connection to a database file. Both `IdentityDb` and `UsageDb` must point at
 * the SAME file here (not two separate :memory: databases, which are private per-connection and would
 * leave UsageDb with no `users` table to reference at all) so the foreign key UsageDb declares against
 * `users(id)` actually resolves — exactly the production wiring (see docs/LAYER_2C_USAGE_ENTITLEMENTS.md).
 */
let dir: string;
let identityDb: IdentityDb;
let usageDb: UsageDb;
let userId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focusspace-usage-db-test-'));
  const path = join(dir, 'test.db');
  identityDb = new IdentityDb(path);
  usageDb = new UsageDb(path);
  userId = randomUUID();
  identityDb.insertUser({ id: userId, email: `${randomUUID()}@example.com`, phone: null, password_hash: 'x', email_verified: 1, status: 'active', created_at: Date.now(), updated_at: Date.now() });
});

afterEach(() => {
  identityDb.close();
  usageDb.close();
  rmSync(dir, { recursive: true, force: true });
});

const makeEvent = (overrides: Partial<UsageEventRow> = {}): UsageEventRow => ({
  id: randomUUID(),
  user_id: userId,
  action: 'explain',
  units: 2,
  period: '2025-06',
  status: 'reserved',
  idempotency_key: null,
  model: null,
  prompt_tokens: null,
  completion_tokens: null,
  created_at: Date.now(),
  updated_at: Date.now(),
  ...overrides,
});

describe('UsageDb — foreign keys shared with IdentityDb', () => {
  it('rejects a usage event referencing a user_id that does not exist', () => {
    expect(() => usageDb.insertReservation(makeEvent({ user_id: 'no-such-user' }))).toThrow();
  });
});

describe('UsageDb — entitlements', () => {
  it('a user with no row has no entitlement (implicitly free — see entitlements.ts)', () => {
    expect(usageDb.getEntitlement(userId)).toBeUndefined();
  });

  it('setPlan upserts: first insert, then update in place', () => {
    usageDb.setPlan(userId, 'pro', 100);
    expect(usageDb.getEntitlement(userId)).toEqual({ user_id: userId, plan: 'pro', updated_at: 100 });
    usageDb.setPlan(userId, 'free', 200);
    expect(usageDb.getEntitlement(userId)).toEqual({ user_id: userId, plan: 'free', updated_at: 200 });
  });
});

describe('UsageDb — usage_events', () => {
  it('round-trips a reservation by id and by idempotency key', () => {
    const row = makeEvent({ idempotency_key: 'key-1' });
    usageDb.insertReservation(row);
    expect(usageDb.findById(row.id)).toEqual(row);
    expect(usageDb.findByIdempotencyKey(userId, 'key-1')).toEqual(row);
  });

  it('allows multiple rows with a NULL idempotency key (only non-null keys are unique)', () => {
    usageDb.insertReservation(makeEvent({ idempotency_key: null }));
    expect(() => usageDb.insertReservation(makeEvent({ idempotency_key: null }))).not.toThrow();
  });

  it('rejects a duplicate (user_id, idempotency_key) pair', () => {
    usageDb.insertReservation(makeEvent({ idempotency_key: 'dupe' }));
    expect(() => usageDb.insertReservation(makeEvent({ idempotency_key: 'dupe' }))).toThrow();
  });

  it('sums only committed and fresh-reserved units for the period, excluding failed and stale reservations', () => {
    const now = Date.now();
    usageDb.insertReservation(makeEvent({ units: 2, period: '2025-06', status: 'committed', created_at: now }));
    usageDb.insertReservation(makeEvent({ units: 3, period: '2025-06', status: 'reserved', created_at: now }));
    usageDb.insertReservation(makeEvent({ units: 5, period: '2025-06', status: 'failed', created_at: now }));
    usageDb.insertReservation(makeEvent({ units: 7, period: '2025-06', status: 'reserved', created_at: now - 10_000 })); // stale relative to cutoff below
    usageDb.insertReservation(makeEvent({ units: 99, period: '2025-05', status: 'committed', created_at: now })); // different period

    expect(usageDb.sumUnitsForPeriod(userId, '2025-06', now - 5_000)).toBe(5); // 2 committed + 3 fresh-reserved
  });

  it('commit sets status/model/tokens; release sets status only', () => {
    const row = makeEvent();
    usageDb.insertReservation(row);
    usageDb.commit(row.id, 999, 'openai/gpt-4o-mini', 10, 20);
    expect(usageDb.findById(row.id)).toMatchObject({ status: 'committed', model: 'openai/gpt-4o-mini', prompt_tokens: 10, completion_tokens: 20, updated_at: 999 });

    const row2 = makeEvent();
    usageDb.insertReservation(row2);
    usageDb.release(row2.id, 1000);
    expect(usageDb.findById(row2.id)).toMatchObject({ status: 'failed', updated_at: 1000 });
  });

  it('reuseReservation overwrites an abandoned row in place, keeping the same id', () => {
    const row = makeEvent({ idempotency_key: 'retry-key', status: 'failed', units: 1, action: 'what' });
    usageDb.insertReservation(row);
    usageDb.reuseReservation(row.id, 'quiz', 2, '2025-07', 5000);
    expect(usageDb.findById(row.id)).toMatchObject({ action: 'quiz', units: 2, period: '2025-07', status: 'reserved', model: null, prompt_tokens: null, completion_tokens: null, created_at: 5000 });
  });
});
