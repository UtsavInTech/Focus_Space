import type { EntitlementRow } from './db';

/**
 * Billing-independent entitlement model (Layer 2C). `plan` is a capability
 * key, never a scattered `if (user.plan === 'pro')` check — callers ask
 * `limitsFor(resolvePlan(row))`, not the plan id directly. 'pro' exists here
 * today even though nothing can grant it yet (no billing in this layer): a
 * future billing layer only ever needs to write one `entitlements` row.
 */
export type PlanId = 'free' | 'pro';

export interface PlanLimits {
  aiUnitsPerPeriod: number;
  /** How many Spaces the account may keep (server/usage/spaces.ts). */
  maxSpaces: number;
}

/**
 * Product decisions, not things derivable from code — kept as tunable defaults rather than buried
 * constants. Neither number is a researched final price/packaging decision; both exist so the limit
 * can move without a code change, and so a future paid plan is a different row here, nothing more.
 */
const FREE_PLAN_MONTHLY_AI_UNITS = Number(process.env.FREE_PLAN_MONTHLY_AI_UNITS ?? 200);
const FREE_PLAN_MAX_SPACES = Number(process.env.FREE_PLAN_MAX_SPACES ?? 4);

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: { aiUnitsPerPeriod: FREE_PLAN_MONTHLY_AI_UNITS, maxSpaces: FREE_PLAN_MAX_SPACES },
  pro: { aiUnitsPerPeriod: FREE_PLAN_MONTHLY_AI_UNITS * 10, maxSpaces: FREE_PLAN_MAX_SPACES * 5 },
};

/** A user with no entitlements row is implicitly on the free plan — no row is written until something actually upgrades them. */
export function resolvePlan(entitlement: EntitlementRow | undefined): PlanId {
  return entitlement?.plan === 'pro' ? 'pro' : 'free';
}

export function limitsFor(plan: PlanId): PlanLimits {
  return PLAN_LIMITS[plan];
}
