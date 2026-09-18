# Layer 2B — Identity & authentication foundation

This is the root identity layer the rest of FocusSpace's future server-owned
domain (preferences, learning history, notes, AI history, usage,
entitlements, billing) will attach to via `user_id`. It does not implement
any of those domains — it establishes the User/Session model and the
extension↔API auth flow they'll all build on, so that work never requires
redesigning who a "FocusSpace user" is.

Everything Layer 1/1.5/2A already does keeps working **unauthenticated**.
Nothing here is required for the existing anonymous experience.

## A–U: the design questions

**A. What is a FocusSpace User?** A row in a server-owned `users` table:
identity + credential, nothing else. Not a container for preferences,
history, notes, usage, or billing — those are separate tables that
reference `user_id`, added in later layers.

**B. Canonical identifier.** An opaque, server-generated internal ID
(`users.id`, UUID stored as TEXT), never the email. Emails change; the ID
never does. Every future table keys off this ID, never off email.

**C. Immutable fields.** `id`, `created_at`. An ID is never reassigned or
reused, even if the account is later deleted (soft-delete, see below).

**D. Mutable fields.** `email` (with re-verification, not built here),
`password_hash`, `status`, `updated_at`.

**E. Credential representation.** `password_hash` only — the plaintext
password is never stored, logged, or returned. Hashed with `scrypt`
(Node's built-in `node:crypto`, no new dependency), salted per-user,
compared with `crypto.timingSafeEqual`.

**F. Storage at this stage.** SQLite via Node's built-in `node:sqlite`
(stable enough for this foundation as of Node 22; flagged experimental by
Node itself — see "Risks" in the final report). Zero new npm dependencies,
a single file (`data/focusspace.db`, gitignored, reproducible by deleting
it and re-running migrations), synchronous API that fits this project's
existing "no framework unless already used" convention. I'm deliberately
**not** introducing Postgres/Docker for Layer 2B — that's real
infrastructure weight for a foundation phase with one API process and no
deployment yet.

**G. Migration to production.** All access goes through a small
`server/db.ts` query surface using plain, portable SQL (no
SQLite-specific syntax beyond `AUTOINCREMENT`/`STRICT` tables) — the
tables and queries are written to read like standard Postgres. Migrating
later is "point `db.ts` at Postgres, keep the schema," not a redesign.

**H. Sessions.** A **server-side row per login**, not a bare stateless
token: `sessions(id, user_id, refresh_token_hash, created_at, expires_at,
revoked_at, user_agent)`. This is what makes independent revocation
possible (§L) and is the "device" concept (§9) — one row per
device/browser login, all listable/revocable per-user once a device-list
UI exists later (not built here).

**I. Access tokens.** Short-lived (15 min), **stateless but
session-checked**: a signed token (`HMAC-SHA256`, server-only
`AUTH_TOKEN_SECRET`) encoding `{ sub: userId, sid: sessionId, exp }`. Every
protected route verifies the signature *and* looks up `sid` in `sessions`
to confirm it isn't revoked/expired — pure stateless JWT verification
alone can't honor revocation until natural expiry, which would violate
§L, so this is deliberately hybrid.

**J. Refresh / re-authentication.** A long-lived (30 days), **opaque**
random token (32 bytes, base64url), given to the client once at
login/refresh and stored **hashed** (SHA-256) in `sessions` — the raw
value is never persisted server-side, mirroring how passwords are hashed.
`POST /v1/auth/refresh` exchanges it for a new access token **and rotates
the refresh token**: the old hash is replaced. If an already-rotated
(reused) refresh token is presented again, the session is revoked
immediately — standard rotation-with-reuse-detection, catching a stolen
token the first time it's used a second time.

**K. Logout.** `POST /v1/auth/logout` marks the current session
`revoked_at = now`. The access token stops passing the session-check
(§I) immediately, without waiting for its own 15-minute expiry.

**L. Later revocation.** Already possible today, just without a UI:
`UPDATE sessions SET revoked_at = ? WHERE id = ?` (or `WHERE user_id = ?`
for "log out everywhere"). No architecture change needed to add a device
list later — only a route and a page.

**M. Extension authentication.** The **background service worker**
talks to the FocusSpace API (mirroring exactly how it already owns the
AI provider calls in `background/ai.ts`) — content scripts and UI never
call the API directly. New `background/auth.ts` performs
register/login/refresh/logout/me and persists the session locally.

**N. Restoring login after restart.** MV3 service workers are ephemeral
and can be killed anytime, so auth state can't live in memory. It's
persisted in `chrome.storage.local` (new `auth` schema key, same
normalize-on-read pattern as every other key in `storage/schema.ts`). On
startup, if a stored access token is present and unexpired it's used
as-is; if expired but a refresh token is present, one silent refresh call
restores the session before any authenticated request is made.

**O. Anonymous state.** Default and fully supported. `settings.auth`
(new) simply stays `null` — every existing feature (Focus Mode, feed,
Knowledge Map, watch-page rail, AI companion via Layer 1/1.5/2A) already
works with no `user_id` anywhere, and nothing in this layer changes that
path. Layer 2B adds an *optional* identity on top, not a requirement.

**P. Anonymous → account migration.** Deliberately **not implemented**
in Layer 2B beyond the extension point: the shapes exist
(`users`/`sessions`) and the trust boundary is drawn (§T), but no local
data is uploaded. See §6 below for exactly what's safe to migrate later
and why none of it moves yet.

**Q. Avoiding merged users.** Registration is unique on normalized
email (`LOWER(TRIM(email))`, enforced by a `UNIQUE` index) — one email,
one user, checked at the database layer, not just in application code
(closes the race condition two concurrent registrations could otherwise
hit). There is no account-linking flow in Layer 2B, so there's nothing
that could merge two existing users by accident.

**R. Safe to keep locally.** Everything Layer 1–2A already keeps
locally, unchanged: watch history, preference profiles, notes, settings,
the access/refresh tokens themselves (see the extension flow below and
"Risks" for the tradeoff of not yet splitting these across
`chrome.storage.session` vs `.local`).

**S. Must become server-owned.** The password (only ever exists
server-side as a hash), the refresh-token hash, and — starting in later
layers — anything that must be consistent across a learner's devices
(preferences, history) or that must survive an uninstall/reinstall.

**T. Trust boundaries.**
```
Chrome extension (untrusted client)
  — holds: access token, refresh token, no secrets
  — never holds: OPENROUTER_API_KEY, AUTH_TOKEN_SECRET, password hashes
        │ HTTPS (HTTP for local dev only)
        ▼
FocusSpace API (trusted)
  — verifies credentials, issues/rotates/revokes sessions
  — the only thing that ever calls OpenRouter (unchanged from Layer 2A)
        │
        ▼
OpenRouter — sees prompts only, never sees FocusSpace identity at all

YouTube — an external data source FocusSpace reads (subscriptions, watch
data via the page's own session); never a FocusSpace identity provider.
A YouTube login is not a FocusSpace login — no code in this layer treats
it as one.

Future web app — a second client of the same FocusSpace API, using the
same register/login/refresh contract; nothing here is extension-specific
except where the token is stored.
```

**U. Supporting future domains without a User redesign.** Every future
table (`preferences`, `learning_history`, `notes`, `ai_conversations`,
`usage`, `entitlements`, `subscriptions`) is `{ ..., user_id REFERENCES
users(id) }`. `users` itself never grows a column for any of them — that's
the whole point of keeping it to identity + credential only (§8's "avoid"
list).

## 6. Anonymous → account transition (design, not implemented)

The question this layer must answer without building the whole system:
*what happens to weeks of anonymous local state when the learner finally
signs up?*

| Local state today | Migrate on signup? | Why |
| --- | --- | --- |
| `watchHistory`, `preferenceProfiles`, `topicPlaylists`, notes | **Yes, later** — genuine learning signal, worth carrying forward | Deferred: needs a real migration endpoint + conflict rules, not built in 2B |
| `settings` (theme, density, filters) | **Yes, later** — user preference, cheap to carry | Deferred, trivial when it happens |
| `modes` (spaces/topics the learner defined) | **Yes, later** — meaningfully personal | Deferred — same reasoning as history |
| `knowledgeMaps`, `relevanceCache`, `feedViews`, `discoveryCache` | **No** | Derived/recomputable caches, not identity-worthy data — re-deriving server-side post-login is cheap and correct; uploading them would just be moving a cache, not learning state |
| `sync` (import/sync status), `ui` (dismissed-banner flags) | **No** | Purely local/device UI state |
| `channels`, `videos` (the synced library) | **No, initially** | YouTube-derived; re-synced from the account's own YouTube session rather than uploaded, so it's never stale relative to what YouTube actually shows |

The **mechanism** Layer 2B does put in place: nothing yet automatically
uploads anything. When a later layer implements migration, it will be an
explicit, one-time, reviewable action (not silent background sync) —
matching "safe, predictable, non-destructive" from the prompt. No local
data is deleted or overwritten by creating an account in this layer.

## Database schema (Layer 2B only)

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,   -- uuid
  email         TEXT NOT NULL UNIQUE,     -- normalized: lower(trim(email))
  password_hash TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active', -- 'active' | 'disabled'
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  id                      TEXT PRIMARY KEY,   -- uuid, = the access token's "sid"
  user_id                 TEXT NOT NULL REFERENCES users(id),
  refresh_token_hash      TEXT NOT NULL,      -- sha256(refresh token), never the raw value
  prev_refresh_token_hash TEXT,               -- previous hash, kept one rotation for reuse detection (see server/auth/service.ts)
  rotated_at              INTEGER NOT NULL,   -- when refresh_token_hash was last set — anchors the reuse grace window below
  user_agent              TEXT,
  created_at              INTEGER NOT NULL,
  expires_at              INTEGER NOT NULL,
  revoked_at              INTEGER            -- NULL = still valid
);
```

Both `prev_refresh_token_hash` and `rotated_at` were added during implementation/review, past the original design pass above:

- `prev_refresh_token_hash` is what makes refresh-token rotation's reuse detection real: a refresh call matching the *previous* hash instead of the current one means an already-exchanged token is being presented again.
- `rotated_at` fixes a real race the Layer 2B final review surfaced: two genuinely concurrent, legitimate refresh calls bearing the *same* token (e.g. two tabs waking near expiry at once) will always produce one "winner" (rotates normally) and one "loser" (its token is now the just-superseded `prev` hash) — with no way, from the server's point of view, to tell that apart from real theft *unless* timing is taken into account. `refresh()` in `server/auth/service.ts` now tolerates a `prev`-hash match within `REFRESH_REUSE_GRACE_MS` (10s) as a non-destructive `409 conflict` (session untouched, the loser just retries and picks up the winner's tokens from local storage on its next status check); a `prev`-hash match *outside* that window is still treated as compromise and revokes the session, exactly as before. This does not weaken theft detection in any realistic scenario — an attacker replaying a genuinely stolen token essentially never does so within 10 seconds of the legitimate device's own next rotation.

The connection also now runs with `PRAGMA foreign_keys = ON` (SQLite does not enforce declared `REFERENCES` constraints by default) — `sessions.user_id REFERENCES users(id)` is now a real, enforced constraint, not a decorative one.

Deliberately not in Layer 2B: `preferences`, `learning_history`, `notes`,
`ai_conversations`, `usage`, `entitlements`, `subscriptions` — each gets its
own table with a `user_id` foreign key when its layer arrives.

## API routes (new, separate from `/v1/ai/complete`)

| Route | Auth required | Purpose |
| --- | --- | --- |
| `POST /v1/auth/register` | no | create account, returns a session (auto-login) |
| `POST /v1/auth/login` | no | verify credentials, returns a session |
| `POST /v1/auth/refresh` | refresh token (body) | rotate refresh token, issue new access token |
| `POST /v1/auth/logout` | access token | revoke the current session |
| `GET /v1/me` | access token | `{ id, email, createdAt }` — proves the auth flow end-to-end |

`/v1/ai/complete` is untouched — still fully anonymous, exactly as Layer
2A left it. Wiring `user_id` into AI requests is explicitly future work
(§16 excludes "recommendation personalization rewrite").

## Security decisions at a glance
- Passwords: `scrypt`, per-user random salt, `timingSafeEqual` comparison.
- Refresh tokens: opaque, high-entropy (32 random bytes), stored only as
  a SHA-256 hash; rotated on every use; reuse of a rotated token revokes
  the session.
- Access tokens: HMAC-signed, 15-minute expiry, session-checked (not
  purely stateless) so revocation is real.
- Login/register: a small in-memory sliding-window rate limit per
  IP+email (no new infra) — a foundation-level guard, explicitly not a
  production-grade distributed limiter.
- Login errors are identical for "no such account" and "wrong password"
  (`Invalid email or password.`), closing the account-enumeration gap.
- No password, hash, refresh token, or `AUTH_TOKEN_SECRET`/
  `OPENROUTER_API_KEY` is ever logged or returned in any response.


## Verified sign-up and phone sign-in (added after the foundation)

The foundation shipped one way in: `POST /v1/auth/register` with an e-mail and a password, unverified.
Two flows were added on top of it — the same `AuthConfig`, the same `issueSession`, the same session
table. `register` stays for compatibility and is still unverified.

### Email: verify the address before the account exists

```
POST /v1/auth/signup/start     { email }            → { delivery, expiresAt, devCode? }
POST /v1/auth/signup/verify    { email, code }      → { ticket, expiresAt }
POST /v1/auth/signup/complete  { ticket, password } → { user, accessToken, refreshToken }
```

- **Nothing is created until step 3.** An abandoned verification leaves no half-account behind; the
  ticket is a short-lived (15 min) signed token, not a database row.
- **Codes are never stored in plaintext.** `auth/codes.ts` keeps an HMAC keyed by `AUTH_TOKEN_SECRET` —
  a six-digit space would be trivially reversible as a plain hash.
- **Three independent limits:** how often a code can be requested per address (5 / 15 min), how often
  one can be guessed (10 / 15 min), and how many wrong guesses one code survives (5, then it is dead).
- **Only the newest code works;** verifying consumes it.

### Phone: the number is the credential

```
POST /v1/auth/phone/start   { phone }        → { delivery, expiresAt, devCode? }
POST /v1/auth/phone/verify  { phone, code }  → { user, accessToken, refreshToken, created }
```

A verified number with no account creates one (no password); a known number signs in. Phone and email
accounts are separate accounts — this layer deliberately has no account-linking or recovery.

### Delivery: provider-independent, honest by default

`server/notify/sender.ts` is one interface with two methods' worth of surface. No provider is bundled,
because a credential may only ever live on the server and this project has none configured. The default
sender prints the code to the server console and reports `delivery: "console"`; the UI says as much
rather than claiming an email was sent. `AUTH_DEV_CODES=1` additionally returns the code in the
response so local development and tests can complete a real round-trip — refused when `NODE_ENV` is
`production`. **Adding a real provider is one file and one line in `loadSenders()`.**

### Schema

`users` gained `phone` (unique, nullable), `email_verified`, and nullable `email`/`password_hash`
(a phone account has no password). SQLite cannot drop a `NOT NULL` in place, so `db.ts` rebuilds the
table once on startup; accounts created before verification existed are marked verified rather than
being locked out of their own account. `verifications` stores kind, target, code hash, attempts and
expiry.
