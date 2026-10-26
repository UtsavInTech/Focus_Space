# Studio implementation report — 26 October 2026

Implemented on `feature/exam-paths-and-site-refresh`. All seven implementation steps are included below, as requested in one final report. Nothing was pushed, merged, deployed or published. No dependencies were added. Existing website signature branding and extension learning flows were retained.

## Verification and limits

- `npm run typecheck` — passed.
- `npm test` — **1,037 tests passed across 115 files**.
- `npm run build` — passed (extension and content/bridge/site bundles).
- `npm run build:web` — passed.
- `npm run build:server` — passed.
- `git diff --check` — passed.
- Earlier checkpoints for navigation and onboarding passed their full check sets; the final checks above cover the integrated Context, Ask, Playbooks, Results and demo work together. They are not seven independently isolated build results.
- PostgreSQL logic is tested with PGlite, including real SQL, constraints and transactions. This does not replace production PostgreSQL concurrency/load testing.
- **Screenshots and browser acceptance are blocked:** the browser tool rejected access to localhost due to a saved browser permission setting. No alternate browser, Playwright or network workaround was used. Light/Deep, phone width, keyboard and reduced-motion support are implemented in source, but this report does not claim a completed visual or WCAG AA audit. The five-second checklist below is a copy/navigation review, not a measured user study.
- Live provider behaviour was not exercised. The fake planner contract has ten evaluated questions; it does not establish real-model accuracy.

## Step 1 — Navigation and understandable pages

Extended the existing Studio shell with Search, Home, Ask, Requests, Students, Playbooks, Results, Courses, Context and Morning brief. Home has an ask box, five suggested questions, setup status, recorded fees, the existing daily story/actions and recent destinations. Search supports institute-wide student names/numbers, loaded course lessons, pages and recent threads. Saved lists rerun current rules and support more pages; pinned questions reopen their conversation. Recent students, course rooms and conversations are kept during the session.

Added one shared glossary and purpose sentence for every page. Phone navigation has labelled horizontal links and an expandable Saved area. Forms, tables and dialogs use existing theme tokens, focus outlines and responsive layouts. Motion respects reduced-motion preferences. URL round-trip tests include all new destinations.

### Five-second copy/navigation checklist

- [x] Home: “Ask about students, finish setup, or choose today's next action.”
- [x] Search: “Find a student by name/number or jump to a page, course or conversation.”
- [x] Ask: “Type a question; inspect the records and how they were selected.”
- [x] Requests: “These students asked to hear from us; call and record what happened.”
- [x] Students: “Find someone, see their sharing choice and open their report.”
- [x] Student report: “Read permitted study facts and record a contact outcome.”
- [x] Playbooks: “Choose matching rules, review a draft, then contact the student yourself.”
- [x] Results: “See staff-recorded enrolments and agreed fees; download or print the month.”
- [x] Courses/lecture rooms: “Open the teaching path and inspect lecture activity.”
- [x] Context: “Save course facts and approve the assistant's writing preferences.”
- [x] Morning brief: “Review today's summary and copy it for the team.”
- [ ] Confirm these interpretations with a counsellor in Light, Deep and phone layouts once browser access is permitted.

## Step 2 — Server-derived onboarding

The setup route computes seven items from institute records: successful imported/published course, joined batch, published quiz, today's class, filled Context, faculty access and reviewed playbook. No browser-stored completion claims. Context requires nonempty institute copy, a named course and at least three nonempty examples. Completed checklists can be dismissed for the mounted session.

Checks cover institute isolation and distinguish merely published content from an imported course. Course/batch/quiz/faculty changes remain in the existing staff Control room; the checklist explains that institute staff should work with their FocusSpace staff contact. No new invitation/email service was invented.

## Step 3 — Context and lessons from edits

Added versioned institute Context with course prices/dates/modes/centres, offers, counsellor details, language, tone, prohibited claims, examples and approved rules. Optimistic version checking rejects stale writes. Every save is audited.

Only edits to sent AI-personalised drafts feed lessons; skipped drafts do not teach the assistant. Summarisation removes student names and phone patterns and proposes general rules. Staff explicitly approve/delete and save rules. The callback number is added after AI drafting. Consent withdrawal or leaving a course clears stored drafts, evidence and edit examples for that student.

Checks cover validation, version conflicts, institute isolation, edit capture and withdrawal cleanup.

## Step 4 — Grounded Ask

