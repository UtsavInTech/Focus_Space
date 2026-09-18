import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IdentityDb } from '../auth/db';
import { UsageDb } from './db';
import { limitsFor } from './entitlements';
import { registerSpace, spaceAllowance, unregisterSpace } from './spaces';
import { ANON_DAILY_AI_UNITS, anonymousKey, assertAnonymousQuota, recordAnonymousUsage } from './service';

/** Same two-connections-one-file wiring as usage/db.test.ts — the spaces table references users(id). */
let dir: string;
let identityDb: IdentityDb;
let usageDb: UsageDb;
let userId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focusspace-spaces-test-'));
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

const FREE_SPACES = limitsFor('free').maxSpaces;

describe('Space allowance is an entitlement, enforced server-side', () => {
  it('lets a free account keep exactly its plan’s number of Spaces', () => {
    expect(spaceAllowance(usageDb, userId)).toEqual({ plan: 'free', used: 0, limit: FREE_SPACES });
    for (let i = 0; i < FREE_SPACES; i++) expect(registerSpace(usageDb, userId, `space-${i}`, `Space ${i}`).used).toBe(i + 1);
    expect(() => registerSpace(usageDb, userId, 'one-too-many', 'Extra')).toThrow(/plan includes/);
    expect(spaceAllowance(usageDb, userId).used).toBe(FREE_SPACES);
    expect(usageDb.findSpace(userId, 'one-too-many')).toBeUndefined();
  });

  it('is idempotent: re-registering a Space the account already has costs nothing', () => {
    registerSpace(usageDb, userId, 'dsa', 'DSA');
    registerSpace(usageDb, userId, 'dsa', 'DSA renamed');
    expect(spaceAllowance(usageDb, userId).used).toBe(1);
    expect(usageDb.findSpace(userId, 'dsa')?.name).toBe('DSA renamed');
  });

  it('frees the slot when a Space is deleted', () => {
    for (let i = 0; i < FREE_SPACES; i++) registerSpace(usageDb, userId, `space-${i}`, null);
    expect(() => registerSpace(usageDb, userId, 'new', null)).toThrow();
    expect(unregisterSpace(usageDb, userId, 'space-0').used).toBe(FREE_SPACES - 1);
    expect(registerSpace(usageDb, userId, 'new', null).used).toBe(FREE_SPACES);
  });

  it('counts each account separately', () => {
    const otherId = randomUUID();
    identityDb.insertUser({ id: otherId, email: `${randomUUID()}@example.com`, phone: null, password_hash: 'x', email_verified: 1, status: 'active', created_at: Date.now(), updated_at: Date.now() });
    for (let i = 0; i < FREE_SPACES; i++) registerSpace(usageDb, userId, `space-${i}`, null);
    expect(registerSpace(usageDb, otherId, 'their-first', null)).toEqual({ plan: 'free', used: 1, limit: FREE_SPACES });
  });

  it('a paid plan simply has a different entitlement row — no code path of its own', () => {
    usageDb.setPlan(userId, 'pro', Date.now());
    expect(spaceAllowance(usageDb, userId).limit).toBe(limitsFor('pro').maxSpaces);
    expect(limitsFor('pro').maxSpaces).toBeGreaterThan(FREE_SPACES);
  });
});

describe('anonymous AI allowance', () => {
  const key = () => anonymousKey('203.0.113.7', 'secret');

  it('allows a limited number of actions per day, then asks for an account', () => {
    for (let i = 0; i < ANON_DAILY_AI_UNITS; i++) {
      assertAnonymousQuota(usageDb, key(), 'what');
      recordAnonymousUsage(usageDb, key(), 'what');
    }
    expect(() => assertAnonymousQuota(usageDb, key(), 'what')).toThrow(/free account/);
  });

  it('charges the same per-action cost as an account does, and never records a failed request', () => {
    assertAnonymousQuota(usageDb, key(), 'quiz');
    recordAnonymousUsage(usageDb, key(), 'quiz'); // quiz costs 2 units
    expect(usageDb.anonUnits(key(), new Date().toISOString().slice(0, 10))).toBe(2);
    assertAnonymousQuota(usageDb, key(), 'what'); // a check alone consumes nothing
    expect(usageDb.anonUnits(key(), new Date().toISOString().slice(0, 10))).toBe(2);
  });

  it('is per-caller, resets daily, and never stores the address itself', () => {
    const other = anonymousKey('198.51.100.9', 'secret');
    for (let i = 0; i < ANON_DAILY_AI_UNITS; i++) recordAnonymousUsage(usageDb, key(), 'what');
    expect(() => assertAnonymousQuota(usageDb, other, 'what')).not.toThrow();
    expect(key()).not.toContain('203.0.113.7');

    const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
    expect(() => assertAnonymousQuota(usageDb, key(), 'what', tomorrow)).not.toThrow();
  });

  it('gives a signed-in free account more than an anonymous visitor', () => {
    expect(limitsFor('free').aiUnitsPerPeriod).toBeGreaterThan(ANON_DAILY_AI_UNITS);
  });
});
