import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planById } from '@/billing/plans';
import { IdentityDb } from '../auth/db';
import { UsageDb } from '../usage/db';
import { resolvePlan } from '../usage/entitlements';
import { buildReceipt } from './receipt';
import { applyWebhook, confirmPayment, confirmSubscription, quote, startCheckout, startSubscription } from './service';
import type { RazorpayConfig } from './razorpay';

/** Basic for life, and moving up without paying twice for the same days. */

const config: RazorpayConfig = { keyId: 'rzp_test_x', keySecret: 'secret', webhookSecret: 'hook', test: true };
const sign = (a: string, b: string) => createHmac('sha256', 'secret').update(`${a}|${b}`).digest('hex');
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 1, 10);

let dir: string;
let identityDb: IdentityDb;
let usageDb: UsageDb;
let alice: string;
/** What Razorpay was asked to do, in order. */
let calls: { url: string; body: Record<string, unknown> | null }[];
let n: number;
let remotePlan: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focusspace-upgrade-test-'));
  identityDb = new IdentityDb(join(dir, 'test.db'));
  usageDb = new UsageDb(join(dir, 'test.db'));
  alice = randomUUID();
  identityDb.insertUser({ id: alice, email: 'a@example.com', phone: null, password_hash: 'x', email_verified: 1, status: 'active', name: null, city: null, google_sub: null, created_at: NOW, updated_at: NOW });
  calls = [];
  n = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ url: u, body });
      const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b, text: async () => '' });
      if (u.endsWith('/orders')) return json({ id: `order_${++n}`, amount: body?.amount, currency: body?.currency, status: 'created' });
      if (u.endsWith('/plans')) return json({ id: (remotePlan = `plan_${++n}`) });
      if (u.endsWith('/subscriptions') && init?.method === 'POST') return json({ id: `sub_${++n}`, status: 'created' });
      if (u.endsWith('/cancel')) return json({ status: 'cancelled' });
      if (u.includes('/subscriptions/')) return json({ id: u.split('/').pop(), status: 'active', plan_id: remotePlan, notes: {} });
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

const planOf = (at: number) => resolvePlan(usageDb.getEntitlement(alice), at);

async function buyOnce(planId: string, period: string, at: number, pay: string) {
  const session = await startCheckout(config, usageDb, alice, { planId, period, currency: 'INR' }, at);
  return { session, grant: await confirmPayment(config, usageDb, alice, { orderId: session.orderId, paymentId: pay, signature: sign(session.orderId, pay) }, at) };
}

async function subscribe(planId: string, period: string, at: number, pay: string) {
  const session = await startSubscription(config, usageDb, alice, { planId, period, currency: 'INR' }, null, at);
  return { session, grant: await confirmSubscription(config, usageDb, alice, { subscriptionId: session.subscriptionId, paymentId: pay, signature: sign(pay, session.subscriptionId) }, at) };
}

describe('Basic, for life', () => {
  it('is ₹99 once, never expires, and cannot be bought twice', async () => {
    const { session, grant } = await buyOnce('basic', 'lifetime', NOW, 'pay_basic');
    expect(session.amountMinor).toBe(9900);
    expect(grant).toMatchObject({ plan: 'basic', expiresAt: null, granted: true });
    expect(planOf(NOW + 3650 * DAY)).toBe('basic');
    await expect(startCheckout(config, usageDb, alice, { planId: 'basic', period: 'lifetime', currency: 'INR' }, NOW)).rejects.toThrow(/already have Basic for life/);
  });

  it('stays underneath a paid plan, and is what the account falls back to', async () => {
    await buyOnce('basic', 'lifetime', NOW, 'pay_basic');
    await buyOnce('pro', 'monthly', NOW + DAY, 'pay_pro');
    expect(planOf(NOW + 2 * DAY)).toBe('pro');
    expect(planOf(NOW + 40 * DAY)).toBe('basic');
  });

  it('takes ₹100 off the first paid month, once', async () => {
    await buyOnce('basic', 'lifetime', NOW, 'pay_basic');
    const plus = quote(usageDb, alice, planById('plus'), 'monthly', 'INR', NOW);
    expect(plus).toMatchObject({ fullMinor: 14900, creditMinor: 10000, chargeMinor: 4900, creditNote: 'Basic owner offer', startsNow: false });
    const { session } = await buyOnce('plus', 'monthly', NOW, 'pay_plus');
    expect(session.amountMinor).toBe(4900);
    // Plus has run out; the offer was for the first paid month only.
    expect(quote(usageDb, alice, planById('pro'), 'monthly', 'INR', NOW + 40 * DAY).creditMinor).toBe(0);
  });
});

