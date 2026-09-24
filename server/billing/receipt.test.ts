import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IdentityDb } from '../auth/db';
import { UsageDb } from '../usage/db';
import { ApiError } from '../http';
import { buildReceipt } from './receipt';

/**
 * A receipt exists to be shown to the one person who paid — every case here is really one property
 * (never leak or confirm another account's payment) checked from a few angles, plus the "the numbers on
 * the page match what was actually recorded" sanity check that makes this worth having at all.
 */

let dir: string;
let identityDb: IdentityDb;
let usageDb: UsageDb;
let ownerId: string;
let strangerId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focusspace-receipt-test-'));
  const path = join(dir, 'test.db');
  identityDb = new IdentityDb(path);
  usageDb = new UsageDb(path);
  ownerId = randomUUID();
  strangerId = randomUUID();
  for (const id of [ownerId, strangerId]) {
    identityDb.insertUser({ id, email: `${id}@example.com`, phone: null, password_hash: 'x', email_verified: 1, status: 'active', name: null, city: null, created_at: Date.now(), updated_at: Date.now() });
  }
});

afterEach(() => {
  identityDb.close();
  usageDb.close();
  rmSync(dir, { recursive: true, force: true });
});

const recordPayment = (id: string, userId: string) =>
  usageDb.recordPayment({ id, user_id: userId, order_id: `order_${id}`, plan: 'pro', period: 'annual', currency: 'USD', amount_minor: 4900, status: 'captured', created_at: Date.parse('2026-03-01') });

describe('buildReceipt', () => {
  it("renders the owner's payment with the recorded amount, plan and payment id", () => {
    recordPayment('pay_abc123', ownerId);
    const receipt = buildReceipt(usageDb, { id: ownerId, email: 'owner@example.com' }, 'pay_abc123');
    expect(receipt.paymentId).toBe('pay_abc123');
    expect(receipt.html).toContain('$49.00');
    expect(receipt.html).toContain('pay_abc123');
    expect(receipt.html).toContain('owner@example.com');
    expect(receipt.html).toContain('12 months');
  });

  it("refuses another account's payment — same error as a payment that doesn't exist at all", () => {
    recordPayment('pay_owned', ownerId);
    let ownedError: unknown;
    let missingError: unknown;
    try {
      buildReceipt(usageDb, { id: strangerId, email: 'stranger@example.com' }, 'pay_owned');
    } catch (err) {
      ownedError = err;
    }
    try {
      buildReceipt(usageDb, { id: strangerId, email: 'stranger@example.com' }, 'pay_does_not_exist');
    } catch (err) {
      missingError = err;
    }
    expect(ownedError).toBeInstanceOf(ApiError);
    expect(missingError).toBeInstanceOf(ApiError);
    // Identical status, code and message either way — nothing here lets a caller distinguish
    // "not yours" from "not real", which is what stops this endpoint being used to probe payment ids.
    expect((ownedError as ApiError).status).toBe((missingError as ApiError).status);
    expect((ownedError as ApiError).code).toBe((missingError as ApiError).code);
    expect((ownedError as ApiError).message).toBe((missingError as ApiError).message);
  });

  it('escapes an email that happens to contain HTML-significant characters', () => {
    recordPayment('pay_xyz', ownerId);
    const receipt = buildReceipt(usageDb, { id: ownerId, email: '<script>alert(1)</script>@example.com' }, 'pay_xyz');
    expect(receipt.html).not.toContain('<script>alert(1)</script>');
    expect(receipt.html).toContain('&lt;script&gt;');
  });
});
