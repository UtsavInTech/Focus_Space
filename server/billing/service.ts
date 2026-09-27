import { randomUUID } from 'node:crypto';
import { BASIC_UPGRADE_CREDIT, PLAN_RANK, PLANS, RETIRED_PLANS, currentPlanId, priceOf, type BillingPeriod, type CurrencyCode, type Plan, type PlanId, type RecurringPeriod } from '@/billing/plans';
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
const PURCHASABLE: PlanId[] = ['basic', 'plus', 'pro', 'max'];

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS: Record<RecurringPeriod, number> = { monthly: 30, annual: 365 };
/** Razorpay's smallest charge. An upgrade never costs less, whatever the credit. */
const MIN_CHARGE_MINOR: Record<CurrencyCode, number> = { INR: 100, USD: 50 };

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

function parse(request: CheckoutRequest): { plan: Plan; period: BillingPeriod; currency: CurrencyCode } {
  const plan = PLANS.find((p) => p.id === request.planId);
  if (!plan || !PURCHASABLE.includes(plan.id)) throw new ApiError(400, 'invalid_request', 'That plan cannot be purchased.');
  if (request.period !== 'monthly' && request.period !== 'annual' && request.period !== 'lifetime') throw new ApiError(400, 'invalid_request', 'Billing period must be "monthly", "annual" or "lifetime".');
  if (request.currency !== 'INR' && request.currency !== 'USD') throw new ApiError(400, 'invalid_request', 'Currency must be "INR" or "USD".');
  if (!priceOf(plan, request.period)) throw new ApiError(400, 'invalid_request', plan.oneTime ? `${plan.name} is a single payment for life.` : `${plan.name} renews monthly or yearly.`);
  return { plan, period: request.period, currency: request.currency };
}

/**
 * Rupees → paise, dollars → cents. Razorpay only deals in minor units, and
 * both currencies we support happen to use a 100:1 minor unit.
 */
function minorUnits(amount: number): number {
  return Math.round(amount * 100);
}

const fullPrice = (plan: Plan, period: BillingPeriod, currency: CurrencyCode) => {
  const price = priceOf(plan, period)!;
  return minorUnits(currency === 'INR' ? price.inr : price.usd);
};

const dateLabel = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

/* ─── What a purchase costs this account ─────────────────────────────────── */

export interface Quote {
  planId: PlanId;
  period: BillingPeriod;
  currency: CurrencyCode;
  /** The plan's price. */
  fullMinor: number;
  /** Taken off it. */
  creditMinor: number;
  /** What is charged now. */
  chargeMinor: number;
  creditNote: string | null;
  /** The plan starts over today: the old plan's unused days were turned into the credit. */
  startsNow: boolean;
  /** The renewing subscription this purchase replaces, stopped once it is paid for. */
  replacesSubscription: string | null;
}

/**
 * The price of a plan for this account, as it stands today. Nobody pays twice for the same days:
 *
 * - Moving up (Plus → Pro, Pro monthly → Pro yearly, …) credits what is left of the current period,
 *   pro rata to what was paid for it, and the new plan starts from today.
 * - A Basic owner's first renewing plan is `BASIC_UPGRADE_CREDIT` cheaper.
 * - Moving down waits for the current period to end: its days are already paid for.
 *
 * The server decides this and the browser only shows it; checkout charges exactly `chargeMinor`.
 */
