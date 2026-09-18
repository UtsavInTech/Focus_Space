import type { Amount } from './plans';

export { CREDIT_COSTS, PLANS } from './plans';

/**
 * "$3.49 / ₹299" — both currencies at once, for places that are explaining the
 * price rather than selling it (the site guide, comparison copy). The pricing
 * cards themselves show one currency at a time, chosen by the visitor.
 */
export function formatAmountless(amount: Amount): string {
  if (!amount.usd && !amount.inr) return 'Free';
  const usd = Math.round(amount.usd * 100) % 100 === 0 ? `$${amount.usd.toFixed(0)}` : `$${amount.usd.toFixed(2)}`;
  return `${usd} / ₹${amount.inr.toLocaleString('en-IN')}`;
}
