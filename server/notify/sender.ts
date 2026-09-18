/**
 * Delivery of verification codes — email and SMS — behind one tiny interface.
 *
 * No provider is bundled: FocusSpace's own server is the only place a provider
 * credential may ever live (never the extension), and this project has no
 * email/SMS account configured. So the default is an honest development sender
 * that prints the code to the server's console and says so, rather than a UI
 * that pretends a message was sent.
 *
 * Adding a real provider later is one file implementing `Sender` and one line
 * in `loadSenders()` — no route, service or client change.
 *
 *   AUTH_DEV_CODES=1   also returns the code in the API response, so local
 *                      development and the test suite can complete a real
 *                      verification round-trip. Refused when NODE_ENV is
 *                      'production' — a production server must deliver codes
 *                      for real, never hand them back to the caller.
 */

export type Channel = 'email' | 'phone';

export interface Sender {
  /** How this sender identifies itself in logs and in the API's `delivery` field. */
  readonly id: string;
  send(target: string, code: string): Promise<void>;
}

export interface Senders {
  email: Sender;
  phone: Sender;
  /** True when the code may be echoed back to the caller (development only). */
  exposeCodes: boolean;
}

/** Logs the code locally. The learner sees "check your email"; the developer reads it here. */
function consoleSender(channel: Channel): Sender {
  return {
    id: 'console',
    async send(target, code) {
      console.log(`[FocusSpace API] ${channel} verification code for ${target}: ${code} (development sender — no ${channel === 'email' ? 'email' : 'SMS'} provider configured)`);
    },
  };
}

export function loadSenders(env: NodeJS.ProcessEnv = process.env): Senders {
  // Real providers plug in here, e.g.:
  //   const email = env.RESEND_API_KEY ? resendSender(env.RESEND_API_KEY) : consoleSender('email');
  const exposeCodes = env.AUTH_DEV_CODES === '1' && env.NODE_ENV !== 'production';
  if (env.AUTH_DEV_CODES === '1' && env.NODE_ENV === 'production') {
    console.warn('[FocusSpace API] AUTH_DEV_CODES is ignored in production — verification codes are never returned to callers there.');
  }
  return { email: consoleSender('email'), phone: consoleSender('phone'), exposeCodes };
}

/** What the API tells the client about how a code was delivered — never the code itself unless `exposeCodes`. */
export interface DeliveryInfo {
  /** 'console' until a real provider is configured; the client shows a development hint for it. */
  delivery: string;
  devCode?: string;
}

export async function deliverCode(senders: Senders, channel: Channel, target: string, code: string): Promise<DeliveryInfo> {
  const sender = senders[channel];
  await sender.send(target, code);
  return { delivery: sender.id, ...(senders.exposeCodes ? { devCode: code } : {}) };
}
