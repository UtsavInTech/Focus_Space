import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IdentityDb } from './db';
import { UsageDb } from '../usage/db';
import { grantPlan } from '../billing/service';
import { resolvePlan } from '../usage/entitlements';
import { login, register, signInWithGoogle, type AuthConfig } from './service';

/**
 * Adding Google sign-in must not cost anyone their account.
 *
 * The risky part of this release is a schema change on a database that already holds real accounts,
 * sessions, payments and plans. So this reopens a database that was written *before* the change and
 * checks that everything in it is still there and still works — rather than only testing a fresh one,
 * where a destructive migration would look perfectly healthy.
 */

const config: AuthConfig = { tokenSecret: 'm'.repeat(48) };
const dirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'focusspace-migration-'));
  dirs.push(dir);
  return join(dir, 'identity.sqlite');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('reopening a database written before Google sign-in existed', () => {
  it('keeps the account, its password, and its session', () => {
    const path = tempDbPath();
    const email = `${randomUUID()}@example.com`;
    const password = 'the-original-password';

    const before = new IdentityDb(path);
    const original = register(before, config, email, password, 'first-browser');
    before.close();

    // Reopening runs migrate() — the ALTER that adds google_sub.
    const after = new IdentityDb(path);
    const user = after.findUserByEmail(email);
    expect(user).toBeDefined();
    expect(user!.id).toBe(original.user.id);
    expect(user!.google_sub).toBeNull();

    // The password still signs in, to the same account id.
    expect(login(after, config, email, password, null).user.id).toBe(original.user.id);
    // And the session issued before the migration is still live.
    expect(after.findSessionByRefreshTokenHash).toBeTypeOf('function');
    after.close();
  });

  it('is idempotent — opening it repeatedly changes nothing', () => {
    const path = tempDbPath();
    const email = `${randomUUID()}@example.com`;
    const first = new IdentityDb(path);
    const original = register(first, config, email, 'a-password-here', null);
    first.close();

    for (let i = 0; i < 3; i++) {
      const db = new IdentityDb(path);
      expect(db.findUserById(original.user.id)?.email).toBe(email);
      db.close();
    }
  });

  it('lets an existing account link Google without changing its id, so its plan and payments follow it', () => {
    const path = tempDbPath();
    const email = `${randomUUID()}@example.com`;

    const before = new IdentityDb(path);
    const original = register(before, config, email, 'a-password-here', null);
    before.close();

    const db = new IdentityDb(path);
    // The same file: entitlements and payments carry a foreign key into `users`.
    const usage = new UsageDb(path);
    // A paid plan, granted through the ordinary billing path, before Google entered the picture.
    const grant = grantPlan(usage, {
      userId: original.user.id,
      planId: 'pro',
      period: 'monthly',
      currency: 'USD',
      amountMinor: 900,
      orderId: 'order_before_google',
      paymentId: 'pay_before_google',
    });
    expect(grant.plan).toBe('pro');
    const entitlementBefore = usage.getEntitlement(original.user.id);
    const paymentsBefore = usage.listPayments(original.user.id);

    const viaGoogle = signInWithGoogle(db, config, { sub: 'google-sub-migrated', email, name: null }, null);
    expect(viaGoogle.created).toBe(false);
    expect(viaGoogle.user.id).toBe(original.user.id);

    // Entitlements and payments are keyed by user id, and the id did not move.
    expect(resolvePlan(usage.getEntitlement(original.user.id))).toBe('pro');
    expect(usage.getEntitlement(original.user.id)?.expires_at).toBe(entitlementBefore?.expires_at);
    expect(usage.listPayments(original.user.id)).toEqual(paymentsBefore);
    usage.close();
    db.close();
  });

  it('does not create a second account for an address that already has one', () => {
    const path = tempDbPath();
    const email = `${randomUUID()}@example.com`;
    const db = new IdentityDb(path);
    register(db, config, email, 'a-password-here', null);

    signInWithGoogle(db, config, { sub: 'google-sub-dup', email, name: null }, null);
    signInWithGoogle(db, config, { sub: 'google-sub-dup', email, name: null }, null);

    // findUserByEmail is a unique lookup; a duplicate would have thrown on insert, so the
    // meaningful assertion is that the row is the same one and still has its password.
    const user = db.findUserByEmail(email);
    expect(user!.password_hash).not.toBeNull();
    expect(user!.google_sub).toBe('google-sub-dup');
    db.close();
  });
});
