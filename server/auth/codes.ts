import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * One-time verification codes (email sign-up, phone sign-in).
 *
 * Never stored in plaintext: only an HMAC of the code, keyed by the server's
 * AUTH_TOKEN_SECRET — a six-digit space is small enough that a plain hash in a
 * leaked database would be trivially reversible, while an HMAC is useless
 * without the secret. Expiry and attempt limits live with the row that stores
 * the hash (server/auth/db.ts), and the policy that uses them is in service.ts,
 * exactly like passwords.ts/tokens.ts split hashing from policy today.
 */

export const CODE_TTL_MS = 10 * 60 * 1000;
/** Wrong guesses allowed per issued code before it is burned and a new one must be requested. */
export const MAX_CODE_ATTEMPTS = 5;
/** How long the ticket proving "this email was just verified" stays valid while the learner picks a password. */
export const SIGNUP_TICKET_TTL_MS = 15 * 60 * 1000;

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashCode(code: string, secret: string): string {
  return createHmac('sha256', secret).update(code).digest('base64url');
}

/** Timing-safe comparison — never short-circuits on the first differing byte. */
export function codeMatches(code: string, storedHash: string, secret: string): boolean {
  const candidate = Buffer.from(hashCode(code, secret));
  const expected = Buffer.from(storedHash);
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
