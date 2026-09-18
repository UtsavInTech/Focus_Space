# FocusSpace — YouTube, organised around what you came for

> YouTube has the content. FocusSpace gives it structure.

FocusSpace is a Chrome extension (Manifest V3). Pick a **space** — DSA, AI / ML, Punjabi music, anything — and YouTube is organised around it: your subscriptions first, the best matches from the rest of YouTube woven in, a learning rail instead of random suggestions, and Shorts and other attention traps gone. It still looks and behaves like YouTube.

## What it does

| | |
| --- | --- |
| **Spaces** | Type what you want ("System Design", "Punjabi music") and FocusSpace infers topics, signals and search context — no keywords to configure. Optional channel search adds channels you like without subscribing. Built-in: DSA, Web Development, AI / ML, Data Science, SQL, Java, Relaxation. Switch from YouTube's home, YouTube's sidebar or the popup. |
| **Home** | Replaces "Recommended for you": a compact space menu and topic chips, **Continue watching** (resume, next in series, missed lectures), then **your subscriptions** ranked by relevance with a **YouTube discovery** after every four, a highlighted "Best match we found", infinite scroll, and channels to discover. Topics double as playlists you can add videos to. |
| **Your course** | When a video belongs to a real playlist — the one you're watching through, or the course playlist the creator links in the description — that playlist is the learning path: ✓ watched · ▶ you are here · → next **unwatched** · skipped lectures. Without one, numbered titles give a series that is labelled as a guess ("Appears to be next"). |
| **You're learning** | A Video Knowledge Map from the creator's chapters, description timestamps, viewer-written outlines in comments (read carefully: jokes, requests and progress logs are ignored; agreeing comments count more) and the transcript. While you watch, FocusSpace shows the concept on screen ("Insert in a Linked List · Up next: Display at 26:50"), a clickable outline, and where it came from. |
| **Learning companion** | *What am I learning?* · *Explain* · *Example* · *Quiz me* · *Ask about this moment*. Runs only when you click, with only that moment's context (concept, neighbours, course position, a short transcript window). Chrome's on-device AI or your own endpoint — never an API key in the extension. "What am I learning?" works without AI. |
| **Watch page** | The player is untouched. The suggestion column becomes a learning rail: your course, what you're learning, then more from this creator, your subscriptions and the best from YouTube — all relevance-filtered. "Show YouTube's suggestions" is one click away. |
| **Search** | Unrelated results hidden, weak matches dimmed, matches from your library shown first, and a one-click "search with context" ("transformers" → "transformers machine learning"). |
| **Navigation** | Every FocusSpace link uses YouTube's own router: same tab, no reload, back/forward and scroll position preserved. |
| **Relevance** | Explainable rules engine (topic evidence, learning or media cues, noise penalties, channel profiles, hard threshold) — see [docs/RELEVANCE.md](docs/RELEVANCE.md). Applied to subscriptions, discovery, search and the rail. |
| **Focus Mode** | On: YouTube is filtered and organised around your space. Off: normal YouTube. <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>. Advanced filtering lives in Settings. |

Session timers, daily budgets and learning-session UI from V1 are dormant in V3 (the storage, logic and background alarms remain for a future accountability release).

## Quick start

Requirements: Node.js 18+ (tested with Node 22) and Chrome 111+.

```bash
npm install
```

```bash
npm run build
```

Build output goes to `dist/` (icons, typecheck, pages + service worker, content script, main-world bridge).

### Load it into Chrome

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → select the **`dist`** folder.
3. FocusSpace opens YouTube and asks "What do you want to focus on?".
4. Optional: on the home, open the space menu → "Import my subscriptions" (you need to be signed in to YouTube), or add channels when creating a space.

After rebuilding, reload the extension in `chrome://extensions` and refresh YouTube tabs.

```bash
npm run dev
```

Rebuilds `dist/` on change (reload the extension to pick it up).

### The website

The public site — home, pricing and FAQ, the pages the launcher in the watch rail and the popup
open — is a separate static build in `web/`:

```bash
npm run dev:web     # http://localhost:5174
npm run build:web   # → dist-web/, deploy as static files
```

It shares the extension's design tokens (`src/ui/styles.css`) and its price book lives in
`web/src/content/plans.ts`, where each plan's `aiCredits` is the same unit the server meters in
`server/usage/cost.ts`. Point a build at a different deployment with `VITE_SITE_URL` and
`VITE_API_URL` (see `src/config.ts`).

### Learning companion (optional)

- **On-device:** in Chrome 138+ with on-device AI support, *Settings → Learning companion → Download model* once. Nothing leaves the browser.
- **Your own endpoint** (keeps the API key on your machine):

```bash
OPENROUTER_API_KEY=your-key npm run ai-endpoint
```

Then set *Settings → Learning companion → My endpoint* to `http://127.0.0.1:8787/v1/moment`.

## Testing

```bash
npm test
```

Unit tests: relevance model (including real channel data), YouTube response parsers against captured real responses, intent inference, feed composition, series continuity, discovery ranking, URLs, RSS, subscriptions parsing; **V4:** learning path (next unwatched, skipped, playlist vs. guessed series), Knowledge Map (chapters, description timestamps, real comment outlines and noise, agreement/conflicts, transcript segmentation checked against an independent viewer outline, fusion and hierarchy, concept boundaries), learning context and AI service (moment-only context, transcript window, caching, zero AI calls during playback).

```bash
npm run typecheck
```

```bash
npm run build && npm run e2e
```

