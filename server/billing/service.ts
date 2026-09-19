import { randomUUID } from 'node:crypto';
import { PLANS, type BillingPeriod, type CurrencyCode, type PlanId } from '@/billing/plans';
import { ApiError } from '../http';
import type { CheckoutRow, UsageDb } from '../usage/db';
import { cancelSubscription, createOrder, createPlan, createSubscription, fetchSubscription, verifyPaymentSignature, verifySubscriptionSignature, type RazorpayConfig } from './razorpay';

/**
 * What a payment buys.
 *
 * Two routes to the same place. A **subscription** renews by itself until
 * cancelled, which is what people expect and what stops a plan lapsing because
 * someone forgot. A one-off **order** stays as the fallback: mandate
 * registration can be declined or unavailable, and a learner who just wants
 * one month should still be able to buy one.
 *
 * Both end at `grantPlan`, which is the single place an entitlement is ever
 * written. That is what makes the first charge, every renewal, and the webhook
 * that reports either of them idempotent with respect to each other.
 *
 * The server never accepts an amount from the client. It takes a plan and a
 * period and looks the money up in the shared price book, because the client
 * is the one place an attacker can edit.
 */

/** Only these can be bought. 'free' is the absence of a payment, not a purchase. */
const PURCHASABLE: PlanId[] = ['pro', 'unlimited', 'max'];

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS: Record<BillingPeriod, number> = { monthly: 30, annual: 365 };

export interface CheckoutRequest {
  planId: string;
  period: string;
  currency: string;
}

export interface CheckoutSession {
  orderId: string;
  amountMinor: number;
  currency: CurrencyCode;
  keyId: string;
  test: boolean;
  planId: PlanId;
  period: BillingPeriod;
  /** What the buyer should see confirmed on the checkout sheet. */
  description: string;
}

function parse(request: CheckoutRequest): { plan: (typeof PLANS)[number]; period: BillingPeriod; currency: CurrencyCode } {
  const plan = PLANS.find((p) => p.id === request.planId);
  if (!plan || !PURCHASABLE.includes(plan.id)) throw new ApiError(400, 'invalid_request', 'That plan cannot be purchased.');
  if (request.period !== 'monthly' && request.period !== 'annual') throw new ApiError(400, 'invalid_request', 'Billing period must be "monthly" or "annual".');
  if (request.currency !== 'INR' && request.currency !== 'USD') throw new ApiError(400, 'invalid_request', 'Currency must be "INR" or "USD".');
  return { plan, period: request.period, currency: request.currency };
}

/**
 * Rupees → paise, dollars → cents. Razorpay only deals in minor units, and
 * both currencies we support happen to use a 100:1 minor unit.
 */
function minorUnits(amount: number): number {
  return Math.round(amount * 100);
}

export async function startCheckout(config: RazorpayConfig, db: UsageDb, userId: string, request: CheckoutRequest, now = Date.now()): Promise<CheckoutSession> {
  const { plan, period, currency } = parse(request);
  const price = plan.price[period];
  const amountMinor = minorUnits(currency === 'INR' ? price.inr : price.usd);
  if (amountMinor <= 0) throw new ApiError(400, 'invalid_request', 'That plan has no price in this currency.');

  const order = await createOrder(config, {
    amountMinor,
    currency,
    // Razorpay caps receipts at 40 characters.
    receipt: `fs_${userId.slice(0, 8)}_${Date.now().toString(36)}`.slice(0, 40),
    // Notes come back on the webhook, which is how a payment that arrives
    // without the browser (the user closed the tab) still knows what it bought.
    notes: { userId, planId: plan.id, period },
  });
  // The purchase is fixed here, server-side. Confirmation grants this row and nothing else.
  db.putCheckout({ ref: order.id, kind: 'order', user_id: userId, plan: plan.id, period, currency, amount_minor: amountMinor, remote_plan_id: null, created_at: now });

  return {
    orderId: order.id,
    amountMinor,
    currency,
    keyId: config.keyId,
    test: config.test,
    planId: plan.id,
    period,
    description: `FocusSpace ${plan.name} · ${period === 'annual' ? '12 months' : '1 month'}`,
  };
}

/* ─── Subscriptions ──────────────────────────────────────────────────────── */

