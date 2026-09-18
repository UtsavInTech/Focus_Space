# V5 engineering contract — "YouTube that learns how you learn"

V4 is working and unchanged by this document: relevance scoring ([RELEVANCE.md](RELEVANCE.md)),
learning path + Knowledge Map ([KNOWLEDGE.md](KNOWLEDGE.md)), and the moment-scoped AI companion
([AI_ARCHITECTURE.md](AI_ARCHITECTURE.md)) all stay as they are. V5 adds three things on top:
durable preference learning, grounded notes/mind-maps in Hindi/English, and a chat+voice layer with
a real provider abstraction. This document exists so three workstreams can build those in parallel
without stepping on each other's files or inventing incompatible shapes.

**Product guardrails that constrain every workstream below:**

- The rail stays simple — no new dashboard. New surfaces are additions to the existing "Learn with
  AI" section of `LearningPanel.tsx`, not new screens.
- Personalization > subscription. A repeatedly-watched, non-subscribed creator must be able to
  outrank a subscribed one (workstream 1).
- Creator chapters/description remain authoritative for structure; transcript and comments stay
  supporting evidence, in that order (unchanged from [KNOWLEDGE.md](KNOWLEDGE.md) — workstream 2
  extends it, never inverts it).
- AI never asserts uniqueness it can't support. "This teacher teaches X" is banned; "Instructor
  emphasis", "Instructor's approach", "Notable explanation" are the vocabulary, unless the context
  actually contains comparative evidence.
- No payments/subscriptions in this phase. Only clean provider/usage boundaries for future
  OpenRouter/OpenAI (workstream 3, §F).

---

## A. Shared data contracts / types

New, additive-only files — created now, in this change, so no workstream has to invent or
renegotiate a shape mid-flight:

| File | Owns | Consumed by |
| --- | --- | --- |
| `src/types/preferences.ts` | `PreferenceSignal`, `ChannelAffinity`, `TopicAffinity`, `PreferenceProfile` | WS1 (produces), relevance engine (consumes `ChannelAffinity` as a `ClassifyContext.channelScore` input) |
| `src/types/notes.ts` | `GeneratedNote`, `SavedNote`, `NoteRange`, `MindMapNode`, `NoteLanguage`, `NoteFormat` | WS2 (produces `GeneratedNote`), WS3 (wraps into `SavedNote`, persists) |
| `src/types/chat.ts` | `ChatMessage`, `ChatSession` | WS3 |
| `src/types/ai-provider.ts` | `ProviderId`, `ProviderCapabilities`, `AiUsageRecord` | WS3 |

Existing types these plug into (read, do not restructure, until the integration step in §H):

- `LearningContext` (`src/learning/context/context.ts`) — WS2 extends this in place (§C).
- `LearningMode`, `Channel`, `WatchEntry` (`src/types/domain.ts`) — read-only inputs to preference
  scoring (WS1) and to notes/chat context (WS2/WS3). Not modified by any workstream.
- `KnowledgeMap`, `KnowledgeNode`, `OutlineCandidate` (`src/learning/knowledge/types.ts`) — WS2 may
  add a new `KnowledgeSource` value (`'ai'` already reserved, base confidence 0.5 — see
  [KNOWLEDGE.md](KNOWLEDGE.md) limitations) but does not change existing node shapes.
- `AiAction`, `AiActionSpec`, `AiRequest`, `AiResult`, `AiProvider` (`src/learning/ai/actions.ts`,
  `service.ts`) — extended only at integration time (§H), by WS3, per §F.

**Rule:** a workstream may freely add new files and new fields to files it owns (§G). It may not
change a field's meaning or remove a field from a type another workstream reads, without a note in
this document.

## B. Event / message contracts

`src/types/messages.ts` (`MessageMap`) is single-owner-per-entry, append-only. Each workstream adds
its own keys at the end of the interface and never edits an existing line. Because this is the one
file all three workstreams must touch, merge it **sequentially in integration order (§H)**, not in
parallel — the second workstream to land rebases onto the first's addition instead of resolving a
conflict.

Planned additions (final shapes are each workstream's to design against these contracts; this is
the reserved namespace so no two workstreams pick the same key):

| Key | Owner | Direction | Req / Res (sketch) |
| --- | --- | --- | --- |
| `preferences/signal` | WS1 | content/ui → background | `{ signal: PreferenceSignal }` → `{ ok: true }` |
| `preferences/profile` | WS1 | any → background | `{ modeId: string }` → `PreferenceProfile` |
| `notes/generate` | WS2 | content → background | `{ context: LearningContext; range: NoteRange \| null; format: NoteFormat; language: NoteLanguage }` → `AiResult`-shaped, `answer` parsed by the caller into `GeneratedNote` |
| `notes/save` / `notes/list` / `notes/delete` | WS3 | content/dashboard → background | CRUD over `SavedNote[]`, keyed by `videoId` |
| `chat/send` | WS3 | content → background | `{ sessionId: string; context: LearningContext; text: string; voice?: boolean }` → `ChatMessage` |
| `chat/history` | WS3 | content → background | `{ videoId: string }` → `ChatSession \| null` |