export function quote(db: UsageDb, userId: string, plan: Plan, period: BillingPeriod, currency: CurrencyCode, now = Date.now()): Quote {
  const fullMinor = fullPrice(plan, period, currency);
  const base: Quote = { planId: plan.id, period, currency, fullMinor, creditMinor: 0, chargeMinor: fullMinor, creditNote: null, startsNow: false, replacesSubscription: null };
  const current = db.getEntitlement(userId);

  if (period === 'lifetime') {
    if (currentPlanId(current?.lifetime_plan) === plan.id) throw new ApiError(409, 'conflict', `You already have ${plan.name} for life.`);
    return base;
  }

  const activeRaw = current && current.plan !== 'free' && current.expires_at && current.expires_at > now ? current.plan : null;
  const active = activeRaw ? currentPlanId(activeRaw) : null;
  if (active && current?.expires_at) {
    const activeName = PLANS.find((p) => p.id === active)?.name ?? active;
    if (PLAN_RANK[plan.id] < PLAN_RANK[active]) {
      throw new ApiError(400, 'invalid_request', `You’re on ${activeName} until ${dateLabel(current.expires_at)}. You can move to ${plan.name} when it ends: turn off renewal from your account, then choose ${plan.name}.`);
    }
    const last = db.lastPaymentFor(userId, activeRaw!);
    const samePlanAndPeriod = active === plan.id && last?.period === period;
    if (samePlanAndPeriod) return base; // Renewing early: the new period is added after the current one.
    if (!last || last.period === 'lifetime' || last.currency !== currency) return { ...base, startsNow: true, replacesSubscription: current.auto_renew === 1 ? current.subscription_id : null };

    const periodMs = PERIOD_DAYS[last.period as RecurringPeriod] * DAY_MS;
    const left = Math.min(Math.max(current.expires_at - now, 0), periodMs);
    const paidFor = last.amount_minor + (last.credit_minor ?? 0);
    const creditMinor = Math.floor((paidFor * left) / periodMs);
    const chargeMinor = fullMinor - creditMinor;
    if (chargeMinor < MIN_CHARGE_MINOR[currency]) {
      throw new ApiError(400, 'invalid_request', `The ${activeName} time you have left is worth more than ${plan.name} ${period === 'annual' ? 'for a year' : 'for a month'}. Choose yearly, or switch when ${activeName} ends on ${dateLabel(current.expires_at)}.`);
    }
    return { ...base, creditMinor, chargeMinor, creditNote: `Unused ${activeName} time`, startsNow: true, replacesSubscription: current.auto_renew === 1 ? current.subscription_id : null };
  }

  if (currentPlanId(current?.lifetime_plan) === 'basic' && !db.hasRecurringPayment(userId)) {
    const creditMinor = minorUnits(currency === 'INR' ? BASIC_UPGRADE_CREDIT.inr : BASIC_UPGRADE_CREDIT.usd);
    return { ...base, creditMinor, chargeMinor: Math.max(fullMinor - creditMinor, MIN_CHARGE_MINOR[currency]), creditNote: 'Basic owner offer' };
  }
  return base;
}

/** The price a signed-in account would pay for each plan it can buy now, for the pricing page. */
export function quotes(db: UsageDb, userId: string, currency: CurrencyCode, now = Date.now()): (Quote | { planId: PlanId; period: BillingPeriod; error: string })[] {
  const out: (Quote | { planId: PlanId; period: BillingPeriod; error: string })[] = [];
  for (const plan of PLANS.filter((p) => PURCHASABLE.includes(p.id))) {
    for (const period of ['monthly', 'annual', 'lifetime'] as BillingPeriod[]) {
      if (!priceOf(plan, period)) continue;
      try {
        out.push(quote(db, userId, plan, period, currency, now));
      } catch (err) {
        out.push({ planId: plan.id, period, error: err instanceof Error ? err.message : 'Not available.' });
      }
    }
  }
  return out;
}

const describe = (plan: Plan, period: BillingPeriod, q: Quote, renewing: boolean) => {
  const what = period === 'lifetime' ? 'for life' : renewing ? `renews ${period === 'annual' ? 'yearly' : 'monthly'}` : period === 'annual' ? '12 months' : '1 month';
  return `FocusSpace ${plan.name} · ${what}${q.creditMinor ? ` · ${q.creditNote} taken off` : ''}`;
};