/** Razorpay needs a finite cycle count; ten years is "until cancelled" in practice. */
const TOTAL_CYCLES: Record<BillingPeriod, number> = { monthly: 120, annual: 10 };
const RAZORPAY_PERIOD: Record<BillingPeriod, 'monthly' | 'yearly'> = { monthly: 'monthly', annual: 'yearly' };

/**
 * The Razorpay Plan for a (plan, period, currency), created once and
 * remembered. The key includes the Razorpay key id because test-mode and
 * live-mode plans are different objects living in different worlds — caching
 * them under one key would hand a live subscription a test plan id.
 */
async function ensureRemotePlan(config: RazorpayConfig, db: UsageDb, plan: (typeof PLANS)[number], period: BillingPeriod, currency: CurrencyCode, now: number): Promise<string> {
  const key = `${config.keyId}:${plan.id}:${period}:${currency}`;
  const cached = db.getRemotePlan(key);
  if (cached) return cached;

  const price = plan.price[period];
  const created = await createPlan(config, {
    amountMinor: minorUnits(currency === 'INR' ? price.inr : price.usd),
    currency,
    period: RAZORPAY_PERIOD[period],
    name: `FocusSpace ${plan.name} (${period === 'annual' ? 'yearly' : 'monthly'})`,
    notes: { planId: plan.id, period },
  });
  db.putRemotePlan(key, created.id, now);
  return created.id;
}

export interface SubscriptionSession {
  subscriptionId: string;
  keyId: string;
  test: boolean;
  planId: PlanId;
  period: BillingPeriod;
  currency: CurrencyCode;
  amountMinor: number;
  description: string;
}

export async function startSubscription(
  config: RazorpayConfig,
  db: UsageDb,
  userId: string,
  request: CheckoutRequest,
  email?: string | null,
  now = Date.now(),
): Promise<SubscriptionSession> {
  const { plan, period, currency } = parse(request);
  const remotePlanId = await ensureRemotePlan(config, db, plan, period, currency, now);
  const subscription = await createSubscription(config, {
    planId: remotePlanId,
    totalCount: TOTAL_CYCLES[period],
    // The same notes an order carries, for the same reason: a renewal arrives
    // months later with no browser attached, and this is how it knows whose it is.
    notes: { userId, planId: plan.id, period },
    email,
  });

  const price = plan.price[period];
  db.putCheckout({
    ref: subscription.id,
    kind: 'subscription',
    user_id: userId,
    plan: plan.id,
    period,
    currency,
    amount_minor: minorUnits(currency === 'INR' ? price.inr : price.usd),
    remote_plan_id: remotePlanId,
    created_at: now,
  });
  return {
    subscriptionId: subscription.id,
    keyId: config.keyId,
    test: config.test,
    planId: plan.id,
    period,
    currency,
    amountMinor: minorUnits(currency === 'INR' ? price.inr : price.usd),
    description: `FocusSpace ${plan.name} · renews ${period === 'annual' ? 'yearly' : 'monthly'}`,
  };
}

export interface GrantInput {
  userId: string;
  planId: PlanId;
  period: BillingPeriod;
  currency: CurrencyCode;
  amountMinor: number;
  orderId: string;
  paymentId: string;
  /** Set when a subscription is paying for this, so renewals and cancellation can find it. */
  subscriptionId?: string | null;
}

export interface Grant {
  plan: PlanId;
  expiresAt: number;
  /** False when this payment had already been applied — the caller should still report success. */
  granted: boolean;
  /** True while a subscription will renew this by itself. */
  autoRenew: boolean;
}

/**
 * Applies a paid plan. Safe to call twice with the same payment: the payments
 * table is the idempotency key, so the webhook and the browser callback racing
 * each other cannot extend someone's plan twice.
 *
 * Buying again while still subscribed extends from the existing expiry rather
 * than from today — nobody should lose days for renewing early.
 */
