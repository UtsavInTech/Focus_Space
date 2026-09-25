# Chrome Web Store submission

Everything the listing asks for, written out. Build and package with:

```bash
VITE_API_URL=https://api.focusspace.xyz VITE_SITE_URL=https://focusspace.xyz npm run build
npm run package            # → release/focusspace-<version>.zip
```

`npm run package` refuses to build a package whose service worker still points
at localhost, or has no API URL baked in at all — both produce an extension
that installs fine and then silently fails, which is the worst thing to
discover after a review.

---

## Listing

**Name:** FocusSpace — Intent-Driven Learning for YouTube

**Short description** (132 characters max)

> Tell YouTube what you came to learn. FocusSpace ranks your subscriptions around it, hides the noise, and turns videos into notes.

**Category:** Productivity
**Language:** English

**Detailed description**

> YouTube has the content. FocusSpace gives it structure.
>
> Pick what you are learning — DSA, system design, Punjabi music, anything — and YouTube reorganises around it. Your own subscriptions come first, ranked by how well they match what you are actually studying, with the best of the wider YouTube woven in. Shorts and the other attention traps are gone.
>
> On a video, FocusSpace follows the course you are on. When the creator links a playlist, that playlist becomes your learning path: what you have watched, where you are, what is genuinely next, and what you skipped. It reads the creator's chapters, the timestamps in the description, the outlines viewers write in the comments and the transcript, and builds a map of the lecture — then tells you which part you are in as you watch.
>
> When you want help, it is there: explain this moment, give me an example, quiz me on this, make me notes, draw me a mind map. Notes and mind maps are grounded in the part of the video you actually watched, and come in English, हिंदी or Hinglish — technical terms left alone, because that is what you will be examined on.
>
> • No API key to bring. It works the moment you install it.
> • No account needed to start.
> • Your watch history and subscriptions never leave your browser.
> • The player is never touched, and Focus Mode turns off in one click.
>
> Free: 3 Spaces without an account, 5 with a free account, and an AI allowance. Paid plans start at ₹299 / $3.99 a month.
>
> Not affiliated with YouTube or Google.

**Privacy policy URL:** https://focusspace.xyz/privacy
**Homepage URL:** https://focusspace.xyz
**Support URL:** https://focusspace.xyz/contact

---

## Single purpose

Chrome requires one narrow purpose. Ours:

> FocusSpace reorganises the YouTube web interface around a subject the user
> chooses, and provides study tools for the video being watched.

Everything in the extension serves that: the feed ranking, the learning path,
the knowledge map, the notes and the AI actions are all about the video or the
subject in front of the user.

---

## Permission justifications

Each one is asked about separately during review. Answer with the *user-facing*
reason, not the technical one.

| Permission | Justification |
| --- | --- |
| `storage`, `unlimitedStorage` | Stores the user's spaces, topics, watch progress, saved notes and settings on their own machine. Knowledge maps and cached feed rankings are sizeable, which is why the unlimited variant is needed. |
| `alarms` | Refreshes the user's channel list periodically in the background so the feed is not stale when they open YouTube. |
| Host access to `https://www.youtube.com/*` | The extension's entire purpose. It reads and reorganises the YouTube page the user is on, and reads public channel data to rank it. |
| Host access to `https://focusspace.xyz/*` | A content script on our own website tells the page that the extension is installed, so the account page can show the user's spaces and settings — which are stored locally and cannot be read any other way. |

## Data disclosure

Tick these, and nothing else:

- **Personally identifiable information** — yes: email address, and optionally name, phone and city, for the account.
- **Website content** — yes: when the user clicks an AI action, the current video's title, position and a short transcript window are sent to our server to produce an answer.
- **Not collected:** health, financial, authentication, personal communications, location, web history, user activity.

Certify all three: not sold to third parties; used only for the stated single
purpose; not used for creditworthiness or lending.

**Payment details are never seen by the extension or our servers** — Razorpay's
own form handles them, so "financial information" is correctly left unticked.

---

## Screenshots (1280×800) and promo tile (440×280)

Generated from the store build against the live API, so every AI answer, note
and mind map in them is real output:

```bash
VITE_API_URL=https://api.focusspace.xyz VITE_SITE_URL=https://focusspace.xyz npm run build
node scripts/store-shots.mjs     # → release/store-assets/
```

Upload in this order:

1. `1-home.png` — the rebuilt home: space chips, ranked channels with match badges, the best match from YouTube
2. `2-watch-explain.png` — a lecture with the rail and a real Explain answer
3. `3-mind-map.png` — a mind map, expanded
4. `4-notes-hinglish.png` — Make Notes in Hinglish, with the language options
5. `5-first-run.png` — the first-run picker, "What do you want to focus on?"

`promo-tile-440x280.png` is the required small promo tile.

---

## Before submitting

- [ ] **Deploy the API first** ([DEPLOY.md](DEPLOY.md), "Release order") — the extension expects the server it was built with
- [ ] Bump `version` in `public/manifest.json` (the store rejects a re-used version)
- [ ] Confirm https://focusspace.xyz/privacy loads
- [ ] Verify the packaged build against the live API, not localhost (`npm run package` checks this)
- [ ] Review takes days to weeks; plan the launch around that, not the other way round
- [ ] Once the listing exists: set `VITE_CHROME_WEB_STORE_URL` on the website service and redeploy it, so "Add to Chrome" opens the listing
- [ ] Fresh-install test with the packaged ZIP, a real account (sign-up code arrives, sign in/out), a real ₹ payment (then refund), and an A → B account switch on one Chrome profile
