import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IdentityDb } from '../auth/db';
import { UsageDb } from '../usage/db';
import { resolvePlan } from '../usage/entitlements';
import { applyWebhook, confirmPayment, confirmSubscription, grantPlan, startCheckout, startSubscription } from './service';
import type { RazorpayConfig } from './razorpay';

/**
 * A Razorpay signature proves an order (or subscription) and a payment belong together — not which plan
 * was bought, nor by whom. These are the attacks that gap allowed; every one must fail.
 */

const config: RazorpayConfig = { keyId: 'rzp_test_x', keySecret: 'secret', webhookSecret: 'hook', test: true };
const sign = (a: string, b: string) => createHmac('sha256', 'secret').update(`${a}|${b}`).digest('hex');

let dir: string;
let identityDb: IdentityDb;
let usageDb: UsageDb;
let alice: string;
let bob: string;
let remoteSubscriptionPlan: string | undefined;

const newUser = () => {
  const id = randomUUID();
  identityDb.insertUser({ id, email: `${id}@example.com`, phone: null, password_hash: 'x', email_verified: 1, status: 'active', name: null, city: null, google_sub: null, created_at: Date.now(), updated_at: Date.now() });
  return id;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focusspace-confirm-test-'));
  identityDb = new IdentityDb(join(dir, 'test.db'));
  usageDb = new UsageDb(join(dir, 'test.db'));
  alice = newUser();
  bob = newUser();
  remoteSubscriptionPlan = undefined;
  let n = 0;
  // Razorpay, as far as these flows touch it.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
      if (u.endsWith('/orders')) return json({ id: `order_${++n}`, amount: JSON.parse(String(init?.body)).amount, currency: 'INR', status: 'created' });
      if (u.endsWith('/plans')) return json({ id: `plan_${++n}` });
      if (u.endsWith('/subscriptions') && init?.method === 'POST') return json({ id: `sub_${++n}`, status: 'created' });
      if (u.includes('/subscriptions/')) return json({ id: u.split('/').pop(), status: 'active', plan_id: remoteSubscriptionPlan, notes: {} });
      throw new Error(`unexpected ${u}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  identityDb.close();
  usageDb.close();
  rmSync(dir, { recursive: true, force: true });
});

const planOf = (userId: string) => resolvePlan(usageDb.getEntitlement(userId));

describe('one-off payments', () => {
  it('grants exactly what was bought', async () => {
    const { orderId } = await startCheckout(config, usageDb, alice, { planId: 'pro', period: 'monthly', currency: 'INR' });
    const grant = confirmPayment(config, usageDb, alice, { orderId, paymentId: 'pay_1', signature: sign(orderId, 'pay_1') });
    expect(grant.plan).toBe('pro');
    expect(planOf(alice)).toBe('pro');
  });

  it('pay for Pro, claim Max: refused, and nothing is granted', async () => {
    const { orderId } = await startCheckout(config, usageDb, alice, { planId: 'pro', period: 'monthly', currency: 'INR' });
    expect(() => confirmPayment(config, usageDb, alice, { orderId, paymentId: 'pay_1', signature: sign(orderId, 'pay_1'), planId: 'max' })).toThrow(/could not be verified/);
    expect(planOf(alice)).toBe('free');
  });

  it('pay monthly, claim annual (or another currency): refused', async () => {
    const { orderId } = await startCheckout(config, usageDb, alice, { planId: 'pro', period: 'monthly', currency: 'INR' });
    const base = { orderId, paymentId: 'pay_1', signature: sign(orderId, 'pay_1') };
    expect(() => confirmPayment(config, usageDb, alice, { ...base, period: 'annual' })).toThrow();
    expect(() => confirmPayment(config, usageDb, alice, { ...base, currency: 'USD' })).toThrow();
    expect(planOf(alice)).toBe('free');
  });

  it('the grant comes from the recorded purchase even when the browser names nothing', async () => {
    const { orderId } = await startCheckout(config, usageDb, alice, { planId: 'unlimited', period: 'annual', currency: 'INR' });
    const grant = confirmPayment(config, usageDb, alice, { orderId, paymentId: 'pay_1', signature: sign(orderId, 'pay_1') });
    expect(grant.plan).toBe('unlimited');
  });

  it("someone else's paid order cannot be confirmed onto your account", async () => {
    const { orderId } = await startCheckout(config, usageDb, alice, { planId: 'unlimited', period: 'monthly', currency: 'INR' });
    expect(() => confirmPayment(config, usageDb, bob, { orderId, paymentId: 'pay_1', signature: sign(orderId, 'pay_1') })).toThrow(/could not be verified/);
    expect(planOf(bob)).toBe('free');
  });

  it('an order the server never started is refused, even correctly signed', () => {
    expect(() => confirmPayment(config, usageDb, alice, { orderId: 'order_forged', paymentId: 'pay_1', signature: sign('order_forged', 'pay_1') })).toThrow();
    expect(planOf(alice)).toBe('free');
  });

  it('a bad signature is still refused first', async () => {
    const { orderId } = await startCheckout(config, usageDb, alice, { planId: 'pro', period: 'monthly', currency: 'INR' });
    expect(() => confirmPayment(config, usageDb, alice, { orderId, paymentId: 'pay_1', signature: 'deadbeef' })).toThrow(/could not be verified/);
  });
});

describe('subscriptions', () => {
  it('grants the recorded plan when Razorpay confirms the subscription charges that plan', async () => {
    const { subscriptionId } = await startSubscription(config, usageDb, alice, { planId: 'pro', period: 'monthly', currency: 'INR' });
    remoteSubscriptionPlan = usageDb.getCheckout(subscriptionId)?.remote_plan_id ?? undefined;
    const grant = await confirmSubscription(config, usageDb, alice, { subscriptionId, paymentId: 'pay_s1', signature: sign('pay_s1', subscriptionId) });
    expect(grant.plan).toBe('pro');
    expect(grant.autoRenew).toBe(true);
  });

  it('subscribe to Pro, claim Max: refused', async () => {
    const { subscriptionId } = await startSubscription(config, usageDb, alice, { planId: 'pro', period: 'monthly', currency: 'INR' });
    remoteSubscriptionPlan = usageDb.getCheckout(subscriptionId)?.remote_plan_id ?? undefined;
    await expect(confirmSubscription(config, usageDb, alice, { subscriptionId, paymentId: 'pay_s1', signature: sign('pay_s1', subscriptionId), planId: 'max' })).rejects.toThrow();
    expect(planOf(alice)).toBe('free');
  });

  it('refused when Razorpay says the subscription charges a different plan than the one recorded', async () => {
    const { subscriptionId } = await startSubscription(config, usageDb, alice, { planId: 'unlimited', period: 'monthly', currency: 'INR' });
    remoteSubscriptionPlan = 'plan_for_something_cheaper';
    await expect(confirmSubscription(config, usageDb, alice, { subscriptionId, paymentId: 'pay_s1', signature: sign('pay_s1', subscriptionId) })).rejects.toThrow(/could not be verified/);
    expect(planOf(alice)).toBe('free');
  });

  it("someone else's subscription cannot be confirmed onto your account", async () => {
    const { subscriptionId } = await startSubscription(config, usageDb, alice, { planId: 'unlimited', period: 'monthly', currency: 'INR' });
    remoteSubscriptionPlan = usageDb.getCheckout(subscriptionId)?.remote_plan_id ?? undefined;
    await expect(confirmSubscription(config, usageDb, bob, { subscriptionId, paymentId: 'pay_s1', signature: sign('pay_s1', subscriptionId) })).rejects.toThrow();
    expect(planOf(bob)).toBe('free');
  });
});

describe('Max coming soon', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('rejects new Max checkout and subscription while Pro and Unlimited remain buyable', async () => {
    await expect(startCheckout(config, usageDb, alice, { planId: 'max', period: 'monthly', currency: 'INR' })).rejects.toThrow(/That plan cannot be purchased/);
    await expect(startSubscription(config, usageDb, alice, { planId: 'max', period: 'monthly', currency: 'INR' })).rejects.toThrow(/That plan cannot be purchased/);
    await expect(startCheckout(config, usageDb, alice, { planId: 'pro', period: 'monthly', currency: 'INR' })).resolves.toMatchObject({ planId: 'pro' });
    await expect(startCheckout(config, usageDb, alice, { planId: 'unlimited', period: 'monthly', currency: 'INR' })).resolves.toMatchObject({ planId: 'unlimited' });
    await expect(startSubscription(config, usageDb, alice, { planId: 'pro', period: 'monthly', currency: 'INR' })).resolves.toMatchObject({ planId: 'pro' });
    await expect(startSubscription(config, usageDb, alice, { planId: 'unlimited', period: 'monthly', currency: 'INR' })).resolves.toMatchObject({ planId: 'unlimited' });
  });

  it('still extends an existing Max subscription when Razorpay reports a renewal', () => {
    const now = Date.now();
    const first = grantPlan(
      usageDb,
      {
        userId: alice,
        planId: 'max',
        period: 'monthly',
        currency: 'INR',
        amountMinor: 149900,
        orderId: 'order_max_0',
        paymentId: 'pay_max_0',
        subscriptionId: 'sub_max',
      },
      now,
    );
    expect(planOf(alice)).toBe('max');

    const renewal = applyWebhook(
      usageDb,
      {
        event: 'subscription.charged',
        payload: {
          payment: {
            entity: {
              id: 'pay_max_1',
              amount: 149900,
              currency: 'INR',
              order_id: 'order_max_1',
              subscription_id: 'sub_max',
              notes: {},
            },
          },
          subscription: { entity: { id: 'sub_max', notes: { userId: alice, planId: 'max', period: 'monthly' } } },
        },
      },
      now + DAY,
    );

    expect(renewal).toMatchObject({ plan: 'max', granted: true, autoRenew: true });
    expect(renewal?.expiresAt).toBe(first.expiresAt + 30 * DAY);
    expect(planOf(alice)).toBe('max');
  });

  it('ignores a Max webhook that is not already tied to a Max subscription', () => {
    const grant = applyWebhook(usageDb, {
      event: 'subscription.charged',
      payload: {
        payment: { entity: { id: 'pay_stranger', amount: 149900, currency: 'INR', order_id: 'order_x', subscription_id: 'sub_unknown', notes: {} } },
        subscription: { entity: { id: 'sub_unknown', notes: { userId: alice, planId: 'max', period: 'monthly' } } },
      },
    });
    expect(grant).toBeNull();
    expect(planOf(alice)).toBe('free');
  });
});