End-to-end on live youtube.com (signed out) in Chromium: **V4** — creator playlist from the description as the course, description timestamps as the outline and the current concept at 17:32, seeking from the outline, an outline built from viewer comments, AI only on click with the moment's context (local test endpoint, captions loaded and the caption preference restored, cached repeat, "Ask about this moment"), "What am I learning?" without AI; **V3** — first run; adding channels; subscription-first feed with discovery after four; topics; infinite scroll; **same-tab SPA navigation with timings** (click → player, click → rail, back); rail relevance; back restores topic and scroll; Continue watching; numbered and playlist series; save to topic; search focus; Shorts; switching spaces from the sidebar; creating "Punjabi music" with channel search "Karan"; topic playlists; Focus off; popup reusing the YouTube tab; space manager; narrow window; no extension errors. Screenshots in `e2e-artifacts/`.

## How it works

- **Bridge (main world).** A 2 KB script runs in YouTube's page context and does two things: navigates with YouTube's own SPA router (`yt-navigate`) and shares the page's public client config. Everything else runs in the isolated content script.
- **CSS-first filtering.** One stylesheet gated by `data-fs-*` attributes on `<html>`; YouTube selectors live only in `src/content/youtube/selectors.ts`. The player is never modified.
- **Data.** On youtube.com, FocusSpace calls the same web API the page uses (search, watch data, playlists, channel search; your history and recommendations when signed in) from YouTube's origin with your existing session. The background keeps your channel library fresh from public uploads lists (relayed through an open YouTube tab — YouTube rejects extension origins) with RSS as a fallback.
- **Performance.** The service worker precomputes a small ready-to-render feed per space (`feedViews`), so YouTube pages never classify the whole library; discovery, playlists and watch data are cached and de-duplicated; watch-page data is cancellable and never blocks the player; DOM churn from the player, comments and chat is ignored.

- **Learning intelligence (V4).** The bridge reads the captions YouTube's player loads (direct transcript requests are rejected). Knowledge Maps are built locally from chapters, description, comments and transcript with per-item confidence, cached per video, and the current concept is computed from `video.currentTime` without any network request.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/KNOWLEDGE.md](docs/KNOWLEDGE.md) · [docs/RELEVANCE.md](docs/RELEVANCE.md) · [docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md).

## Account (optional)

FocusSpace works fully signed out. An account carries your AI allowance and spaces across devices.

- **Where:** the FocusSpace section of YouTube's sidebar → **Sign in / Create account**, or Settings → Account.
- **Ways in:** email (a 6-digit code confirms the address, then you choose a password), email + password afterwards, or a phone number with a one-time code.
- **Free plan:** a monthly AI allowance and up to 4 spaces, both enforced by the server. Signed out, the AI companion has a small daily allowance so you can try it.
- **Run the server:**

```bash
OPENROUTER_API_KEY=your-key AUTH_TOKEN_SECRET=$(openssl rand -base64 32) AUTH_DEV_CODES=1 npm run ai-api
```

Then set Settings → Account → FocusSpace server to `http://127.0.0.1:8788`. No email or SMS provider is configured by default: codes are printed by the server and shown in the UI as development codes. `AUTH_DEV_CODES=1` is refused in production — connect a real provider in `server/notify/sender.ts` before deploying. See [docs/LAYER_2B_IDENTITY.md](docs/LAYER_2B_IDENTITY.md).

## Permissions

| Permission | Why |
| --- | --- |
| `storage`, `unlimitedStorage` | Spaces, settings, watch progress, playlists, channel library and cached relevance/discovery results — locally. |
| `alarms` | Periodic library refresh. |
| `https://www.youtube.com/*` | Content script + bridge on YouTube, public channel data. |

## Privacy

No FocusSpace server, account or analytics; all data stays in `chrome.storage.local`. Requests go only to youtube.com, and on YouTube they are the same kind of requests the page itself makes for you. The one exception is the learning companion when you configure your own endpoint: then, and only when you click, that server receives the current moment's context (never your history or subscriptions). Settings → Privacy explains exactly what is requested.

## Limitations

- **YouTube's web API is not a public contract.** Parsers walk responses generically and are covered by tests against captured responses, but a large YouTube change could need an update. The official Data API (OAuth) would be the long-term replacement; `src/integrations/youtube/innertube-client.ts` is the single seam.
- **Background refresh needs a YouTube tab** for the uploads list (YouTube returns 403 to extension origins, and its RSS feeds currently return 404). With no YouTube tab open, the saved library is used until one is.
- **Watch history.** "Continue watching" uses FocusSpace's own progress and, when signed in, the history and progress YouTube shows you. It never claims to know more; series answers carry a confidence ("Next in…", "Appears to be next…").
- **Relevance is rule-based**, not AI. Vague titles can be misjudged; allowing a channel or adding a topic fixes most cases.
- The sidebar section needs YouTube's full sidebar (not the collapsed mini-guide).
- **Transcripts** exist only for videos with captions, and only once YouTube's player has loaded them (some videos load them automatically; otherwise when you ask). Comment- and transcript-based outlines are heuristics and are labelled that way.
- **Creator playlists** are found when the description links them; very long playlists are checked against their first ~100 items.

## Roadmap

V1 Focused YouTube ✅ · V2 Relevance & subscription intelligence ✅ · V3 Spaces, discovery, series continuity, YouTube-native UX ✅ · V4 Learning path, Video Knowledge Map, moment-aware companion ✅ · Next: learning plans across videos, AI refinement of transcript-only outlines, more companion actions (notes, flashcards, interview questions).
