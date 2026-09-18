import { randomUUID } from 'node:crypto';
import { ApiError } from '../http';
import type { IdentityDb, UserRow } from './db';
import { hashPassword, verifyPassword } from './passwords';
import {
  ACCESS_TOKEN_TTL_MS,
  REFRESH_REUSE_GRACE_MS,
  REFRESH_TOKEN_TTL_MS,
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from './tokens';
import { RateLimiter } from './rate-limit';
import { CODE_TTL_MS, MAX_CODE_ATTEMPTS, SIGNUP_TICKET_TTL_MS, codeMatches, generateCode, hashCode } from './codes';
import { deliverCode, type DeliveryInfo, type Senders } from '../notify/sender';
import type { VerificationKind } from './db';

/**
 * Auth business logic (Layer 2B) — register/login/refresh/logout/authenticate,
 * combining db.ts + passwords.ts + tokens.ts + rate-limit.ts. This is the only
 * file that decides *policy* (generic error messages to avoid enumeration,
 * rate-limit thresholds, rotation-with-reuse-detection); index.ts just wires
 * HTTP onto these functions.
 */

export interface AuthConfig {
  tokenSecret: string;
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const tokenSecret = env.AUTH_TOKEN_SECRET;
  if (!tokenSecret) throw new Error('Set AUTH_TOKEN_SECRET (a long random string used to sign access tokens — never commit it).');
  if (tokenSecret.length < 32) throw new Error('AUTH_TOKEN_SECRET must be at least 32 characters — generate one with `openssl rand -base64 32`.');
  return { tokenSecret };
}

export interface PublicUser {
  id: string;
  /** Null for a phone-only account. */
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  /** Profile. Both null until the learner fills them in; neither is ever required. */
  name: string | null;
  city: string | null;
  createdAt: number;
}

function toPublicUser(row: UserRow): PublicUser {
  return { id: row.id, email: row.email, phone: row.phone, emailVerified: row.email_verified === 1, name: row.name ?? null, city: row.city ?? null, createdAt: row.created_at };
}

export interface SessionTokens {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
}

export interface AuthResult extends SessionTokens {
  user: PublicUser;
}

// Per-email, in-process sliding windows (see rate-limit.ts's own note on scope). Keyed by normalized
// email rather than IP: the extension has no server-visible IP concept worth trusting yet, and this is
// specifically a credential-stuffing guard on one account, not a general abuse limiter.
const loginLimiter = new RateLimiter(10, 15 * 60 * 1000);
const registerLimiter = new RateLimiter(5, 60 * 60 * 1000);

function issueSession(db: IdentityDb, config: AuthConfig, userId: string, userAgent: string | null, now = Date.now()): SessionTokens {
  const sessionId = randomUUID();
  const refreshToken = generateRefreshToken();
  db.insertSession({
    id: sessionId,
    user_id: userId,
    refresh_token_hash: hashRefreshToken(refreshToken),
    prev_refresh_token_hash: null,
    rotated_at: now,
    user_agent: userAgent,
    created_at: now,
    expires_at: now + REFRESH_TOKEN_TTL_MS,
    revoked_at: null,
  });
  const accessTokenExpiresAt = now + ACCESS_TOKEN_TTL_MS;
  const accessToken = signAccessToken({ sub: userId, sid: sessionId, exp: accessTokenExpiresAt }, config.tokenSecret);
  return { accessToken, accessTokenExpiresAt, refreshToken };
}

export function register(db: IdentityDb, config: AuthConfig, email: string, password: string, userAgent: string | null): AuthResult {
  if (!registerLimiter.attempt(email)) throw new ApiError(429, 'rate_limited', 'Too many registration attempts. Try again later.');
  if (db.findUserByEmail(email)) throw new ApiError(409, 'conflict', 'An account with that email already exists.');

  const now = Date.now();
  const user: UserRow = {
    id: randomUUID(),
    email,
    phone: null,
    password_hash: hashPassword(password),
    // Unverified: this direct route predates email verification and stays for compatibility. The
    // product flow is startEmailSignup → verifyEmailSignup → completeEmailSignup, which sets this.
    email_verified: 0,
    status: 'active',
    name: null,
    city: null,
    created_at: now,
    updated_at: now,
  };
  db.insertUser(user);
  return { ...issueSession(db, config, user.id, userAgent, now), user: toPublicUser(user) };
}

/** Same generic failure for "no such account" and "wrong password" (§13 — do not let login become an email-enumeration oracle). */
const INVALID_CREDENTIALS = new ApiError(401, 'unauthorized', 'Invalid email or password.');

export function login(db: IdentityDb, config: AuthConfig, email: string, password: string, userAgent: string | null): AuthResult {
  if (!loginLimiter.attempt(email)) throw new ApiError(429, 'rate_limited', 'Too many login attempts. Try again later.');

  const user = db.findUserByEmail(email);
  // A phone-only account has no password to check against — the same generic failure, never a hint that it exists.
  if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) throw INVALID_CREDENTIALS;
  if (user.status !== 'active') throw new ApiError(403, 'forbidden', 'This account is disabled.');

  return { ...issueSession(db, config, user.id, userAgent), user: toPublicUser(user) };
}

