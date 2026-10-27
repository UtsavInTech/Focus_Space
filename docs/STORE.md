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

**Name:** FocusSpace: Intent-Driven Learning for YouTube (taken from the manifest)

**Short description** (132 characters max)

> Pick your exam and YouTube becomes a classroom: a step-by-step path, only your syllabus in the feed, and an AI tutor on every lecture.

**Category:** Education
**Language:** English

**Detailed description**

> YouTube has every lecture you need. FocusSpace puts them in order.
>
> Tell FocusSpace what you're preparing for (UPSC, NEET, JEE, SSC, banking, B.Tech, or any topic of your own) and the YouTube home page becomes a classroom for it.
>
> START IN THE RIGHT PLACE
> The first video on your home explains the syllabus and how to begin. After that, your whole syllabus is one path (for UPSC: Prelims, CSAT, Mains, Interview), and "You are here" moves with you as you study.
>
> EVERY TOPIC IS A SHORT COURSE
> Open a topic like Polity and you get a short course: what it is, the full picture, then each part in order (Constitution, Fundamental Rights and so on), with a Next button and the videos you've already finished ticked off. Open a subtopic and it gets its own page.
>
> NOTHING ELSE ON THE PAGE
> Shorts, trending and off-topic videos are gone. Continue watching only shows lessons, never the music you played while studying. Your own subscriptions come first, ranked by how well they match your syllabus.
>
> AN AI TUTOR ON EVERY LECTURE
> On a video, ask FocusSpace to explain this moment, give an example, quiz you, or make notes and mind maps from the part you watched, in English, हिंदी or Hinglish. Technical terms stay as they are, because that's what you'll be examined on.
>
> • Works the moment you install it. No API key, and no account needed to start.
> • Your watch history and subscriptions stay in your browser. For institute courses you join, course totals are counted; named progress and quiz scores are shared only if you choose.
> • The YouTube player is never touched, and Focus Mode turns off in one click (Alt+Shift+F).
>
> Free: 3 Spaces without an account, 5 with a free account, and a daily AI allowance. Paid plans start at ₹299 / $3.99 a month.
>
> FocusSpace is not affiliated with YouTube or Google.

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

Review these categories against the Store questionnaire before submission:

- Personally identifiable information: account email; optional account profile fields; and, only when joining an institute course, a mobile number verified by SMS and the enrolment. The institute the learner joins receives their name and verified number, as the join page states before joining.

- User activity: institute-course milestone totals. Identified course progress, time in lectures, study days and quiz scores reach the institute only with progress-sharing consent. Personal watch history and personal Spaces are not reported.

- Website content: the current video context sent when the learner asks for an AI action, as already disclosed. Personal transcripts, notes and AI conversations are not included in institute progress reporting.

- Authentication information: the account credentials/session information processed by the existing account service; the extension never receives an institute’s credentials or a YouTube password. Review the exact Store questionnaire against these flows before submission.

- Not collected for institute reporting: precise location, health data, bank details or payment credentials. Studio stores staff message drafts and edits, contact outcomes and agreed course fees; it does not verify collection of those fees. Payment data for FocusSpace subscriptions is handled by Razorpay’s checkout.

Certify all three: not sold to third parties; used only for the stated single
purpose; not used for creditworthiness or lending.

**Payment details are never seen by the extension or our servers** — Razorpay's
own form handles them, so "financial information" is correctly left unticked.

---

## Store images

The images are not kept in the repository. The listing uses five 1280×800 screenshots, each a real
capture of the store build on YouTube (AI output is genuine, not a test double) under a one-line
headline, in this order:

1. The exam picker, showing every exam on one screen
2. A Space home: the "Start here" syllabus video and the path through the stages
3. A topic page as a short course: steps, Next, subtopics
4. A lecture with the study panel and an Explain answer
5. A mind map made from a lecture

Plus a small promo tile (440×280) and a marquee promo tile (1400×560). The store icon is
`icons/icon-128.png` from the package, drawn by `scripts/generate-icons.mjs`.

--- | --- |
| Store icon (128×128) | comes from the zip (`icons/icon-128.png`); a copy is `store-icon-128.png` |
| Screenshot 1 | `1-exams.png`: every exam on one screen (UPSC, SSC, banking, JEE, NEET, GATE…) |
| Screenshot 2 | `2-home.png`: UPSC home, "Start here" syllabus video and the path |
| Screenshot 3 | `3-topic.png`: Polity as a short course with Next |
| Screenshot 4 | `4-watch.png`: a lecture with a real Explain answer |
| Screenshot 5 | `5-mind-map.png`: a mind map made from a lecture |
| Small promo tile (440×280) | `promo-small-440x280.png` |
| Marquee promo tile (1400×560) | `promo-marquee-1400x560.png` |

---

## Before submitting

- [ ] **Deploy the API first** ([DEPLOY.md](DEPLOY.md), "Release order") — the extension expects the server it was built with
- [ ] Bump `version` in `public/manifest.json` (the store rejects a re-used version)
- [ ] Confirm https://focusspace.xyz/privacy loads
- [ ] Verify the packaged build against the live API, not localhost (`npm run package` checks this)
- [ ] Review takes days to weeks; plan the launch around that, not the other way round
- [ ] Once the listing exists: set `VITE_CHROME_WEB_STORE_URL` on the website service and redeploy it, so "Add to Chrome" opens the listing
- [ ] Fresh-install test with the packaged ZIP, a real account (sign-up code arrives, sign in/out), a real ₹ payment (then refund), and an A → B account switch on one Chrome profile

## Institute Studio assistant disclosure — 26 October 2026

The institute assistant uses course records to answer staff questions and draft messages. Analysis uses aggregates and pseudonymous student identifiers; individual drafts may include a student’s first name and shared course facts. Phone numbers are excluded from AI requests. Staff review messages and record contact outcomes and agreed course fees. FocusSpace stores institute context, saved questions, draft edits and outcomes; these fee records are not payment verification.

OpenAI is the assistant provider. Progress-based matching requires current progress-sharing consent. Saved questions contain phone-redacted text and query plans, not stored report snapshots. Message sending remains a manual WhatsApp, phone or copy action. Institute Context and writing preferences are supplied by staff; no website visitor identification is added. Token metering stores counts, model and institute id, not prompts or answers.
