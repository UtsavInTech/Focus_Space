import { hasStoreListing, installHref, onPhoneOrTablet, sendLinkToComputer } from '../install';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { navigate, onLinkClick } from '../router';
import { useAuth } from '../auth';
import { Sparkle } from './Sparkle';
import { CheckoutCancelled, startCheckout } from '../checkout';
import { formatAmount, looksIndian } from '../currency';
import * as api from '../api';
import { ANNUAL_DISCOUNT_LABEL, CREDIT_COSTS, FREE_DAILY_AI_CREDITS, FREE_SPACE_LIMIT, PLAN_RANK, PLANS, annualSavingPercent, perMonth } from '../content/plans';
import type { CurrencyCode, Plan, RecurringPeriod } from '../content/plans';
import { INSTITUTE_LINK, INSTITUTE_PILOT_STRIP } from '../content/institutes';

interface Props {
  currency: CurrencyCode;
  onCurrency: (currency: CurrencyCode) => void;
  /** The home page shows the cards without the credit table underneath. */
  compact?: boolean;
  showCredits?: boolean;
}

export function PricingSection({ currency, onCurrency, compact, showCredits }: Props) {
  const auth = useAuth();
  // Monthly first: the price people compare is the monthly one, and a yearly per-month figure next to it misleads.
  const [period, setPeriod] = useState<RecurringPeriod>('monthly');
  /** What this account would pay today for each plan (upgrade credit, the Basic offer). Visitors see list prices. */
  const [prices, setPrices] = useState<api.QuoteOrRefusal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Set once a payment is confirmed: a plain thank-you with the way back to YouTube, not a note under the cards. */
  const [purchased, setPurchased] = useState<string | null>(null);
  const purchasedRef = useRef<HTMLDivElement>(null);
  /**
   * Renewing by default, because a plan that lapses silently is worse for
   * everyone — but it is a visible choice, not something done to people.
   */
  const [renewing, setRenewing] = useState(true);

  /**
   * Buying requires an account, because a payment has to attach to one. Rather
   * than refusing, send them to sign in — they come back to this page.
   */
  useEffect(() => {
    let alive = true;
    if (!auth.user) return setPrices([]);
    void auth
      .token()
      .then((token) => (token ? api.quotes(token, currency) : null))
      .then((res) => alive && setPrices(res?.quotes ?? []))
      .catch(() => alive && setPrices([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user, auth.plan, auth.lifetimePlan, currency]);

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
      navigate('/signin?next=%2Fpricing');
      return;
    }
    setBusy(plan.id);
    setMessage(null);
    setPurchased(null);
    try {
      const token = await auth.token();
      if (!token) {
        navigate('/signin?next=%2Fpricing');
        return;
      }
      const lifetime = !!plan.oneTime;
      const result = await startCheckout({ planId: plan.id, period: lifetime ? 'lifetime' : period, currency, token, email: auth.user.email, renewing: !lifetime && renewing });
      // Re-read from the server rather than trusting what checkout just told us.
      await auth.reload();
      setPurchased(
        lifetime
          ? `${plan.name} is yours for life.`
          : result.autoRenew && result.expiresAt
            ? `You're on ${plan.name}. It renews automatically on ${new Date(result.expiresAt).toLocaleDateString()}, cancel any time.`
            : `You're on ${plan.name}${result.expiresAt ? ` until ${new Date(result.expiresAt).toLocaleDateString()}` : ''}. It will not renew by itself.`,
      );
    } catch (err) {
      // Closing the payment sheet is a decision, not an error worth shouting about.
      if (!(err instanceof CheckoutCancelled)) setMessage(err instanceof Error ? err.message : 'Could not start the payment.');
    } finally {
      setBusy(null);
    }
  }

  // Bring the thank-you into view: the payment sheet closes wherever the page happened to be scrolled.
  useEffect(() => {
    if (purchased) purchasedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [purchased]);

  return (
    <section className="fsw-section fsw-pricing" id="pricing">
      {purchased && (
        <div className="fsw-purchased" role="status" ref={purchasedRef}>
          <div>
            <strong>Payment received. Thank you!</strong>
            <p>{purchased}</p>
          </div>
          <a className="fsw-btn fsw-btn-primary" href="https://www.youtube.com/" target="_blank" rel="noreferrer">
            Open YouTube
          </a>
        </div>
      )}

      {compact && (
        <div className="fsw-section-head" data-reveal>
          <h2>Free where it can be, paid where it costs us</h2>
          <p>Modes, ranking, the learning path and the knowledge map run on your machine and stay free.</p>
        </div>
      )}

      <div className="fsw-pricing-controls">
        <div className="fsw-switch" role="group" aria-label="Billing period">
          {(['monthly', 'annual'] as RecurringPeriod[]).map((p) => (
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
        {PLANS.filter((plan) => !plan.unlisted).map((plan, i) => (
          <PlanCard
            key={plan.id}
            order={i}
            plan={plan}
            period={period}
            currency={currency}
            compact={compact}
            busy={busy === plan.id}
            current={auth.user ? auth.plan : null}
            ownedForLife={auth.user ? auth.lifetimePlan === plan.id : false}
            expiresAt={auth.planExpiresAt}
            autoRenew={auth.autoRenew}
            renewing={renewing}
            price={prices.find((q) => q.planId === plan.id && q.period === (plan.oneTime ? 'lifetime' : period)) ?? null}
            onBuy={() => void buy(plan)}
          />
        ))}
      </div>

      <a className="fsw-institute-pilot-strip" href={INSTITUTE_LINK.to} onClick={onLinkClick(INSTITUTE_LINK.to)}>{INSTITUTE_PILOT_STRIP}<span aria-hidden="true">↗</span></a>

      <p className="fsw-pricing-note">
        Not ready to pay? A free account keeps {FREE_SPACE_LIMIT} Spaces with {FREE_DAILY_AI_CREDITS} AI credits a day. Moving up later, you only pay the difference.
      </p>

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
            One credit is one AI request, weighted by how much work it is. Watching a video never costs a credit.
            Nothing is spent until you click.
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

function PlanCard({
  plan,
  period,
  currency,
  compact,
  busy,
  current,
  ownedForLife,
  expiresAt,
  autoRenew,
  renewing,
  price,
  onBuy,
  order,
}: {
  order: number;
  plan: Plan;
  period: RecurringPeriod;
  currency: CurrencyCode;
  compact?: boolean;
  busy?: boolean;
  /** Null for a visitor: `auth.plan` defaults to 'free', and marking a plan "Current" for someone with no account is untrue. */
  current: string | null;
  /** Bought once and kept (Basic), whatever paid plan runs on top of it. */
  ownedForLife: boolean;
  expiresAt: number | null;
  autoRenew: boolean;
  /** The "Renew automatically" choice above the cards — what buying this card would set up. */
  renewing: boolean;
  /** This account's price today, from the server; null for a visitor. */
  price: api.QuoteOrRefusal | null;
  onBuy: () => void;
}) {
  const lifetime = !!plan.oneTime;
  const isCurrent = ownedForLife || (!lifetime && current === plan.id);
  const comingSoon = Boolean(plan.comingSoon);
  const refusal = price && 'error' in price ? price.error : null;
  const credit = price && !('error' in price) && price.creditMinor > 0 ? price : null;
  // ₹149 for Plus is Basic for life plus a first month of Plus — for anyone who doesn't own Basic yet.
  // Visitors see it too: the server's quote, once signed in, says whether it still applies.
  const bundle = plan.id === 'plus' && (price ? !('error' in price) && price.includesBasic : current === null);
  const lower = current !== null && !lifetime && PLAN_RANK[plan.id] < PLAN_RANK[current as keyof typeof PLAN_RANK];
  // Offering "Get Pro" to someone already on Pro is the bug this replaces.
  const label = isCurrent ? (lifetime ? 'Yours for life' : 'Your plan') : comingSoon ? 'Coming soon' : lower ? `Switch to ${plan.name}` : credit ? `${plan.cta} for ${formatAmount({ inr: credit.chargeMinor / 100, usd: credit.chargeMinor / 100 }, currency)}` : plan.cta;
  const shown = lifetime ? plan.oneTime! : perMonth(plan, period);
  const saving = annualSavingPercent(plan, currency);

  return (
    <article
      className={`fsw-plan${plan.featured ? ' is-featured' : ''}${isCurrent ? ' is-current' : ''}`}
      data-reveal
      // The four plans arrive left to right, a beat apart, so the eye reads them in order.
      style={{ '--fsw-reveal-delay': `${order * 80}ms` } as CSSProperties}
    >
      {isCurrent ? <span className="fsw-plan-flag is-current">{lifetime ? 'Yours' : 'Current plan'}</span> : plan.featured ? <span className="fsw-plan-flag">Most popular</span> : lifetime && <span className="fsw-plan-flag">Pay once</span>}
      {/* The plan we recommend twinkles, from its outline so nothing lands on the price. Not once it is yours. */}
      {plan.featured && !isCurrent && <Sparkle from="edge" rate={7} />}
      <h3>{plan.name}</h3>
      <p className="fsw-plan-tagline">{plan.tagline}</p>

      <p className="fsw-plan-price">
        <strong key={`${currency}-${formatAmount(shown, currency)}`} className="fsw-price-amount">{formatAmount(shown, currency)}</strong>
        <span>{lifetime ? ' once' : '/month'}</span>
      </p>

      {/* The annual charge is stated in full. "$2.42/month" with no yearly figure
          anywhere is the pattern that gets pricing pages accused of hiding the number. */}
      <p className="fsw-plan-sub">
        {credit
          ? `${credit.creditNote}: ${formatAmount({ inr: credit.creditMinor / 100, usd: credit.creditMinor / 100 }, currency)} off today`
          : isCurrent && !lifetime && expiresAt
            ? `${autoRenew ? 'Renews' : 'Runs until'} ${new Date(expiresAt).toLocaleDateString()}`
            : lifetime
              ? 'No renewals, no expiry'
              : period === 'annual'
                ? `${formatAmount(plan.price!.annual, currency)} billed once a year · save ${saving}%`
                : `${formatAmount(plan.price!.monthly, currency)} billed every month`}
      </p>
      {/* The renewal term said on the card itself, where the price is read — not only in a checkbox above.
          The line is there on every card, empty where it does not apply, so the four buttons line up. */}
      <p className="fsw-plan-renews">
        {refusal && !isCurrent ? refusal : !isCurrent && !comingSoon && (lifetime ? 'One payment · yours for life' : renewing ? `Renews ${period === 'annual' ? 'yearly' : 'monthly'} · cancel anytime` : 'One payment · does not renew')}
      </p>

      <button
        type="button"
        className={`fsw-btn ${plan.featured && !isCurrent ? 'fsw-btn-primary' : 'fsw-btn-outline'} fsw-btn-block`}
        disabled={busy || isCurrent || comingSoon || !!refusal}
        onClick={comingSoon ? undefined : onBuy}
      >
        {busy ? 'Opening payment…' : label}
      </button>
      {/* Buying the same plan again is a renewal, not a mistake — but it should be a deliberate choice. */}
      {isCurrent && !lifetime && !autoRenew && !comingSoon && (
        <button type="button" className="fsw-link fsw-plan-renew" onClick={onBuy}>
          Extend by another {period === 'annual' ? 'year' : 'month'}
        </button>
      )}

      {bundle && !isCurrent && (
        <p className="fsw-plan-bonus">
          New here? {formatAmount(plan.price!.monthly, currency)} gets you <b>Basic for life</b> ({formatAmount(PLANS.find((p) => p.id === 'basic')!.oneTime!, currency)}) plus your first month of Plus.
        </p>
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