export async function startCheckout(config: RazorpayConfig, db: UsageDb, userId: string, request: CheckoutRequest, now = Date.now()): Promise<CheckoutSession> {
  const { plan, period, currency } = parse(request);
  const q = quote(db, userId, plan, period, currency, now);

  const order = await createOrder(config, {
    amountMinor: q.chargeMinor,
    currency,
    // Razorpay caps receipts at 40 characters.
    receipt: `fs_${userId.slice(0, 8)}_${Date.now().toString(36)}`.slice(0, 40),
    // Notes come back on the webhook, which is how a payment that arrives
    // without the browser (the user closed the tab) still knows what it bought.
    notes: { userId, planId: plan.id, period },
  });
  // The purchase is fixed here, server-side. Confirmation grants this row and nothing else.
  db.putCheckout({
    ref: order.id,
    kind: 'order',
    user_id: userId,
    plan: plan.id,
    period,
    currency,
    amount_minor: q.chargeMinor,
    remote_plan_id: null,
    created_at: now,
    credit_minor: q.creditMinor,
    credit_note: q.creditNote,
    replaces_subscription: q.replacesSubscription,
    starts_now: q.startsNow ? 1 : 0,
  });

  return { orderId: order.id, amountMinor: q.chargeMinor, currency, keyId: config.keyId, test: config.test, planId: plan.id, period, description: describe(plan, period, q, false) };
}

/* ─── Subscriptions ──────────────────────────────────────────────────────── */

/** Razorpay needs a finite cycle count; ten years is "until cancelled" in practice. */
const TOTAL_CYCLES: Record<RecurringPeriod, number> = { monthly: 120, annual: 10 };
const RAZORPAY_PERIOD: Record<RecurringPeriod, 'monthly' | 'yearly'> = { monthly: 'monthly', annual: 'yearly' };

/**
 * The Razorpay Plan for a (plan, period, currency), created once and
 * remembered. The key includes the Razorpay key id because test-mode and
 * live-mode plans are different objects living in different worlds — caching
 * them under one key would hand a live subscription a test plan id.
 */
