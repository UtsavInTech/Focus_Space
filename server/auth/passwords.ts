import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing — `scrypt` from Node's built-in `node:crypto` (no new
 * dependency). Per-user random salt; stored as `salt:hash`, both hex. The
 * plaintext password is never stored, logged, or returned anywhere.
 */

const SALT_BYTES = 16;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const hash = scryptSync(password, salt, KEY_LEN).toString('hex');
  return `${salt}:${hash}`;
}

/** Timing-safe: never short-circuits on the first differing byte. */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, KEY_LEN);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