/**
 * Rotation with reuse detection: a session holds the current refresh-token hash and the immediately
 * previous one. A refresh with the current hash rotates normally. A refresh with the *previous* hash
 * means a token that was already exchanged is being presented again — but that can genuinely happen
 * without any theft involved: two near-simultaneous legitimate refresh calls (e.g. two tabs waking up
 * near expiry at the same moment) will both read the same current hash before either has rotated, so
 * the "loser" of that race always presents an already-superseded token through no fault of its own.
 *
 * To tell that apart from real reuse (a leaked token replayed well after the legitimate rotation), a
 * short grace window (REFRESH_REUSE_GRACE_MS) after a rotation tolerates exactly one more presentation
 * of the previous token without revoking anything — the loser just gets a non-destructive "retry"
 * error and, on its next status check, picks up the winner's already-persisted new tokens. Only reuse
 * *outside* that window is treated as a real compromise signal and revokes the whole session.
 */
export function refresh(db: IdentityDb, config: AuthConfig, refreshToken: string): SessionTokens {
  const now = Date.now();
  const hash = hashRefreshToken(refreshToken);

  const current = db.findSessionByRefreshTokenHash(hash);
  if (current) {
    if (current.revoked_at !== null || current.expires_at <= now) throw new ApiError(401, 'unauthorized', 'Session is no longer valid.');
    const newRefreshToken = generateRefreshToken();
    db.rotateSession(current.id, hashRefreshToken(newRefreshToken), current.refresh_token_hash, now, now + REFRESH_TOKEN_TTL_MS);
    const accessTokenExpiresAt = now + ACCESS_TOKEN_TTL_MS;
    const accessToken = signAccessToken({ sub: current.user_id, sid: current.id, exp: accessTokenExpiresAt }, config.tokenSecret);
    return { accessToken, accessTokenExpiresAt, refreshToken: newRefreshToken };
  }

  const stale = db.findSessionByPrevRefreshTokenHash(hash);
  if (stale && stale.revoked_at === null) {
    if (now - stale.rotated_at <= REFRESH_REUSE_GRACE_MS) {
      throw new ApiError(409, 'conflict', 'This refresh token was already used a moment ago. Retry shortly.');
    }
    db.revokeSession(stale.id, now);
    throw new ApiError(401, 'unauthorized', 'Refresh token reuse detected; session revoked. Please log in again.');
  }

  throw new ApiError(401, 'unauthorized', 'Invalid refresh token.');
}

export function logout(db: IdentityDb, sessionId: string): void {
  db.revokeSession(sessionId, Date.now());
}