async function ensureRemotePlan(config: RazorpayConfig, db: UsageDb, plan: Plan, period: RecurringPeriod, currency: CurrencyCode, now: number): Promise<string> {
  const key = `${config.keyId}:${plan.id}:${period}:${currency}`;
  const cached = db.getRemotePlan(key);
  if (cached) return cached;

  const created = await createPlan(config, {
    amountMinor: fullPrice(plan, period, currency),
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
  if (period === 'lifetime') throw new ApiError(400, 'invalid_request', `${plan.name} is a single payment, it does not renew.`);
  const q = quote(db, userId, plan, period, currency, now);
  const remotePlanId = await ensureRemotePlan(config, db, plan, period, currency, now);
  const subscription = await createSubscription(config, {
    planId: remotePlanId,
    totalCount: TOTAL_CYCLES[period],
    // The same notes an order carries, for the same reason: a renewal arrives
    // months later with no browser attached, and this is how it knows whose it is.
    notes: { userId, planId: plan.id, period },
    email,
    // With a credit, the first period is its own smaller charge today and the plan's own charges start one
    // period later, so the renewal date is where the paid period ends.
    upfront: q.creditMinor ? { amountMinor: q.chargeMinor, currency, name: `${plan.name}, first ${period === 'annual' ? 'year' : 'month'} (${q.creditNote} taken off)`, startAt: now + PERIOD_DAYS[period] * DAY_MS } : undefined,
  });

  db.putCheckout({
    ref: subscription.id,
    kind: 'subscription',
    user_id: userId,
    plan: plan.id,
    period,
    currency,
    amount_minor: q.chargeMinor,
    remote_plan_id: remotePlanId,
    created_at: now,
    credit_minor: q.creditMinor,
    credit_note: q.creditNote,
    replaces_subscription: q.replacesSubscription,
    starts_now: q.startsNow ? 1 : 0,
  });
  return { subscriptionId: subscription.id, keyId: config.keyId, test: config.test, planId: plan.id, period, currency, amountMinor: q.chargeMinor, description: describe(plan, period, q, true) };
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
  creditMinor?: number;
  creditNote?: string | null;
  /** An upgrade credited with the old plan's unused days: the new period starts today. */
  startsNow?: boolean;
}

export interface Grant {
  plan: PlanId;
  /** Null for a plan kept for life. */
  expiresAt: number | null;
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
 * than from today — nobody should lose days for renewing early. An upgrade has
 * already been credited for those days, so it starts from today instead.
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
    credit_minor: input.creditMinor ?? 0,
    credit_note: input.creditNote ?? null,
  });

  const current = db.getEntitlement(input.userId);
  const standing = (): Grant => ({ plan: effectivePlan(current, now) as PlanId, expiresAt: current?.expires_at ?? null, granted: false, autoRenew: current?.auto_renew === 1 });

  if (input.period === 'lifetime') {
    if (fresh) db.setLifetimePlan(input.userId, input.planId, now);
    const after = db.getEntitlement(input.userId);
    return { plan: effectivePlan(after, now) as PlanId, expiresAt: after?.expires_at ?? null, granted: fresh, autoRenew: after?.auto_renew === 1 };
  }
  if (!fresh) return standing(); // Already applied. Report the entitlement as it stands rather than adding to it.

  const activeUntil = current && current.plan !== 'free' && current.expires_at && current.expires_at > now ? current.expires_at : now;
  // A late charge from a subscription that an upgrade replaced must never take the account back down.
  const active = activeUntil > now ? currentPlanId(current!.plan) : null;
  if (active && input.subscriptionId && current?.subscription_id !== input.subscriptionId && PLAN_RANK[input.planId] < PLAN_RANK[active]) return standing();

  const expiresAt = (input.startsNow ? now : activeUntil) + PERIOD_DAYS[input.period] * DAY_MS;
  // A one-off purchase on top of a subscription must not silently cancel it, so an
  // absent subscriptionId keeps whatever was already there — unless this purchase replaces it.
  const subscriptionId = input.subscriptionId ?? (input.startsNow ? null : current?.subscription_id ?? null);
  const autoRenew = input.subscriptionId ? true : input.startsNow ? false : current?.auto_renew === 1;
  db.setPlan(input.userId, input.planId, now, expiresAt, input.paymentId, subscriptionId, autoRenew);
  return { plan: input.planId, expiresAt, granted: true, autoRenew };
}

/** Stops the subscription an upgrade replaced, once the upgrade is paid. Never fails the purchase itself. */
async function stopReplaced(config: RazorpayConfig, purchase: CheckoutRow): Promise<void> {
  if (!purchase.replaces_subscription) return;
  await cancelSubscription(config, purchase.replaces_subscription).catch((err) =>
    console.error(`[FocusSpace billing] Could not stop replaced subscription ${purchase.replaces_subscription}: ${err instanceof Error ? err.message : String(err)}`),
  );
}

