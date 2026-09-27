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

export type PlanId = 'free' | 'basic' | 'plus' | 'pro' | 'max';
/** `lifetime` is Basic's single payment; the other two renew (or are bought one period at a time). */
export type BillingPeriod = 'monthly' | 'annual' | 'lifetime';
export type RecurringPeriod = Exclude<BillingPeriod, 'lifetime'>;
export type CurrencyCode = 'USD' | 'INR';

export interface Amount {
  usd: number;
  inr: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Per billing period. Annual is the full yearly charge, not a monthly rate. Absent for a one-time plan. */
  price?: Record<RecurringPeriod, Amount>;
  /** A single payment that never expires (Basic). */
  oneTime?: Amount;
  /** Highlighted card. Exactly one plan should set this. */
  featured?: boolean;
  /** Not shown as a card on the pricing page (the free account). */
  unlisted?: boolean;
  /**
   * Limits the product enforces — the only ones it has. `null` means unlimited.
   * `modes` is the number of Spaces an account may keep (server/usage/spaces.ts);
   * `aiCredits` is the monthly allowance in the units of server/usage/cost.ts, and `aiCreditsPerDay` a
   * rolling 24-hour ceiling under it (only the cheap plans have one); `voiceMinutes` is the monthly
   * allowance of speech — yours and FocusSpace's together (server/usage/voice.ts); `quizQuestions` is the
   * monthly allowance of checked quiz questions (server/usage/quiz.ts); `savedNotes` is how many notes
   * and mind maps the Library keeps (content/ui/NotesPanel.tsx).
   */
  limits: {
    modes: number | null;
    aiCredits: number | null;
    aiCreditsPerDay: number | null;
    voiceMinutes: number;
    quizQuestions: number;
    savedNotes: number | null;
  };
  /** Only what the product actually does today — pricing, FAQ and the extension quote this list. */
  features: string[];
  /** Shown under the feature list — what this plan deliberately does not include. */
  missing?: string[];
  cta: string;
  /** Visible on pricing, but not for sale. Existing entitlements are unchanged. */
  comingSoon?: boolean;
}

/** Plans no longer sold whose entitlements still exist: they get the plan that replaced them. */
export const RETIRED_PLANS: Record<string, PlanId> = { unlimited: 'max' };

/** A year costs ten months: the toggle says so, and each card states its own exact saving. */
export const ANNUAL_DISCOUNT_LABEL = '2 months free';

/**
 * Without an account there is no server-side allowance, so these two are
 * enforced differently: Spaces in the browser (background/spaces.ts), AI per
 * day on the server, keyed by a hash of the caller's address
 * (server/usage/service.ts).
 */
export const GUEST_SPACE_LIMIT = 3;
export const GUEST_DAILY_AI_CREDITS = 10;

/**
 * The free account: enough to see what FocusSpace does, small enough that ₹99 for Basic is the obvious
 * next step. The same numbers as the Free plan's `limits`, named for the copy that quotes them.
 */
export const FREE_SPACE_LIMIT = 5;
export const FREE_MONTHLY_AI_CREDITS = 150;
export const FREE_DAILY_AI_CREDITS = 10;

/**
 * Talking costs real money per second — the natural voice most of all (about ₹1.3 a minute at worst) —
 * so it is the one thing no plan gets without limit. Every allowance is **per month**. A free account
 * gets a real half hour (at most ~₹40 of speech); each paid plan roughly doubles the one below it, at
 * a worst case of about a third of what the plan brings in after GST and fees — and most people talk
 * far less. Without an account, voice is only for setting up (the guide), and never more than a free
 * account would get: 5 minutes a month per install.
 */
export const FREE_MONTHLY_VOICE_MINUTES = 30;

/**
 * Quiz me needs an account and is counted in questions, not credits: every question is written and then
 * checked by a second model before anyone sees it, so a question costs more than its credit share would
 * say. No plan is without limit. Choosing a difficulty and keeping score come with Plus and above.
 */
