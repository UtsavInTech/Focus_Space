# Layer 2C — Usage & entitlements foundation

Builds on Layer 2B identity (`user_id`) to add server-enforced usage metering
and a billing-independent entitlement model. No payments, no Stripe/UPI, no
subscription objects — those attach to `entitlements.plan` later without
touching this layer.

## Where enforcement happens, and why

`src/learning/ai/service.ts`'s `run()` serves cache hits with **zero network
calls** (`cache.get(key)` returns before any `provider.complete()`). Client-side
enforcement is therefore structurally impossible to trust — the only point
that reliably sees every real OpenRouter-costing request is the server's
`POST /v1/ai/complete` handler. All enforcement lives there.

## Data model — two new tables, one new file, same database

`server/usage/db.ts` opens its **own** `DatabaseSync` connection to the same
`data/focusspace.db` file `server/auth/db.ts` already uses (`DB_PATH`
respected identically). This is deliberate, not an oversight: `IdentityDb`
keeps its connection private, and Layer 2B's review already established that
identity tables must never grow domain-specific columns — adding a second,
independent connection is the smallest change that avoids touching
`server/auth/db.ts` at all. WAL mode (already enabled by `IdentityDb`) is
explicitly designed for exactly this — multiple connections/writers to one
file — so this is safe, not merely convenient.

```sql
CREATE TABLE entitlements (
  user_id    TEXT PRIMARY KEY REFERENCES users(id),
  plan       TEXT NOT NULL DEFAULT 'free',
  updated_at INTEGER NOT NULL
);

CREATE TABLE usage_events (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  action            TEXT NOT NULL,             -- 'what' | 'explain' | ... | 'chat' | 'notes' | 'mindmap'
  units             INTEGER NOT NULL,          -- cost, see "Action cost" below
  period            TEXT NOT NULL,             -- UTC "YYYY-MM"
  status            TEXT NOT NULL,             -- 'reserved' | 'committed' | 'failed'
  idempotency_key   TEXT,                      -- nullable; NULLs never collide (partial UNIQUE index)
  model             TEXT,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
```

A user with **no** `entitlements` row is implicitly `'free'` — no row is ever
written until something (a future billing layer) actually changes a plan.
This keeps Layer 2C's write surface to zero on the entitlement side.

`users` itself is untouched, preserving the Layer 2B principle that identity
never grows domain columns.

## Concurrency & idempotency

`reserveUsage()` is **fully synchronous** — no `await` anywhere inside it,
same argument already relied on in `server/auth/service.ts`'s `refresh()`
rotation: Node's single-threaded event loop cannot interleave two synchronous
calls, so whichever of two "concurrent" HTTP requests reaches `reserveUsage()`
first completes its quota check *and* its insert before the other can even
begin. Two simultaneous requests against a nearly-exhausted quota cannot both
slip through.

Idempotency (`idempotencyKey`, optional on the wire): a retried request
bearing the same key as an existing row is handled by status:
- `committed` → the original request already succeeded and was charged once;
  the retry gets a **fresh answer without being charged again** (we deliberately
  do not cache/replay the original AI content — see "What is not stored"
  below — so the only way to give the retrying client anything is to ask the
  provider again, at FocusSpace's infra cost, not the user's quota).
- `reserved`, and younger than `RESERVATION_STALE_MS` (2 minutes — real
  OpenRouter calls finish in seconds) → a genuinely concurrent duplicate
  (e.g. a double-click) → rejected with `409 conflict`, no new charge.
- `reserved`, but older than the staleness window (the process crashed or was
  killed mid-request, between reserve and commit/release) → treated as
  abandoned; the same row is reused for a fresh attempt rather than leaking a
  permanently-stuck reservation.
- `failed` → freely reusable, same as above.

This is the smallest reservation/commit/release model that satisfies "two
concurrent requests can't both bypass quota" and "a retried request can't
double-charge" without building a ledger.

## Failed requests never consume quota

`index.ts` wraps every authenticated `/v1/ai/complete` call:
reserve → call `orchestrate()` → **commit** on success, **release** (marks
`'failed'`) on any thrown error (upstream failure, timeout, validation
failure after reservation). A `'failed'`/stale-`'reserved'` row never counts
toward the period total (`sumUnitsForPeriod` only sums `committed` rows plus
*fresh* `reserved` ones).