`notes/generate` deliberately reuses the existing `ai/run` machinery rather than becoming a parallel
pipeline: WS2's job is producing the *prompt spec* for `'notes'` / `'mindmap'` actions (new
`AiAction` values), not a new transport. Whether it lands as new `AiAction` values on the existing
`ai/run` message or as the dedicated `notes/generate` message above is decided at integration
(§H, step 3) once both are in front of us — reserve the key either way.

## C. AI context contract

`LearningContext` (`src/learning/context/context.ts`, `CONTEXT_VERSION`) stays the single context
object handed to every AI surface — actions, notes, chat, voice all read the same shape. WS2 owns
this file and extends it additively:

- Add `language: NoteLanguage` (default `'en'`), set from `Settings` (a new field WS2 adds to
  `AiSettings` in `src/types/domain.ts` at integration time — see §H — not before).
- Add optional `range: NoteRange | null` to `ContextInputs` and a `LearningContext.range` output,
  so `buildLearningContext` can describe a *watched span* (for notes over a selection) instead of
  only an instant. `transcriptWindow` generalizes: when `range` is set, the window is the range
  itself (still capped at existing character budgets), not the ±90s/20s point window.
- Bump `CONTEXT_VERSION` to 2 when this lands. `aiCacheKey` (`ai/service.ts`) already includes
  `CONTEXT_VERSION`, so old cache entries invalidate for free — no cache-key work needed outside
  WS2's own file.

Nothing about the *moment* pipeline changes: `locateConcept` stays a local, network-free binary
search, and nothing on `timeupdate` reaches this file's network-touching consumers. The existing
`ai.test.ts` assertion (zero provider calls across a simulated hour of playback) must still hold
after WS2's changes — see §I.

## D. Preference scoring contract

Owned by WS1 (`src/learning/preferences/`, new). Inputs are signals already available without new
tracking machinery — `watchHistory` entries (`src/types/domain.ts`) already carry `progress`,
`videoId`, `channelId`/`channelTitle`(via join), `modeId`, `topicId`. WS1 adds `PreferenceSignal`
emission at existing signal points (watch progress ticks, AI-action use, explicit save) rather than
inventing new tracking; see `PreferenceSignalKind` in `src/types/preferences.ts` for the exhausted
set for this phase.

