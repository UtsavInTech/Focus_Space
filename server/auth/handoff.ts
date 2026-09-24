import { randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from '../http';
import type { IdentityDb } from './db';
import { hashRefreshToken } from './tokens';
import type { AuthConfig, AuthResult } from './service';
import { issueSessionFor } from './service';

/**
 * Moving a proven identity between FocusSpace surfaces.
 *
 * There is one FocusSpace account, and three clients of this API: the website, the extension's service
 * worker, and (through it) YouTube. They cannot share a session — the API is cross-origin to all of
 * them, so there is no cookie, and the extension cannot read the website's localStorage. Signing in on
 * focusspace.xyz therefore does nothing for the extension unless something deliberately carries the
 * identity across.
 *
 * That something is a handoff code: a 32-byte random string the server issues to an *already
 * authenticated* caller, stores only as a hash, and accepts exactly once within a minute. Redeeming it
 * mints a brand-new session for the same user.
 *
 * Why a code rather than passing the session itself:
 *
 * - The website never hands the extension a refresh token, so a bug on the site cannot leak long-lived
 *   credentials into another context.
 * - Each surface gets its own session row, so "sign out" on one is not "sign out" on the other, and the
 *   existing rotation/reuse detection (service.ts) keeps working per surface.
 * - A code that leaks is worth nothing a minute later, and nothing at all if it was already redeemed.
 *
 * It is the authorization-code pattern, with FocusSpace as both issuer and consumer. The code itself is
 * never logged, never written to storage on either client, and is used and discarded immediately.
 */

/** Long enough that guessing is hopeless, short enough to sit in a URL fragment for one redirect. */
const CODE_BYTES = 32;

/**
 * One minute. A handoff is always redeemed by a machine, immediately — the only reason it is not
 * seconds is to tolerate a slow network on the redirect that carries it.
 */
export const HANDOFF_TTL_MS = 60_000;

export const generateHandoffCode = (): string => randomBytes(CODE_BYTES).toString('base64url');

/** Reuses the refresh token's hash: same threat (a stolen bearer string), so the same storage rule. */
const hashCode = hashRefreshToken;

/**
 * Issues a code for a user the caller has *already* authenticated. Never call this from an
 * unauthenticated route: possession of a handoff code is possession of the account.
 */
export function createHandoff(db: IdentityDb, userId: string, origin: string, now = Date.now()): { code: string; expiresAt: number } {
  // Cheap, opportunistic housekeeping — expired codes are unredeemable, so there is nothing to keep.
  db.deleteExpiredHandoffs(now - HANDOFF_TTL_MS);
  const code = generateHandoffCode();
  const expiresAt = now + HANDOFF_TTL_MS;
  db.insertHandoff({ id: randomUUID(), code_hash: hashCode(code), user_id: userId, origin, expires_at: expiresAt, consumed_at: null, created_at: now });
  return { code, expiresAt };
}

/**
 * Exchanges a code for a new session. Every failure says the same thing: a code that never existed, one
 * already used and one that expired are indistinguishable to the caller, because the difference is only
 * ever useful to someone guessing.
 */
export function redeemHandoff(db: IdentityDb, config: AuthConfig, code: string, userAgent: string | null, now = Date.now()): AuthResult {
  const invalid = new ApiError(401, 'unauthorized', 'That sign-in link has expired. Start again from FocusSpace.');
  if (typeof code !== 'string' || code.length < 16 || code.length > 128) throw invalid;

  const row = db.findHandoffByCodeHash(hashCode(code));
  if (!row || row.consumed_at !== null || row.expires_at <= now) throw invalid;
  // Single use, decided by the database rather than by the read above — two tabs redeeming at once
  // must not both get a session.
  if (!db.consumeHandoff(row.id, now)) throw invalid;

  const user = db.findUserById(row.user_id);
  if (!user || user.status !== 'active') throw invalid;
  return issueSessionFor(db, config, user, userAgent, now);
}
