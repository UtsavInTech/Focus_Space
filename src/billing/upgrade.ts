import { PLAN_RANK, PLANS, type PlanId } from './plans';

/**
 * Whether to offer an upgrade, and in what words — or null for "don't". Only a plan with a Space limit
 * left to lift, and only when the learner is at (or one short of) it, and nobody is nagged while they
 * have room. Each plan points at the next rung that is for sale, never further.
 */
export function upgradeOffer(plan: string, spaces: { used: number; limit: number | null } | null): string | null {
  if (!spaces || spaces.limit === null || spaces.used < spaces.limit - 1) return null;
  // The next plan up that can actually be bought today: never one marked coming soon (Max, for now).
  const rank = PLAN_RANK[plan as PlanId];
  const next = rank === undefined ? null : PLANS.filter((p) => PLAN_RANK[p.id] > rank && !p.comingSoon && !p.unlisted).sort((a, b) => PLAN_RANK[a.id] - PLAN_RANK[b.id])[0];
  if (!next) return null;
  return next.oneTime ? `Want more Spaces? ${next.name} is ₹${next.oneTime.inr} for life` : `Need more Spaces? Go ${next.name}`;
}
