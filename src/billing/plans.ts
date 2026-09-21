/**
 * The FocusSpace price book — the single source of truth for what things cost.
 *
 * It lives in `src/` rather than in the website because the **server** is the
 * one that must decide an amount. A checkout that took the price from the page
 * would let anyone pay ₹1 for Max by editing a request; the client asks for a
 * plan and a period, and the server looks the money up here.
 *
 * USD is the headline everywhere; INR is what an Indian visitor is actually
 * charged through Razorpay. Both amounts are **fixed per plan**, never a live
 * FX conversion: Razorpay subscription plans are created with a fixed amount,
 * and a floating rate would make invoices, refunds and accounting disagree
 * with what the page said. When the rate drifts far enough to matter, the
 * numbers here move deliberately, in one commit.
 *
 * `aiCredits` is the same unit the server already meters in
 * `server/usage/cost.ts` (ask 1 · explain/quiz 2 · notes/mind map 3), so the
 * marketing copy and the enforcement code cannot drift apart: a plan's
 * `aiCredits` is exactly what `PLAN_LIMITS[plan].aiUnitsPerPeriod` must be set
 * to on the server.
 */

export type PlanId = 'free' | 'pro' | 'unlimited' | 'max';
export type BillingPeriod = 'monthly' | 'annual';
export type CurrencyCode = 'USD' | 'INR';

export interface Amount {
  usd: number;
  inr: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Per billing period. Annual is the full yearly charge, not a monthly rate. */
  price: Record<BillingPeriod, Amount>;
  /** Highlighted card. Exactly one plan should set this. */
  featured?: boolean;
  /**
   * Limits the product enforces — the only ones it has. `null` means unlimited.
   * `modes` is the number of Spaces an account may keep (server/usage/spaces.ts);
   * `aiCredits` is the monthly allowance in the units of server/usage/cost.ts.
   */
  limits: {
    modes: number | null;
    aiCredits: number | null;
  };
  /** Only what the product actually does today — pricing, FAQ and the extension quote this list. */
  features: string[];
  /** Shown under the feature list — what this plan deliberately does not include. */
  missing?: string[];
  cta: string;
  /** Visible on pricing, but not for sale. Existing entitlements are unchanged. */
  comingSoon?: boolean;
}

/**
 * The annual discount differs slightly by currency, because every displayed
 * figure is held to a .99 ending in both — so the toggle advertises the best
 * of them and each card states its own exact saving.
 */
export const ANNUAL_DISCOUNT_LABEL = 'Save up to 33%';

/**
 * Without an account there is no server-side allowance, so these two are
 * enforced differently: Spaces in the browser (background/spaces.ts), AI per
 * day on the server, keyed by a hash of the caller's address
 * (server/usage/service.ts).
 */
export const GUEST_SPACE_LIMIT = 3;
export const GUEST_DAILY_AI_CREDITS = 10;

/** The Free account's allowances — the same numbers as the Free plan's `limits`, named for the copy that quotes them. */
export const FREE_SPACE_LIMIT = 5;
export const FREE_MONTHLY_AI_CREDITS = 200;

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Everything that makes YouTube usable again, at no cost.',
    price: { monthly: { usd: 0, inr: 0 }, annual: { usd: 0, inr: 0 } },
    limits: { modes: FREE_SPACE_LIMIT, aiCredits: FREE_MONTHLY_AI_CREDITS },
    features: [
      `${GUEST_SPACE_LIMIT} Spaces without an account, ${FREE_SPACE_LIMIT} with a free account`,
      'Relevance-ranked subscriptions and discovery',
      'Learning path, knowledge map and Shorts removal',
      `${FREE_MONTHLY_AI_CREDITS} AI credits a month with a free account (${GUEST_DAILY_AI_CREDITS} a day without one)`,
      'Notes and mind maps in English, हिंदी or Hinglish',
    ],
    cta: 'Add to Chrome — Free',
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For one subject you are serious about.',
    // Annual totals are 12 x a .99 monthly figure, so the "/month" line stays clean: $2.99 / ₹199.
    price: { monthly: { usd: 3.99, inr: 299 }, annual: { usd: 35.88, inr: 2388 } },
    limits: { modes: 15, aiCredits: 2000 },
    features: ['Everything in Free', '15 Spaces', '2,000 AI credits a month', 'Email support'],
    cta: 'Get Pro',
  },
  {
    id: 'unlimited',
    name: 'Unlimited',
    tagline: 'For everything you are learning at once.',
    price: { monthly: { usd: 7.99, inr: 599 }, annual: { usd: 71.88, inr: 4788 } },
    featured: true,
    limits: { modes: null, aiCredits: null },
    features: ['Everything in Free', 'Unlimited Spaces', 'Unlimited AI credits', 'Priority support'],
    cta: 'Get Unlimited',
  },
  {
    id: 'max',
    name: 'Max',
    tagline: 'Everything in Unlimited, for people who want to back FocusSpace.',
    price: { monthly: { usd: 19.99, inr: 1499 }, annual: { usd: 179.88, inr: 11988 } },
    limits: { modes: null, aiCredits: null },
    features: ['Everything in Unlimited', 'Unlimited Spaces', 'Unlimited AI credits', 'Priority support'],
    cta: 'Get Max',
    comingSoon: true,
  },
];

/** "Pro plan", "Max plan" — for a plan id that arrived as a plain string from the server. */
export const planLabel = (id: string): string => `${PLANS.find((p) => p.id === id)?.name ?? id} plan`;

export const planById = (id: PlanId): Plan => PLANS.find((p) => p.id === id) ?? PLANS[0];

/**
 * The monthly-equivalent of an annual price, for the "$2.42/month, billed
 * annually" line. Rounded for display only — the charge is always the exact
 * annual `Amount` above.
 */
export function perMonth(plan: Plan, period: BillingPeriod): Amount {
  if (period === 'monthly') return plan.price.monthly;
  return { usd: plan.price.annual.usd / 12, inr: Math.round(plan.price.annual.inr / 12) };
}

/**
 * What the annual price saves against twelve monthly charges, in the currency
 * being shown. Currency-specific because the rounding that keeps every figure
 * ending in .99 lands on slightly different ratios — quoting the dollar saving
 * next to a rupee price would simply be wrong.
 */
export function annualSavingPercent(plan: Plan, currency: CurrencyCode = 'USD'): number {
  const monthly = currency === 'INR' ? plan.price.monthly.inr : plan.price.monthly.usd;
  const annual = currency === 'INR' ? plan.price.annual.inr : plan.price.annual.usd;
  const yearOfMonthly = monthly * 12;
  if (!yearOfMonthly) return 0;
  return Math.round(((yearOfMonthly - annual) / yearOfMonthly) * 100);
}

/**
 * What one credit buys — mirrors `ACTION_COST` in server/usage/cost.ts exactly.
 * Kept here so the pricing page explains the real unit rather than a
 * marketing abstraction of it.
 */
export const CREDIT_COSTS: { action: string; credits: number }[] = [
  { action: 'Ask about this moment, or a chat turn', credits: 1 },
  { action: 'What am I learning? · Example', credits: 1 },
  { action: 'Explain this · Quiz me', credits: 2 },
  { action: 'Notes or a mind map', credits: 3 },
];
