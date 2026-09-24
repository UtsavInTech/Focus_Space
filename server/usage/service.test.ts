import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../http';
import { IdentityDb } from '../auth/db';
import { UsageDb } from './db';
import { commitUsage, releaseUsage, reserveUsage, RESERVATION_STALE_MS, usageStatus } from './service';

let dir: string;
let identityDb: IdentityDb;
let usageDb: UsageDb;

const makeUser = (): string => {
  const id = randomUUID();
  identityDb.insertUser({ id, email: `${randomUUID()}@example.com`, phone: null, password_hash: 'x', email_verified: 1, status: 'active', name: null, city: null, google_sub: null, created_at: Date.now(), updated_at: Date.now() });
  return id;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focusspace-usage-service-test-'));
  const path = join(dir, 'test.db');
  identityDb = new IdentityDb(path);
  usageDb = new UsageDb(path);
});

afterEach(() => {
  identityDb.close();
  usageDb.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('usageStatus — free entitlement resolution', () => {
  it('a user with no entitlements row resolves as the free plan with the configured allowance', () => {
    const userId = makeUser();
    const status = usageStatus(usageDb, userId, Date.parse('2025-06-15T00:00:00Z'));
    expect(status.plan).toBe('free');
    expect(status.period).toBe('2025-06');
    expect(status.used).toBe(0);
    expect(status.limit).toBeGreaterThan(0);
  });

  it('a user granted "pro" resolves with pro limits (not reachable via any route yet, but the mechanism works)', () => {
    const userId = makeUser();
    usageDb.setPlan(userId, 'pro', Date.now());
    const free = usageStatus(usageDb, makeUser());
    const pro = usageStatus(usageDb, userId);
    expect(pro.plan).toBe('pro');
    // Both plans are finite here; unlimited (null) is covered by its own test below.
    expect(pro.limit!).toBeGreaterThan(free.limit!);
  });
});

describe('unlimited plans', () => {
  it('report a null limit, not zero — an unlimited plan showed "0 of 0" on the account page', () => {
    const userId = makeUser();
    usageDb.setPlan(userId, 'max', Date.now());
    const status = usageStatus(usageDb, userId);
    expect(status.plan).toBe('max');
    // Infinity survives JSON as null, so the wire type says null and means unlimited.
    expect(status.limit).toBeNull();
    expect(JSON.parse(JSON.stringify(status)).limit).toBeNull();
  });

  it('never run out, however much is spent', () => {
    const now = Date.now();
    const userId = makeUser();
    usageDb.setPlan(userId, 'unlimited', now);
    for (let i = 0; i < 50; i++) {
      const r = reserveUsage(usageDb, userId, 'mindmap', null, now);
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') commitUsage(usageDb, r.id, { model: null, promptTokens: null, completionTokens: null }, now);
    }
    expect(usageStatus(usageDb, userId, now).used).toBe(150);
  });
});

describe('user isolation', () => {
  it("one user's usage never counts toward another user's total", () => {
    const a = makeUser();
    const b = makeUser();
    const now = Date.now();
    reserveUsage(usageDb, a, 'quiz', null, now);
    reserveUsage(usageDb, a, 'quiz', null, now);
    expect(usageStatus(usageDb, a, now).used).toBeGreaterThan(0);
    expect(usageStatus(usageDb, b, now).used).toBe(0);
  });
});

describe('reserve → commit / release', () => {
  it('a successful request commits usage that counts toward the period total', () => {
    const userId = makeUser();
    const now = Date.now();
    const reservation = reserveUsage(usageDb, userId, 'explain', null, now);
    if (reservation.kind !== 'ok') throw new Error('expected ok');
    expect(usageStatus(usageDb, userId, now).used).toBe(2); // explain costs 2 units while only reserved

    commitUsage(usageDb, reservation.id, { model: 'openai/gpt-4o-mini', promptTokens: 10, completionTokens: 20 }, now);
    expect(usageStatus(usageDb, userId, now).used).toBe(2); // still counted once committed
  });

  it('a failed provider request releases the reservation and does not count against quota', () => {
    const userId = makeUser();
    const now = Date.now();
    const reservation = reserveUsage(usageDb, userId, 'quiz', null, now);
    if (reservation.kind !== 'ok') throw new Error('expected ok');
    expect(usageStatus(usageDb, userId, now).used).toBe(2);

    releaseUsage(usageDb, reservation.id, now);
    expect(usageStatus(usageDb, userId, now).used).toBe(0);
  });

  it('a stale, abandoned reservation (process crash — never committed or released) stops counting after the staleness window', () => {
    const userId = makeUser();
    const reservedAt = Date.now();
    const reservation = reserveUsage(usageDb, userId, 'what', null, reservedAt);
    if (reservation.kind !== 'ok') throw new Error('expected ok');

    expect(usageStatus(usageDb, userId, reservedAt).used).toBe(1);
    const later = reservedAt + RESERVATION_STALE_MS + 1000;
    expect(usageStatus(usageDb, userId, later).used).toBe(0);
  });
});

describe('quota enforcement', () => {
  it('exhausted quota is rejected with 429 quota_exceeded and does not create a reservation', () => {
    const userId = makeUser();
    usageDb.setPlan(userId, 'free', Date.now());
    const now = Date.now();

    // Drain the free allowance exactly (each committed "what" costs 1 unit).
    const status = usageStatus(usageDb, userId, now);
    for (let i = 0; i < status.limit!; i++) {
      const r = reserveUsage(usageDb, userId, 'what', null, now);
      if (r.kind === 'ok') commitUsage(usageDb, r.id, { model: null, promptTokens: null, completionTokens: null }, now);
    }
    expect(usageStatus(usageDb, userId, now).used).toBe(status.limit);

    let caught: ApiError | null = null;
    try {
      reserveUsage(usageDb, userId, 'what', null, now);
    } catch (err) {
      caught = err as ApiError;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.status).toBe(429);
    expect(caught?.code).toBe('quota_exceeded');
    // The rejected attempt must not itself have been reserved.
    expect(usageStatus(usageDb, userId, now).used).toBe(status.limit);
  });

  it('a request that would exceed quota (cost bigger than remaining headroom) is rejected even if some headroom remains', () => {
    const userId = makeUser();
    const now = Date.now();
    const status = usageStatus(usageDb, userId, now);
    // Leave exactly 1 unit of headroom, then try a 3-unit action ("notes").
    for (let i = 0; i < status.limit! - 1; i++) {
      const r = reserveUsage(usageDb, userId, 'what', null, now);
      if (r.kind === 'ok') commitUsage(usageDb, r.id, { model: null, promptTokens: null, completionTokens: null }, now);
    }
    expect(() => reserveUsage(usageDb, userId, 'notes', null, now)).toThrow(ApiError);
  });
});

describe('concurrency — two simultaneous requests must not both bypass quota', () => {
  it('when only one unit of headroom remains, two same-tick reservation attempts cannot both succeed', () => {
    const userId = makeUser();
    const now = Date.now();
    const status = usageStatus(usageDb, userId, now);
    for (let i = 0; i < status.limit! - 1; i++) {
      const r = reserveUsage(usageDb, userId, 'what', null, now);
      if (r.kind === 'ok') commitUsage(usageDb, r.id, { model: null, promptTokens: null, completionTokens: null }, now);
    }

    // Two "concurrent" attempts at the exact same timestamp — reserveUsage is fully synchronous, so
    // JS's single-threaded execution already guarantees they cannot interleave; this proves the second
    // one correctly sees the first's reservation rather than a stale pre-reservation count.
    const first = reserveUsage(usageDb, userId, 'what', null, now);
    expect(first.kind).toBe('ok');

    let secondFailed = false;
    try {
      reserveUsage(usageDb, userId, 'what', null, now);
    } catch (err) {
      secondFailed = err instanceof ApiError && err.code === 'quota_exceeded';
    }
    expect(secondFailed).toBe(true);
  });
});

describe('idempotent retry', () => {
  it('a retry with the same idempotency key after a committed success is not charged again', () => {
    const userId = makeUser();
    const now = Date.now();
    const first = reserveUsage(usageDb, userId, 'explain', 'req-1', now);
    if (first.kind !== 'ok') throw new Error('expected ok');
    commitUsage(usageDb, first.id, { model: null, promptTokens: null, completionTokens: null }, now);
    expect(usageStatus(usageDb, userId, now).used).toBe(2);

    const retry = reserveUsage(usageDb, userId, 'explain', 'req-1', now);
    expect(retry).toEqual({ kind: 'duplicate-committed' });
    expect(usageStatus(usageDb, userId, now).used).toBe(2); // unchanged — not double-charged
  });

  it('a genuinely concurrent duplicate (same key, still in flight) is rejected with 409, not double-reserved', () => {
    const userId = makeUser();
    const now = Date.now();
    const first = reserveUsage(usageDb, userId, 'explain', 'req-2', now);
    expect(first.kind).toBe('ok');

    let caught: ApiError | null = null;
    try {
      reserveUsage(usageDb, userId, 'explain', 'req-2', now);
    } catch (err) {
      caught = err as ApiError;
    }
    expect(caught?.status).toBe(409);
    expect(caught?.code).toBe('conflict');
    expect(usageStatus(usageDb, userId, now).used).toBe(2); // only the first reservation counts
  });

  it('a retry with the same key after the original attempt crashed (stale reservation) is allowed through as a fresh attempt', () => {
    const userId = makeUser();
    const reservedAt = Date.now();
    const first = reserveUsage(usageDb, userId, 'explain', 'req-3', reservedAt);
    if (first.kind !== 'ok') throw new Error('expected ok');
    // Never committed or released — simulates a process crash mid-request.

    const later = reservedAt + RESERVATION_STALE_MS + 1000;
    const retry = reserveUsage(usageDb, userId, 'explain', 'req-3', later);
    expect(retry).toEqual({ kind: 'ok', id: first.id }); // same row reused, not a new one
    expect(usageStatus(usageDb, userId, later).used).toBe(2);
  });

  it('a retry with the same key after an explicit release (failed request) is allowed through fresh', () => {
    const userId = makeUser();
    const now = Date.now();
    const first = reserveUsage(usageDb, userId, 'quiz', 'req-4', now);
    if (first.kind !== 'ok') throw new Error('expected ok');
    releaseUsage(usageDb, first.id, now);
    expect(usageStatus(usageDb, userId, now).used).toBe(0);

    const retry = reserveUsage(usageDb, userId, 'quiz', 'req-4', now);
    expect(retry.kind).toBe('ok');
    expect(usageStatus(usageDb, userId, now).used).toBe(2);
  });
});

describe('period boundary', () => {
  it('usage from a previous UTC calendar month does not count against the current period', () => {
    const userId = makeUser();
    const mayReservation = reserveUsage(usageDb, userId, 'what', null, Date.parse('2025-05-31T23:00:00Z'));
    if (mayReservation.kind !== 'ok') throw new Error('expected ok');
    commitUsage(usageDb, mayReservation.id, { model: null, promptTokens: null, completionTokens: null }, Date.parse('2025-05-31T23:00:00Z'));

    const juneStatus = usageStatus(usageDb, userId, Date.parse('2025-06-01T00:00:01Z'));
    expect(juneStatus.period).toBe('2025-06');
    expect(juneStatus.used).toBe(0);
  });

  it('usage is computed from the server clock (UTC), independent of any caller-supplied timezone concept', () => {
    // There is no timezone parameter anywhere in this API — currentPeriod() only ever takes an epoch ms
    // timestamp, so there is nothing a client could pass to shift its own period boundary.
    const userId = makeUser();
    const status = usageStatus(usageDb, userId, Date.parse('2025-06-15T12:00:00Z'));
    expect(status.period).toBe('2025-06');
  });
});
