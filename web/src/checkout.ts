import * as api from './api';
import type { BillingPeriod, CurrencyCode, PlanId } from './content/plans';

/**
 * Razorpay checkout, from the website.
 *
 * The flow, and why each step exists:
 *   1. ask our API for an order — the *server* prices it, so nothing the
 *      browser sends can change what is charged;
 *   2. open Razorpay's own sheet, which is where card and UPI details are
 *      typed. They never touch our page or our servers;
 *   3. hand the signed result back to our API, which verifies the signature
 *      before granting anything.
 *
 * Razorpay's webhook does step 3 as well, independently. That redundancy is
 * deliberate: if the browser is closed at the wrong moment the webhook still
 * grants the plan, and the payment id makes the two idempotent.
 */

const SDK_URL = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: { email?: string };
  theme?: { color?: string };
  handler: (response: RazorpayResponse) => void;
  modal?: { ondismiss?: () => void };
}

type RazorpayCtor = new (options: RazorpayOptions) => { open: () => void };

let sdk: Promise<RazorpayCtor> | null = null;

/** Loaded on demand, not on every page view — most visitors never reach checkout. */
function loadSdk(): Promise<RazorpayCtor> {
  if (sdk) return sdk;
  sdk = new Promise((resolve, reject) => {
    const existing = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.onload = () => {
      const ctor = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
      if (ctor) resolve(ctor);
      else reject(new Error('Could not load the payment form. Try again.'));
    };
    script.onerror = () => {
      sdk = null; // let a later attempt retry rather than failing forever
      reject(new Error('Could not reach the payment provider. Check your connection.'));
    };
    document.head.appendChild(script);
  });
  return sdk;
}

export interface CheckoutResult {
  plan: PlanId;
  expiresAt: number;
}

export interface CheckoutInput {
  planId: PlanId;
  period: BillingPeriod;
  currency: CurrencyCode;
  token: string;
  email?: string | null;
}

export class CheckoutCancelled extends Error {
  constructor() {
    super('Payment cancelled.');
    this.name = 'CheckoutCancelled';
  }
}

export async function startCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const session = await api.startCheckout(input.token, { planId: input.planId, period: input.period, currency: input.currency });
  const Razorpay = await loadSdk();

  return new Promise<CheckoutResult>((resolve, reject) => {
    let settled = false;

    const checkout = new Razorpay({
      key: session.keyId,
      amount: session.amountMinor,
      currency: session.currency,
      name: 'FocusSpace',
      description: session.description,
      order_id: session.orderId,
      prefill: input.email ? { email: input.email } : undefined,
      theme: { color: '#6d5dfc' },
      handler: (response) => {
        settled = true;
        api
          .confirmPayment(input.token, {
            orderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
            planId: input.planId,
            period: input.period,
            currency: input.currency,
          })
          .then((grant) => resolve({ plan: grant.plan, expiresAt: grant.expiresAt }))
          // The money is taken by this point, and the webhook will still grant the
          // plan — so this says "we will sort it out", never "payment failed".
          .catch(() => reject(new Error('Payment went through, but confirming it here failed. Refresh in a moment — it will appear.')));
      },
      modal: {
        ondismiss: () => {
          if (!settled) reject(new CheckoutCancelled());
        },
      },
    });

    checkout.open();
  });
}
