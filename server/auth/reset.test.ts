import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../http';
import { IdentityDb } from './db';
import { authenticate, completePasswordReset, login, register, startPasswordReset, verifyPasswordReset, type AuthConfig } from './service';
import type { Senders } from '../notify/sender';

/**
 * Password reset. The three properties worth testing are the security ones:
 * the flow cannot be used to discover which emails have accounts, a code
 * cannot be skipped, and a reset must not leave a thief's session alive.
 */

const config: AuthConfig = { tokenSecret: 'x'.repeat(32) };
const uniqueEmail = () => `user-${randomUUID()}@example.com`;

let db: IdentityDb;
let sent: { target: string; code: string }[];
let senders: Senders;

beforeEach(() => {
  db = new IdentityDb(':memory:');
  sent = [];
  const record = { id: 'test', send: async (target: string, code: string) => void sent.push({ target, code }) };
  senders = { email: record, phone: record, exposeCodes: true };
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

describe('password reset', () => {
  it('resets the password and signs the person in with the new one', async () => {
    const email = uniqueEmail();
    register(db, config, email, 'the old password', null);

    await startPasswordReset(db, config, senders, email);
    const { ticket } = verifyPasswordReset(db, config, email, sent[0].code);
    const result = completePasswordReset(db, config, ticket, 'a brand new password', null);

    expect(result.user.email).toBe(email);
    expect(login(db, config, email, 'a brand new password', null).user.email).toBe(email);
    expect(asApiError(() => login(db, config, email, 'the old password', null)).status).toBe(401);
  });

  it('revokes every existing session — the whole point of resetting after a theft', async () => {
    const email = uniqueEmail();
    const stolen = register(db, config, email, 'the old password', null);
    // The attacker's session works right up until the reset.
    expect(authenticate(db, config, `Bearer ${stolen.accessToken}`).user.email).toBe(email);

    await startPasswordReset(db, config, senders, email);
    const { ticket } = verifyPasswordReset(db, config, email, sent[0].code);
    const fresh = completePasswordReset(db, config, ticket, 'a brand new password', null);

    expect(asApiError(() => authenticate(db, config, `Bearer ${stolen.accessToken}`)).status).toBe(401);
    // …but the person who just reset it is not logged out of the tab they are in.
    expect(authenticate(db, config, `Bearer ${fresh.accessToken}`).user.email).toBe(email);
  });

  it('says the same thing for an unknown address, and sends nothing', async () => {
    const known = uniqueEmail();
    register(db, config, known, 'the old password', null);

    // Production senders never echo the code back (AUTH_DEV_CODES is refused there),
    // and that is the configuration this property has to hold in: a development
    // server returning devCode for a real address only is a deliberate convenience.
    const production: Senders = { ...senders, exposeCodes: false };

    const forKnown = await startPasswordReset(db, config, production, known);
    const forUnknown = await startPasswordReset(db, config, production, uniqueEmail());

    // Identical shape and values: the form must not become an account-existence oracle.
    expect(Object.keys(forUnknown).sort()).toEqual(Object.keys(forKnown).sort());
    expect(forUnknown.delivery).toBe(forKnown.delivery);
    expect(forKnown).not.toHaveProperty('devCode');

    // …and nothing was sent to the address with no account.
    expect(sent).toHaveLength(1);
    expect(sent[0].target).toBe(known);
  });

  it('rejects a wrong code, and a code that has already been used', async () => {
    const email = uniqueEmail();
    register(db, config, email, 'the old password', null);
    await startPasswordReset(db, config, senders, email);

    expect(asApiError(() => verifyPasswordReset(db, config, email, '000000')).status).toBe(400);

    const { ticket } = verifyPasswordReset(db, config, email, sent[0].code);
    completePasswordReset(db, config, ticket, 'a brand new password', null);
    // Replaying the same code must not mint a second ticket.
    expect(asApiError(() => verifyPasswordReset(db, config, email, sent[0].code)).status).toBe(400);
  });

  it('will not accept a sign-up ticket as a reset ticket', async () => {
    const email = uniqueEmail();
    register(db, config, email, 'the old password', null);
    // A ticket from the other flow is signed with the same secret; only the marker differs,
    // and that marker is what stops one flow being used to complete the other.
    const { startEmailSignup, verifyEmailSignup } = await import('./service');
    const other = uniqueEmail();
    await startEmailSignup(db, config, senders, other);
    const signupTicket = verifyEmailSignup(db, config, other, sent[sent.length - 1].code).ticket;

    expect(asApiError(() => completePasswordReset(db, config, signupTicket, 'a brand new password', null)).status).toBe(400);
  });
});
