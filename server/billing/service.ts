import { randomUUID } from 'node:crypto';
import { PLANS, type BillingPeriod, type CurrencyCode, type PlanId } from '@/billing/plans';
import { ApiError } from '../http';
import type { UsageDb } from '../usage/db';
import { createOrder, verifyPaymentSignature, type RazorpayConfig } from './razorpay';

/**
 * What a payment buys.
 *
 * Razorpay *Orders*, not Subscriptions, for this first version: an order is a
 * single charge that grants access for the period bought, and it works the day
 * the account is approved. Auto-renewing subscriptions in India need e-mandate
 * or UPI Autopay registration, which is a larger piece of work and a worse
 * thing to debug on launch day. The cost of that choice is honest and visible:
 * access expires and has to be bought again, and the UI says so rather than
 * implying a renewal that will not happen.
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

export async function startCheckout(config: RazorpayConfig, userId: string, request: CheckoutRequest): Promise<CheckoutSession> {
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

export interface GrantInput {
  userId: string;
  planId: PlanId;
  period: BillingPeriod;
  currency: CurrencyCode;
  amountMinor: number;
  orderId: string;
  paymentId: string;
}

export interface Grant {
  plan: PlanId;
  expiresAt: number;
  /** False when this payment had already been applied — the caller should still report success. */
  granted: boolean;
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
    return { plan: (current?.plan as PlanId) ?? input.planId, expiresAt: current?.expires_at ?? activeUntil, granted: false };
  }

  const expiresAt = activeUntil + PERIOD_DAYS[input.period] * DAY_MS;
  db.setPlan(input.userId, input.planId, now, expiresAt, input.paymentId);
  return { plan: input.planId, expiresAt, granted: true };
}

/**
 * Confirms a payment the browser reported. The signature is what makes this
 * trustworthy — without it, anyone could POST a plan id and be upgraded.
 */
export function confirmPayment(
  config: RazorpayConfig,
  db: UsageDb,
  userId: string,
  body: { orderId: string; paymentId: string; signature: string; planId: string; period: string; currency: string },
  now = Date.now(),
): Grant {
  if (!verifyPaymentSignature(config, body.orderId, body.paymentId, body.signature)) {
    throw new ApiError(400, 'invalid_signature', 'That payment could not be verified. If money left your account, contact support and nothing will be lost.');
  }
  const { plan, period, currency } = parse(body);
  const price = plan.price[period];
  return grantPlan(
    db,
    {
      userId,
      planId: plan.id,
      period,
      currency,
      amountMinor: minorUnits(currency === 'INR' ? price.inr : price.usd),
      orderId: body.orderId,
      paymentId: body.paymentId,
    },
    now,
  );
}

/**
 * Applies a `payment.captured` webhook. The notes carried on the order are the
 * only link back to who paid for what, which is why `startCheckout` sets them.
 */
export function applyWebhook(db: UsageDb, event: unknown, now = Date.now()): Grant | null {
  const payload = event as { event?: string; payload?: { payment?: { entity?: Record<string, unknown> } } };
  if (payload?.event !== 'payment.captured') return null;

  const payment = payload.payload?.payment?.entity;
  if (!payment) return null;

  const notes = (payment.notes ?? {}) as Record<string, string>;
  const userId = notes.userId;
  const planId = notes.planId as PlanId | undefined;
  const period = notes.period as BillingPeriod | undefined;
  if (!userId || !planId || !period || !PURCHASABLE.includes(planId)) return null;

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