## Action cost — derived from the existing prompt-complexity signal, not invented

`src/learning/ai/actions.ts`'s own `WINDOW_FOR` table already encodes real
relative cost (transcript window length, `maxChars`) per action. Layer 2C's
`ACTION_COST` mirrors that ordering rather than inventing numbers:

| action | units | why |
| --- | --- | --- |
| what, ask, example, chat | 1 | short window, no `maxChars` cap (or the smallest one) |
| explain, quiz | 2 | longer window, `maxChars` 3200–4500 |
| notes, mindmap | 3 | full generation, typically the longest output |

One caveat, examined and left as a deliberate limitation: `notes`/`mindmap`
requests carry a **pre-built prompt** the server never inspects (Layer 2A
never reconstructed note prompts server-side — `orchestrator.ts` rejects
notes/mindmap without one). The server therefore cannot yet tell a
"section" note from a "full video" note apart to charge them differently;
both cost the same 3 units today. Finer-grained note costing needs
server-side note-prompt construction, which is out of scope here.

Quiz's existing revision pass (`src/learning/ai/service.ts`'s `reviewAnswer`)
can trigger a **second**, fully independent `/v1/ai/complete` call when the
first draft fails the quiz-quality heuristic. Each call is reserved/charged
independently — this is architecturally honest (two real OpenRouter calls
really did happen) and needs no special-casing.

## Entitlements — capability/limit table, not scattered plan checks

```ts
PLAN_LIMITS: Record<'free' | 'pro', { aiUnitsPerPeriod: number }>
```

`'pro'` exists in the type and the limits table today even though nothing
can grant it yet (no billing) — exactly so a future billing layer only has
to `INSERT`/`UPDATE` one `entitlements` row, never touch this shape. The
Free monthly allowance is a configuration value
(`FREE_PLAN_MONTHLY_AI_UNITS` env var, default `200`), not a buried magic
number — the actual figure is a product decision to tune later, not
something this layer can derive from the code.

## Period

UTC calendar month (`new Date(now).toISOString().slice(0, 7)` → `"2025-06"`),
computed entirely server-side — never the client's clock or timezone. Kept
to one function (`currentPeriod()`) specifically so switching to a rolling
30-day window later is a one-function change, not a schema migration.

## Anonymous users — rate-limited, not metered

Inspected first: `background/ai.ts`'s `endpointProvider` sends **no**
Authorization header today at all; Chrome on-device AI never leaves the
browser (zero FocusSpace/provider cost, never metered); a learner's own
personal AI endpoint is never FocusSpace's cost either. The only case that
spends real FocusSpace/OpenRouter money without an authenticated identity is
an anonymous caller whose configured `ai.endpointUrl` happens to point at the
FocusSpace server itself.