describe('moving up pays only the difference', () => {
  it('credits the unused days of the current plan, and the new plan starts today', async () => {
    await buyOnce('pro', 'monthly', NOW, 'pay_pro');
    const at = NOW + 10 * DAY; // 20 of 30 days left
    const q = quote(usageDb, alice, planById('max'), 'monthly', 'INR', at);
    expect(q.creditMinor).toBe(Math.floor((29900 * 20) / 30));
    expect(q.chargeMinor).toBe(59900 - q.creditMinor);
    expect(q.creditNote).toBe('Unused Pro time');

    const { session, grant } = await buyOnce('max', 'monthly', at, 'pay_max');
    expect(session.amountMinor).toBe(q.chargeMinor);
    expect(grant.plan).toBe('max');
    expect(grant.expiresAt).toBe(at + 30 * DAY); // not the old expiry plus a month: those days were credited

    const receipt = buildReceipt(usageDb, { id: alice, email: 'a@example.com' }, 'pay_max').html;
    expect(receipt).toContain('Unused Pro time');
    expect(receipt).toContain('₹599');
  });

  it('refuses to move down mid-period, and says when it can', async () => {
    await buyOnce('max', 'monthly', NOW, 'pay_max');
    await expect(startCheckout(config, usageDb, alice, { planId: 'pro', period: 'monthly', currency: 'INR' }, NOW + DAY)).rejects.toThrow(/You’re on Max until .* move to Pro when it ends/);
  });

  it('renewing the same plan early adds a period after the current one, at full price', async () => {
    const { grant: first } = await buyOnce('pro', 'monthly', NOW, 'pay_1');
    const { session, grant } = await buyOnce('pro', 'monthly', NOW + 5 * DAY, 'pay_2');
    expect(session.amountMinor).toBe(29900);
    expect(grant.expiresAt).toBe(first.expiresAt! + 30 * DAY);
  });

  it('a renewing upgrade charges the difference now, renews at full price a period later, and stops the old subscription', async () => {
    const { session: old } = await subscribe('plus', 'monthly', NOW, 'pay_plus');
    const at = NOW + 15 * DAY;
    const { session, grant } = await subscribe('pro', 'monthly', at, 'pay_pro');

    const created = calls.filter((c) => c.url.endsWith('/subscriptions') && c.body).pop()!.body!;
    expect(created.start_at).toBe(Math.floor((at + 30 * DAY) / 1000));
    expect(created.addons).toEqual([{ item: { name: expect.stringContaining('Unused Plus time'), amount: session.amountMinor, currency: 'INR' } }]);
    expect(session.amountMinor).toBe(29900 - Math.floor((14900 * 15) / 30));
    expect(grant).toMatchObject({ plan: 'pro', expiresAt: at + 30 * DAY, autoRenew: true });
    expect(calls.some((c) => c.url.endsWith(`/subscriptions/${old.subscriptionId}/cancel`))).toBe(true);

    // A late charge from the stopped Plus subscription never takes the account back down.
    await applyWebhook(usageDb, {
      event: 'subscription.charged',
      payload: {
        payment: { entity: { id: 'pay_late', amount: 14900, currency: 'INR', order_id: '', subscription_id: old.subscriptionId, notes: {} } },
        subscription: { entity: { id: old.subscriptionId, notes: { userId: alice, planId: 'plus', period: 'monthly' } } },
      },
    }, at + DAY);
    expect(planOf(at + 2 * DAY)).toBe('pro');
  });

  it('a renewal of the upgraded subscription is a plain full-price period', async () => {
    const { session: upgrade } = await (async () => {
      await buyOnce('plus', 'monthly', NOW, 'pay_plus');
      return subscribe('pro', 'monthly', NOW + 10 * DAY, 'pay_pro');
    })();
    const renewal = await applyWebhook(usageDb, {
      event: 'subscription.charged',
      payload: {
        payment: { entity: { id: 'pay_pro_2', amount: 29900, currency: 'INR', order_id: '', subscription_id: upgrade.subscriptionId, notes: {} } },
        subscription: { entity: { id: upgrade.subscriptionId, notes: { userId: alice, planId: 'pro', period: 'monthly' } } },
      },
    }, NOW + 40 * DAY);
    expect(renewal).toMatchObject({ plan: 'pro', granted: true, expiresAt: NOW + 10 * DAY + 60 * DAY });
    expect(usageDb.getPayment('pay_pro_2')).toMatchObject({ amount_minor: 29900, credit_minor: 0 });
  });
});
