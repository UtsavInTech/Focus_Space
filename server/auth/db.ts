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
  created_at: number;
  updated_at: number;
}

export type VerificationKind = 'email_signup' | 'phone_login';

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
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

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
      .prepare('INSERT INTO users (id, email, phone, password_hash, email_verified, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(user.id, user.email, user.phone, user.password_hash, user.email_verified, user.status, user.created_at, user.updated_at);
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

  /** "Log out everywhere" — not exposed via any route yet, but the schema already supports it (see docs §L). */
  revokeAllSessionsForUser(userId: string, at: number): void {
    this.db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(at, userId);
  }
}

let shared: IdentityDb | null = null;

/** The process-wide database handle, opened once. `DB_PATH` defaults to a gitignored file next to the repo root. */
export function getDb(): IdentityDb {
  if (!shared) shared = new IdentityDb(process.env.DB_PATH ?? 'data/focusspace.db');
  return shared;
}
