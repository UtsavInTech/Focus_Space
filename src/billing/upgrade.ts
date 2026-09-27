/**
 * Whether to offer an upgrade, and in what words — or null for "don't". Only a plan with a Space limit
 * left to lift, and only when the learner is at (or one short of) it: Max is never pitched anything,
 * and nobody is nagged while they have room. Each plan points at the next rung, never further.
 */
export function upgradeOffer(plan: string, spaces: { used: number; limit: number | null } | null): string | null {
  if (!spaces || spaces.limit === null || spaces.used < spaces.limit - 1) return null;
  if (plan === 'free') return 'Want more Spaces? Basic is ₹99 for life';
  if (plan === 'basic') return 'Need more Spaces? Go Plus';
  if (plan === 'plus') return 'Need more Spaces? Go Pro';
  if (plan === 'pro') return 'Need more Spaces? Go Max';
  return null;
}
