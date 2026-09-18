import type { Amount, CurrencyCode } from './content/plans';

/**
 * USD is the headline price for everyone. INR is shown **in addition**, to
 * visitors we can reasonably believe are in India, because that is what
 * Razorpay will actually charge them — a price page that says "$3.49" and then
 * bills ₹299 without warning is the kind of surprise that causes chargebacks.
 *
 * Detection is a hint, never a gate: the visitor can switch currency manually,
 * and the choice is remembered. We deliberately do not geolocate by IP — it
 * needs a request before the page can render a price, and the timezone the
 * browser already reports is both free and good enough to pick a *default*.
 */

const INDIA_TIMEZONES = ['Asia/Kolkata', 'Asia/Calcutta'];
const STORAGE_KEY = 'fs.currency';

function detectedCurrency(): CurrencyCode {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && INDIA_TIMEZONES.includes(tz)) return 'INR';
  } catch {
    /* Intl can throw in exotic environments — fall through to the language check. */
  }
  try {
    if (navigator.language?.toLowerCase().endsWith('-in')) return 'INR';
  } catch {
    /* ignore */
  }
  return 'USD';
}

/** The visitor's remembered choice, or our best guess. Never throws. */
export function initialCurrency(): CurrencyCode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'USD' || saved === 'INR') return saved;
  } catch {
    /* Private windows and blocked site data both throw here; the guess is still fine. */
  }
  return detectedCurrency();
}

export function rememberCurrency(currency: CurrencyCode): void {
  try {
    localStorage.setItem(STORAGE_KEY, currency);
  } catch {
    /* A remembered preference is a convenience, never a requirement. */
  }
}

/** True when the visitor looks Indian-resident, i.e. Razorpay will charge INR. */
export const looksIndian = (): boolean => detectedCurrency() === 'INR';

const SYMBOL: Record<CurrencyCode, string> = { USD: '$', INR: '₹' };

/**
 * Money, formatted the way each currency is normally written: USD keeps cents
 * when it has them ($3.49, but $75), INR is always whole rupees with Indian
 * digit grouping (₹1,999 — not ₹1,999.00 and not ₹1999).
 */
export function formatAmount(amount: Amount, currency: CurrencyCode): string {
  const value = currency === 'INR' ? amount.inr : amount.usd;
  if (!value) return 'Free';
  if (currency === 'INR') return `${SYMBOL.INR}${Math.round(value).toLocaleString('en-IN')}`;
  const hasCents = Math.round(value * 100) % 100 !== 0;
  return `${SYMBOL.USD}${value.toFixed(hasCents ? 2 : 0)}`;
}
