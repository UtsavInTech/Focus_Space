import { hasStoreListing, installHref, onPhoneOrTablet, sendLinkToComputer } from '../install';
import { useState, type CSSProperties } from 'react';
import { navigate, onLinkClick } from '../router';
import { useAuth } from '../auth';
import { Sparkle } from './Sparkle';
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
   * Renewing by default, because a plan that lapses silently is worse for
   * everyone — but it is a visible choice, not something done to people.
   */
  const [renewing, setRenewing] = useState(true);

  /**
   * Buying requires an account, because a payment has to attach to one. Rather
   * than refusing, send them to sign in — they come back to this page.
   */
  async function buy(plan: Plan) {
    if (plan.comingSoon) return;
    if (plan.id === 'free') {
      // A phone cannot install the extension; hand the link on to a computer instead of a dead store page.
      if (onPhoneOrTablet()) void sendLinkToComputer();
      else if (hasStoreListing()) window.open(installHref(), '_blank', 'noreferrer');
      else navigate('/#install');
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
      const result = await startCheckout({ planId: plan.id, period, currency, token, email: auth.user.email, renewing });
      // Re-read from the server rather than trusting what checkout just told us.
      await auth.reload();
      setMessage(
        result.autoRenew
          ? `You're on ${plan.name}. It renews automatically on ${new Date(result.expiresAt).toLocaleDateString()} — cancel any time.`
          : `You're on ${plan.name}. It runs until ${new Date(result.expiresAt).toLocaleDateString()}, and will not renew by itself.`,
      );
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
        <div className="fsw-section-head" data-reveal>
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

        <label className="fsw-renew-toggle">
          <input type="checkbox" checked={renewing} onChange={(e) => setRenewing(e.target.checked)} />
          <span>Renew automatically</span>
        </label>

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
        {PLANS.map((plan, i) => (
          <PlanCard key={plan.id} order={i} plan={plan} period={period} currency={currency} compact={compact} busy={busy === plan.id} current={auth.user ? auth.plan : null} expiresAt={auth.planExpiresAt} autoRenew={auth.autoRenew} renewing={renewing} onBuy={() => void buy(plan)} />
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
  autoRenew,
  renewing,
  onBuy,
  order,
}: {
  order: number;
  plan: Plan;
  period: BillingPeriod;
  currency: CurrencyCode;
  compact?: boolean;
  busy?: boolean;
  /** Null for a visitor: `auth.plan` defaults to 'free', and marking Free as "Current plan" for someone with no account is untrue. */
  current: string | null;
  expiresAt: number | null;
  autoRenew: boolean;
  /** The "Renew automatically" choice above the cards — what buying this card would set up. */
  renewing: boolean;
  onBuy: () => void;
}) {
  const isFree = plan.id === 'free';
  const isCurrent = current === plan.id;
  const comingSoon = Boolean(plan.comingSoon);
  // Offering "Get Pro" to someone already on Pro is the bug this replaces.
  const label = isCurrent
    ? 'Your plan'
    : comingSoon
      ? 'Coming soon'
      : current !== null && RANK[plan.id] < RANK[current]
        ? `Switch to ${plan.name}`
        : // On a phone the Free plan's button sends the link on rather than opening a store that cannot install.
          isFree && onPhoneOrTablet()
          ? 'Send the link to my computer'
          : plan.cta;
  const monthly = perMonth(plan, period);
  const saving = annualSavingPercent(plan, currency);

  return (
    <article
      className={`fsw-plan${plan.featured ? ' is-featured' : ''}${isCurrent ? ' is-current' : ''}`}
      data-reveal
      // The four plans arrive left to right, a beat apart, so the eye reads them in order.
      style={{ '--fsw-reveal-delay': `${order * 80}ms` } as CSSProperties}
    >
      {isCurrent ? <span className="fsw-plan-flag is-current">Current plan</span> : plan.featured && <span className="fsw-plan-flag">Most popular</span>}
      {/* The plan we recommend twinkles, from its outline so nothing lands on the price. Not once it is yours. */}
      {plan.featured && !isCurrent && <Sparkle from="edge" rate={7} />}
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
          ? `${autoRenew ? 'Renews' : 'Runs until'} ${new Date(expiresAt).toLocaleDateString()}`
          : isFree
            ? 'No card, no expiry'
            : period === 'annual'
              ? `${formatAmount(plan.price.annual, currency)} billed once a year · save ${saving}%`
              : `${formatAmount(plan.price.monthly, currency)} billed every month`}
      </p>
      {/* The renewal term said on the card itself, where the price is read — not only in a checkbox above.
          The line is there on every card, empty where it does not apply, so the four buttons line up. */}
      <p className="fsw-plan-renews">
        {!isFree && !isCurrent && !comingSoon && (renewing ? `Renews ${period === 'annual' ? 'yearly' : 'monthly'} · cancel anytime` : 'One payment · does not renew')}
      </p>

      <button
        type="button"
        className={`fsw-btn ${plan.featured && !isCurrent ? 'fsw-btn-primary' : 'fsw-btn-outline'} fsw-btn-block`}
        disabled={busy || isCurrent || comingSoon}
        onClick={comingSoon ? undefined : onBuy}
      >
        {busy ? 'Opening payment…' : label}
      </button>
      {/* Buying the same plan again is a renewal, not a mistake — but it should be a deliberate choice. */}
      {isCurrent && !isFree && !autoRenew && !comingSoon && (
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