export const FREE_MONTHLY_QUIZ_QUESTIONS = 5;
export const QUIZ_EXTRAS_PLANS: readonly string[] = ['plus', 'pro', 'max'];
export const GUEST_SETUP_VOICE_MINUTES_PER_MONTH = 5;
export const FREE_SAVED_NOTES = 5;

/**
 * Basic is paid for once and kept for life, so every allowance it has is a ceiling FocusSpace can afford
 * forever on ₹99: at most ~300 AI actions a month (about ₹25 of AI at worst), a handful of quiz questions,
 * the free half hour of voice. Past that, the way on is Plus, and a Basic owner's first month of Plus is
 * ₹100 cheaper (`BASIC_UPGRADE_CREDIT`). Pro is never discounted: at ₹299 it has no room for it.
 *
 * The other way round: someone new who buys Plus straight away gets Basic for life with it
 * (`PLUS_INCLUDES_BASIC`), so ₹149 is ₹99 of Basic plus a first month of Plus, and nobody who chose the
 * bigger plan ends up with less than someone who bought Basic.
 */
export const BASIC_UPGRADE_CREDIT: Amount = { inr: 100, usd: 1 };
export const BASIC_UPGRADE_PLANS: readonly PlanId[] = ['plus'];
export const PLUS_INCLUDES_BASIC = true;
const PLUS_MONTHLY: Amount = { usd: 1.99, inr: 149 };

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Try FocusSpace with an account.',
    unlisted: true,
    limits: { modes: FREE_SPACE_LIMIT, aiCredits: FREE_MONTHLY_AI_CREDITS, aiCreditsPerDay: FREE_DAILY_AI_CREDITS, voiceMinutes: FREE_MONTHLY_VOICE_MINUTES, quizQuestions: FREE_MONTHLY_QUIZ_QUESTIONS, savedNotes: FREE_SAVED_NOTES },
    features: [
      `${GUEST_SPACE_LIMIT} Spaces without an account, ${FREE_SPACE_LIMIT} with a free account`,
      'Relevance-ranked subscriptions and discovery',
      'Learning path, knowledge map and Shorts removal',
      `${FREE_DAILY_AI_CREDITS} AI credits a day with a free account, up to ${FREE_MONTHLY_AI_CREDITS} a month (${GUEST_DAILY_AI_CREDITS} a day without one)`,
      `Talk to FocusSpace AI: ${FREE_MONTHLY_VOICE_MINUTES} minutes of voice a month with a free account`,
      `Quiz me: ${FREE_MONTHLY_QUIZ_QUESTIONS} checked questions a month with a free account`,
      `Notes and mind maps in English, हिंदी or Hinglish, ${FREE_SAVED_NOTES} kept in your Library`,
    ],
    cta: 'Add to Chrome for free',
  },
  {
    id: 'basic',
    name: 'Basic',
    tagline: 'Pay once, keep it for life.',
    oneTime: { usd: 0.99, inr: 99 },
    limits: { modes: 15, aiCredits: 300, aiCreditsPerDay: 20, voiceMinutes: FREE_MONTHLY_VOICE_MINUTES, quizQuestions: 10, savedNotes: 15 },
    features: [
      '15 Spaces, for life',
      'Choose the channels in every Space',
      'Switch Spaces or open a video just by asking FocusSpace AI',
      '15 notes and mind maps kept in your Library',
      '20 AI credits a day, up to 300 a month',
      '10 quiz questions a month',
      `Your first month of Plus for ₹${PLUS_MONTHLY.inr - BASIC_UPGRADE_CREDIT.inr}`,
    ],
    cta: 'Get Basic for life',
  },
  {
    id: 'plus',
    name: 'Plus',
    tagline: 'For a subject you study every week.',
    // Yearly is ten months' price: two months free, never so deep that a month drops below what it costs us.
    price: { monthly: PLUS_MONTHLY, annual: { usd: 19.9, inr: 1490 } },
    limits: { modes: 25, aiCredits: 1000, aiCreditsPerDay: null, voiceMinutes: 60, quizQuestions: 60, savedNotes: null },
    features: ['Everything in Basic', '25 Spaces', '1,000 AI credits a month, no daily cap', '1 hour of voice a month', '60 quiz questions a month, with difficulty and score', 'Unlimited notes and mind maps'],
    cta: 'Get Plus',
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For everything you are learning at once.',
    price: { monthly: { usd: 3.99, inr: 299 }, annual: { usd: 39.9, inr: 2990 } },
    featured: true,
    limits: { modes: 50, aiCredits: 2500, aiCreditsPerDay: null, voiceMinutes: 120, quizQuestions: 150, savedNotes: null },
    features: ['Everything in Plus', '50 Spaces', '2,500 AI credits a month', '2 hours of voice a month', '150 quiz questions a month, with difficulty and score', 'Email support'],
    cta: 'Get Pro',
  },
  {
    id: 'max',
    name: 'Max',
    tagline: 'The most capable FocusSpace, for learning every day.',
    // Coming soon: priced for what it will carry (the strongest AI model, notes kept on our servers).
    price: { monthly: { usd: 12.99, inr: 999 }, annual: { usd: 129.9, inr: 9990 } },
    limits: { modes: null, aiCredits: null, aiCreditsPerDay: null, voiceMinutes: 300, quizQuestions: 600, savedNotes: null },
    features: [
      'Everything in Pro',
      'The most capable AI model for notes, mind maps and chat',
      'Your notes and Library kept on FocusSpace’s servers, safe if you reinstall',
      'Unlimited Spaces and AI credits (fair use)',
      '5 hours of voice a month',
      '600 quiz questions a month',
      'Priority support',
    ],
    cta: 'Get Max',
    comingSoon: true,
  },
];