export function grantPlan(db: UsageDb, input: GrantInput, now = Date.now()): Grant {
  const fresh = db.recordPayment({
    id: input.paymentId,
    user_id: input.userId,
    order_id: input.orderId,
    plan: input.planId,
    period: input.period,
    currency: input.currency,
    amount_minor: input.amountMinor,
    status: 'captured',
    created_at: now,
  });

  const current = db.getEntitlement(input.userId);
  const activeUntil = current && current.plan !== 'free' && current.expires_at && current.expires_at > now ? current.expires_at : now;

  if (!fresh) {
    // Already applied. Report the entitlement as it stands rather than adding to it.
    return { plan: (current?.plan as PlanId) ?? input.planId, expiresAt: current?.expires_at ?? activeUntil, granted: false, autoRenew: current?.auto_renew === 1 };
  }

  const expiresAt = activeUntil + PERIOD_DAYS[input.period] * DAY_MS;
  // A one-off purchase on top of a subscription must not silently cancel it, so an
  // absent subscriptionId keeps whatever was already there.
  const subscriptionId = input.subscriptionId ?? current?.subscription_id ?? null;
  const autoRenew = input.subscriptionId ? true : current?.auto_renew === 1;
  db.setPlan(input.userId, input.planId, now, expiresAt, input.paymentId, subscriptionId, autoRenew);
  return { plan: input.planId, expiresAt, granted: true, autoRenew };
}

const UNVERIFIED = 'That payment could not be verified. If money left your account, contact support and nothing will be lost.';

/**
 * The purchase a confirmation refers to, as the server recorded it when checkout started — and only if
 * it belongs to the account confirming it. A Razorpay signature proves the order and the payment belong
 * together; it says nothing about which plan was bought or by whom. So the plan, period, currency and
 * amount always come from this record, never from the request.
 *
 * If the browser does name a plan, period or currency, it must match: a mismatch means the request was
 * altered, and it is refused rather than quietly corrected.
 */
function recordedPurchase(db: UsageDb, userId: string, ref: string, kind: CheckoutRow['kind'], claimed: { planId?: string; period?: string; currency?: string }): CheckoutRow {
  const row = db.getCheckout(ref);
  if (!row || row.kind !== kind || row.user_id !== userId) throw new ApiError(400, 'unknown_purchase', UNVERIFIED);
  const altered = (claimed.planId && claimed.planId !== row.plan) || (claimed.period && claimed.period !== row.period) || (claimed.currency && claimed.currency !== row.currency);
  if (altered) throw new ApiError(400, 'purchase_mismatch', UNVERIFIED);
  return row;
}

/** Confirms a one-off payment the browser reported: a valid signature for an order this account started. */
export function confirmPayment(
  config: RazorpayConfig,
  db: UsageDb,
  userId: string,
  body: { orderId: string; paymentId: string; signature: string; planId?: string; period?: string; currency?: string },
  now = Date.now(),
): Grant {
  if (!verifyPaymentSignature(config, body.orderId, body.paymentId, body.signature)) throw new ApiError(400, 'invalid_signature', UNVERIFIED);
  const purchase = recordedPurchase(db, userId, body.orderId, 'order', body);
  return grantPlan(
    db,
    {
      userId,
      planId: purchase.plan as PlanId,
      period: purchase.period as BillingPeriod,
      currency: purchase.currency as CurrencyCode,
      amountMinor: purchase.amount_minor,
      orderId: body.orderId,
      paymentId: body.paymentId,
    },
    now,
  );
}

/**
 * Confirms the first charge of a subscription. Note the signature order — `payment|subscription`, the
 * reverse of an order. Beyond the signature and the recorded purchase, Razorpay is asked which Plan the
 * subscription actually charges, and it must be the one created for this entitlement.
 */
export async function confirmSubscription(
  config: RazorpayConfig,
  db: UsageDb,
  userId: string,
  body: { subscriptionId: string; paymentId: string; signature: string; planId?: string; period?: string; currency?: string },
  now = Date.now(),
): Promise<Grant> {
  if (!verifySubscriptionSignature(config, body.subscriptionId, body.paymentId, body.signature)) throw new ApiError(400, 'invalid_signature', UNVERIFIED);
  const purchase = recordedPurchase(db, userId, body.subscriptionId, 'subscription', body);
  const remote = await fetchSubscription(config, body.subscriptionId);
  if (!purchase.remote_plan_id || remote.plan_id !== purchase.remote_plan_id || (remote.notes?.userId && remote.notes.userId !== userId)) {
    throw new ApiError(400, 'purchase_mismatch', UNVERIFIED);
  }
  return grantPlan(
    db,
    {
      userId,
      planId: purchase.plan as PlanId,
      period: purchase.period as BillingPeriod,
      currency: purchase.currency as CurrencyCode,
      amountMinor: purchase.amount_minor,
      orderId: '',
      paymentId: body.paymentId,
      subscriptionId: body.subscriptionId,
    },
    now,
  );
}

