import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

/**
 * Identity storage (Layer 2B) — SQLite via Node's own built-in `node:sqlite`
 * (no new dependency; see docs/LAYER_2B_IDENTITY.md §F for why). Plain,
 * portable SQL only, so moving to Postgres later is "point this file at a
 * different driver", not a schema redesign.
 *
 * Loaded via `createRequire` rather than a static `import` — `node:sqlite` is
 * new enough that Vite/Vitest's builtin-module externalization (used by the
 * non-server test/build configs, which never load this module for real) does
 * not yet recognize it, and tries to resolve it as an npm package named
 * "sqlite" instead. A runtime require is invisible to that static analysis;
 * Node resolves the real builtin directly, exactly like the production
 * server build already did successfully.
 *
 * Everything else FocusSpace does (watch history, preferences, notes,
 * settings) stays exactly where it already lives — `chrome.storage.local`,
 * untouched by this file. This is identity + sessions, nothing else.
 */
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

export interface UserRow {
  id: string;
  /** Null for a phone-only account. */
  email: string | null;
  /** E.164, null for an email-only account. */
  phone: string | null;
  /** Null until the learner sets one (phone sign-in never requires a password). */
  password_hash: string | null;
  email_verified: number;
  status: 'active' | 'disabled';
  /** What they want to be called. Null until they say. */
  name: string | null;
  /** Free text, for regional pricing and support context. Never validated against a list. */
  city: string | null;
  /** Google's stable subject id, once this account has signed in with Google. Null for everyone else. */
  google_sub: string | null;
  created_at: number;
  updated_at: number;
}

export type VerificationKind = 'email_signup' | 'phone_login' | 'password_reset';

