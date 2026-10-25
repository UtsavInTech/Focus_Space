# Institutes, Phase 1 / Step 1

Server foundation only. Course import (Step 2), admin/student website pages (Step 3), extension integration
and privacy/store drafts (Step 4) are not built by this step. The public website still calls the pilot
proposed. No service has been deployed.

## Storage and identity

[Postgres.js](https://github.com/porsager/postgres) (`postgres`) is the sole runtime dependency added. It supplies a bounded connection pool and transactions.
[PGlite](https://pglite.dev/docs/) (`@electric-sql/pglite`) is a **development-only** dependency: tests execute the same PostgreSQL SQL in
process, with real JSONB, constraints, rollback and triggers, without a Postgres server. It does not
simulate a multi-process Postgres deployment; run integration/load tests against Railway before release.

`DATABASE_URL` selects Postgres for the `institutes` schema only. Identity, sessions, billing and usage
stay in SQLite. The key joining them is the authenticated `user_id`. SQL lives only in `db.ts`; test
SQL is used only to inspect invariants. Migration version 1 runs under a transaction/advisory lock.
Published versions have a database trigger that forbids updates/deletes. Roll back by publishing a new
version of a previous draft, not changing history.

`INSTITUTES_STAFF` is a comma-separated allow-list of user ids or **verified** email addresses. No entry
means no staff access. It never accepts `ADMIN_TOKEN`; `/v1/admin/metrics` still uses its existing handler.
Org roles (`owner`, `admin`, `faculty`) grant Studio reads for that org only, not FocusSpace admin access.
Global org listing is staff-only. Public course/join identifiers and a user's own membership listing
are the intentional global lookup seams; subsequent course data operations take an org id.

Without `DATABASE_URL`/auth configuration, only institute endpoints fail with a controlled 503. A failed
Postgres connection is retried on a later request; it does not stop the existing API from serving.

## Routes

All bodies are bounded JSON and all private routes require an existing Bearer session. No guest fallback.

| Method | Path | Audience / result |
| --- | --- | --- |
| GET | `/v1/institutes/access` | Current user: own org roles and whether FocusSpace staff |
| GET | `/v1/me/institutes` | Own active course/batch memberships and version/ETag |
| GET | `/v1/courses/:course` | Published public course metadata, no student data |
| GET | `/v1/courses/:course/v/:version` | Published JSON; private items require active batch membership |
| GET | `/v1/join/:code` | Public batch landing metadata, rate-limited |
| POST | `/v1/enroll` | `{courseId \| joinCode, phone, consents}` |
| GET | `/v1/consents?orgId=...` | Own current choices and notice versions |
| POST | `/v1/consents` | `{orgId, consents}`; withdrawal takes effect on commit |
| POST | `/v1/institutes/phone/start` | `{phone}`; reuses existing SMS-code delivery |
| POST | `/v1/institutes/phone/verify` | `{phone, code}`; proves phone for the signed-in account, no new session/account |
| POST | `/v1/institutes/:course/leave` | `{orgId}`; leaves that institute course, not personal Spaces |
| GET | `/v1/institutes/:org/assignments?courseId=...` | Own enrolled batches' today's class/homework |
| POST | `/v1/progress` | Single milestone or `{events:[...]}`; max 100 per request |
| GET | `/v1/institutes/quizzes/:org/:quiz` | Completed video's published questions/options, never answers |
| POST | `/v1/quiz-attempts` | `{orgId,quizId,answers:[optionIndex...]}`; returns only score/total |
| GET, POST | `/v1/admin/orgs` | FocusSpace staff: list/create orgs |
| POST | `/v1/admin/orgs/:org/settings` | `{status:pilot\|active\|paused}` |
| POST | `/v1/admin/orgs/:org/members` | `{userId,role}`; account must exist in SQLite |
| GET, POST | `/v1/admin/orgs/:org/courses` | List/create; creation needs `title,kind,channelId`, optional `examId` |
| GET, POST | `/v1/admin/orgs/:org/courses/:course/draft` | Read/save reviewed `{payload}` |
| POST | `/v1/admin/orgs/:org/courses/:course/publish` | `{}`; creates a new immutable version |
| POST | `/v1/admin/orgs/:org/courses/:course/import` | Explicit 501 until Step 2; never pretends an import succeeded |
| GET, POST | `/v1/admin/orgs/:org/batches` | List/create; creation needs `courseId,name,seats`, optional epoch-ms dates |
| POST | `/v1/admin/orgs/:org/batches/:batch/settings` | `{status:active\|paused,seats}`; cannot reduce below active enrolment |
| POST | `/v1/admin/orgs/:org/batches/:batch/rotate` | `{}`; invalidates old join code |
| POST | `/v1/admin/orgs/:org/batches/:batch/assignments` | `{itemRef,kind:today\|homework,note?,dueOn?}`; course item must exist |
| POST | `/v1/admin/orgs/:org/courses/:course/quizzes` | Staff-only draft with `videoId,questions` (server keeps answer indices) |
| POST | `/v1/admin/orgs/:org/quizzes/:quiz/publish` | `{}`; staff approval |
| GET | `/v1/studio/:org/funnel` | Org staff only: aggregate funnel and video completion/drop-off |
| GET | `/v1/studio/:org/students` | Org staff only: paged, progress-consenting students |
| GET | `/v1/studio/:org/leads.csv` | Org staff only: paged, verified, contact-consenting students; audited |

Consent input: `{textVersion:'institute-consent-v1',progress:false,contact:false}`. Both choices must be
explicit booleans, never inferred/truthy. They are org-wide. Leaving the last course in an org withdraws
both; leaving one of several courses does not silently revoke permission for the others.

Phone is required only in institute endpoints. Accept an Indian mobile in `+91` E.164 or 10-digit form;
store normalized E.164, uniquely across all institute students. A phone is fixed once registered in this
step (there is no phone-change flow yet). OTP is needed only for contact sharing, unless the existing
signed-in phone identity already proves that same number. The existing SMS provider and code expiry,
attempt limits and one-time consumption are reused. An OTP for another existing account cannot attach
that account's phone to this one. No SMS provider means an honest refusal, not a fake verification.

Student/lead filters: `courseId`, `minCompletion` (percentage), `minQuizScore` (percentage), `limit`
(1–500), `after` (last returned user id). JSON gives `next`; CSV gives `X-Next-Cursor`. Contact-only
consent never exposes progress/scores, and therefore cannot match performance filters. CSV values are
quoted and spreadsheet-formula prefixes neutralized. Every export page is logged atomically with its
read. Its SQL statement snapshot is its linearization point; withdrawals committed before it are excluded.

## Progress, privacy and scale decisions

- A queue coalesces by org/user/course/video, keeps the highest stage and seconds, and commits batches
  of up to 500 distinct keys. Up to 5,000 unique queued keys/20,000 waiting acknowledgments are allowed;
  overflow returns 429 so the caller can retry. Success is acknowledged **after** the DB commit.
- Stage and seconds are monotonic. Duplicate/out-of-order requests do not increment totals twice.
  A `done` milestone also counts `started` and `half`. Days are server UTC dates, never client dates.
- Only enrolled course videos are accepted; members-only videos require current batch membership.
  Membership and consent are rechecked during flush. Student locks serialize flush/withdrawal/leave.
- With progress consent, a single identified progress row per student/course/video is upserted. Without
  it, no identified progress or quiz-attempt row is stored. Studio cannot see names or scores.
- To deduplicate totals and keep quizzes usable without sharing, two private receipt tables keep HMAC
  keys plus highest stage/pass flag. They contain no user id, phone, name, seconds or answers. These
  are **pseudonymous internal counters**, not a claim of irreversible anonymization. The HMAC key derives
  from `AUTH_TOKEN_SECRET`; rotating it requires preserving/migrating the receipt key to avoid recounts.
  The counters never reach Studio/exports. Aggregates stay after withdrawal, while identified progress
  and quiz scores are deleted. Re-consenting does not restore deleted history.
- Enrolment and required phone are account/course administration data even when progress sharing is off;
  neither is listed personally to an institute without the applicable consent.
- Funnel milestones are per course participant, using a separate course receipt: the same person in two
  courses counts twice. Milestones/join totals are cumulative; sharing counts are currently active
  choices. Per-video totals count student-video pairs. These meanings are returned with the API.
- A passed institute quiz currently means >=70%. This is an explicit server default pending the phase-2
  quiz editor. Correct answers stay server-side; no per-question answer key is returned, even on submit.
- Phase 1 permits only the source channel in published drafts. Outside channels are rejected until the
  institute-admin approval workflow is built; nothing is silently approved by an import or student.
- Only YouTube ids are stored in items/channel references. Subject/topic titles and institute branding
  are authored course metadata, not cached YouTube video titles, thumbnails or durations.

## Checks and remaining work

Tests use PostgreSQL-in-process and the HTTP route factory with real SQLite sessions. They cover org
isolation, immutable publishing, stripped private items/answer fields, unverified/unique phones, seat
races, private batch access after leaving, consent withdrawal while a milestone is queued, no identified
rows without consent, paging/filters/export auditing, CSV formula safety, OTP ownership, rate-limited join
code guessing, and 10,000 coalesced milestones yielding one progress row.

This is server groundwork, not the full pilot. Course import, the institute-admin approval workflow,
Control room/Studio/student UI, actual extension requests, consent/privacy/store review and release are
later steps. Don't move to Step 2 until the owner reviews Step 1. The website work was the base for this
branch at the owner's request; it has not been merged or deployed here.

Validation on this branch: typecheck passed; full suite 105 files / 969 tests passed; extension, website
and server builds passed. The server bundle also booted from an isolated temporary folder with no
node_modules: health returned 200 and an unconfigured institute request returned the intended 503.
No real Postgres service or live SMS was used, and visual browser verification remains unavailable.
