import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IdentityDb } from '../auth/db';
import { UsageDb } from '../usage/db';
import { effectivePlan, grantPlan } from './service';
import { resolvePlan, limitsFor } from '../usage/entitlements';
import { verifyPaymentSignature, verifyWebhookSignature, type RazorpayConfig } from './razorpay';

/** The two things that must not be wrong: money maps to the right entitlement, and only real payments count. */

let dir: string;
let identityDb: IdentityDb;
let usageDb: UsageDb;
let userId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focusspace-billing-test-'));
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

const DAY = 24 * 60 * 60 * 1000;
const input = (overrides: Partial<Parameters<typeof grantPlan>[1]> = {}) => ({
  userId,
  planId: 'pro' as const,
  period: 'monthly' as const,
  currency: 'INR' as const,
  amountMinor: 29900,
  orderId: 'order_1',
  paymentId: 'pay_1',
  ...overrides,
});

describe('grantPlan', () => {
  it('grants the plan for the period bought', () => {
    const now = 1_000_000;
    const grant = grantPlan(usageDb, input(), now);
    expect(grant).toMatchObject({ plan: 'pro', granted: true });
    expect(grant.expiresAt).toBe(now + 30 * DAY);
    expect(resolvePlan(usageDb.getEntitlement(userId), now)).toBe('pro');
  });

  it('an annual purchase lasts a year', () => {
    const now = 1_000_000;
    expect(grantPlan(usageDb, input({ period: 'annual' }), now).expiresAt).toBe(now + 365 * DAY);
  });

  it('replaying the same payment never extends the plan twice', () => {
    const now = 1_000_000;
    const first = grantPlan(usageDb, input(), now);
    // The webhook and the browser callback both report the same payment id.
    const second = grantPlan(usageDb, input(), now + 5_000);
    expect(second.granted).toBe(false);
    expect(second.expiresAt).toBe(first.expiresAt);
  });

  it('renewing early extends from the existing expiry, not from today', () => {
    const now = 1_000_000;
    const first = grantPlan(usageDb, input(), now);
    const second = grantPlan(usageDb, input({ paymentId: 'pay_2' }), now + DAY);
    // Buying a day later must add 30 days to what was left, not reset to 30 from now.
    expect(second.expiresAt).toBe(first.expiresAt + 30 * DAY);
  });
});

describe('expiry', () => {
  it('a lapsed paid plan reads as free again', () => {
    const now = 1_000_000;
    grantPlan(usageDb, input(), now);
    const row = usageDb.getEntitlement(userId);
    expect(effectivePlan(row, now + 29 * DAY)).toBe('pro');
    expect(effectivePlan(row, now + 31 * DAY)).toBe('free');
    expect(resolvePlan(row, now + 31 * DAY)).toBe('free');
  });

  it('limits follow the plan, and unlimited plans really are unlimited', () => {
    expect(limitsFor('free').aiUnitsPerPeriod).toBe(200);
    expect(limitsFor('pro').aiUnitsPerPeriod).toBe(2000);
    expect(limitsFor('unlimited').aiUnitsPerPeriod).toBe(Infinity);
    expect(limitsFor('max').maxSpaces).toBe(Infinity);
  });
});

describe('signatures', () => {
  const config: RazorpayConfig = { keyId: 'rzp_test_x', keySecret: 'secret', webhookSecret: 'hooksecret', test: true };

  it('accepts a correctly signed payment and rejects a tampered one', () => {
    // HMAC-SHA256 of "order|payment" with the key secret — Razorpay's documented scheme.
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    const good = createHmac('sha256', 'secret').update('order_1|pay_1').digest('hex');
    expect(verifyPaymentSignature(config, 'order_1', 'pay_1', good)).toBe(true);
    expect(verifyPaymentSignature(config, 'order_1', 'pay_2', good)).toBe(false);
    expect(verifyPaymentSignature(config, 'order_1', 'pay_1', 'deadbeef')).toBe(false);
  });

  it('refuses every webhook when no webhook secret is configured', () => {
    // Otherwise an unconfigured deployment would accept forged upgrade events.
    expect(verifyWebhookSignature({ ...config, webhookSecret: '' }, '{}', 'anything')).toBe(false);
  });
});
