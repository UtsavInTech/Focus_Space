import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutInput } from './checkout';

const api = vi.hoisted(() => ({
  startCheckout: vi.fn(), startSubscription: vi.fn(), confirmPayment: vi.fn(), confirmSubscription: vi.fn(),
}));
vi.mock('./api', () => api);

interface ProviderResponse {
  razorpay_order_id?: string;
  razorpay_subscription_id?: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface ProviderOptions {
  key: string;
  order_id?: string;
  subscription_id?: string;
  amount?: number;
  currency?: string;
  handler: (response: ProviderResponse) => void;
  modal: { ondismiss: () => void };
}
let options: ProviderOptions | undefined;
const response: ProviderResponse = { razorpay_order_id: 'order_server', razorpay_payment_id: 'pay_test', razorpay_signature: 'signed_test_response' };
const input: CheckoutInput = { planId: 'pro', period: 'monthly', currency: 'INR', token: 'local-test-token', renewing: false };
const grant = { ok: true, plan: 'pro', expiresAt: 2000000000000, autoRenew: false };
const provider = vi.fn(function (opts: ProviderOptions) {
  options = opts;
  return { open: vi.fn() };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  options = undefined;
  vi.stubGlobal('window', { Razorpay: provider });
  api.startCheckout.mockResolvedValue({ keyId: 'rzp_test_local', orderId: 'order_server', amountMinor: 29900, currency: 'INR', description: 'Pro monthly' });
  api.startSubscription.mockResolvedValue({ keyId: 'rzp_test_local', subscriptionId: 'sub_server', description: 'Pro recurring' });
  api.confirmPayment.mockResolvedValue(grant);
  api.confirmSubscription.mockResolvedValue({ ...grant, autoRenew: true });
});
afterEach(() => vi.unstubAllGlobals());

async function begin(overrides: Partial<CheckoutInput> = {}) {
  const { startCheckout } = await import('./checkout');
  const result = startCheckout({ ...input, ...overrides });
  await vi.waitFor(() => expect(options).toBeDefined());
  return { result };
}

describe('website checkout, without making any external payment', () => {
  it('uses the server amount and verifies the one-off response before returning success', async () => {
    const { result } = await begin();
    expect(options).toMatchObject({ key: 'rzp_test_local', order_id: 'order_server', amount: 29900, currency: 'INR' });
    options!.handler(response);
    expect(api.confirmPayment).toHaveBeenCalledWith(input.token, {
      orderId: 'order_server', paymentId: 'pay_test', signature: 'signed_test_response', planId: 'pro', period: 'monthly', currency: 'INR',
    });
    await expect(result).resolves.toEqual({ plan: 'pro', expiresAt: grant.expiresAt, autoRenew: false });
  });

  it('confirms renewing subscriptions through the subscription endpoint', async () => {
    const { result } = await begin({ renewing: true, period: 'annual' });
    expect(options).toMatchObject({ subscription_id: 'sub_server' });
    expect(options).not.toHaveProperty('amount');
    options!.handler({ ...response, razorpay_subscription_id: 'sub_server' });
    expect(api.confirmSubscription).toHaveBeenCalledWith(input.token, {
      subscriptionId: 'sub_server', paymentId: 'pay_test', signature: 'signed_test_response', planId: 'pro', period: 'annual', currency: 'INR',
    });
    expect(api.confirmPayment).not.toHaveBeenCalled();
    await expect(result).resolves.toMatchObject({ plan: 'pro', autoRenew: true });
  });

  it('keeps Basic lifetime purchases as one-off payments with no expiry', async () => {
    api.confirmPayment.mockResolvedValue({ ...grant, plan: 'basic', expiresAt: null });
    const { result } = await begin({ planId: 'basic', period: 'lifetime' });
    options!.handler(response);
    await expect(result).resolves.toEqual({ plan: 'basic', expiresAt: null, autoRenew: false });
    expect(api.startSubscription).not.toHaveBeenCalled();
  });

  it('treats closing checkout as cancellation and never confirms a payment', async () => {
    const { result } = await begin();
    options!.modal.ondismiss();
    await expect(result).rejects.toMatchObject({ name: 'CheckoutCancelled' });
    expect(api.confirmPayment).not.toHaveBeenCalled();
  });

  it('does not let modal dismissal overwrite a successful provider callback being verified', async () => {
    let confirm!: (value: typeof grant) => void;
    api.confirmPayment.mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
    const { result } = await begin();
    options!.handler(response);
    options!.modal.ondismiss();
    confirm(grant);
    await expect(result).resolves.toMatchObject({ plan: 'pro' });
  });

  it('verifies duplicate provider callbacks only once', async () => {
    const { result } = await begin();
    options!.handler(response);
    options!.handler(response);
    await result;
    expect(api.confirmPayment).toHaveBeenCalledTimes(1);
  });

  it('never reports success when server confirmation fails', async () => {
    api.confirmPayment.mockRejectedValue(new Error('network unavailable'));
    const { result } = await begin();
    options!.handler(response);
    await expect(result).rejects.toThrow('Payment went through, but confirming it here failed');
  });

  it('allows checkout to retry when the provider script loaded without exposing its SDK', async () => {
    const fakeWindow: { Razorpay?: typeof provider } = {};
    const script = { src: '', onload: () => {}, onerror: () => {}, remove: vi.fn() };
    const appendChild = vi.fn();
    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('document', { createElement: () => script, head: { appendChild } });
    const { startCheckout } = await import('./checkout');
    const failed = startCheckout(input);
    await vi.waitFor(() => expect(appendChild).toHaveBeenCalledTimes(1));
    script.onload();
    await expect(failed).rejects.toThrow('Could not load the payment form');
    expect(script.remove).toHaveBeenCalled();
    fakeWindow.Razorpay = provider;
    const { result } = await begin();
    options!.handler(response);
    await expect(result).resolves.toMatchObject({ plan: 'pro' });
  });
});
