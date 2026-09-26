# FocusSpace — YouTube, organised around what you came for

> YouTube has the content. FocusSpace gives it structure.

FocusSpace is a Chrome extension (Manifest V3) with a website and an API behind it. Pick a **Space** — DSA, AI / ML, Punjabi music, anything — and YouTube is organised around it: your subscriptions first, the best matches from the rest of YouTube woven in, a learning rail instead of random suggestions, and Shorts and other attention traps gone. It still looks and behaves like YouTube.

Live at [focusspace.xyz](https://focusspace.xyz) · API at `api.focusspace.xyz` · version 0.5.0.

> **Proprietary.** This repository is not open source — see [LICENSE](LICENSE). Contributions are by invitation; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Project map

One repository, one `package.json`, three things that ship separately:

| Part | Folder | Built with | Ships to |
| --- | --- | --- | --- |
| **Extension** | `src/`, `public/`, `popup.html`, `dashboard.html` | `npm run build` → `dist/` | Chrome Web Store (`npm run package` → `release/`) |
| **Website** | `web/` | `npm run build:web` → `dist-web/` | Railway, `Dockerfile.web` + `Caddyfile.web` |
| **API** | `server/` | `npm run build:server` → `dist-server/` | Railway, `Dockerfile` |

```
src/                 the extension
  background/          service worker: sync, AI calls, account, Spaces allowance
  content/             everything inside youtube.com (bridge, YouTube DOM, data, React UI)
  dashboard/ popup/    the extension's own pages
  learning/            relevance, learning path, Knowledge Map, AI prompts, notes
  modes/               Spaces ("modes" in code): templates, intent inference
  storage/             typed chrome.storage schema, per-account data ownership
  billing/plans.ts     plan limits and prices — the one source the server and website also read
  ui/                  shared design system and components
  types/messages.ts    every message between UI and service worker
web/                 the website: home, pricing, sign-in, account, /connect (signs the extension in)
server/              the API: auth/, usage/ (metering), billing/ (Razorpay), notify/ (email)
scripts/             e2e suite, packaging, store screenshots, icon generation, dev AI endpoint
docs/                architecture, deploy and store guides, design records — start at docs/README.md
```

`dist*/`, `release/`, `data/` (local SQLite) and `e2e-artifacts/` are build output or local data and are gitignored. Leave the root files where they are: the Dockerfiles, `Caddyfile.web`, the HTML entry points and the Vite configs are read by the build and by Railway.

## What it does

| | |
| --- | --- |
| **Spaces** | Type what you want ("System Design", "Punjabi music") and FocusSpace infers topics, signals and search context — no keywords to configure. Optional channel search adds channels you like without subscribing. Built-in: DSA, Web Development, AI / ML, Data Science, SQL, Java, Relaxation. Switch from YouTube's home, YouTube's sidebar or the popup. |
| **Home** | Replaces "Recommended for you": a compact space menu and topic chips, **Continue watching** (resume, next in series, missed lectures), then **your subscriptions** ranked by relevance with a **YouTube discovery** after every four, a highlighted "Best match we found", infinite scroll, and channels to discover. Topics double as playlists you can add videos to. |
| **Your course** | When a video belongs to a real playlist — the one you're watching through, or the course playlist the creator links in the description — that playlist is the learning path: ✓ watched · ▶ you are here · → next **unwatched** · skipped lectures. Without one, numbered titles give a series that is labelled as a guess ("Appears to be next"). |
| **You're learning** | A Video Knowledge Map from the creator's chapters, description timestamps, viewer-written outlines in comments (jokes, requests and progress logs are ignored; agreeing comments count more) and the transcript. While you watch, FocusSpace shows the concept on screen, a clickable outline, and where it came from. |
| **FocusSpace AI** | *What am I learning?* · *Explain* · *Example* · *Quiz me* · *Ask about this moment*, plus a chat (typed or dictated) and **Make Notes** — notes or a mind map, in English, Hindi or Hinglish. Runs only when you ask, with only that moment's context. Hosted by FocusSpace and metered per plan; there is never an API key in the extension. |
| **Library** | Saved notes, mind maps and AI chats, filed under their Space, in the extension's dashboard. Saving needs a free account; signed out, you can still generate and chat. |
| **Watch page** | The player is untouched. The suggestion column becomes a learning rail: your course, what you're learning, then more from this creator, your subscriptions and the best from YouTube — all relevance-filtered. "Show YouTube's suggestions" is one click away. |
| **Search** | Unrelated results hidden, weak matches dimmed, matches from your library shown first, and a one-click "search with context" ("transformers" → "transformers machine learning"). |
| **Navigation** | Every FocusSpace link uses YouTube's own router: same tab, no reload, back/forward and scroll position preserved. |
| **Relevance** | Explainable rules engine (topic evidence, learning or media cues, noise penalties, channel profiles, hard threshold) — see [docs/RELEVANCE.md](docs/RELEVANCE.md). |
| **Focus Mode** | On: YouTube is filtered and organised around your Space. Off: normal YouTube. <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>. |

## Accounts and plans

FocusSpace works signed out. Signing in happens on the website — Google or email — and the website hands the session to the extension (`web/src/connect.ts`); the extension never holds an OAuth client or a Google token.

| | Signed out | Free account | Paid (Pro · Unlimited · Max) |
| --- | --- | --- | --- |
| Spaces | 3 | 5 | 15 · unlimited · unlimited |
| AI credits | 10 a day | 200 a month | 2,000 a month · unlimited · unlimited |
| Save to Library | — | ✓ | ✓ |

The table is a summary: **`src/billing/plans.ts` is the source of truth** for every limit and price (USD shown, INR charged through Razorpay). The server enforces them; the extension and website only display them.

## Quick start

Requirements: **Node.js 22** (the API uses `node:sqlite`) and Chrome 111+.

```bash
npm install
npm run build          # extension → dist/  (icons, typecheck, pages, service worker, content scripts)
npm run dev            # same, rebuilding on change
```

**Load it into Chrome:** `chrome://extensions` → **Developer mode** → **Load unpacked** → select `dist/`. After a rebuild, reload the extension there and refresh YouTube tabs.

**Website:**

```bash
npm run dev:web        # http://localhost:5174
npm run build:web      # → dist-web/
```

**API, locally:**

```bash
cp .env.example .env   # fill in OPENAI_API_KEY and AUTH_TOKEN_SECRET
npm run ai-api         # http://127.0.0.1:8788, verification codes printed instead of emailed
```

Build the extension and website against it with `VITE_API_URL=http://127.0.0.1:8788` (and `VITE_SITE_URL=http://localhost:5174`); `src/config.ts` bakes those in at build time.

## Testing

```bash
npm test               # unit tests (vitest) — extension, website and server
npm run typecheck
npm run build && npm run e2e   # end-to-end on live youtube.com in Chromium; screenshots in e2e-artifacts/
```

The e2e suite drives the real site signed out, against a local AI endpoint: first run, subscription-first feed, same-tab navigation timings, the learning rail and Knowledge Map, AI on click, search focus, Shorts, switching and creating Spaces, the popup, the dashboard, a narrow window, and no extension errors.

## Releasing

**The API first, always** — an extension talking to an older server can break. Deploy the API and check `/v1/health`, then the website, then package the extension. Details: [docs/DEPLOY.md](docs/DEPLOY.md) (Railway, variables, the database volume) and [docs/STORE.md](docs/STORE.md) (packaging and the store listing).

## How it works

- **Bridge (main world).** A 2 KB script runs in YouTube's page context: it navigates with YouTube's own SPA router (`yt-navigate`), shares the page's public client config and reads the captions the player loads. Everything else runs in the isolated content script.
- **CSS-first filtering.** One stylesheet gated by `data-fs-*` attributes on `<html>`; YouTube selectors live only in `src/content/youtube/selectors.ts`. The player is never modified.
- **Data.** On youtube.com, FocusSpace calls the same web API the page uses, from YouTube's origin with your existing session. The background keeps your channel library fresh from public uploads lists (relayed through an open YouTube tab) with RSS as a fallback.
- **Performance.** The service worker precomputes a small ready-to-render feed per Space (`feedViews`), so YouTube pages never classify the whole library; network calls are cached and de-duplicated; nothing on the playback path touches the network.
- **AI.** Every AI request goes through the service worker to the FocusSpace API, which holds the one OpenAI key and meters usage per account (or per install, signed out). Chrome's on-device model is an alternative where available.

Details: [docs/README.md](docs/README.md) indexes every doc.

## Permissions

| Permission | Why |
| --- | --- |
| `storage`, `unlimitedStorage` | Spaces, settings, watch progress, playlists, channel library, notes and cached results — locally. |
| `alarms` | Periodic library refresh. |
| `https://www.youtube.com/*` | Content script and bridge on YouTube, public channel data. |
| `https://focusspace.xyz/*` | The website, so it can sign the extension in and read your Spaces. |

## Privacy

Your Spaces, watch progress, notes and Library stay in `chrome.storage.local`, owned per account in that browser. The FocusSpace API stores your account (email; phone, name and city only if you give them), your plan and payments, AI usage records, and the names of Spaces created while signed in. When you use AI — only when you click — the current moment's context (video title, concept, a short transcript window, your question) is sent to the API and on to OpenAI; your history and subscriptions are not. The full statement is the website's privacy page (`web/src/content/legal.ts`).

## Limitations

- **YouTube's web API is not a public contract.** Parsers walk responses generically and are tested against captured responses, but a large YouTube change could need an update. `src/integrations/youtube/innertube-client.ts` is the single seam.
- **Background refresh needs a YouTube tab** for the uploads list (YouTube returns 403 to extension origins). With no YouTube tab open, the saved library is used until one is.
- **Relevance is rule-based**, not AI. Vague titles can be misjudged; allowing a channel or adding a topic fixes most cases.
- The sidebar section needs YouTube's full sidebar (not the collapsed mini-guide).
- **Transcripts** exist only for videos with captions, once the player has loaded them. Comment- and transcript-based outlines are heuristics and are labelled that way.
- **Creator playlists** are found when the description links them; very long playlists are checked against their first ~100 items.

## Known issues

Found in the first days after launch:

1. In Chrome, some buttons do not respond after opening the extension. (Now working)
2. The website UI needs more clean-up. (Done)
3. The FocusSpace AI bubble should hide when a video is played full screen (Working).

## License

Copyright © 2026 Utsav Kumar (UtsavInTech). All rights reserved. See [LICENSE](LICENSE).