/** The order plans rise in: upgrades go up it, never down mid-cycle. */
export const PLAN_RANK: Record<PlanId, number> = { free: 0, basic: 1, plus: 2, pro: 3, max: 4 };

/** A stored plan id as today's plan: a retired one maps to its replacement, anything unknown to Free. */
export function currentPlanId(id: string | null | undefined): PlanId {
  const mapped = (id && RETIRED_PLANS[id]) || id;
  return PLANS.some((p) => p.id === mapped) ? (mapped as PlanId) : 'free';
}

/** "Pro plan", "Max plan" — for a plan id that arrived as a plain string from the server. */
export const planLabel = (id: string): string => `${planById(currentPlanId(id)).name} plan`;

export const planById = (id: PlanId): Plan => PLANS.find((p) => p.id === id) ?? PLANS[0];

/**
 * The monthly-equivalent of an annual price, for the "$2.42/month, billed
 * annually" line. Rounded for display only — the charge is always the exact
 * annual `Amount` above.
 */
export function perMonth(plan: Plan, period: RecurringPeriod): Amount {
  if (!plan.price) return plan.oneTime ?? { usd: 0, inr: 0 };
  if (period === 'monthly') return plan.price.monthly;
  return { usd: plan.price.annual.usd / 12, inr: Math.round(plan.price.annual.inr / 12) };
}

/** What a plan costs for a period, or null when it cannot be bought that way. */
export function priceOf(plan: Plan, period: BillingPeriod): Amount | null {
  if (period === 'lifetime') return plan.oneTime ?? null;
  return plan.price?.[period] ?? null;
}

/**
 * What the annual price saves against twelve monthly charges, in the currency
 * being shown. Currency-specific because the rounding that keeps every figure
 * ending in .99 lands on slightly different ratios — quoting the dollar saving
 * next to a rupee price would simply be wrong.
 */
export function annualSavingPercent(plan: Plan, currency: CurrencyCode = 'USD'): number {
  if (!plan.price) return 0;
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
  { action: 'A chat message', credits: 1 },
  { action: 'What am I learning? · Example', credits: 1 },
  { action: 'Explain this', credits: 2 },
  { action: 'Notes or a mind map', credits: 3 },
];
