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

/**
 * The Free plan's numbers stay environment-tunable — they are the ones most
 * likely to move in response to what the AI actually costs, and moving them
 * should not need a deploy of the website too.
 */
const FREE_PLAN_MONTHLY_AI_UNITS = Number(process.env.FREE_PLAN_MONTHLY_AI_UNITS ?? 200);
const FREE_PLAN_MAX_SPACES = Number(process.env.FREE_PLAN_MAX_SPACES ?? 5);

const unlimited = (value: number | null) => (value === null ? Infinity : value);

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = Object.fromEntries(
  PLANS.map((plan) => [
    plan.id,
    plan.id === 'free'
      ? { aiUnitsPerPeriod: FREE_PLAN_MONTHLY_AI_UNITS, maxSpaces: FREE_PLAN_MAX_SPACES }
      : { aiUnitsPerPeriod: unlimited(plan.limits.aiCredits), maxSpaces: unlimited(plan.limits.modes) },
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