const grantFrom = (purchase: CheckoutRow, ids: { orderId: string; paymentId: string; subscriptionId?: string | null }): GrantInput => ({
  userId: purchase.user_id,
  planId: purchase.plan as PlanId,
  period: purchase.period as BillingPeriod,
  currency: purchase.currency as CurrencyCode,
  amountMinor: purchase.amount_minor,
  creditMinor: purchase.credit_minor ?? 0,
  creditNote: purchase.credit_note ?? null,
  startsNow: purchase.starts_now === 1,
  ...ids,
});

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
export async function confirmPayment(
  config: RazorpayConfig,
  db: UsageDb,
  userId: string,
  body: { orderId: string; paymentId: string; signature: string; planId?: string; period?: string; currency?: string },
  now = Date.now(),
): Promise<Grant> {
  if (!verifyPaymentSignature(config, body.orderId, body.paymentId, body.signature)) throw new ApiError(400, 'invalid_signature', UNVERIFIED);
  const purchase = recordedPurchase(db, userId, body.orderId, 'order', body);
  const grant = grantPlan(db, grantFrom(purchase, { orderId: body.orderId, paymentId: body.paymentId }), now);
  if (grant.granted) await stopReplaced(config, purchase);
  return grant;
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
  const grant = grantPlan(db, grantFrom(purchase, { orderId: '', paymentId: body.paymentId, subscriptionId: body.subscriptionId }), now);
  if (grant.granted) await stopReplaced(config, purchase);
  return grant;
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
 * Checkout/subscription *creation* is gated on PURCHASABLE. Webhooks are not:
 * a plan we have stopped selling can still be charged by Razorpay for a
 * subscription we already created. Those charges must still grant.
 */
function canApplyWebhookCharge(db: UsageDb, planId: PlanId, userId: string, orderId: string, subscriptionId: string | null): boolean {
  if (PURCHASABLE.includes(planId)) return true;
  if (!PLANS.some((p) => p.id === planId && p.id !== 'free')) return false;
  if (subscriptionId) {
    const entitled = db.findBySubscription(subscriptionId);
    if (entitled?.user_id === userId && entitled.plan === planId) return true;
    const recorded = db.getCheckout(subscriptionId);
    if (recorded?.kind === 'subscription' && recorded.user_id === userId && recorded.plan === planId) return true;
  }
  if (orderId) {
    const recorded = db.getCheckout(orderId);
    if (recorded?.user_id === userId && recorded.plan === planId) return true;
  }
  return false;
}

/**
 * Applies a `payment.captured` webhook. The notes carried on the order are the
 * only link back to who paid for what, which is why `startCheckout` sets them.
 * The purchase this account recorded at checkout, when there is one, decides the
 * credit and whether the plan starts today — for an order, and for the first
 * charge of a subscription (a renewal is a plain charge at full price).
 */
export async function applyWebhook(db: UsageDb, event: unknown, now = Date.now(), config?: RazorpayConfig | null): Promise<Grant | null> {
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
  const rawPlan = notes.planId ?? subscriptionNotes.planId;
  // A retired plan still renewing (Unlimited) renews as the plan that replaced it.
  const planId = (rawPlan && RETIRED_PLANS[rawPlan] ? RETIRED_PLANS[rawPlan] : rawPlan) as PlanId | undefined;
  const period = (notes.period ?? subscriptionNotes.period) as BillingPeriod | undefined;
  const subscriptionId = String(payment.subscription_id ?? subscriptionEntity?.id ?? '') || null;
  const orderId = String(payment.order_id ?? '');
  if (!userId || !planId || !period || !canApplyWebhookCharge(db, planId, userId, orderId, subscriptionId)) return null;

  const paymentId = String(payment.id ?? randomUUID());
  const recorded = orderId ? db.getCheckout(orderId) : subscriptionId ? db.getCheckout(subscriptionId) : undefined;
  const firstCharge = recorded && recorded.user_id === userId && (recorded.kind === 'order' || db.getEntitlement(userId)?.subscription_id !== subscriptionId);
  const grant = firstCharge
    ? grantPlan(db, grantFrom(recorded, { orderId, paymentId, subscriptionId }), now)
    : grantPlan(db, { userId, planId, period, currency: (payment.currency as CurrencyCode) ?? 'INR', amountMinor: Number(payment.amount) || 0, orderId, paymentId, subscriptionId }, now);
  if (firstCharge && grant.granted && config) await stopReplaced(config, recorded);
  return grant;
}

/**
 * What an account is on right now. A paid period that has run out falls back to
 * what was bought for life (Basic), else to free. Enforced on read rather than by
 * a scheduled job: there is no scheduler here, and a lapsed row that nobody has
 * looked at yet has no effect on anything until it is read. Retired plans read as
 * the plan that replaced them.
 */
export function effectivePlan(entitlement: { plan: string; expires_at: number | null; lifetime_plan?: string | null } | undefined, now = Date.now()): string {
  const lifetime = entitlement?.lifetime_plan ? currentPlanId(entitlement.lifetime_plan) : 'free';
  if (!entitlement || entitlement.plan === 'free') return lifetime;
  if (entitlement.expires_at && entitlement.expires_at <= now) return lifetime;
  return currentPlanId(entitlement.plan);
}
