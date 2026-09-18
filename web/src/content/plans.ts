/**
 * The FocusSpace price book.
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
  /** Limits the server enforces. `null` means unlimited. */
  limits: {
    modes: number | null;
    subtopicsPerMode: number | null;
    aiCredits: number | null;
    premiumCredits: number | null;
  };
  features: string[];
  /** Shown under the feature list — what this plan deliberately does not include. */
  missing?: string[];
  cta: string;
}

/** ~30% off the monthly rate, matching how the annual toggle is advertised. */
export const ANNUAL_DISCOUNT_LABEL = 'Save 30%';

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Everything that makes YouTube usable again, at no cost.',
    price: { monthly: { usd: 0, inr: 0 }, annual: { usd: 0, inr: 0 } },
    limits: { modes: 5, subtopicsPerMode: 5, aiCredits: 200, premiumCredits: null },
    features: [
      '3 modes without an account, 5 once you sign in',
      'Up to 5 sub-topics per mode',
      'Relevance-ranked subscriptions and discovery',
      'Learning path, knowledge map and Shorts removal',
      '200 AI credits a month (10 a day signed out)',
      'Notes and mind maps in English, हिंदी or Hinglish',
    ],
    missing: ['No sync across devices', 'No premium models'],
    cta: 'Add to Chrome — Free',
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For one subject you are serious about.',
    price: { monthly: { usd: 3.49, inr: 299 }, annual: { usd: 29, inr: 2499 } },
    limits: { modes: 15, subtopicsPerMode: 15, aiCredits: 2000, premiumCredits: 100 },
    features: [
      '15 modes',
      'Up to 15 sub-topics per mode',
      '2,000 AI credits a month',
      '100 premium credits for the advanced model',
      'Mind map diagrams, exportable as SVG',
      'Notes and modes synced across devices',
      'Email support',
    ],
    cta: 'Get Pro',
  },
  {
    id: 'unlimited',
    name: 'Unlimited',
    tagline: 'For everything you are learning at once.',
    price: { monthly: { usd: 8.99, inr: 749 }, annual: { usd: 75, inr: 6299 } },
    featured: true,
    limits: { modes: null, subtopicsPerMode: null, aiCredits: null, premiumCredits: 2800 },
    features: [
      'Unlimited modes and sub-topics',
      'Unlimited AI credits on the standard model',
      '2,800 premium credits a month',
      'Full-course notes across a whole playlist',
      'Mind map diagrams, exportable as SVG',
      'Notes and modes synced across devices',
      'Priority support',
    ],
    cta: 'Get Unlimited',
  },
  {
    id: 'max',
    name: 'Max',
    tagline: 'For people who live inside long courses.',
    price: { monthly: { usd: 24.99, inr: 1999 }, annual: { usd: 209, inr: 16799 } },
    limits: { modes: null, subtopicsPerMode: null, aiCredits: null, premiumCredits: 10000 },
    features: [
      'Everything in Unlimited',
      '10,000 premium credits a month',
      'The advanced model by default on every action',
      'Longest transcript windows for multi-hour lectures',
      'Early access to new features',
      'Priority support',
    ],
    cta: 'Get Max',
  },
];

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

/** What the annual price saves against twelve monthly charges, as a percentage. */
export function annualSavingPercent(plan: Plan): number {
  const yearOfMonthly = plan.price.monthly.usd * 12;
  if (!yearOfMonthly) return 0;
  return Math.round(((yearOfMonthly - plan.price.annual.usd) / yearOfMonthly) * 100);
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
