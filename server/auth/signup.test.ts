import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../http';
import { loadSenders, type Senders } from '../notify/sender';
import { IdentityDb } from './db';
import { MAX_CODE_ATTEMPTS } from './codes';
import { completeEmailSignup, login, PHONE_UNAVAILABLE, startEmailSignup, startPhoneSignIn, verifyEmailSignup, verifyPhoneSignIn, type AuthConfig } from './service';

/**
 * Verified e-mail sign-up and phone OTP sign-in (Layer 2B). Codes are captured
 * from a stub sender — the same seam a real email/SMS provider plugs into —
 * so these exercise the actual server-side verification, not a mocked result.
 */

const config: AuthConfig = { tokenSecret: 'test-secret-that-is-long-enough-32ch' };

/**
 * The code request/verify limiters in service.ts are per-target and module-level (one process, one
 * set of windows — see rate-limit.ts). Tests therefore use a fresh address/number each time, exactly
 * like server/auth/service.test.ts's uniqueEmail(), so one test's attempts never count against another's.
 */
const uniqueEmail = () => `learner-${randomUUID()}@example.com`;
let phoneCounter = 0;
const uniquePhone = () => `+9198765${String(phoneCounter++).padStart(5, '0')}`;

let db: IdentityDb;
let sent: { channel: string; target: string; code: string }[];
let senders: Senders;

const emailSender = (channel: 'email' | 'phone') => ({
  id: 'test',
  send: async (target: string, code: string) => {
    sent.push({ channel, target, code });
  },
});

beforeEach(() => {
  db = new IdentityDb(':memory:');
  sent = [];
  senders = { email: emailSender('email'), phone: emailSender('phone'), exposeCodes: false };
});

const lastCode = () => sent[sent.length - 1].code;

async function createVerifiedAccount(email = uniqueEmail(), password = 'correct-horse') {
  await startEmailSignup(db, config, senders, email);
  const { ticket } = verifyEmailSignup(db, config, email, lastCode());
  return completeEmailSignup(db, config, ticket, password, 'test-agent');
}

describe('email sign-up: verify the address before the account exists', () => {
  it('sends a code, and creates nothing until the password step', async () => {
    const email = uniqueEmail();
    const sentResult = await startEmailSignup(db, config, senders, email);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: 'email', target: email });
    expect(sentResult.delivery).toBe('test');
    expect(sentResult.devCode).toBeUndefined(); // only with AUTH_DEV_CODES=1
    expect(sentResult.expiresAt).toBeGreaterThan(Date.now());
    expect(db.findUserByEmail(email)).toBeUndefined();

    const { ticket } = verifyEmailSignup(db, config, email, lastCode());
    expect(db.findUserByEmail(email)).toBeUndefined(); // still nothing: no password yet

    const result = completeEmailSignup(db, config, ticket, 'correct-horse', 'test-agent');
    expect(result.user).toMatchObject({ email, phone: null, emailVerified: true });
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(db.findUserByEmail(email)?.email_verified).toBe(1);
  });

  it('the new account can sign in with its password afterwards', async () => {
    const email = uniqueEmail();
    await createVerifiedAccount(email);
    expect(login(db, config, email, 'correct-horse', null).user.email).toBe(email);
    expect(() => login(db, config, email, 'wrong-password', null)).toThrow(ApiError);
  });

  it('rejects a wrong code, an expired code, and a reused one', async () => {
    const email = uniqueEmail();
    await startEmailSignup(db, config, senders, email);
    expect(() => verifyEmailSignup(db, config, email, '000000')).toThrow(/doesn't match/);

    const code = lastCode();
    expect(() => verifyEmailSignup(db, config, email, code, Date.now() + 60 * 60 * 1000)).toThrow(/expired/);

    const { ticket } = verifyEmailSignup(db, config, email, code);
    expect(() => verifyEmailSignup(db, config, email, code)).toThrow(/no longer valid/);
    // The ticket from the one real verification still works.
    expect(completeEmailSignup(db, config, ticket, 'correct-horse', null).user.emailVerified).toBe(true);
  });

  it('burns a code after too many wrong guesses', async () => {
    const email = uniqueEmail();
    await startEmailSignup(db, config, senders, email);
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) expect(() => verifyEmailSignup(db, config, email, '000000')).toThrow();
    expect(() => verifyEmailSignup(db, config, email, lastCode())).toThrow(/Request a new one/);
  });

  it('only the newest code works when several were requested', async () => {
    const email = uniqueEmail();
    await startEmailSignup(db, config, senders, email);
    const first = lastCode();
    await startEmailSignup(db, config, senders, email);
    expect(() => verifyEmailSignup(db, config, email, first)).toThrow();
    expect(verifyEmailSignup(db, config, email, lastCode()).ticket).toBeTruthy();
  });

  it('refuses to start for an address that already has an account, and refuses a stale ticket', async () => {
    const email = uniqueEmail();
    await createVerifiedAccount(email);
    await expect(startEmailSignup(db, config, senders, email)).rejects.toThrow(/already exists/);
    expect(() => completeEmailSignup(db, config, 'not-a-real-ticket', 'correct-horse', null)).toThrow(/expired/);
  });

  it('rate-limits repeated code requests for one address', async () => {
    const email = uniqueEmail();
    for (let i = 0; i < 5; i++) await startEmailSignup(db, config, senders, email);
    await expect(startEmailSignup(db, config, senders, email)).rejects.toThrow(/Too many codes/);
  });
});

