# Institutes, Phase 1 pilot

Phase 1 pilot implementation is built locally: Postgres APIs, official playlist import, staff Control room,
read-only Studio metrics with institute channel approval, student enrolment/consent pages, and cached
read-only extension Spaces. This is not a public launch. No institute partnership or deployment is claimed.

## Storage and identity

[Postgres.js](https://github.com/porsager/postgres) (`postgres`) is the sole runtime dependency added. It supplies a bounded connection pool and transactions.
[PGlite](https://pglite.dev/docs/) (`@electric-sql/pglite`) is a **development-only** dependency: tests execute the same PostgreSQL SQL in
process, with real JSONB, constraints, rollback and triggers, without a Postgres server. It does not
simulate a multi-process Postgres deployment; run integration/load tests against Railway before release.

`DATABASE_URL` selects Postgres for the `institutes` schema only. Identity, sessions, billing and usage
stay in SQLite. The key joining them is the authenticated `user_id`. SQL lives only in `db.ts`; test
SQL is used only to inspect invariants. Migration versions 1–3 run under a transaction/advisory lock.
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
| POST | `/v1/admin/orgs/:org/courses/:course/import` | Official API import; explicit daily cache, requires server `YOUTUBE_API_KEY` |
| GET, POST | `/v1/admin/orgs/:org/batches` | List/create; creation needs `courseId,name,seats`, optional epoch-ms dates |
| POST | `/v1/admin/orgs/:org/batches/:batch/settings` | `{status:active\|paused,seats}`; cannot reduce below active enrolment |
| POST | `/v1/admin/orgs/:org/batches/:batch/rotate` | `{}`; invalidates old join code |
| POST | `/v1/admin/orgs/:org/batches/:batch/assignments` | `{itemRef,kind:today\|homework,note?,dueOn?}`; course item must exist |
| POST | `/v1/admin/orgs/:org/courses/:course/quizzes` | Staff-only draft with `videoId,questions` (server keeps answer indices) |
| POST | `/v1/admin/orgs/:org/quizzes/:quiz/publish` | `{}`; staff approval |
| GET | `/v1/studio/:org/funnel` | Org staff only: aggregate funnel and video completion/drop-off |
| GET | `/v1/studio/:org/students` | Org staff only: every enrolled student (name, verified number, flags); progress, quiz, watch time and activity only for progress-sharing students. `priority=1` for "contact me" only |
| GET | `/v1/studio/:org/students/:user` | Org staff only: one student's report (lectures, quizzes with times, requests); progress parts only with progress sharing; audited |
| GET | `/v1/studio/:org/activity` | Org staff only: lecture starts and completions per day for eight weeks, from anonymous daily totals |
| GET | `/v1/studio/:org/outline` | Org staff only: `?courseId=` latest published course, with lesson titles held in memory for a day |
| GET | `/v1/studio/:org/requests` | Org staff only: "contact me" requests, open first |
| POST | `/v1/studio/:org/requests/:id/handled` | Org staff only: marks a request done; audited |
| GET | `/v1/studio/:org/leads.csv` | Org staff only: paged list of enrolled students with name, number and "contact me"; audited |
| POST | `/v1/institutes/contact` | Student: `{orgId,courseId,note?}` — "Talk to your faculty": turns "contact me" on and raises one open request |

**Owner's decision, 26 Oct 2026 (consent v2).** Joining any institute course, free or batch, needs a verified
Indian mobile, and the institute receives the student's name and that number. The join page says so before
joining, and the notice version is stored on the enrolment (`terms_version`). This is a deliberate business
choice with known legal risk under India's DPDP Act for free courses; a lawyer should review the join page
before the first paid contract.

Consent input: `{textVersion:'institute-consent-v2',progress:false,contact:false}`. Both remaining choices must
be explicit booleans, never inferred/truthy, and start off. `progress` shares identified progress, quiz scores,
watch time and study days. `contact` means "Yes, contact me": the student goes first in the institute's list
and a request lands in its inbox (`contact_requests`); withdrawing it closes open requests. Choices are org-wide.
Leaving the last course in an org withdraws both; leaving one of several courses does not revoke the others.

Phone: accept an Indian mobile in `+91` E.164 or 10-digit form; store normalized E.164, unique across all
institute students. A phone is fixed once registered (no phone-change flow yet). It must be proven before
joining: by the existing SMS code (`/v1/institutes/phone/start|verify`), or by a session that signed in with
that same phone. The existing SMS provider, code expiry, attempt limits and one-time consumption are reused.
An OTP for another account cannot attach that account's phone to this one. No SMS provider means an honest
refusal, not a fake verification (the local demo alone accepts `000000`, and says so on screen).

Student/lead filters: `courseId`, `minCompletion` (percentage), `minQuizScore` (percentage), `limit`
(1–500), `after` (last returned user id). JSON gives `next`; CSV gives `X-Next-Cursor`. Students who
don't share progress never expose progress/scores, and therefore never match performance filters. CSV values are
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
- Published drafts require the source channel. Outside channels require an org owner/admin approval in
  Studio; faculty and FocusSpace staff cannot grant that approval through the suggestion endpoint.
- Only YouTube ids are stored in items/channel references. Subject/topic titles and institute branding
  are authored course metadata, not cached YouTube video titles, thumbnails or durations.

## Import and extension decisions

- `YOUTUBE_API_KEY` is server-only. Import uses official channels/playlists/playlistItems list endpoints,
  pages of 50, at most 100 playlists and 5,000 videos. Playlist titles exist transiently for taxonomy
  matching; persisted labels come from our catalog or `Playlist N`/`Other`. Staff reviews before publishing.
- Imports are explicit and cached per course for 24 hours. A failed/in-flight attempt also holds that
  course's daily claim, preventing repeated quota consumption. Duplicate pagination tokens fail closed.
- Outside-channel approval is a limited Studio write exception; metrics and student data remain read-only.
  Staff adds the approved id to the reviewed draft. Suggestions/approvals are audited.
- Extension schema 6 owns `instituteCache` per account. Refresh on YouTube open and the periodic tick;
  version payloads use ETag. Offline uses cache; explicit 401/403/404 discards inaccessible content.
  Institute Spaces bypass personal quotas, keep course order and disable discovery/Shorts.
- Started is positive watched progress, half is 50%, completed is 80% (the existing completion convention).
  Milestones coalesce in memory for 1.5 seconds, at most 100 distinct pending videos, with five network
  attempts. Browser shutdown can lose pending milestones; this is not guaranteed delivery. The server
  itself acknowledges only committed writes. Quiz me scores are self-reported study results, not
  authenticated examination results; server-graded institute quizzes are separate.
- Privacy and Store wording was reviewed and approved by the owner on 25 October 2026. Nothing was submitted.

## Additional routes and tables

| Method | Path | Result |
| --- | --- | --- |
| POST | `/v1/institutes/quiz-score` | Own enrolled video score; stores only with current progress consent |
| POST | `/v1/admin/orgs/:org/courses/:course/suggestions` | Staff suggests an outside channel |
| GET | `/v1/studio/:org/courses` | Org course list |
| GET | `/v1/studio/:org/channels?courseId=...` | Org course suggestions/approvals |
| POST | `/v1/studio/:org/channels` | Owner/admin approves `{courseId,channelId}` |

Migration 2 adds `import_cache` and `channel_approvals`; migration 3 adds `quizme_scores`.
Website routes are `/admin`, `/studio`, `/join/:code`, `/learn/:course`; account has course sharing cards.

## Checks and release boundaries

Tests execute PostgreSQL SQL with PGlite and HTTP routes with real SQLite sessions. They cover organisation
isolation, immutable versions, members-only stripping, private quiz answers, phone uniqueness/verification,
seat races, consent withdrawal, bounded 10,000-event coalescing, import caching, approval roles, ETag/offline
refresh and personal-Space reporting isolation. The extension, website and API have separate builds.

Before public launch, verify a real Postgres service under concurrency/load, live YouTube import quota,
SMS delivery, production configuration and manual extension/browser flows. Browser visual QA was unavailable
because saved browser permissions denied access; no screenshot validation is claimed. No new public
service, phone/tablet player, institute billing, CRM integration or faculty quiz editor is included.
