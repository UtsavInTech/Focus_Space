import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IdentityDb } from './db';
import { login, register, signInWithGoogle, type AuthConfig } from './service';
import { createHandoff, redeemHandoff, HANDOFF_TTL_MS } from './handoff';
import { createState, loadGoogleConfig, verifyState, authorizeUrl } from './google';

const config: AuthConfig = { tokenSecret: 'a'.repeat(48) };
let db: IdentityDb;

beforeEach(() => {
  db = new IdentityDb(':memory:');
});

const googleProfile = (over: Partial<{ sub: string; email: string; name: string | null }> = {}) => ({
  sub: 'google-sub-1',
  email: `${randomUUID()}@example.com`,
  name: 'A Learner',
  ...over,
});

/**
 * An ordinary email+password account. `register` is the service's own test-only constructor (it is not
 * reachable over HTTP) and produces exactly the row the verified sign-up flow does, minus the code
 * round-trip that is tested in service.test.ts.
 */
const passwordAccount = (email: string, password = 'a-long-password') => register(db, config, email, password, null);

describe('signInWithGoogle', () => {
  it('creates a verified, passwordless account when the Google identity is new', () => {
    const profile = googleProfile();
    const result = signInWithGoogle(db, config, profile, null);
    expect(result.created).toBe(true);
    expect(result.user.email).toBe(profile.email);
    expect(result.user.emailVerified).toBe(true);
    expect(result.user.google).toBe(true);
    expect(result.accessToken).toBeTruthy();
    expect(db.findUserById(result.user.id)!.password_hash).toBeNull();
  });

  it('returns the same account on a second sign-in, matching on the Google id not the address', () => {
    const profile = googleProfile();
    const first = signInWithGoogle(db, config, profile, null);
    // Google address changed; the subject id did not — still the same person.
    const second = signInWithGoogle(db, config, { ...profile, email: `${randomUUID()}@example.com` }, null);
    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
  });

  it('links an existing password account instead of creating a duplicate', () => {
    const email = `${randomUUID()}@example.com`;
    const original = passwordAccount(email);

    const viaGoogle = signInWithGoogle(db, config, googleProfile({ email }), null);
    expect(viaGoogle.created).toBe(false);
    // The same account row: plan, payments, usage and registered Spaces all key off this id.
    expect(viaGoogle.user.id).toBe(original.user.id);
    expect(viaGoogle.user.google).toBe(true);
  });

  it('leaves the linked account’s password working', () => {
    const email = `${randomUUID()}@example.com`;
    const password = 'still-my-password';
    const original = passwordAccount(email, password);
    signInWithGoogle(db, config, googleProfile({ email }), null);

    const byPassword = login(db, config, email, password, null);
    expect(byPassword.user.id).toBe(original.user.id);
    expect(byPassword.user.google).toBe(true);
  });

  it('issues a real session each time rather than reusing one', () => {
    const profile = googleProfile();
    const a = signInWithGoogle(db, config, profile, null);
    const b = signInWithGoogle(db, config, profile, null);
    expect(a.refreshToken).not.toBe(b.refreshToken);
  });
});

describe('OAuth state', () => {
  it('round-trips the return address', () => {
    const state = createState(config.tokenSecret, 'https://focusspace.xyz/signin');
    expect(verifyState(state, config.tokenSecret).returnTo).toBe('https://focusspace.xyz/signin');
  });

  it('rejects a tampered or foreign state', () => {
    const state = createState(config.tokenSecret, 'https://focusspace.xyz/signin');
    expect(() => verifyState(`${state}x`, config.tokenSecret)).toThrow();
    expect(() => verifyState(state, 'b'.repeat(48))).toThrow();
    expect(() => verifyState('not-a-state', config.tokenSecret)).toThrow();
    expect(() => verifyState(undefined, config.tokenSecret)).toThrow();
  });

  it('rejects a state that has aged out', () => {
    const state = createState(config.tokenSecret, 'https://focusspace.xyz/signin', 1_000);
    expect(() => verifyState(state, config.tokenSecret, 1_000 + 11 * 60_000)).toThrow();
  });

  it('builds an authorize URL that asks only for identity and never carries the secret', () => {
    const url = new URL(authorizeUrl({ clientId: 'id-123', clientSecret: 'shhh', redirectUri: 'https://api.example/cb' }, 'state-1'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.toString()).not.toContain('shhh');
  });

  it('is unconfigured unless all three settings are present', () => {
    expect(loadGoogleConfig({})).toBeNull();
    expect(loadGoogleConfig({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' })).toBeNull();
    expect(loadGoogleConfig({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', GOOGLE_REDIRECT_URI: 'https://x/cb' })).toEqual({
      clientId: 'a',
      clientSecret: 'b',
      redirectUri: 'https://x/cb',
    });
  });
});

describe('handoff', () => {
  const user = () => signInWithGoogle(db, config, googleProfile(), null).user;

  it('exchanges a code for a new session for the same account', () => {
    const owner = user();
    const { code } = createHandoff(db, owner.id, 'website');
    const session = redeemHandoff(db, config, code, 'the-extension');
    expect(session.user.id).toBe(owner.id);
    expect(session.refreshToken).toBeTruthy();
  });

  it('gives each surface its own session, so signing out of one does not sign out the other', () => {
    const owner = user();
    const a = redeemHandoff(db, config, createHandoff(db, owner.id, 'website').code, 'extension');
    const b = redeemHandoff(db, config, createHandoff(db, owner.id, 'website').code, 'extension');
    expect(a.refreshToken).not.toBe(b.refreshToken);
  });

  it('accepts a code exactly once', () => {
    const { code } = createHandoff(db, user().id, 'website');
    expect(() => redeemHandoff(db, config, code, null)).not.toThrow();
    expect(() => redeemHandoff(db, config, code, null)).toThrow(/expired/i);
  });

  it('refuses an expired code', () => {
    const owner = user();
    const now = Date.now();
    const { code } = createHandoff(db, owner.id, 'website', now);
    expect(() => redeemHandoff(db, config, code, null, now + HANDOFF_TTL_MS + 1)).toThrow(/expired/i);
  });

  it('refuses an unknown or malformed code, with the same message as every other failure', () => {
    for (const bad of ['', 'x', 'not-a-real-handoff-code-but-long-enough-to-pass']) {
      expect(() => redeemHandoff(db, config, bad, null)).toThrow(/expired/i);
    }
  });

  it('stores only the hash, never the code itself', () => {
    const owner = user();
    const { code } = createHandoff(db, owner.id, 'website');
    expect(db.findHandoffByCodeHash(code)).toBeUndefined();
  });
});
