import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../http';
import { IdentityDb } from './db';
import { signAccessToken } from './tokens';
import { REFRESH_REUSE_GRACE_MS } from './tokens';
import { authenticate, login, logout, refresh, register, tryAuthenticate, type AuthConfig } from './service';

const config: AuthConfig = { tokenSecret: 'x'.repeat(32) };
const uniqueEmail = () => `user-${randomUUID()}@example.com`;

let db: IdentityDb;

beforeEach(() => {
  db = new IdentityDb(':memory:');
});

const asApiError = (fn: () => unknown): ApiError => {
  try {
    fn();
    throw new Error('expected to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
};

describe('register', () => {
  it('creates a user and immediately issues a usable session', () => {
    const email = uniqueEmail();
    const result = register(db, config, email, 'correct horse battery staple', 'test-agent');
    expect(result.user.email).toBe(email);
    expect(result.user).not.toHaveProperty('password_hash');
    expect(result.user).not.toHaveProperty('password');
    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');

    expect(authenticate(db, config, `Bearer ${result.accessToken}`).user.email).toBe(email);
  });

  it('rejects a duplicate email with 409 conflict', () => {
    const email = uniqueEmail();
    register(db, config, email, 'password one', null);
    const err = asApiError(() => register(db, config, email, 'a different password', null));
    expect(err.status).toBe(409);
    expect(err.code).toBe('conflict');
  });

  it('rate-limits repeated registration attempts for the same email', () => {
    const email = uniqueEmail();
    register(db, config, email, 'password one', null); // 1st: succeeds
    for (let i = 0; i < 4; i++) {
      asApiError(() => register(db, config, email, 'password one', null)); // 2nd-5th: conflict, still counted
    }
    const err = asApiError(() => register(db, config, email, 'password one', null)); // 6th: rate limited
    expect(err.code).toBe('rate_limited');
    expect(err.status).toBe(429);
  });
});

describe('login', () => {
  it('succeeds with correct credentials', () => {
    const email = uniqueEmail();
    register(db, config, email, 'correct horse battery staple', null);
    const result = login(db, config, email, 'correct horse battery staple', null);
    expect(result.user.email).toBe(email);
  });

  it('rejects an unknown email and a wrong password with the identical generic message (no enumeration)', () => {
    const email = uniqueEmail();
    register(db, config, email, 'correct horse battery staple', null);

    const wrongPassword = asApiError(() => login(db, config, email, 'not the password', null));
    const unknownEmail = asApiError(() => login(db, config, uniqueEmail(), 'not the password', null));

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.message).toBe(unknownEmail.message);
    expect(wrongPassword.code).toBe('unauthorized');
  });

  it('rate-limits repeated failed login attempts for the same email', () => {
    const email = uniqueEmail();
    register(db, config, email, 'correct horse battery staple', null);
    for (let i = 0; i < 10; i++) {
      asApiError(() => login(db, config, email, 'wrong', null)); // attempts 1-10: invalid credentials
    }
    const err = asApiError(() => login(db, config, email, 'wrong', null)); // 11th: rate limited
    expect(err.code).toBe('rate_limited');
  });
});

describe('authenticate', () => {
  it('rejects a missing or malformed Authorization header', () => {
    expect(asApiError(() => authenticate(db, config, undefined)).status).toBe(401);
    expect(asApiError(() => authenticate(db, config, 'not-a-bearer-token')).status).toBe(401);
  });

  it('rejects a token with a bad signature', () => {
    const { accessToken } = register(db, config, uniqueEmail(), 'password one', null);
    const tampered = accessToken.slice(0, -2) + 'zz';
    expect(asApiError(() => authenticate(db, config, `Bearer ${tampered}`)).status).toBe(401);
  });

  it('rejects an expired access token', () => {
    const { user } = register(db, config, uniqueEmail(), 'password one', null);
    const session = db.findSessionByRefreshTokenHash; // sanity: exists on db instance
    expect(typeof session).toBe('function');
    const expired = signAccessToken({ sub: user.id, sid: 'does-not-matter', exp: Date.now() - 1 }, config.tokenSecret);
    expect(asApiError(() => authenticate(db, config, `Bearer ${expired}`)).status).toBe(401);
  });

  it('rejects a token whose session has been revoked (logout)', () => {
    const { accessToken } = register(db, config, uniqueEmail(), 'password one', null);
    logout(db, authenticate(db, config, `Bearer ${accessToken}`).sessionId);
    expect(asApiError(() => authenticate(db, config, `Bearer ${accessToken}`)).status).toBe(401);
  });

  it('never returns the password hash on the resolved user', () => {
    const { accessToken } = register(db, config, uniqueEmail(), 'password one', null);
    const { user } = authenticate(db, config, `Bearer ${accessToken}`);
    expect(Object.keys(user).sort()).toEqual(['createdAt', 'email', 'emailVerified', 'id', 'phone']);
  });
});

describe('authorization boundaries — User A must never resolve as, or affect, User B', () => {
  it('a token whose session belongs to a different user than the token claims is rejected outright', () => {
    // Simulates the concrete "ID manipulation" attack the session model must resist: even a validly
    // *signed* access token (e.g. from a bug elsewhere, or a stolen session id spliced onto another
    // token) must not authenticate as a user it doesn't actually belong to. authenticate() must treat
    // the session row — not the token payload alone — as the source of truth for identity.
    const a = register(db, config, uniqueEmail(), 'password one', null);
    const b = register(db, config, uniqueEmail(), 'password two', null);
    const sessionIdOfB = authenticate(db, config, `Bearer ${b.accessToken}`).sessionId;

    // A forged token: claims to be user A's subject, but points at user B's session id.
    const forged = signAccessToken({ sub: a.user.id, sid: sessionIdOfB, exp: Date.now() + 60_000 }, config.tokenSecret);
    expect(asApiError(() => authenticate(db, config, `Bearer ${forged}`)).status).toBe(401);
  });

  it('logging out User A does not revoke User B session, and each user only ever resolves as themselves', () => {
    const a = register(db, config, uniqueEmail(), 'password one', null);
    const b = register(db, config, uniqueEmail(), 'password two', null);

    expect(authenticate(db, config, `Bearer ${a.accessToken}`).user.id).toBe(a.user.id);
    expect(authenticate(db, config, `Bearer ${b.accessToken}`).user.id).toBe(b.user.id);

    logout(db, authenticate(db, config, `Bearer ${a.accessToken}`).sessionId);

    expect(asApiError(() => authenticate(db, config, `Bearer ${a.accessToken}`)).status).toBe(401);
    expect(authenticate(db, config, `Bearer ${b.accessToken}`).user.id).toBe(b.user.id);
  });

  it('refreshing User A session can never mint a token for User B, and reuse-revocation of A does not touch B', () => {
    const a = register(db, config, uniqueEmail(), 'password one', null);
    const b = register(db, config, uniqueEmail(), 'password two', null);

    const rotated = refresh(db, config, a.refreshToken);
    expect(authenticate(db, config, `Bearer ${rotated.accessToken}`).user.id).toBe(a.user.id);

    // Replay A's now-superseded refresh token well outside the reuse grace window (real theft signal,
    // not a benign race) — must revoke only A's session.
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + REFRESH_REUSE_GRACE_MS + 1000);
    try {
      expect(() => refresh(db, config, a.refreshToken)).toThrow(ApiError);
    } finally {
      spy.mockRestore();
    }
    expect(asApiError(() => authenticate(db, config, `Bearer ${rotated.accessToken}`)).status).toBe(401);
    expect(authenticate(db, config, `Bearer ${b.accessToken}`).user.id).toBe(b.user.id);
  });
});

