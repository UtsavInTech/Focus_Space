import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IdentityDb } from '../auth/db';
import { UsageDb } from '../usage/db';
import { applyWebhook, effectivePlan, grantPlan } from './service';
import { resolvePlan, limitsFor } from '../usage/entitlements';
import { verifyPaymentSignature, verifySubscriptionSignature, verifyWebhookSignature, type RazorpayConfig } from './razorpay';

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
  identityDb.insertUser({ id: userId, email: `${randomUUID()}@example.com`, phone: null, password_hash: 'x', email_verified: 1, status: 'active', name: null, city: null, google_sub: null, created_at: Date.now(), updated_at: Date.now() });
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
  it('grants the plan for the period bought', async () => {
    const now = 1_000_000;
    const grant = grantPlan(usageDb, input(), now);
    expect(grant).toMatchObject({ plan: 'pro', granted: true });
    expect(grant.expiresAt).toBe(now + 30 * DAY);
    expect(resolvePlan(usageDb.getEntitlement(userId), now)).toBe('pro');
  });

  it('an annual purchase lasts a year', async () => {
    const now = 1_000_000;
    expect(grantPlan(usageDb, input({ period: 'annual' }), now).expiresAt).toBe(now + 365 * DAY);
  });

  it('replaying the same payment never extends the plan twice', async () => {
    const now = 1_000_000;
    const first = grantPlan(usageDb, input(), now);
    // The webhook and the browser callback both report the same payment id.
    const second = grantPlan(usageDb, input(), now + 5_000);
    expect(second.granted).toBe(false);
    expect(second.expiresAt).toBe(first.expiresAt);
  });

  it('renewing early extends from the existing expiry, not from today', async () => {
    const now = 1_000_000;
    const first = grantPlan(usageDb, input(), now);
    const second = grantPlan(usageDb, input({ paymentId: 'pay_2' }), now + DAY);
    // Buying a day later must add 30 days to what was left, not reset to 30 from now.
    expect(second.expiresAt).toBe(first.expiresAt! + 30 * DAY);
  });
});

describe('expiry', () => {
  it('a lapsed paid plan reads as free again', async () => {
    const now = 1_000_000;
    grantPlan(usageDb, input(), now);
    const row = usageDb.getEntitlement(userId);
    expect(effectivePlan(row, now + 29 * DAY)).toBe('pro');
    expect(effectivePlan(row, now + 31 * DAY)).toBe('free');
    expect(resolvePlan(row, now + 31 * DAY)).toBe('free');
  });

  it('limits follow the plan, and unlimited plans really are unlimited', async () => {
    expect(limitsFor('free').aiUnitsPerPeriod).toBe(150);
    expect(limitsFor('free').aiUnitsPerDay).toBe(10);
    expect(limitsFor('basic').aiUnitsPerDay).toBe(20);
    expect(limitsFor('pro').aiUnitsPerPeriod).toBe(2500);
    expect(limitsFor('pro').aiUnitsPerDay).toBe(Infinity);
    expect(limitsFor('max').aiUnitsPerPeriod).toBe(Infinity);
    expect(limitsFor('max').maxSpaces).toBe(Infinity);
  });
});

describe('signatures', () => {
  const config: RazorpayConfig = { keyId: 'rzp_test_x', keySecret: 'secret', webhookSecret: 'hooksecret', test: true };

  it('accepts a correctly signed payment and rejects a tampered one', async () => {
    // HMAC-SHA256 of "order|payment" with the key secret — Razorpay's documented scheme.
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    const good = createHmac('sha256', 'secret').update('order_1|pay_1').digest('hex');
    expect(verifyPaymentSignature(config, 'order_1', 'pay_1', good)).toBe(true);
    expect(verifyPaymentSignature(config, 'order_1', 'pay_2', good)).toBe(false);
    expect(verifyPaymentSignature(config, 'order_1', 'pay_1', 'deadbeef')).toBe(false);
  });

  it('refuses every webhook when no webhook secret is configured', async () => {
    // Otherwise an unconfigured deployment would accept forged upgrade events.
    expect(verifyWebhookSignature({ ...config, webhookSecret: '' }, '{}', 'anything')).toBe(false);
  });
});