Scoring shape (mirrors the existing channel-relevance formula in
[RELEVANCE.md](RELEVANCE.md#channel-relevance-channelsts) so the two stay legible side by side):

```
ChannelAffinity.score = decay(lastSignalAt) × ( 0.45·completion rate
                                              + 0.20·rewatch rate
                                              + 0.20·ai-engagement rate
                                              + 0.15·explicit-save rate )
```

- **Decoupled from subscription.** `ChannelAffinity` never reads `Channel.source`. Subscription
  status is blended in only where it already lives — `ClassifyContext.channelScore`
  (`src/learning/relevance/types.ts`) — as a *second* term WS1 adds when wiring
  `channels.ts::channelScore()`:
  `effectiveChannelScore = max(ruleBasedChannelScore, behavioralAffinity)`, so a highly-watched
  unsubscribed creator can match or exceed a subscribed one with a thin history, never the reverse
  (a subscribed creator never scores below their rule-based profile because of this change).
- **Decay** matters more here than in channel profiles: preference should track what the learner is
  *currently* into, not a lifetime average. A simple exponential half-life (~21 days) is enough for
  this phase; tune in WS1's own tests, not in this document.
- **Cold start.** `sampleSize` below a floor (proposed: 3 signals) contributes 0 — an unsubscribed
  channel needs real repeat engagement before it can outrank rule-based scoring, matching the
  product principle ("*repeatedly* watches") without over-fitting to one video.
- **Learning-path continuity.** WS1 also owns the cross-video "what's next for you" signal — not
  the in-course "next" (`learning/path/path.ts` — untouched, still authoritative when a course
  exists), but the between-courses recommendation once a course is finished: which topic/creator
  the learner's affinity points to next. This is a new pure function in
  `src/learning/preferences/continuity.ts`, consumed by `content/data` at integration (§H), never a
  change to `path.ts`'s existing contract.

## E. Notes / mind-map persistence contract

Generation (WS2, `src/learning/notes/`) and persistence (WS3) are split deliberately so grounding
logic has no storage dependency and can be unit-tested against fixtures the same way
`knowledge.test.ts` and `ai.test.ts` already are:

- **WS2 produces `GeneratedNote`** (`src/types/notes.ts`) from a `LearningContext` (§C) plus a
  `NoteRange`. Grounding order for what goes into a note mirrors the Knowledge Map's own evidence
  order: chapters/description structure first (section boundaries, titles), transcript for content
  within a section, comments only as corroborating colour if already present in the map's evidence
  — never a fresh comment fetch triggered by notes. `conceptIds` on the result must all resolve to
  real `KnowledgeNode.id`s in the map the context was built from, so a note can always be traced
  back to where it came from.
- **Hindi/Hinglish/English.** `NoteLanguage` controls the *prose*; technical terms are not
  translated (a note in `hi` still says "linked list", not a transliteration/translation of it).
  This is a prompt-construction rule in WS2's own files, not a new type.
- **WS3 persists `SavedNote`** — a new top-level `StorageSchema` key (proposed name: `notes`,
  shape `Record<string, SavedNote[]>` keyed by `videoId`), added to `src/storage/schema.ts` at
  integration (§H), not by WS3 alone mid-flight (schema.ts is the other genuinely shared file —
  see §G exceptions). Until integration, WS3 develops against its own `src/storage/notes-store.ts`
  wrapping an in-memory/stub store with the same shape, swapped for the real schema key in one
  small diff at merge time.
- **Selection-range notes.** The "notes for a selected watched range, not just the whole video"
  requirement is exactly `NoteRange` — already in the type, WS2's generator already takes it. No
  separate mechanism needed.

## F. Provider abstraction

Owned by WS3. Today's `AiProvider` (`src/learning/ai/service.ts`) is correct in spirit — no keys in
the extension, availability-checked, cache-and-dedupe — and stays that way. WS3's job is widening it
without breaking the two providers that already work:

- `AiProvider.id` widens from `'chrome' | 'endpoint'` to `ProviderId` (`src/types/ai-provider.ts`).
  `'openrouter'` / `'openai'` are never called directly from the extension — they describe what the
  learner's own endpoint forwards to (matching the existing reference server pattern,
  `scripts/ai-endpoint/server.mjs`), exactly like today's `'endpoint'` provider already does for
  Anthropic. No new extension permissions, no new secret storage.
- Add `ProviderCapabilities` per provider so chat/voice/streaming can be offered only where
  supported, and so `actions` (today's five) keep working unconditionally — a provider that can't
  chat must still answer "Explain this".
- `AiUsageRecord` is append-only, local, small (matches `UsageLog`'s existing dormant-but-present
  pattern in `src/types/domain.ts`) — a count for the learner's own awareness, explicitly not a
  metering system for billing (no subscriptions this phase, per the product brief).
- This file (`ai/service.ts`) and `ai/actions.ts` are where WS2's new `'notes'`/`'mindmap'`
  `AiAction` values and WS3's `'chat'`/`'voice'` request shapes both land — see §G exception list.
  WS3 owns the actual edit; WS2 hands over its prompt spec (task text, window sizing, review rules
  — the same shape as `WINDOW_FOR`/`TASK` already in `actions.ts`) as data, not as a diff to a file
  it doesn't own.

## G. File ownership

**Exclusive** (only the listed workstream edits these; creating new files inside an owned directory
never needs coordination):

| Workstream | Owns |
| --- | --- |
| WS1 | `src/learning/preferences/**` (new), `src/learning/relevance/channels.ts`, `src/learning/library.ts` (wiring `channelScore` only), `src/types/preferences.ts` |
| WS2 | `src/learning/context/context.ts`, `src/learning/notes/**` (new), `src/learning/knowledge/**` (only if adding the reserved `'ai'` source — additive), `src/types/notes.ts` |
| WS3 | `src/learning/ai/service.ts`, `src/learning/ai/actions.ts`, `src/learning/ai/chat.ts` (new), `src/learning/ai/voice.ts` (new), `src/learning/ai/providers/**` (new), `src/storage/notes-store.ts` (new, pre-integration stub), `src/types/chat.ts`, `src/types/ai-provider.ts` |

**Shared — edit only at integration, sequentially, never in parallel** (§H order applies):

| File | Why it's shared | Who touches it, in order |
| --- | --- | --- |
| `src/types/messages.ts` | Single `MessageMap` interface | WS1 → WS2 → WS3, append-only, each a small diff |
| `src/storage/schema.ts` | Single `StorageSchema` interface + `defaultsFor`/`normalize` | WS1 (`preferenceProfiles` key) → WS3 (`notes`, `chatSessions` keys) |
| `src/types/domain.ts` | `AiSettings`/`Settings` gains `language` default (WS2) | WS2 only; WS1/WS3 don't need this file |
| `src/content/ui/LearningPanel.tsx` | The one rail surface all three add UI to | WS1 (nothing — preference ranking is invisible, feeds existing sections), WS2 (notes/mind-map chip + language toggle), WS3 (chat panel + voice control) — WS2 lands first so WS3's chat entry point sits below an already-working notes chip, not the reverse |

Everything not listed above and not inside an owned directory (§ tables) is existing V4 code no
workstream touches this phase.

## H. Integration order

1. **This change** — shared contracts (§A–F types, this document) land first, alone, so all three
   workstreams start from the same file set. Already done as of this commit.
2. **WS1 merges first.** Fully additive (new directory + two narrow, mechanical edits to
   `channels.ts`/`library.ts`), zero UI surface, zero dependency on WS2/WS3. Lowest risk, unblocks
   nothing but blocks nobody either — safe to go first.
3. **WS2 merges second.** Depends on nothing from WS1. WS3 depends on WS2's `GeneratedNote` shape
   and prompt spec being real (not just the type stub), so WS2 must land before WS3's notes-facing
   work is exercised end-to-end — WS3 can still develop chat/voice/provider work in parallel against
   the stubs, but the notes half of WS3 integrates after WS2.
4. **WS3 merges last.** Performs the two remaining shared-file edits (`schema.ts` notes/chat keys,
   `messages.ts` chat/voice keys — after WS1's own `messages.ts`/`schema.ts` entries are already in
   from step 2), wires WS2's notes generator into real persistence, widens `AiProvider`/`AiAction`.

Each step is a normal small PR/diff on top of the previous, not a big-bang merge — `messages.ts` and
`schema.ts` diffs specifically should be reviewed alone, separate from the workstream's feature
code, since that's where a silent conflict would actually hurt.

## I. Tests required before merging each workstream

All workstreams, before merge: `npm run typecheck`, `npm test` (full suite, not just new files) —
the existing suite (`path.test.ts`, `knowledge.test.ts`, `ai.test.ts`, `relevance.test.ts`,
`v3.test.ts`, `youtube.test.ts`) must stay green untouched, since none of them should need to
change for additive work.

- **WS1 (preferences):**
  - Affinity score for a rewatched, non-subscribed channel exceeds a once-watched subscribed one
    with equal-quality content (the core product claim — must be a named test, not incidental).
  - Cold start returns 0 below the sample-size floor.
  - Decay: a signal from 60+ days ago contributes materially less than one from today.
  - `channels.ts` change: existing `relevance.test.ts` A–E channel-ordering assertions still pass
    unmodified — behavioral affinity augments, doesn't reorder, the existing fixture-based ordering.
- **WS2 (notes/knowledge-map/context/language):**
  - `GeneratedNote.conceptIds` all resolve to real nodes in the source `KnowledgeMap` (grounding,
    not hallucinated structure).
  - A range-scoped note only draws on transcript/chapters within that range (no leakage from
    outside the selection).
  - Hindi output keeps technical terms (`markdown` in `'hi'` still contains e.g. "linked list"
    verbatim) — a fixture-based assertion, not a translation-quality one.
  - `CONTEXT_VERSION` bump: old cached `ai/service.ts` entries miss after the bump (reuses existing
    `aiCacheKey` behavior — assert, don't just assume).
  - Existing `ai.test.ts` zero-provider-calls-during-playback assertion still holds.
- **WS3 (chat/voice/persistence/providers):**
  - A widened `AiProvider.id` doesn't break the existing `'chrome' | 'endpoint'` selection logic in
    `pick()` (`ai/service.ts`) — existing provider-selection tests still pass.
  - Chat history round-trips through the store (save → list → matches).
  - `AiUsageRecord` is written on every provider call, including cached hits (`cached: true`), and
    never on a locally-answered action (`'what'` with no provider).
  - Voice turns produce the same `ChatMessage` shape as text turns (`voice: true` is the only
    difference) — no parallel schema for voice history.
  - A provider with `chat: false` in `ProviderCapabilities` falls back to single-shot actions
    without erroring the chat UI.

Integration-only tests (run once, at each §H merge step, in addition to the workstream's own):

- After WS1: full suite green, no relevance fixture changes needed.
- After WS2: full suite green; new `notes.test.ts` fixtures added.
- After WS3: full suite green; `messages.ts`/`schema.ts` diffs reviewed for exactly the additive
  keys listed in §G, nothing else.
