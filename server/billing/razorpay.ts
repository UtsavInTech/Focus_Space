import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../http';

/**
 * Razorpay, over plain HTTP — no SDK, matching how `openrouter.ts` and the
 * Resend sender already work. Razorpay's REST API is small enough that a
 * dependency would add supply-chain risk without adding capability.
 *
 * Two things live here and nowhere else: creating an order, and proving that
 * a payment really happened. Everything about *what* a payment entitles
 * someone to is in service.ts.
 */

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  /** Set in the Razorpay dashboard when the webhook is created. */
  webhookSecret: string;
  /** True while the account is on test keys — surfaced to the client so the UI can say so. */
  test: boolean;
}

/**
 * Returns null when Razorpay is not configured. Deliberately not a throw:
 * the rest of the API — the AI routes, accounts, usage — must keep working on
 * a deployment that has no payment provider yet, which is exactly the state
 * this project is in while Razorpay verifies the website.
 */
export function loadRazorpayConfig(env: NodeJS.ProcessEnv = process.env): RazorpayConfig | null {
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return {
    keyId,
    keySecret,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? '',
    // Razorpay's own convention: test keys are prefixed rzp_test_.
    test: keyId.startsWith('rzp_test_'),
  };
}

const API = 'https://api.razorpay.com/v1';

const authHeader = (config: RazorpayConfig) => `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`;

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

/**
 * `amount` is in the currency's smallest unit — paise for INR, cents for USD.
 * Razorpay has no notion of rupees, and passing 299 instead of 29900 charges
 * ₹2.99, so the conversion happens once, here, and never in a caller.
 */
export async function createOrder(config: RazorpayConfig, input: { amountMinor: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<RazorpayOrder> {
  const res = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: { Authorization: authHeader(config), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
      // The payment is only worth anything to us once captured; auto-capture
      // removes a whole class of "paid but never captured" support tickets.
      payment_capture: 1,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ApiError(502, 'upstream_error', `Razorpay could not start the payment. ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as RazorpayOrder;
}

/** Constant-time compare, so a signature check cannot be probed byte by byte. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The client hands back `{ order_id, payment_id, signature }` after Razorpay's
 * checkout closes. The signature is HMAC-SHA256 of "order_id|payment_id" with
 * the key secret — the only proof that the payment is real and was not typed
 * into the address bar.
 */
export function verifyPaymentSignature(config: RazorpayConfig, orderId: string, paymentId: string, signature: string): boolean {
  const expected = createHmac('sha256', config.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, signature);
}

/**
 * Webhooks are signed with a *different* secret — the one set when the webhook
 * is created — over the raw request body. The body must be the exact bytes
 * received: re-serialising the parsed JSON changes whitespace and key order and
 * the signature stops matching.
 */
export function verifyWebhookSignature(config: RazorpayConfig, rawBody: string, signature: string): boolean {
  if (!config.webhookSecret) return false;
  const expected = createHmac('sha256', config.webhookSecret).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}
