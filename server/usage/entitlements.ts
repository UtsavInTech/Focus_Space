import { PLANS, type PlanId } from '@/billing/plans';
import { effectivePlan } from '../billing/service';
import type { EntitlementRow } from './db';

/**
 * Billing-independent entitlement model. `plan` is a capability key, never a
 * scattered `if (user.plan === 'pro')` check — callers ask
 * `limitsFor(resolvePlan(row))`, not the plan id directly.
 *
 * The limits come from the shared price book (`src/billing/plans.ts`) rather
 * than a second table here, so what the pricing page advertises and what the
 * server enforces cannot drift apart. `Infinity` is how "unlimited" is
 * expressed: every comparison against it already reads correctly, and nothing
 * needs a null check.
 */
export type { PlanId };

export interface PlanLimits {
  aiUnitsPerPeriod: number;
  /** How many Spaces the account may keep (server/usage/spaces.ts). */
  maxSpaces: number;
}


const unlimited = (value: number | null) => (value === null ? Infinity : value);

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = Object.fromEntries(
  PLANS.map((plan) => [
    plan.id,
    // Every plan, Free included, straight from the price book. An environment override here once let the
    // enforced Free limits drift from what the pricing page promised; there is deliberately no such knob now.
    { aiUnitsPerPeriod: unlimited(plan.limits.aiCredits), maxSpaces: unlimited(plan.limits.modes) },
  ]),
) as Record<PlanId, PlanLimits>;

/**
 * A user with no entitlements row is free, and so is one whose paid plan has
 * run out — expiry is applied on read (see billing/service.ts `effectivePlan`)
 * because there is no scheduler here to expire rows on a timer.
 */
export function resolvePlan(entitlement: EntitlementRow | undefined, now = Date.now()): PlanId {
  const plan = effectivePlan(entitlement, now);
  return (PLANS.some((p) => p.id === plan) ? plan : 'free') as PlanId;
}

export function limitsFor(plan: PlanId): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}
