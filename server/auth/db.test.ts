import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IdentityDb, type SessionRow, type UserRow } from './db';

let db: IdentityDb;

const makeUser = (overrides: Partial<UserRow> = {}): UserRow => ({
  id: randomUUID(),
  email: `${randomUUID()}@example.com`,
  phone: null,
  password_hash: 'salt:hash',
  email_verified: 1,
  status: 'active',
  name: null,
  city: null,
  google_sub: null,
  created_at: Date.now(),
  updated_at: Date.now(),
  ...overrides,
});

const makeSession = (userId: string, overrides: Partial<SessionRow> = {}): SessionRow => ({
  id: randomUUID(),
  user_id: userId,
  refresh_token_hash: randomUUID(),
  prev_refresh_token_hash: null,
  rotated_at: Date.now(),
  user_agent: null,
  created_at: Date.now(),
  expires_at: Date.now() + 1000,
  revoked_at: null,
  ...overrides,
});

beforeEach(() => {
  db = new IdentityDb(':memory:');
});

describe('IdentityDb — users', () => {
  it('round-trips a user by email and by id', () => {
    const user = makeUser();
    db.insertUser(user);
    expect(db.findUserByEmail(user.email!)).toEqual(user);
    expect(db.findUserById(user.id)).toEqual(user);
  });

  it('returns undefined for an unknown user', () => {
    expect(db.findUserByEmail('nobody@example.com')).toBeUndefined();
    expect(db.findUserById('nonexistent')).toBeUndefined();
  });

  it('enforces email uniqueness at the storage layer — the real backstop behind the app-level 409 check', () => {
    const email = `${randomUUID()}@example.com`;
    db.insertUser(makeUser({ email }));
    expect(() => db.insertUser(makeUser({ email }))).toThrow();
  });
});

describe('IdentityDb — foreign keys', () => {
  it('rejects a session row referencing a user_id that does not exist (PRAGMA foreign_keys must be ON)', () => {
    // SQLite does not enforce a declared REFERENCES constraint unless foreign_keys is turned on for the
    // connection — without that pragma this insert would silently succeed and leave an orphan row.
    expect(() => db.insertSession(makeSession('no-such-user-id'))).toThrow();
  });
});

describe('IdentityDb — sessions', () => {
  it('round-trips a session and rotation updates the right fields in place', () => {
    const user = makeUser();
    db.insertUser(user);
    const session = makeSession(user.id, { refresh_token_hash: 'hash-v1' });
    db.insertSession(session);

    expect(db.findSessionById(session.id)).toEqual(session);
    expect(db.findSessionByRefreshTokenHash('hash-v1')?.id).toBe(session.id);

    const rotatedAt = session.rotated_at + 500;
    db.rotateSession(session.id, 'hash-v2', 'hash-v1', rotatedAt, session.expires_at + 1000);
    const rotated = db.findSessionById(session.id);
    expect(rotated?.refresh_token_hash).toBe('hash-v2');
    expect(rotated?.prev_refresh_token_hash).toBe('hash-v1');
    expect(rotated?.rotated_at).toBe(rotatedAt);
    expect(db.findSessionByRefreshTokenHash('hash-v1')).toBeUndefined();
    expect(db.findSessionByPrevRefreshTokenHash('hash-v1')?.id).toBe(session.id);
  });

  it('revokes a single session without affecting others for the same user', () => {
    const user = makeUser();
    db.insertUser(user);
    const s1 = makeSession(user.id);
    const s2 = makeSession(user.id);
    db.insertSession(s1);
    db.insertSession(s2);

    db.revokeSession(s1.id, 12345);
    expect(db.findSessionById(s1.id)?.revoked_at).toBe(12345);
    expect(db.findSessionById(s2.id)?.revoked_at).toBeNull();
  });

  it('revokeAllSessionsForUser revokes only that user\'s still-live sessions', () => {
    const a = makeUser();
    const b = makeUser();
    db.insertUser(a);
    db.insertUser(b);
    const aSession1 = makeSession(a.id);
    const aSession2 = makeSession(a.id);
    const bSession = makeSession(b.id);
    db.insertSession(aSession1);
    db.insertSession(aSession2);
    db.insertSession(bSession);

    db.revokeAllSessionsForUser(a.id, 99999);

    expect(db.findSessionById(aSession1.id)?.revoked_at).toBe(99999);
    expect(db.findSessionById(aSession2.id)?.revoked_at).toBe(99999);
    expect(db.findSessionById(bSession.id)?.revoked_at).toBeNull();
  });
});