/** Verifies a `Bearer <token>` Authorization header end-to-end: signature, expiry, and that the session is still live. */
export function authenticate(db: IdentityDb, config: AuthConfig, authorizationHeader: string | undefined): { user: PublicUser; sessionId: string } {
  const token = authorizationHeader?.startsWith('Bearer ') ? authorizationHeader.slice('Bearer '.length).trim() : null;
  if (!token) throw new ApiError(401, 'unauthorized', 'Missing or invalid Authorization header.');

  const payload = verifyAccessToken(token, config.tokenSecret);
  if (!payload) throw new ApiError(401, 'unauthorized', 'Invalid or expired access token.');

  const session = db.findSessionById(payload.sid);
  if (!session || session.revoked_at !== null || session.expires_at <= Date.now()) {
    throw new ApiError(401, 'unauthorized', 'Session is no longer valid.');
  }
  // The session row is the source of truth for *who*, not just the token payload — a session revoked or
  // reassigned after the access token was signed must not be trusted just because the signature checks out.
  if (session.user_id !== payload.sub) throw new ApiError(401, 'unauthorized', 'Invalid or expired access token.');

  const user = db.findUserById(payload.sub);
  if (!user || user.status !== 'active') throw new ApiError(401, 'unauthorized', 'Invalid or expired access token.');

  return { user: toPublicUser(user), sessionId: session.id };
}

/**
 * Non-throwing variant of authenticate() — an invalid/expired/missing token resolves to "no identity"
 * (anonymous) rather than failing the caller's request. For routes where authentication is optional
 * context rather than a hard gate — today, only /v1/ai/complete's usage-metering hook (Layer 2C): a
 * stale token must never be able to break the AI companion outright. Routes that actually require a
 * verified caller (e.g. /v1/me, /v1/me/usage) must keep using the throwing authenticate().
 */
export function tryAuthenticate(db: IdentityDb, config: AuthConfig, authorizationHeader: string | undefined): { user: PublicUser; sessionId: string } | null {
  if (!authorizationHeader) return null;
  try {
    return authenticate(db, config, authorizationHeader);
  } catch {
    return null;
  }
}


/* ─── Verified sign-up and phone sign-in ───────────────────────────────────── */

/**
 * One code at a time, per target, with three independent limits: how often a code can be *requested*
 * (stops using FocusSpace as an email/SMS cannon), how often one can be *guessed*, and how many wrong
 * guesses a single code tolerates before it is dead (codes.ts's MAX_CODE_ATTEMPTS).
 */
const codeRequestLimiter = new RateLimiter(5, 15 * 60 * 1000);
const codeVerifyLimiter = new RateLimiter(10, 15 * 60 * 1000);

export interface CodeSent extends DeliveryInfo {
  expiresAt: number;
}

async function issueCode(db: IdentityDb, config: AuthConfig, senders: Senders, kind: VerificationKind, target: string, channel: 'email' | 'phone', now = Date.now()): Promise<CodeSent> {
  if (!codeRequestLimiter.attempt(`${kind}:${target}`)) throw new ApiError(429, 'rate_limited', 'Too many codes requested for this address. Try again in a few minutes.');
  const code = generateCode();
  const expiresAt = now + CODE_TTL_MS;
  db.insertVerification({ id: randomUUID(), kind, target, code_hash: hashCode(code, config.tokenSecret), attempts: 0, expires_at: expiresAt, consumed_at: null, created_at: now });
  const delivery = await deliverCode(senders, channel, target, code);
  return { ...delivery, expiresAt };
}

/** Consumes the current code for `target`, or throws a message that says exactly what to do next. */
function consumeCode(db: IdentityDb, config: AuthConfig, kind: VerificationKind, target: string, code: string, now = Date.now()): void {
  if (!codeVerifyLimiter.attempt(`${kind}:${target}`)) throw new ApiError(429, 'rate_limited', 'Too many attempts. Try again in a few minutes.');

  const row = db.findLatestVerification(kind, target);
  if (!row || row.consumed_at !== null) throw new ApiError(400, 'invalid_request', 'That code is no longer valid. Request a new one.');
  if (row.expires_at <= now) throw new ApiError(400, 'invalid_request', 'That code has expired. Request a new one.');
  if (row.attempts >= MAX_CODE_ATTEMPTS) throw new ApiError(429, 'rate_limited', 'Too many incorrect attempts for that code. Request a new one.');
  if (!codeMatches(code, row.code_hash, config.tokenSecret)) {
    db.recordVerificationAttempt(row.id);
    throw new ApiError(400, 'invalid_request', "That code doesn't match. Check it and try again.");
  }
  db.consumeVerification(row.id, now);
}