Implemented PLAN → validated typed functions → database RUN → minimized evidence → checked WRITE through the existing OpenAI wrapper. The whitelist has seven read-only functions. Student lookup stays on the server; analysis uses pseudonyms. Tables and displayed counts come from SQL. Unsupported numeric prose is replaced with a notice next to the actual records. Threads store redacted questions and plans, not report snapshots; reopened queries use current consent.

Answers include sortable tables, saved lists, playbook creation, filter explanations and follow-up questions. Saved conversations expose earlier questions. The provider sees no structured phone/callback fields or raw contact-request notes. Input text is phone-redacted too.

Added per-institute token accounting to the existing SQLite usage service. Reservations enforce a hard monthly ceiling before calling the provider. Success settles to reported usage; uncertain failures keep their reservation. The interface identifies fake/live mode and charged/reserved tokens.

Checks include ten fake-planner questions, unknown function/parameter rejection, organisation boundaries, consent filters (including zero thresholds), name/phone minimisation, numerical grounding and budget refusal. A numeric-evidence check cannot prove that every sentence is semantically correct; human message review remains required.

## Step 5 — Reviewed playbooks

Added the five requested starting points, editable thresholds/course selection/contact recency, templates, optional AI drafting, language-aware greetings, line explanations and WhatsApp/call/copy channels. Review and sending are separate explicit actions. Bulk preparation is capped at ten per action; staff must confirm each message before recording it sent. Keyboard shortcuts: J edits the first draft; Alt+S skips it; Escape closes the rule editor. Autopilot is disabled.

Matching is computed on demand. A database constraint prevents two open playbook claims for one student. Already contacted/skipped students are excluded before pagination; a specific later-page student is checked independently. Free-course rules count only free-course study. Returning-student rules use actual recorded study-day gaps rather than assuming that old activity means a return.

Checks cover queue deduplication, later-page claims, completed-review exclusion, free versus paid course metrics, actual study gaps, consent withdrawal and isolation. Study-day history starts with this version; it cannot reconstruct older attendance. Message preparation is explicit rather than generating every queue draft on load, to avoid surprise AI spending.

## Step 6 — Outcomes and Results

Outcome recording is available from student reports, requests, student lists, answer tables and reviewed queues. Enrolled requires a named paid course and positive integer rupee fee. Repeated student/course enrolment is rejected; course labels are matched without case or surrounding-space differences. Playbook attribution requires a message recorded as sent.

Results uses India-calendar month boundaries, with per-playbook queued/contacted/interested/enrolled/fee totals, messages linked to the most enrolments, CSV export and a print layout. Fee totals appear on Home and in the copied Morning brief. CSV cells neutralise spreadsheet formula prefixes. Former students' names are not newly disclosed through results, and their stored drafts are cleared on departure.

**Product decision:** say “your team recorded” and “agreed fees”, not “FocusSpace earned/brought you”. These records cannot prove money was collected or that our software caused a purchase. Best-message ranking is an association (enrolled students, then fees), not a causal experiment. For Indian coaching institutes, automatic outreach and promises of marks, selection or scholarship would be poor defaults; staff review and approved facts are safer and more credible.

## Step 7 — Demo, disclosures and documentation

The local fixture includes 180 fictional students, six weeks of study/outreach/outcomes, institute Context, five playbooks and saved questions. Added free-course quiz fixtures so free-course matching demonstrates the intended behaviour. `--serve-only` runs the site and API without browser automation; fictional lesson fixtures are labelled. AI is fake unless the process is explicitly given an OpenAI key, and the mode is displayed. Seed setup invokes no provider; fake responses meter zero provider tokens.

Updated privacy content, the plain data summary and Store disclosure to explain staff questions, drafts/edits, provider data minimisation, recorded outcomes and fees. The new disclosure text was shown in the conversation before committing. Updated architecture, deployment variables and server routes/tables/AI rules. No new retention purge is claimed: business outcomes remain institute records, while identified study-derived drafts/edits are removed on withdrawal/departure.

### Local review

- Website: `http://localhost:5174/studio`.
- Demo owner: `demo-faculty@example.com`.
- Password: `demo-password-2026`.
- Demo SMS code, if needed: `000000`.
- This run uses demo API ports 8792/8793 to avoid other existing local services.
- Launch: `DEMO_API_PORT=8792 DEMO_REAL_PORT=8793 node scripts/institute-demo.mjs --serve-only --keep`.

No screenshots are attached: the browser permission block prevented capture. The implementation and automated checks are complete; visual review in the running demo remains the explicit verification limitation.
