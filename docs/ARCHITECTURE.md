# FocusSpace architecture

This page is the Chrome extension's internals. The repository also holds the website (`web/`) and
the API (`server/`) — the [README's project map](../README.md#project-map) shows how the three fit.

```
                        chrome.storage.local  (typed schema: src/storage)
             settings · modes · watchHistory · topicPlaylists · channels · videos
             feedViews · relevanceCache · discoveryCache · sync
                  ▲                    ▲                       ▲
                  │ onChanged          │                       │
┌─────────────────┴──────┐  ┌──────────┴─────────┐  ┌──────────┴─────────────────────────┐
│ Popup / Space manager  │  │ Service worker     │  │ youtube.com                        │
│ src/popup, dashboard   │  │ src/background     │  │                                    │
│ focus toggle, spaces,  │  │ library sync,      │  │ bridge.js (MAIN world)             │
│ editor, subscriptions, │  │ feedViews warmer,  │  │   yt-navigate SPA router, ytcfg    │
│ settings               │  │ import, YouTube    │  │ content.js (isolated world)        │
└──────────┬─────────────┘  │ relay, alarms      │  │   controller: filters, slots,      │
           │ runtime msgs   └──────────┬─────────┘  │   watch data, progress, search     │
           └──────────────────────────►│◄──────────►│   React UI in shadow-root slots    │
                                                    └────────────────────────────────────┘
```

## Folders

| Path | Responsibility |
| --- | --- |
| `src/content/bridge` | Main-world bridge: SPA navigation through YouTube's router, page client config, read-only capture of the captions YouTube's player loads (+ explicit, restored caption loads). |
| `src/content/youtube` | All YouTube DOM knowledge: selectors, navigation events, CSS filter rules, search marks, SPA helper, fallback metadata, `captions.ts` (bridge messages). |
| `src/content/data` | Page InnerTube client (user's session), request cache, feed/discovery/continue-watching hooks, `series.ts` (learning path resolution), `knowledge.ts` (comments, map cache, playback concept). |
| `src/content/ui` | UI inside YouTube: `SpaceHome`, `WatchRail`, `LearningPanel` (Your course · You're learning · outline · AI actions), `SearchStrip`, `GuideSpaces`, cards, overlays. |
| `src/content/controller.ts` | Applies state to the page: flags, slot placement, watch data (cancellable), progress, scroll restoration. |
| `src/integrations/youtube` | Non-DOM YouTube knowledge: InnerTube parsers + client, `knowledge-parse.ts` (chapters, description playlists, comments), `transcript-parse.ts` (captions), URLs, RSS, channel resolution, subscriptions reader. |
| `src/learning` | Relevance engine (`relevance/`), library + channel profiles, `feed-view`, `discovery`, `feed`, `next` (series state); **V4:** `path/` (learning path), `knowledge/` (Knowledge Map: timestamps, description, comments, transcript segmentation, fusion, locate), `context/` (moment context), `ai/` (actions, prompts, service). |
| `src/modes` | Templates, space service, intent inference (`intent.ts`), icons, topic playlists. |
| `src/ui` | Design system, shared components (`CreateSpace`, `ChannelPicker`, …), `nav.tsx` (navigation context), `data.tsx` (YouTube data context). |
| `src/ai` | Classifier registry, sidekick, `on-device.ts` (Chrome Prompt API helpers). |
| `src/background` | Service worker: sync, relevance warmer, subscriptions import, YouTube relay, `ai.ts` (companion providers), session alarms (dormant). |
| `src/content/site-bridge.ts` | Content script on focusspace.xyz: tells the website the extension is installed, so it can hand over a sign-in. |
| `src/dashboard`, `src/popup` | The extension's own pages: dashboard (Home, Library, History, Spaces, Account, Settings) and the toolbar popup. |
| `src/storage` | Typed `chrome.storage.local` schema and migrations, per-account data ownership, notes and chat stores. |
| `src/messaging`, `src/types` | Typed runtime messages (`types/messages.ts` is the full list) and shared types. |
| `src/billing`, `src/config.ts` | Plan limits and prices (`plans.ts`, the single source the server and website also read); build-time API/site URLs. |
| `server/` | The API (Node 22, `node:sqlite`): `auth/`, `usage/` (metering, entitlements), `billing/` (Razorpay), `notify/` (email). |
| `web/` | The website (React + Vite): home, pricing, sign-in, account, the `/connect` page that signs the extension in. |

## Navigation (same tab, SPA)

FocusSpace links are real `<a href>` elements (middle-click/"open in new tab" work) rendered through `YtLink`. A plain click calls the `Navigator` from context:

- on youtube.com → `spaNavigate()` → `focusspace:navigate` event → bridge dispatches `yt-navigate` on `<ytd-app>` with a proper endpoint (watch, search, browse, playlist). If YouTube's router doesn't start within 1.5 s, it falls back to `location.assign`.
- on extension pages → background `youtube/open`, which reuses an open YouTube tab.

The controller reacts to `yt-navigate-start/finish`, `yt-page-data-updated`, `popstate` and a URL safety net. The home view is mounted on first visit and stays mounted, so topic, feed pages and discovery survive navigation; scroll is restored on back/forward.

## Content pipeline

```
Subscriptions + added channels ──► background sync (uploads via YouTube-tab relay, RSS fallback) ──► videos
                                                        │
                                          relevance warmer (debounced, cached)
                                                        ▼
                                   feedViews[space]: ranked items, topics, channel profiles (~KBs)
                                                        │
YouTube search for the space ──► rankDiscovery ─────────┤
YouTube recommendations (signed in) ──► rankDiscovery ──┤
                                                        ▼
                                composeFeed: sub sub sub sub DISCOVERY … ── "More from YouTube" ── …
```

- **Discovery** queries come from the space (`discoveryQueriesFor`); the first page per query is persisted for 12 h. Results are relevance-filtered with the space's own search counted as context (strongest for music/media spaces).
- **Continue watching** (`useContinueWatching`): FocusSpace progress (saved every few seconds while watching) + YouTube history progress (signed in) → resume items; the most recent video's series (playlist or numbered uploads) → missed/next (`learning/next.ts`), each with a confidence.
- **Watch rail** (V4): one `next` request per video (title, owner, description, chapters, playlist, related, comments token), then:
  1. **Your course**: playlist in URL → creator playlist linked in the description (verified to contain the video) → numbered series (labelled as a guess). "Next" = next unwatched ([KNOWLEDGE.md](KNOWLEDGE.md)).
  2. **You're learning**: Knowledge Map from chapters / description / comments / transcript, current concept from `video.currentTime` (local), outline, AI actions.
  3. More from this creator → from your subscriptions → best from YouTube → more related. Relevance never reorders the course.

## Learning intelligence (V4)

```
next response ──► chapters · description · playlist ids · comments token
comments (≤ 2 pages, only when chapters are missing/coarse) ─┐
captions captured by the bridge (or loaded on request) ──────┼─► buildKnowledgeMap (cached by signature)
space vocabulary ────────────────────────────────────────────┘        │
                                                                      ▼
video timeupdate ─► locateConcept (binary search) ─► current concept (state changes only on a new concept)
learner click ─► buildLearningContext (moment only) ─► 'ai/run' ─► service worker ─► endpoint | on-device
```

See [KNOWLEDGE.md](KNOWLEDGE.md) and [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md).

## Watch-page UI and theming

- **Colours.** FocusSpace owns its colours: light and dark tokens live in `content/ui/content.css`, keyed by `data-theme` on each slot. Only YouTube's theme is detected (`html[dark]`). YouTube's `--yt-spec-*` variables are never used; they aren't reliably available, and relying on them once rendered dark mode black-on-black. Neutrals match YouTube's palette.
- **Rail structure.** Header, then Your course, You're learning, Video knowledge map, Learn with AI, Discover. Sections are separated by hairlines rather than cards; the only card is an AI answer.
- **Typography:** 12 px labels, 14 px body, 18 px for the current concept.
- **Spacing:** 4/8/12/16/24 px (`--fs-s1…s5`).
- **Transitions:** 120–180 ms, no scaling beyond a 3 % press.
- **Knowledge map:** a window of 8 parts around "You are here", with an expandable full list that scrolls internally.

## Performance rules

- The player is never blocked: watch data loads after navigation and is aborted when the user moves on.
- Library-wide classification happens in the service worker; YouTube pages read `feedViews`.
- Every network call is cached and de-duplicated (`content/data/cache.ts`); discovery pages on scroll, one request at a time.
- MutationObserver callbacks ignore the player, comments, chat and FocusSpace's own slots; reconcile is throttled.
- Knowledge Maps build in an idle callback (~35 ms for a 5-hour course), are persisted per video and rebuilt only when their input signature changes.
- Playback → concept is a local binary search; nothing on the playback path touches the network or the AI.
- Comments are fetched after the player settles and only when needed; captions are read from what the player already loads, or loaded once when the learner asks.

## Adding things

- **A distraction filter:** `FilterPrefs` + presets (`storage/schema.ts`), selectors, a rule in `css-rules.ts`, the flag in `controller.apply()`, a row in `FilterEditor.tsx`.
- **A new YouTube data source:** parse in `innertube-parse.ts` (test with a captured fixture), expose in `innertube-client.ts`, cache in `content/data/youtube.ts`.
- **AI intent/classification:** implement `IntentEngine` (`modes/intent.ts`) or `VideoClassifier` (`learning/classifier.ts`) and register it — see AI_ARCHITECTURE.md.
- **An AI action:** add it to `AI_ACTIONS` and `TASK` in `learning/ai/actions.ts` and a chip in `content/ui/LearningPanel.tsx`.
- **A knowledge source:** produce `OutlineCandidate`s (with a `KnowledgeSource` and base confidence in `knowledge/types.ts`), add it to the ranked list in `knowledge/fuse.ts`, bump `KNOWLEDGE_VERSION`.

## When YouTube changes its page

YouTube ships layout changes without notice. FocusSpace is built so that a change degrades one feature, never YouTube itself:

- **One place knows YouTube's DOM** (`content/youtube/selectors.ts`), each selector with fallbacks; a new layout means adding a selector there and keeping the old one.
- **Fail open.** `content/youtube/health.ts` checks, a few seconds after each page settles, that every anchor FocusSpace depends on exists and that its own surfaces actually mounted. A missing one switches that feature's hiding CSS off for the session (the home feed, related videos, search filtering), so YouTube's own version shows.
- **Crash boundaries.** Every surface on youtube.com sits in its own `SurfaceBoundary`; a crash shows YouTube's version back and leaves the other surfaces running.
- **Knowing about it.** Issues are kept in `chrome.storage` (`health`) and shown in *Settings → YouTube compatibility*. With usage counts on, the daily ping carries the broken feature names only; the API logs them as `layout_drift features=…`.
- **Before learners notice.** `.github/workflows/youtube-canary.yml` runs `scripts/youtube-canary.ts` daily against live youtube.com with the same anchor list (`CRITICAL_ANCHORS`); a failed run emails the repository owners. Run it locally with `CANARY_CHANNEL=chrome npm run canary`.


## Institute pilot (implemented locally, not deployed)

Existing SQLite identity/session/billing → authenticated `user_id` → separate PostgreSQL `institutes`
schema. `server/institutes/db.ts` owns SQL and transactional migrations; `routes.ts` owns access checks;
`queue.ts` coalesces milestones before acknowledged commits. `import.ts` calls official YouTube Data API
list endpoints with the server-only key. Import JSON contains IDs and authored course labels, never
cached YouTube titles/thumbnails. Owner/admin approval is required for suggested outside channels.

Core tables: orgs, org_members, courses, course_versions, batches, students, enrollments, consents,
progress, course_stats, quizzes, quiz_attempts, assignments, audit_log; private HMAC receipt tables deduplicate
aggregate counters without named student progress. Import cache, channel approvals and Quiz me scores
are migrations 2–3. See [the exact route/table contracts](../server/institutes/README.md).

Website lazy routes: staff `/admin`, org `/studio`, student `/join/:code` and `/learn/:course`. Sharing
choices start off, are separate and revocable, and never gate course tools. Contact requires SMS proof.
Extension schema 6 keeps account-owned course JSON and ETags, compiles read-only institute modes outside
personal quotas, and refreshes on YouTube open/periodic ticks. Personal Spaces never send institute
milestones or scores. Offline cache remains usable; explicit access refusal removes course content.
No-institute learners retain their existing personal modes/settings. The signature branding is unchanged.

### Studio questions and reviewed outreach

Consent v2 shares an enrolled student's name and verified number with their institute as stated before joining. Identified progress, quiz scores and study activity remain opt-in. Migration 4 records the join notice and contact requests; migration 5 adds the Studio counselling tables described in `server/institutes/README.md`.

The existing Studio shell now includes Home/setup, Ask, Context, Playbooks and Results. A question follows PLAN → typed validation → org-scoped database RUN → minimized evidence → numeric-checked WRITE. Only `server/openai.ts` calls the provider; SQLite usage reservations enforce per-institute monthly budgets. Saved lists keep rules, not student snapshots. Context uses optimistic versioning. Message preparation rechecks consent after AI, requires manual review, and never sends. Staff record outcomes; rupee totals mean agreed fees, not proven revenue caused by FocusSpace. No new dependencies.
