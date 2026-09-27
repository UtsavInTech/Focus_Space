import { PLANS, currentPlanId } from '@/billing/plans';
import type { PaymentRow } from '../usage/db';

/**
 * "Payment received": sent the moment a payment is applied, so every buyer has a receipt in their inbox as
 * well as on their account page (server/billing/receipt.ts). Plain text, through Resend, from `MAIL_FROM`.
 *
 * A receipt that cannot be sent never fails the purchase: the plan is already granted, the receipt is still
 * on the account page, and the failure is logged.
 */

/** Where a buyer writes for the invoice Razorpay issues, or anything about a charge (the website's contact address). */
export const BILLING_CONTACT = 'utsav.udk@gmail.com';

export type ReceiptMailer = (to: string, payment: PaymentRow) => Promise<void>;

const money = (amountMinor: number, currency: string): string => {
  const value = amountMinor / 100;
  return currency === 'INR' ? `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : `$${value.toFixed(2)}`;
};

export function receiptText(payment: PaymentRow, siteUrl: string, contact = BILLING_CONTACT): { subject: string; text: string } {
  const plan = PLANS.find((p) => p.id === currentPlanId(payment.plan))?.name ?? payment.plan;
  const term = payment.period === 'lifetime' ? 'for life' : payment.period === 'annual' ? '12 months' : '1 month';
  const credit = payment.credit_minor ?? 0;
  const date = new Date(payment.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const lines = [
    `Your payment was successful. Thank you for buying FocusSpace ${plan}.`,
    '',
    `Plan: ${plan}, ${term}`,
    ...(credit ? [`Price: ${money(payment.amount_minor + credit, payment.currency)}`, `${payment.credit_note ?? 'Credit'}: -${money(credit, payment.currency)}`] : []),
    `Paid: ${money(payment.amount_minor, payment.currency)}`,
    `Date: ${date}`,
    `Payment ID: ${payment.id}`,
    '',
    `Your full receipt, to print or save, is on your account page: ${siteUrl.replace(/\/+$/, '')}/account`,
    '',
    'This receipt was generated automatically by FocusSpace.',
    `If you need the invoice issued by Razorpay, or have any question about this payment, email ${contact} with the payment ID above and we will send it to you.`,
  ];
  return { subject: `Your FocusSpace receipt: ${plan}, ${money(payment.amount_minor, payment.currency)}`, text: lines.join('\n') };
}

/** Null when no real sender is configured: Resend's shared sender reaches only the account owner, so buyers would get nothing. */
export function loadReceiptMailer(env: NodeJS.ProcessEnv = process.env): ReceiptMailer | null {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM;
  if (!apiKey || !from) return null;
  const siteUrl = env.SITE_URL || 'https://focusspace.xyz';
  return async (to, payment) => {
    const { subject, text } = receiptText(payment, siteUrl, env.BILLING_CONTACT || BILLING_CONTACT);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      // Replies go to a person, whatever address the mail was sent from.
      body: JSON.stringify({ from, to, subject, text, reply_to: env.BILLING_CONTACT || BILLING_CONTACT }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Resend rejected the receipt (HTTP ${res.status}). ${(await res.text().catch(() => '')).slice(0, 200)}`);
  };
}
