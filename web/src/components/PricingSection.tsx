import { useState } from 'react';
import { navigate, onLinkClick } from '../router';
import { useAuth } from '../auth';
import { CheckoutCancelled, startCheckout } from '../checkout';
import { formatAmount, looksIndian } from '../currency';
import { ANNUAL_DISCOUNT_LABEL, CREDIT_COSTS, PLANS, annualSavingPercent, perMonth } from '../content/plans';
import type { BillingPeriod, CurrencyCode, Plan } from '../content/plans';

interface Props {
  currency: CurrencyCode;
  onCurrency: (currency: CurrencyCode) => void;
  /** The home page shows the cards without the credit table underneath. */
  compact?: boolean;
  showCredits?: boolean;
}

export function PricingSection({ currency, onCurrency, compact, showCredits }: Props) {
  const auth = useAuth();
  const [period, setPeriod] = useState<BillingPeriod>('annual');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Buying requires an account, because a payment has to attach to one. Rather
   * than refusing, send them to sign in — they come back to this page.
   */
  async function buy(plan: Plan) {
    if (plan.id === 'free') {
      navigate('/#install');
      return;
    }
    if (!auth.user) {
      navigate('/signin');
      return;
    }
    setBusy(plan.id);
    setMessage(null);
    try {
      const token = await auth.token();
      if (!token) {
        navigate('/signin');
        return;
      }
      const result = await startCheckout({ planId: plan.id, period, currency, token, email: auth.user.email });
      // Re-read from the server rather than trusting what checkout just told us.
      await auth.reload();
      setMessage(`You're on ${plan.name}. It runs until ${new Date(result.expiresAt).toLocaleDateString()}.`);
    } catch (err) {
      // Closing the payment sheet is a decision, not an error worth shouting about.
      if (!(err instanceof CheckoutCancelled)) setMessage(err instanceof Error ? err.message : 'Could not start the payment.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="fsw-section fsw-pricing" id="pricing">
      {compact && (
        <div className="fsw-section-head">
          <h2>Free where it can be, paid where it costs us</h2>
          <p>Modes, ranking, the learning path and the knowledge map run on your machine and stay free.</p>
        </div>
      )}

      <div className="fsw-pricing-controls">
        <div className="fsw-switch" role="group" aria-label="Billing period">
          {(['monthly', 'annual'] as BillingPeriod[]).map((p) => (
            <button key={p} type="button" className={period === p ? 'is-active' : ''} aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {p === 'monthly' ? 'Monthly' : 'Annually'}
              {p === 'annual' && <em>{ANNUAL_DISCOUNT_LABEL}</em>}
            </button>
          ))}
        </div>

        <div className="fsw-switch fsw-switch-sm" role="group" aria-label="Currency">
          {(['USD', 'INR'] as CurrencyCode[]).map((c) => (
            <button key={c} type="button" className={currency === c ? 'is-active' : ''} aria-pressed={currency === c} onClick={() => onCurrency(c)}>
              {c === 'USD' ? '$ USD' : '₹ INR'}
            </button>
          ))}
        </div>
      </div>

      {/* Shown to visitors we believe are in India regardless of which currency they
          are looking at — someone comparing the dollar price still needs to know what
          their card or UPI app will actually be debited. */}
      {looksIndian() && (
        <p className="fsw-pricing-note">
          Paying from India? You are charged in rupees through UPI, card or netbanking. The dollar price is the
          headline; the rupee amount is what leaves your account.
        </p>
      )}

      <div className={`fsw-plans${compact ? ' is-compact' : ''}`}>
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} period={period} currency={currency} compact={compact} busy={busy === plan.id} current={auth.plan} expiresAt={auth.planExpiresAt} onBuy={() => void buy(plan)} />
        ))}
      </div>

      {message && <p className="fsw-pricing-note" style={{ marginTop: 20 }}>{message}</p>}

      {compact && (
        <p className="fsw-pricing-more">
          <a href="/pricing" onClick={onLinkClick('/pricing')}>
            Compare plans in full, and see what a credit buys →
          </a>
        </p>
      )}

      {showCredits && (
        <div className="fsw-credits">
          <h3>What a credit buys</h3>
          <p>
            One credit is one AI request, weighted by how much work it is. Watching a video never costs a credit —
            nothing is spent until you click.
          </p>
          <ul>
            {CREDIT_COSTS.map((c) => (
              <li key={c.action}>
                <span>{c.action}</span>
                <em>
                  {c.credits} credit{c.credits > 1 ? 's' : ''}
                </em>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Where each plan sits relative to the others, so a card can say "upgrade" or "downgrade" honestly. */
const RANK: Record<string, number> = { free: 0, pro: 1, unlimited: 2, max: 3 };

function PlanCard({
  plan,
  period,
  currency,
  compact,
  busy,
  current,
  expiresAt,
  onBuy,
}: {
  plan: Plan;
  period: BillingPeriod;
  currency: CurrencyCode;
  compact?: boolean;
  busy?: boolean;
  current: string;
  expiresAt: number | null;
  onBuy: () => void;
}) {
  const isFree = plan.id === 'free';
  const isCurrent = current === plan.id;
  // Offering "Get Pro" to someone already on Pro is the bug this replaces.
  const label = isCurrent ? 'Your plan' : RANK[plan.id] < RANK[current] ? `Switch to ${plan.name}` : plan.cta;
  const monthly = perMonth(plan, period);
  const saving = annualSavingPercent(plan, currency);

  return (
    <article className={`fsw-plan${plan.featured ? ' is-featured' : ''}${isCurrent ? ' is-current' : ''}`}>
      {isCurrent ? <span className="fsw-plan-flag is-current">Current plan</span> : plan.featured && <span className="fsw-plan-flag">Most popular</span>}
      <h3>{plan.name}</h3>
      <p className="fsw-plan-tagline">{plan.tagline}</p>

      <p className="fsw-plan-price">
        {isFree ? <strong>Free</strong> : <strong>{formatAmount(monthly, currency)}</strong>}
        {!isFree && <span>/month</span>}
      </p>

      {/* The annual charge is stated in full. "$2.42/month" with no yearly figure
          anywhere is the pattern that gets pricing pages accused of hiding the number. */}
      <p className="fsw-plan-sub">
        {isCurrent && expiresAt
          ? `Runs until ${new Date(expiresAt).toLocaleDateString()}`
          : isFree
            ? 'No card, no expiry'
            : period === 'annual'
              ? `${formatAmount(plan.price.annual, currency)} billed once a year · save ${saving}%`
              : `${formatAmount(plan.price.monthly, currency)} billed every month`}
      </p>

      <button
        type="button"
        className={`fsw-btn ${plan.featured && !isCurrent ? 'fsw-btn-primary' : 'fsw-btn-outline'} fsw-btn-block`}
        disabled={busy || isCurrent}
        onClick={onBuy}
      >
        {busy ? 'Opening payment…' : label}
      </button>
      {/* Buying the same plan again is a renewal, not a mistake — but it should be a deliberate choice. */}
      {isCurrent && !isFree && (
        <button type="button" className="fsw-link fsw-plan-renew" onClick={onBuy}>
          Extend by another {period === 'annual' ? 'year' : 'month'}
        </button>
      )}

      <ul className="fsw-plan-features">
        {(compact ? plan.features.slice(0, 4) : plan.features).map((f) => (
          <li key={f}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {f}
          </li>
        ))}
      </ul>

      {!compact && plan.missing?.length ? (
        <ul className="fsw-plan-features is-missing">
          {plan.missing.map((m) => (
            <li key={m}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
              {m}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