A persistent "monthly allowance" needs a stable identity to attach to.
IP address is not that — NAT, dynamic IPs and VPNs make it both leaky (blocks
innocent users sharing an IP) and trivially bypassable (real abuse just
rotates IPs), and building real anonymous-identity tracking to get a real
quota would be exactly the "invasive tracking" the task says not to
introduce. So: anonymous `/v1/ai/complete` requests get a lightweight,
**already-established** IP-keyed sliding-window rate limit (reusing
`server/auth/rate-limit.ts`'s `RateLimiter`, not a new mechanism) purely as a
burst/abuse safety net — this is rate limiting, not entitlement, and is kept
in `index.ts` next to the route, never touching the usage/entitlement tables.
Anonymous behavior is otherwise **completely unchanged**: no login prompt,
no persistent tracking, no quota UI.

An expired/malformed (but present) Authorization header on `/v1/ai/complete`
degrades to anonymous handling rather than failing the request — a stale
token must never be able to break the AI companion outright; the AI route
prioritizes "keeps working" over "always meters," matching the product's own
"do not casually remove anonymous behavior" instruction. `GET /v1/me/usage`
(below) has the opposite policy: it has nothing meaningful to answer for an
unverified caller, so it requires a genuinely valid token and 401s otherwise.

## Rate limiting vs. quota — kept structurally separate

Two independent mechanisms, reusing the one `RateLimiter` class:
- **Rate limiting** (already existed for login/register, now also anonymous
  AI calls): in-memory, IP/email-keyed, protects the API from bursts. No
  persistence, resets on restart, per-process — unchanged scope from Layer 2B.
- **Quota/entitlement** (new): SQLite-persisted, `user_id`-keyed, protects the
  learner's monthly allowance across restarts and devices.

Neither path calls into the other.

## Extension wiring

`background/ai.ts`'s `resolveProviders()` now attaches an access token to the
endpoint call **only when** `settings.ai.endpointUrl` and `settings.api.baseUrl`
share an origin — i.e., only when the learner's configured AI endpoint *is*
the FocusSpace identity server, never a third-party/personal endpoint (that
would otherwise leak a Bearer token to an arbitrary URL). Token freshness
reuses the already-reviewed `background/auth.ts` `status()` (silent refresh,
non-destructive on transient failure) — no new refresh logic.

`idempotencyKey` is accepted on the wire (`AiApiRequest`) and fully
implemented server-side, but **today's client does not send one** — nothing
in the current extension retries a request automatically, so generating a
key today would be speculative. This is a deliberate, documented deferral:
the server-side guarantee exists and is tested independently of any client
using it yet.

## API

- `POST /v1/ai/complete` — contract **unchanged** for existing callers; two
  new optional additions: request may include `idempotencyKey`, response may
  include `usage: { promptTokens, completionTokens } | null` (from
  OpenRouter's own response, when present — no new provider call, no new
  cost-management system).
- `GET /v1/me/usage` (new, minimal) — `{ ok, plan, period, used, limit }` for
  the authenticated caller only. No billing/plan-management surface.

## What is not stored

No prompts, transcripts, or AI-generated content in `usage_events` — only
action, cost, status, timestamps, and (post-commit) model/token counts.

## Deliberate deferrals

Client-side idempotency-key generation; per-scope note costing (needs
server-side note-prompt building); IP-based IdP-independent Pro upgrades
(needs billing); a device/session-scoped usage view; multi-generation
reservation reuse beyond one retry cycle — reusing a stale row twice in a row
is fine, this only ever tracks the single latest attempt per key, which is
sufficient for the "retry after a crash" case this layer targets.


## Spaces as an entitlement (added with the account experience)

A Space is a product capability, so it is enforced exactly like AI usage rather than with a
`plan === 'free'` check in the UI:

- `PlanLimits` gained `maxSpaces` (free: 4, `FREE_PLAN_MAX_SPACES`; pro: 5× that). Not a researched
  pricing decision — a tunable default, so a paid plan is a different entitlement row and nothing else.
- `spaces(user_id, space_id, name, created_at)` records *which* Spaces an account keeps — the Spaces
  themselves never leave `chrome.storage.local`.
- `GET/POST/DELETE /v1/me/spaces`. `POST` is idempotent (a re-sync or second device costs no slot) and
  refuses with `403 space_limit` and a product explanation. `DELETE` frees the slot immediately.
- The extension asks before creating (`spaces/authorize`), so the learner sees an explanation instead
  of a failure — but the server is what actually decides. A *transport* failure never blocks creation;
  being offline must not stop someone organising their own YouTube.
- The allowance belongs to an *account*, not to a browser. Signed out, nothing is enforced client-side:
  a default install already ships more built-in spaces than the free limit, and building a second,
  client-side quota is exactly the parallel system this layer exists to avoid.
- Signing in does not retroactively claim the spaces already in the browser — they keep working. The
  allowance covers spaces created while signed in, which is what "4 spaces on your account" means.

## Anonymous AI allowance

Anonymous callers were rate-limited but unmetered, which left "sign in" with nothing to offer. They now
get a small daily allowance (`ANON_DAILY_AI_UNITS`, default 10 units/day) enforced server-side, using the
same per-action costs, so a free account is genuinely more than no account.

- Kept structurally apart from the account system: its own `anon_usage` table, a *daily* window, no
  reservations or idempotency, and keyed by a salted hash of the caller's IP — never the IP itself, and
  never in a table belonging to a user. Rows older than a week are pruned opportunistically.
- Checked *before* the upstream call and recorded only *after* a successful one, so a failed request
  never consumes the allowance — verified against a running server, where four upstream failures in a
  row left the allowance untouched.
- Refusals use the existing `quota_exceeded` code, with a message that points at creating a free account.
