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
  /** Null when no SMS provider can deliver a code — phone sign-in is then refused, not faked. */
  phone: Sender | null;
  /** True when the code may be echoed back to the caller (development only). */
  exposeCodes: boolean;
}

/**
 * Email through Resend — one HTTP call, no SDK, no dependency added to a
 * server that currently has none. Chosen because it needs exactly one secret
 * and nothing else to work.
 *
 * A send that fails throws, and the route turns that into an honest error:
 * telling someone to check their inbox for a mail that was never sent is the
 * one outcome worse than showing them a failure.
 */
function resendSender(apiKey: string, from: string): Sender {
  return {
    id: 'resend',
    async send(target, code) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: target,
          subject: `${code} is your FocusSpace code`,
          // Plain text, deliberately: a verification mail has one job, and a plain-text
          // one is far less likely to be filtered on the way to a new account's inbox.
          text: [`Your FocusSpace verification code is ${code}.`, '', 'It expires shortly. If you did not ask for it, you can ignore this email.'].join('\n'),
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Resend rejected the verification email (HTTP ${res.status}). ${detail.slice(0, 200)}`);
      }
    },
  };
}

/** Logs the code locally. The learner sees "check your email"; the developer reads it here. */
function consoleSender(channel: Channel): Sender {
  return {
    id: 'console',
    async send(target, code) {
      console.log(`[FocusSpace API] ${channel} verification code for ${target}: ${code} (development sender, no ${channel === 'email' ? 'email' : 'SMS'} provider configured)`);
    },
  };
}

/** Resend's shared sandbox sender. It only delivers to the account owner's own address — fine for a first deploy, useless for real sign-ups. */
const RESEND_FALLBACK_FROM = 'FocusSpace <onboarding@resend.dev>';

export function loadSenders(env: NodeJS.ProcessEnv = process.env): Senders {
  const email = env.RESEND_API_KEY ? resendSender(env.RESEND_API_KEY, env.MAIL_FROM || RESEND_FALLBACK_FROM) : consoleSender('email');
  if (!env.RESEND_API_KEY && env.NODE_ENV === 'production') {
    // Loud, because a production server with no mail provider cannot complete a single sign-up:
    // the code is written to a log the learner will never read.
    console.error('[FocusSpace API] No RESEND_API_KEY in production, email verification codes cannot be delivered and sign-up will not work.');
  }
  if (env.RESEND_API_KEY && !env.MAIL_FROM) {
    console.warn(`[FocusSpace API] MAIL_FROM is unset, sending as ${RESEND_FALLBACK_FROM}, which Resend only delivers to your own address. Set MAIL_FROM to an address on a domain you have verified.`);
  }

  const exposeCodes = env.AUTH_DEV_CODES === '1' && env.NODE_ENV !== 'production';
  if (env.AUTH_DEV_CODES === '1' && env.NODE_ENV === 'production') {
    console.warn('[FocusSpace API] AUTH_DEV_CODES is ignored in production, verification codes are never returned to callers there.');
  }
  // There is no SMS provider. In development the console sender stands in; in production a phone code
  // would only ever reach the server log, so phone sign-in is switched off rather than left to fail.
  const phone = env.NODE_ENV === 'production' ? null : consoleSender('phone');
  return { email, phone, exposeCodes };
}

/** What the API tells the client about how a code was delivered — never the code itself unless `exposeCodes`. */
export interface DeliveryInfo {
  /** 'console' until a real provider is configured; the client shows a development hint for it. */
  delivery: string;
  devCode?: string;
}

export async function deliverCode(senders: Senders, channel: Channel, target: string, code: string): Promise<DeliveryInfo> {
  const sender = senders[channel];
  if (!sender) throw new Error(`No ${channel} sender is configured.`); // callers refuse before issuing a code; this is the backstop
  await sender.send(target, code);
  return { delivery: sender.id, ...(senders.exposeCodes ? { devCode: code } : {}) };
}