describe('refresh', () => {
  it('rotates the refresh token and issues a new access token', () => {
    const { refreshToken } = register(db, config, uniqueEmail(), 'password one', null);
    const rotated = refresh(db, config, refreshToken);
    expect(rotated.refreshToken).not.toBe(refreshToken);
    expect(typeof rotated.accessToken).toBe('string');
  });

  it('the newly rotated refresh token itself works for a subsequent refresh', () => {
    const { refreshToken } = register(db, config, uniqueEmail(), 'password one', null);
    const first = refresh(db, config, refreshToken);
    const second = refresh(db, config, first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
  });

  it('rejects a garbage/unknown refresh token', () => {
    register(db, config, uniqueEmail(), 'password one', null);
    expect(asApiError(() => refresh(db, config, 'not-a-real-refresh-token')).status).toBe(401);
  });

  it('detects reuse of an already-rotated refresh token well after the grace window and revokes the session', () => {
    const { refreshToken } = register(db, config, uniqueEmail(), 'password one', null);
    const rotated = refresh(db, config, refreshToken);

    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + REFRESH_REUSE_GRACE_MS + 1000);
    let err: ApiError;
    try {
      err = asApiError(() => refresh(db, config, refreshToken)); // replaying the old, superseded token
    } finally {
      spy.mockRestore();
    }
    expect(err.status).toBe(401);

    // The session is now revoked outright — even the legitimately-rotated token stops working.
    expect(() => refresh(db, config, rotated.refreshToken)).toThrow(ApiError);
  });

  it('replaying the just-superseded token WITHIN the grace window is treated as a benign race, not theft — no revocation', () => {
    // Simulates two near-simultaneous legitimate refresh calls (e.g. two tabs) both holding the same
    // refresh token: one wins and rotates, the other's identical call arrives moments later bearing the
    // now-superseded token. That must not be indistinguishable from an attacker replaying a stolen token.
    const { refreshToken } = register(db, config, uniqueEmail(), 'password one', null);
    const winner = refresh(db, config, refreshToken);

    const err = asApiError(() => refresh(db, config, refreshToken)); // the "loser" of the race, moments later
    expect(err.status).toBe(409);
    expect(err.code).toBe('conflict');

    // Crucially, the session survives — the winner's already-issued tokens are still fully valid.
    expect(authenticate(db, config, `Bearer ${winner.accessToken}`).user.email).toBeDefined();
    expect(() => refresh(db, config, winner.refreshToken)).not.toThrow();
  });

  it('rejects a refresh token whose session has expired', () => {
    const { refreshToken } = register(db, config, uniqueEmail(), 'password one', null);
    const farFuture = Date.now() + 365 * 24 * 60 * 60 * 1000;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(farFuture);
    try {
      expect(asApiError(() => refresh(db, config, refreshToken)).status).toBe(401);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('tryAuthenticate — the non-throwing variant Layer 2C\'s /v1/ai/complete relies on', () => {
  it('resolves the caller for a valid token, identically to authenticate()', () => {
    const { accessToken, user } = register(db, config, uniqueEmail(), 'password one', null);
    expect(tryAuthenticate(db, config, `Bearer ${accessToken}`)?.user.id).toBe(user.id);
  });

  it('returns null (never throws) for a missing, malformed, or invalid token', () => {
    expect(tryAuthenticate(db, config, undefined)).toBeNull();
    expect(tryAuthenticate(db, config, 'not-a-bearer-token')).toBeNull();
    expect(tryAuthenticate(db, config, 'Bearer garbage')).toBeNull();
  });

  it('returns null for a token whose session has been revoked, same as authenticate() would reject it', () => {
    const { accessToken } = register(db, config, uniqueEmail(), 'password one', null);
    logout(db, authenticate(db, config, `Bearer ${accessToken}`).sessionId);
    expect(tryAuthenticate(db, config, `Bearer ${accessToken}`)).toBeNull();
  });
});

describe('logout', () => {
  it('is idempotent — revoking an already-revoked session does not throw', () => {
    const { accessToken } = register(db, config, uniqueEmail(), 'password one', null);
    const { sessionId } = authenticate(db, config, `Bearer ${accessToken}`);
    logout(db, sessionId);
    expect(() => logout(db, sessionId)).not.toThrow();
  });
});