describe('phone sign-in without an SMS provider', () => {
  it('production has no phone sender — codes would only reach the server log', () => {
    expect(loadSenders({ NODE_ENV: 'production' }).phone).toBeNull();
    expect(loadSenders({ NODE_ENV: 'development' }).phone).not.toBeNull();
  });

  it('is refused plainly, before any code is created or sent', async () => {
    const noSms: Senders = { ...senders, phone: null };
    await expect(startPhoneSignIn(db, config, noSms, uniquePhone())).rejects.toThrow(PHONE_UNAVAILABLE);
    expect(sent).toHaveLength(0);
  });
});

describe('phone sign-in: the number is the credential', () => {
  it('creates the account on first verification and signs in on the next', async () => {
    const phone = uniquePhone();
    await startPhoneSignIn(db, config, senders, phone);
    expect(sent[0]).toMatchObject({ channel: 'phone', target: phone });

    const first = verifyPhoneSignIn(db, config, phone, lastCode(), 'test-agent');
    expect(first.created).toBe(true);
    expect(first.user).toMatchObject({ phone, email: null, emailVerified: false });
    expect(first.accessToken).toBeTruthy();

    await startPhoneSignIn(db, config, senders, phone);
    const second = verifyPhoneSignIn(db, config, phone, lastCode(), null);
    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id); // same account, not a duplicate
  });

  it('never stores the code itself, only a keyed hash', async () => {
    const phone = uniquePhone();
    await startPhoneSignIn(db, config, senders, phone);
    const row = db.findLatestVerification('phone_login', phone)!;
    expect(row.code_hash).not.toContain(lastCode());
    expect(row.consumed_at).toBeNull();
    verifyPhoneSignIn(db, config, phone, lastCode(), null);
    expect(db.findLatestVerification('phone_login', phone)?.consumed_at).not.toBeNull();
  });

  it('rejects a wrong or expired code', async () => {
    const phone = uniquePhone();
    await startPhoneSignIn(db, config, senders, phone);
    expect(() => verifyPhoneSignIn(db, config, phone, '111111', null)).toThrow(/doesn't match/);
    expect(() => verifyPhoneSignIn(db, config, phone, lastCode(), null, Date.now() + 60 * 60 * 1000)).toThrow(/expired/);
    expect(db.findUserByPhone(phone)).toBeUndefined(); // nothing created by failed attempts
  });

  it('keeps email and phone accounts separate', async () => {
    const email = uniqueEmail();
    const phone = uniquePhone();
    await createVerifiedAccount(email);
    await startPhoneSignIn(db, config, senders, phone);
    const phoneAccount = verifyPhoneSignIn(db, config, phone, lastCode(), null);
    expect(phoneAccount.user.id).not.toBe(db.findUserByEmail(email)?.id);
    expect(phoneAccount.user.email).toBeNull();
  });
});

describe('code delivery', () => {
  it('returns the code to the caller only when the server exposes it (development)', async () => {
    const dev: Senders = { ...senders, exposeCodes: true };
    const result = await startEmailSignup(db, config, dev, uniqueEmail());
    expect(result.devCode).toBe(lastCode());
  });

  it('a failing sender fails the request instead of pretending a code was sent', async () => {
    const broken: Senders = { ...senders, email: { id: 'broken', send: vi.fn().mockRejectedValue(new Error('smtp down')) } };
    await expect(startEmailSignup(db, config, broken, uniqueEmail())).rejects.toThrow('smtp down');
  });
});