describe('subscriptions', () => {
  const payment = (overrides: Record<string, unknown> = {}) => ({
    id: 'pay_r1',
    amount: 29900,
    currency: 'INR',
    order_id: 'order_r1',
    subscription_id: 'sub_1',
    notes: {},
    ...overrides,
  });

  it('a renewal reads who it belongs to from the subscription, since the payment carries no notes', async () => {
    const now = 1_000_000;
    const grant = await applyWebhook(
      usageDb,
      {
        event: 'subscription.charged',
        payload: {
          payment: { entity: payment() },
          subscription: { entity: { id: 'sub_1', notes: { userId, planId: 'pro', period: 'monthly' } } },
        },
      },
      now,
    );
    expect(grant).toMatchObject({ plan: 'pro', granted: true, autoRenew: true });
    expect(usageDb.getEntitlement(userId)).toMatchObject({ subscription_id: 'sub_1', auto_renew: 1 });
  });

  it('the same renewal reported twice only ever extends the plan once', async () => {
    const now = 1_000_000;
    const event = {
      event: 'subscription.charged',
      payload: { payment: { entity: payment() }, subscription: { entity: { id: 'sub_1', notes: { userId, planId: 'pro', period: 'monthly' } } } },
    };
    const first = await applyWebhook(usageDb, event, now);
    // Razorpay also sends payment.captured for the same payment; both must not count.
    const second = await applyWebhook(usageDb, { event: 'payment.captured', payload: { payment: { entity: payment({ notes: { userId, planId: 'pro', period: 'monthly' } }) } } }, now + 1000);
    expect(second?.granted).toBe(false);
    expect(second?.expiresAt).toBe(first?.expiresAt);
  });

  it('cancelling stops renewal without shortening the plan', async () => {
    const now = 1_000_000;
    grantPlan(usageDb, { ...input({ paymentId: 'pay_sub' }), subscriptionId: 'sub_1' }, now);
    const before = usageDb.getEntitlement(userId);

    await applyWebhook(usageDb, { event: 'subscription.cancelled', payload: { subscription: { entity: { id: 'sub_1' } } } }, now + 5000);

    const after = usageDb.getEntitlement(userId);
    expect(after?.auto_renew).toBe(0);
    expect(after?.expires_at).toBe(before?.expires_at);
    expect(effectivePlan(after, now)).toBe('pro');
  });

  it('a halted subscription — repeated failed charges — also stops renewing', async () => {
    const now = 1_000_000;
    grantPlan(usageDb, { ...input({ paymentId: 'pay_sub2' }), subscriptionId: 'sub_2' }, now);
    await applyWebhook(usageDb, { event: 'subscription.halted', payload: { subscription: { entity: { id: 'sub_2' } } } }, now);
    expect(usageDb.getEntitlement(userId)?.auto_renew).toBe(0);
  });

  it('a one-off purchase on top of a subscription does not silently cancel it', async () => {
    const now = 1_000_000;
    grantPlan(usageDb, { ...input({ paymentId: 'pay_a' }), subscriptionId: 'sub_keep' }, now);
    grantPlan(usageDb, input({ paymentId: 'pay_b' }), now + 1000);
    expect(usageDb.getEntitlement(userId)).toMatchObject({ subscription_id: 'sub_keep', auto_renew: 1 });
  });

  it('signs subscriptions payment|subscription, the reverse of an order — getting this backwards fails only after money moves', async () => {
    const config: RazorpayConfig = { keyId: 'rzp_test_x', keySecret: 'secret', webhookSecret: 'h', test: true };
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    const good = createHmac('sha256', 'secret').update('pay_1|sub_1').digest('hex');
    expect(verifySubscriptionSignature(config, 'sub_1', 'pay_1', good)).toBe(true);
    // The order-style signature must not validate a subscription.
    const orderStyle = createHmac('sha256', 'secret').update('sub_1|pay_1').digest('hex');
    expect(verifySubscriptionSignature(config, 'sub_1', 'pay_1', orderStyle)).toBe(false);
  });
});
