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

describe('one-off payments', async () => {
  it('grants exactly what was bought', async () => {
    const { orderId } = await startCheckout(config, usageDb, alice, { planId: 'pro', period: 'monthly', currency: 'INR' });
    const grant = await confirmPayment(config, usageDb, alice, { orderId, paymentId: 'pay_1', signature: sign(orderId, 'pay_1') });
    expect(grant.plan).toBe('pro');
    expect(planOf(alice)).toBe('pro');
  });

  it('pay for Pro, claim Max: refused, and nothing is granted', async () => {
    const { orderId } = await startCheckout(config, usageDb, alice, { planId: 'pro', period: 'monthly', currency: 'INR' });
    await expect(confirmPayment(config, usageDb, alice, { orderId, paymentId: 'pay_1', signature: sign(orderId, 'pay_1'), planId: 'max' })).rejects.toThrow(/could not be verified/);
    expect(planOf(alice)).toBe('free');
  });

  it('pay monthly, claim annual (or another currency): refused', async () => {
    const { orderId } = await startCheckout(config, usageDb, alice, { planId: 'pro', period: 'monthly', currency: 'INR' });
    const base = { orderId, paymentId: 'pay_1', signature: sign(orderId, 'pay_1') };
    await expect(confirmPayment(config, usageDb, alice, { ...base, period: 'annual' })).rejects.toThrow();
    await expect(confirmPayment(config, usageDb, alice, { ...base, currency: 'USD' })).rejects.toThrow();
    expect(planOf(alice)).toBe('free');
  });

  it('the grant comes from the recorded purchase even when the browser names nothing', async () => {
    const { orderId } = await startCheckout(config, usageDb, alice, { planId: 'max', period: 'annual', currency: 'INR' });
    const grant = await confirmPayment(config, usageDb, alice, { orderId, paymentId: 'pay_1', signature: sign(orderId, 'pay_1') });
    expect(grant.plan).toBe('max');
  });

  it("someone else's paid order cannot be confirmed onto your account", async () => {
    const { orderId } = await startCheckout(config, usageDb, alice, { planId: 'max', period: 'monthly', currency: 'INR' });
    await expect(confirmPayment(config, usageDb, bob, { orderId, paymentId: 'pay_1', signature: sign(orderId, 'pay_1') })).rejects.toThrow(/could not be verified/);
    expect(planOf(bob)).toBe('free');
  });

  it('an order the server never started is refused, even correctly signed', async () => {
    await expect(confirmPayment(config, usageDb, alice, { orderId: 'order_forged', paymentId: 'pay_1', signature: sign('order_forged', 'pay_1') })).rejects.toThrow();
    expect(planOf(alice)).toBe('free');
  });

  it('a bad signature is still refused first', async () => {
    const { orderId } = await startCheckout(config, usageDb, alice, { planId: 'pro', period: 'monthly', currency: 'INR' });
    await expect(confirmPayment(config, usageDb, alice, { orderId, paymentId: 'pay_1', signature: 'deadbeef' })).rejects.toThrow(/could not be verified/);
  });
});

describe('subscriptions', async () => {
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
    const { subscriptionId } = await startSubscription(config, usageDb, alice, { planId: 'max', period: 'monthly', currency: 'INR' });
    remoteSubscriptionPlan = 'plan_for_something_cheaper';
    await expect(confirmSubscription(config, usageDb, alice, { subscriptionId, paymentId: 'pay_s1', signature: sign('pay_s1', subscriptionId) })).rejects.toThrow(/could not be verified/);
    expect(planOf(alice)).toBe('free');
  });

  it("someone else's subscription cannot be confirmed onto your account", async () => {
    const { subscriptionId } = await startSubscription(config, usageDb, alice, { planId: 'max', period: 'monthly', currency: 'INR' });
    remoteSubscriptionPlan = usageDb.getCheckout(subscriptionId)?.remote_plan_id ?? undefined;
    await expect(confirmSubscription(config, usageDb, bob, { subscriptionId, paymentId: 'pay_s1', signature: sign('pay_s1', subscriptionId) })).rejects.toThrow();
    expect(planOf(bob)).toBe('free');
  });
});

describe('retired Unlimited', async () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('cannot be bought any more; Basic, Plus, Pro and Max can', async () => {
    await expect(startCheckout(config, usageDb, alice, { planId: 'unlimited', period: 'monthly', currency: 'INR' })).rejects.toThrow(/That plan cannot be purchased/);
    await expect(startSubscription(config, usageDb, alice, { planId: 'unlimited', period: 'monthly', currency: 'INR' })).rejects.toThrow(/That plan cannot be purchased/);
    for (const planId of ['plus', 'pro', 'max']) await expect(startSubscription(config, usageDb, alice, { planId, period: 'monthly', currency: 'INR' })).resolves.toMatchObject({ planId });
    await expect(startCheckout(config, usageDb, alice, { planId: 'basic', period: 'lifetime', currency: 'INR' })).resolves.toMatchObject({ planId: 'basic', amountMinor: 9900 });
    await expect(startSubscription(config, usageDb, alice, { planId: 'basic', period: 'lifetime', currency: 'INR' })).rejects.toThrow(/does not renew/);
    await expect(startCheckout(config, usageDb, alice, { planId: 'basic', period: 'monthly', currency: 'INR' })).rejects.toThrow(/single payment/);
  });

  it('an Unlimited subscription still renews, as Max', async () => {
    const now = Date.now();
    const first = grantPlan(usageDb, { userId: alice, planId: 'unlimited' as never, period: 'monthly', currency: 'INR', amountMinor: 59900, orderId: 'order_u_0', paymentId: 'pay_u_0', subscriptionId: 'sub_unl' }, now);
    expect(planOf(alice)).toBe('max');

    const renewal = await applyWebhook(
      usageDb,
      {
        event: 'subscription.charged',
        payload: {
          payment: { entity: { id: 'pay_u_1', amount: 59900, currency: 'INR', order_id: '', subscription_id: 'sub_unl', notes: {} } },
          subscription: { entity: { id: 'sub_unl', notes: { userId: alice, planId: 'unlimited', period: 'monthly' } } },
        },
      },
      now + DAY,
    );

    expect(renewal).toMatchObject({ plan: 'max', granted: true, autoRenew: true });
    expect(renewal?.expiresAt).toBe(first.expiresAt! + 30 * DAY);
  });

  it('ignores a charge for a plan it cannot tie to anything', async () => {
    const grant = await applyWebhook(usageDb, {
      event: 'subscription.charged',
      payload: {
        payment: { entity: { id: 'pay_stranger', amount: 149900, currency: 'INR', order_id: 'order_x', subscription_id: 'sub_unknown', notes: {} } },
        subscription: { entity: { id: 'sub_unknown', notes: { userId: alice, planId: 'enterprise', period: 'monthly' } } },
      },
    });
    expect(grant).toBeNull();
    expect(planOf(alice)).toBe('free');
  });
});
