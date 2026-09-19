/**
 * Whether to offer an upgrade, and in what words — or null for "don't". Only a plan with a Space limit
 * left to lift, and only when the learner is at (or one short of) it: Unlimited and Max are never
 * pitched anything, and nobody is nagged while they have room.
 */
export function upgradeOffer(plan: string, spaces: { used: number; limit: number | null } | null): string | null {
  if (!spaces || spaces.limit === null || spaces.used < spaces.limit - 1) return null;
  if (plan === 'free') return 'Want more Spaces? Upgrade';
  if (plan === 'pro') return 'Need more Spaces? Go Unlimited';
  return null;
}