/** Step 1 of creating an account: prove the email exists before any password is chosen. */
export async function startEmailSignup(db: IdentityDb, config: AuthConfig, senders: Senders, email: string): Promise<CodeSent> {
  const existing = db.findUserByEmail(email);
  if (existing?.password_hash) throw new ApiError(409, 'conflict', 'An account with that email already exists. Sign in instead.');
  return issueCode(db, config, senders, 'email_signup', email, 'email');
}

/**
 * Step 2: the code proves the address. The result is a short-lived signed ticket rather than an
 * account — the account only exists once a password is set (step 3), so an abandoned verification
 * leaves nothing behind.
 */
export function verifyEmailSignup(db: IdentityDb, config: AuthConfig, email: string, code: string, now = Date.now()): { ticket: string; expiresAt: number } {
  consumeCode(db, config, 'email_signup', email, code, now);
  const expiresAt = now + SIGNUP_TICKET_TTL_MS;
  return { ticket: signAccessToken({ sub: `signup:${email}`, sid: SIGNUP_TICKET_SID, exp: expiresAt }, config.tokenSecret), expiresAt };
}

/** `sid` is a session id everywhere else; this constant marks a token that is explicitly *not* a session. */
const SIGNUP_TICKET_SID = 'email-signup';

/** Step 3: set the password, create the (verified) account, and sign in. */
export function completeEmailSignup(db: IdentityDb, config: AuthConfig, ticket: string, password: string, userAgent: string | null, now = Date.now()): AuthResult {
  const payload = verifyAccessToken(ticket, config.tokenSecret, now);
  if (!payload || payload.sid !== SIGNUP_TICKET_SID || !payload.sub.startsWith('signup:')) {
    throw new ApiError(400, 'invalid_request', 'That verification has expired. Start again with your email address.');
  }
  const email = payload.sub.slice('signup:'.length);
  if (db.findUserByEmail(email)?.password_hash) throw new ApiError(409, 'conflict', 'An account with that email already exists. Sign in instead.');

  const user: UserRow = { id: randomUUID(), email, phone: null, password_hash: hashPassword(password), email_verified: 1, status: 'active', name: null, city: null, created_at: now, updated_at: now };
  db.insertUser(user);
  return { ...issueSession(db, config, user.id, userAgent, now), user: toPublicUser(user) };
}

/** Trimmed, length-capped, and an empty string means "clear it" rather than storing blank. */
function cleanField(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_request', 'Profile fields must be text.');
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

/**
 * Updates the profile — name and city only. Identity (email, phone, password)
 * is deliberately untouchable here: each has its own verified flow, and a
 * general-purpose "update user" is how an account takeover becomes possible.
 */
export function updateProfile(db: IdentityDb, userId: string, patch: { name?: unknown; city?: unknown }, now = Date.now()): PublicUser {
  db.updateProfile(userId, { name: cleanField(patch.name, 80), city: cleanField(patch.city, 80) }, now);
  const row = db.findUserById(userId);
  if (!row) throw new ApiError(401, 'unauthorized', 'Account not found.');
  return toPublicUser(row);
}


export async function startPhoneSignIn(db: IdentityDb, config: AuthConfig, senders: Senders, phone: string): Promise<CodeSent> {
  const existing = db.findUserByPhone(phone);
  if (existing && existing.status !== 'active') throw new ApiError(403, 'forbidden', 'This account is disabled.');
  return issueCode(db, config, senders, 'phone_login', phone, 'phone');
}

/**
 * Phone sign-in is sign-up as well: a verified number with no account yet creates one (no password —
 * the number *is* the credential), and a known number signs in. Nothing else about the account differs.
 */
export function verifyPhoneSignIn(db: IdentityDb, config: AuthConfig, phone: string, code: string, userAgent: string | null, now = Date.now()): AuthResult & { created: boolean } {
  consumeCode(db, config, 'phone_login', phone, code, now);

  let user = db.findUserByPhone(phone);
  const created = !user;
  if (!user) {
    user = { id: randomUUID(), email: null, phone, password_hash: null, email_verified: 0, status: 'active', name: null, city: null, created_at: now, updated_at: now };
    db.insertUser(user);
  }
  if (user.status !== 'active') throw new ApiError(403, 'forbidden', 'This account is disabled.');
  return { ...issueSession(db, config, user.id, userAgent, now), user: toPublicUser(user), created };
}
