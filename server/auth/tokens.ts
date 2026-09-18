import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

/**
 * Access tokens: short-lived, signed (HMAC-SHA256), and — deliberately —
 * still checked against the session record by the caller (see
 * verifyAccessToken's `sid`), so revocation (docs §L) is real rather than
 * "wait for the JWT to expire". This file only proves the signature and
 * expiry; the session-table lookup happens in service.ts.
 *
 * Refresh tokens: opaque random values. The raw value is only ever seen by
 * the client — this file's `hashRefreshToken` is what actually gets stored.
 */

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * How long after a rotation the *previous* refresh token is still tolerated as a benign retry/race
 * (two near-simultaneous legitimate refresh calls, e.g. from two tabs, or a client retrying after a
 * slow response) rather than treated as theft. See service.ts's `refresh()` — this is what keeps a
 * genuine race from destroying a perfectly valid session, while reuse well outside this window still
 * revokes it.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

export interface AccessTokenPayload {
  sub: string; // user id
  sid: string; // session id
  exp: number; // epoch ms
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function signAccessToken(payload: AccessTokenPayload, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

/** Returns the payload only if the signature is valid and it hasn't expired — never throws on bad input. */
export function verifyAccessToken(token: string, secret: string, now = Date.now()): AccessTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  const expected = sign(body, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<AccessTokenPayload>;
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp <= now) return null;
    return { sub: payload.sub, sid: payload.sid, exp: payload.exp };
  } catch {
    return null;
  }
}

/** 32 random bytes, base64url — high entropy, opaque (carries no information itself, unlike the access token). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What actually gets stored — the raw refresh token is never persisted server-side, same principle as password hashing. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
