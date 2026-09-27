import { describe, expect, it } from 'vitest';
import { loadReceiptMailer, receiptText } from './receipt-email';

const payment = { id: 'pay_1', user_id: 'u', order_id: 'o', plan: 'pro', period: 'monthly', currency: 'INR', amount_minor: 19967, status: 'captured', created_at: Date.UTC(2026, 8, 27), credit_minor: 9933, credit_note: 'Unused Plus time' };

describe('receipt email', () => {
  it('states the plan, the price, the credit, what was paid, and where the full receipt is', () => {
    const { subject, text } = receiptText(payment, 'https://focusspace.xyz/');
    expect(subject).toBe('Your FocusSpace receipt: Pro, ₹199.67');
    expect(text).toContain('Plan: Pro, 1 month');
    expect(text).toContain('Price: ₹299');
    expect(text).toContain('Unused Plus time: -₹99.33');
    expect(text).toContain('Payment ID: pay_1');
    expect(text).toContain('https://focusspace.xyz/account');
    expect(text).toContain('Your payment was successful');
    expect(text).toContain('invoice issued by Razorpay');
    expect(text).toContain('utsav.udk@gmail.com');
    expect(receiptText({ ...payment, plan: 'basic', period: 'lifetime', amount_minor: 9900, credit_minor: 0 }, 'https://focusspace.xyz').text).toContain('Plan: Basic, for life');
  });

  it('is off without a real sender, rather than sending from an address buyers never receive', () => {
    expect(loadReceiptMailer({ RESEND_API_KEY: 'k' })).toBeNull();
    expect(loadReceiptMailer({ MAIL_FROM: 'a@b.c' })).toBeNull();
    expect(loadReceiptMailer({ RESEND_API_KEY: 'k', MAIL_FROM: 'billing@focusspace.xyz' })).toBeTypeOf('function');
  });
});