/** A pending one-time code. Only the HMAC of the code is stored — see auth/codes.ts. */
export interface VerificationRow {
  id: string;
  kind: VerificationKind;
  /** Normalized email address or E.164 phone number. */
  target: string;
  code_hash: string;
  attempts: number;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

/**
 * A one-time, short-lived code that moves an already-proven identity to another FocusSpace surface —
 * the website handing a signed-in session to the extension, or the Google callback handing one back to
 * the website. Only the hash is stored, exactly like a refresh token, and redeeming it issues a *new*
 * session rather than sharing the existing one: each surface ends up with its own refresh token, so
 * signing out of one never signs out the other.
 */
export interface HandoffRow {
  id: string;
  code_hash: string;
  user_id: string;
  /** Free-text label for where it was made ('website', 'google'), for nothing but diagnosis. */
  origin: string;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  /** The immediately-prior refresh-token hash, kept for one rotation only — see service.ts's reuse-detection note. */
  prev_refresh_token_hash: string | null;
  /** When the current refresh_token_hash was set (creation counts as the first "rotation") — see service.ts's reuse grace window. */
  rotated_at: number;
  user_agent: string | null;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT UNIQUE,
  phone          TEXT UNIQUE,
  password_hash  TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active',
  name           TEXT,
  city           TEXT,
  google_sub     TEXT UNIQUE,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS handoffs (
  id          TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  origin      TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS handoffs_expires_idx ON handoffs(expires_at);

CREATE TABLE IF NOT EXISTS verifications (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  target      TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS verifications_target_idx ON verifications(kind, target, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT NOT NULL REFERENCES users(id),
  refresh_token_hash      TEXT NOT NULL,
  prev_refresh_token_hash TEXT,
  rotated_at              INTEGER NOT NULL,
  user_agent              TEXT,
  created_at              INTEGER NOT NULL,
  expires_at              INTEGER NOT NULL,
  revoked_at              INTEGER
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_refresh_token_hash_idx ON sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS sessions_prev_refresh_token_hash_idx ON sessions(prev_refresh_token_hash);
`;

export class IdentityDb {
  private readonly db: DatabaseSyncType;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    // SQLite does not enforce declared foreign keys unless this is set per-connection — without it,
    // `sessions.user_id REFERENCES users(id)` is decorative only, and nothing stops an orphan session row.
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /**
   * Databases created before phone sign-in / email verification existed have a `users` table whose
   * `email` and `password_hash` are NOT NULL and which has no `phone` column. SQLite cannot drop a
   * NOT NULL constraint in place, so the table is rebuilt once — the standard SQLite migration.
   * Accounts that already existed are marked email_verified: they registered when registration was
   * the only flow, and retroactively locking them out of their own account would be wrong.
   */
  private migrate(): void {
    const columns = this.db.prepare('PRAGMA table_info(users)').all() as { name: string; notnull: number }[];

    // Profile fields, added after accounts already existed. Nullable columns are the
    // one ALTER SQLite always accepts, so these need none of the table rebuild below.
    const names = new Set(columns.map((c) => c.name));
    if (columns.length && !names.has('name')) this.db.exec('ALTER TABLE users ADD COLUMN name TEXT');
    if (columns.length && !names.has('city')) this.db.exec('ALTER TABLE users ADD COLUMN city TEXT');
    // Google sign-in, added after accounts already existed. Nullable and backfilled with nothing: every
    // existing account keeps its password and keeps working exactly as it did, and links to Google only
    // if its owner chooses to. SQLite cannot ALTER in a UNIQUE constraint, hence the partial index.
    if (columns.length && !names.has('google_sub')) {
      this.db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');
      this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_idx ON users(google_sub) WHERE google_sub IS NOT NULL');
    }

    if (!columns.length || names.has('phone')) return;
    this.db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      ALTER TABLE users RENAME TO users_pre_phone;
      CREATE TABLE users (
        id             TEXT PRIMARY KEY,
        email          TEXT UNIQUE,
        phone          TEXT UNIQUE,
        password_hash  TEXT,
        email_verified INTEGER NOT NULL DEFAULT 0,
        status         TEXT NOT NULL DEFAULT 'active',
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL
      );
      INSERT INTO users (id, email, phone, password_hash, email_verified, status, created_at, updated_at)
        SELECT id, email, NULL, password_hash, 1, status, created_at, updated_at FROM users_pre_phone;
      -- name, city and google_sub are left NULL: the rebuilt table declares them, and the pre-phone
      -- table this copies from predates all three, so there is nothing to carry across.
      DROP TABLE users_pre_phone;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  close(): void {
    this.db.close();
  }

  // ── users ──────────────────────────────────────────────────────────────

  insertUser(user: UserRow): void {
    this.db
      .prepare('INSERT INTO users (id, email, phone, password_hash, email_verified, status, name, city, google_sub, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(user.id, user.email, user.phone, user.password_hash, user.email_verified, user.status, user.name, user.city, user.google_sub, user.created_at, user.updated_at);
  }

  findUserByEmail(email: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
  }

  findUserByPhone(phone: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) as UserRow | undefined;
  }

  findUserById(id: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  findUserByGoogleSub(sub: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE google_sub = ?').get(sub) as UserRow | undefined;
  }

  /**
   * Links an existing account to a Google identity. Deliberately narrow: it sets `google_sub` and can
   * mark an address verified (Google has just proven it), and touches nothing else — not the password,
   * which keeps working, and not the plan, payments or Spaces, which are keyed by user id and never move.
   */
  linkGoogle(userId: string, sub: string, now: number): void {
    this.db.prepare('UPDATE users SET google_sub = ?, email_verified = 1, updated_at = ? WHERE id = ?').run(sub, now, userId);
  }

  /**
   * Profile fields only. Deliberately cannot touch email, phone, password or
   * status: those are identity, they each have their own verified flow, and a
   * general-purpose "update user" is how an account takeover becomes possible.
   * `undefined` leaves a field alone; `null` clears it.
   */
  updateProfile(id: string, patch: { name?: string | null; city?: string | null }, at: number): void {
    const sets: string[] = [];
    const values: (string | null | number)[] = [];
    if (patch.name !== undefined) {
      sets.push('name = ?');
      values.push(patch.name);
    }
    if (patch.city !== undefined) {
      sets.push('city = ?');
      values.push(patch.city);
    }
    if (!sets.length) return;
    sets.push('updated_at = ?');
    values.push(at, id);
    this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  // ── verification codes ─────────────────────────────────────────────────

  insertVerification(row: VerificationRow): void {
    this.db
      .prepare('INSERT INTO verifications (id, kind, target, code_hash, attempts, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.kind, row.target, row.code_hash, row.attempts, row.expires_at, row.consumed_at, row.created_at);
  }

  /** The most recently issued code for this target — an older one is superseded, never a second valid guess. */
  findLatestVerification(kind: VerificationKind, target: string): VerificationRow | undefined {
    return this.db.prepare('SELECT * FROM verifications WHERE kind = ? AND target = ? ORDER BY created_at DESC LIMIT 1').get(kind, target) as VerificationRow | undefined;
  }

  countVerification(kind: VerificationKind, target: string, since: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM verifications WHERE kind = ? AND target = ? AND created_at > ?').get(kind, target, since) as { n: number }).n;
  }

  recordVerificationAttempt(id: string): void {
    this.db.prepare('UPDATE verifications SET attempts = attempts + 1 WHERE id = ?').run(id);
  }

  consumeVerification(id: string, at: number): void {
    this.db.prepare('UPDATE verifications SET consumed_at = ? WHERE id = ?').run(at, id);
  }

  // ── sessions ───────────────────────────────────────────────────────────

  insertSession(session: SessionRow): void {
    this.db
      .prepare(
        'INSERT INTO sessions (id, user_id, refresh_token_hash, prev_refresh_token_hash, rotated_at, user_agent, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        session.id,
        session.user_id,
        session.refresh_token_hash,
        session.prev_refresh_token_hash,
        session.rotated_at,
        session.user_agent,
        session.created_at,
        session.expires_at,
        session.revoked_at,
      );
  }

  findSessionById(id: string): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  }

  findSessionByRefreshTokenHash(hash: string): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE refresh_token_hash = ?').get(hash) as SessionRow | undefined;
  }

  findSessionByPrevRefreshTokenHash(hash: string): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE prev_refresh_token_hash = ?').get(hash) as SessionRow | undefined;
  }

  /** Rotation (§J): shift the current hash into `prev` (for one-generation reuse detection), store the new one, push out the expiry. */
  rotateSession(id: string, refreshTokenHash: string, prevRefreshTokenHash: string, rotatedAt: number, expiresAt: number): void {
    this.db
      .prepare('UPDATE sessions SET refresh_token_hash = ?, prev_refresh_token_hash = ?, rotated_at = ?, expires_at = ? WHERE id = ?')
      .run(refreshTokenHash, prevRefreshTokenHash, rotatedAt, expiresAt, id);
  }

  revokeSession(id: string, at: number): void {
    this.db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(at, id);
  }

  /** Used by a password reset: a new password must invalidate every session the old one opened. */
  setPassword(userId: string, passwordHash: string, at: number): void {
    this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, at, userId);
  }

  /** "Log out everywhere" — used by a password reset, which must not leave a thief signed in. */
  revokeAllSessionsForUser(userId: string, at: number): void {
    this.db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(at, userId);
  }

  // ── handoffs ───────────────────────────────────────────────────────────

  insertHandoff(row: HandoffRow): void {
    this.db
      .prepare('INSERT INTO handoffs (id, code_hash, user_id, origin, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.code_hash, row.user_id, row.origin, row.expires_at, row.consumed_at, row.created_at);
  }

  findHandoffByCodeHash(hash: string): HandoffRow | undefined {
    return this.db.prepare('SELECT * FROM handoffs WHERE code_hash = ?').get(hash) as HandoffRow | undefined;
  }

  /**
   * Marks the code used, and reports whether *this* call is the one that did it. The UPDATE's own
   * WHERE clause is the check, so two simultaneous redemptions of the same code cannot both win —
   * SQLite serialises the writes and the loser changes no rows.
   */
  consumeHandoff(id: string, at: number): boolean {
    const result = this.db.prepare('UPDATE handoffs SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').run(at, id);
    return Number(result.changes) === 1;
  }

  /** Housekeeping: a code that was never redeemed is worthless once expired. */
  deleteExpiredHandoffs(before: number): void {
    this.db.prepare('DELETE FROM handoffs WHERE expires_at < ?').run(before);
  }
}

let shared: IdentityDb | null = null;

/** The process-wide database handle, opened once. `DB_PATH` defaults to a gitignored file next to the repo root. */
export function getDb(): IdentityDb {
  if (!shared) shared = new IdentityDb(process.env.DB_PATH ?? 'data/focusspace.db');
  return shared;
}