/**
 * Stops a subscription renewing, at the end of the cycle already paid for.
 * Cancelling is not a refund: the entitlement keeps its expiry and only
 * `auto_renew` is cleared, so the learner keeps every day they bought.
 */
export async function cancelPlan(config: RazorpayConfig, db: UsageDb, userId: string, now = Date.now()): Promise<{ expiresAt: number | null }> {
  const current = db.getEntitlement(userId);
  if (!current?.subscription_id || current.auto_renew !== 1) {
    throw new ApiError(400, 'invalid_request', 'There is no renewing subscription on this account.');
  }
  await cancelSubscription(config, current.subscription_id);
  db.clearAutoRenew(userId, now);
  return { expiresAt: current.expires_at };
}

/**
 * Applies a `payment.captured` webhook. The notes carried on the order are the
 * only link back to who paid for what, which is why `startCheckout` sets them.
 */
export function applyWebhook(db: UsageDb, event: unknown, now = Date.now()): Grant | null {
  const payload = event as {
    event?: string;
    payload?: { payment?: { entity?: Record<string, unknown> }; subscription?: { entity?: Record<string, unknown> } };
  };
  const kind = payload?.event;

  // A subscription that ends — cancelled, or halted after repeated failed charges —
  // stops renewing but keeps the period already paid for. Only `auto_renew` changes.
  if (kind === 'subscription.cancelled' || kind === 'subscription.halted' || kind === 'subscription.completed') {
    const subscriptionId = String(payload.payload?.subscription?.entity?.id ?? '');
    const row = subscriptionId ? db.findBySubscription(subscriptionId) : undefined;
    if (row) db.clearAutoRenew(row.user_id, now);
    return null;
  }

  // Every charge, first or recurring, arrives as payment.captured. A renewal also
  // arrives as subscription.charged carrying the same payment, and the payment id
  // makes the two idempotent — whichever lands first grants, the other is a no-op.
  const payment = kind === 'payment.captured' ? payload.payload?.payment?.entity : kind === 'subscription.charged' ? payload.payload?.payment?.entity : null;
  if (!payment) return null;

  const notes = (payment.notes ?? {}) as Record<string, string>;
  const subscriptionEntity = payload.payload?.subscription?.entity;
  const subscriptionNotes = (subscriptionEntity?.notes ?? {}) as Record<string, string>;

  // A renewal's payment carries no notes of its own; the subscription's do.
  const userId = notes.userId ?? subscriptionNotes.userId;
  const planId = (notes.planId ?? subscriptionNotes.planId) as PlanId | undefined;
  const period = (notes.period ?? subscriptionNotes.period) as BillingPeriod | undefined;
  if (!userId || !planId || !period || !PURCHASABLE.includes(planId)) return null;

  const subscriptionId = String(payment.subscription_id ?? subscriptionEntity?.id ?? '') || null;

  return grantPlan(
    db,
    {
      userId,
      planId,
      period,
      currency: (payment.currency as CurrencyCode) ?? 'INR',
      amountMinor: Number(payment.amount) || 0,
      orderId: String(payment.order_id ?? ''),
      paymentId: String(payment.id ?? randomUUID()),
      subscriptionId,
    },
    now,
  );
}

/**
 * A paid plan that has run out is free again. Enforced on read rather than by
 * a scheduled job: there is no scheduler here, and a lapsed row that nobody
 * has looked at yet has no effect on anything until it is read.
 */
export function effectivePlan(entitlement: { plan: string; expires_at: number | null } | undefined, now = Date.now()): string {
  if (!entitlement || entitlement.plan === 'free') return 'free';
  if (entitlement.expires_at && entitlement.expires_at <= now) return 'free';
  return entitlement.plan;
}
