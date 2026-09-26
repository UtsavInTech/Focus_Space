# Contributing to FocusSpace

FocusSpace is a proprietary product ([LICENSE](LICENSE)). Contributions are by invitation, and by
contributing you agree that your work becomes part of FocusSpace under that licence. If you are here,
you were invited — thank you. This page is how we work, for people and AI coding agents alike.

## 1. Know what you are changing

FocusSpace is three things in one repository — read the [README's project map](README.md#project-map)
first:

- **The extension** (`src/`) — runs inside youtube.com and in its own dashboard and popup.
- **The website** (`web/`) — focusspace.xyz: home, pricing, sign-in, account.
- **The API** (`server/`) — accounts, AI metering, payments. Holds the only secrets.

Then read the doc for the area you are touching — [docs/README.md](docs/README.md) says which.

## 2. Set up

```bash
npm install                 # Node.js 22 required
cp .env.example .env        # only if you need the API locally
npm run build               # extension → dist/, load it unpacked in chrome://extensions
```

`npm run dev`, `npm run dev:web` and `npm run ai-api` run the three parts locally — see the
[README's quick start](README.md#quick-start).

## 3. Where things go

| You are adding… | Put it in |
| --- | --- |
| UI on YouTube's pages | `src/content/ui/` |
| A YouTube selector or DOM rule | `src/content/youtube/` — the only place that knows YouTube's markup |
| Parsing YouTube's data | `src/integrations/youtube/`, tested against a captured fixture |
| A dashboard or popup screen | `src/dashboard/pages/`, `src/popup/` |
| A shared component | `src/ui/components/` (styles use the tokens in `src/ui/styles.css`) |
| A message between UI and service worker | its type in `src/types/messages.ts`, its handler in `src/background/service-worker.ts` |
| Stored data | `src/storage/schema.ts` — with a version and a migration, never a silent shape change |
| An AI action or prompt | `src/learning/ai/` — see [docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md) |
| A plan limit or price | `src/billing/plans.ts` only. The website and server read it; never copy a number |
| An API route | `server/index.ts`, logic in `server/<area>/`, input checks in `validate.ts` |
| Website pages and copy | `web/src/components/`, text in `web/src/content/` |
| A test | beside the code, as `name.test.ts` |

Don't move the root files (Dockerfiles, `Caddyfile.web`, `popup.html`, `dashboard.html`, Vite
configs): the build and Railway read them where they are. Don't rename docs in `docs/` either —
source comments link to them.

## 4. Product rules

These are decisions, not suggestions. Changing one is a conversation with the owner first.

- **No bring-your-own API key.** AI is hosted by the FocusSpace API and metered per plan. No secret
  ever goes in the extension or the website.
- **The server enforces, clients display.** Limits live in `src/billing/plans.ts`; the API checks
  them. A client-side check is a courtesy, never the guard.
- **Say only what is built.** Copy — in the extension, on the website, in the store listing — never
  promises a feature that does not exist yet (sync across devices, for example).
- **AI sees the moment, not the person.** Only the current video moment's context is sent; never
  watch history or subscriptions. If you change what is sent, update the privacy page
  (`web/src/content/legal.ts`) in the same change.
- **One account's data is never merged into another's.** A guest is offered keep-or-start-fresh on
  first sign-in (`src/background/ownership.ts`).
- **Saving to the Library needs an account.** Generating and chatting do not
  (`src/ui/account/save-gate.ts`).
- **The player is never touched**, and nothing on the playback path calls the network.
- **Release the API first**, then the website, then the extension ([docs/DEPLOY.md](docs/DEPLOY.md)).

## 5. Writing code

- TypeScript, strict. Import from `src/` with the `@/` alias.
- Match the file you are in: its naming, its comment density, its idiom. Comments explain *why*,
  not what the next line does.
- Keep changes small and on-topic. No drive-by reformatting, renaming or refactors in a feature
  change — they make review and parallel work harder.
- New dependencies need a reason; the extension bundle is loaded on every YouTube page.
- The service worker must not import React or UI code — keep shared rules in plain modules.
- User-facing text is plain and professional: say what happens, not how great it is.

## 6. Working alongside others

Several people and AI agents often work on FocusSpace at the same time.

**On GitHub** (collaborators working from their own clone):

- **Work on your own branch**, named for the change (`fix/ai-bubble-fullscreen`,
  `feat/notes-export`). Never push to `main` — every change reaches it through a reviewed pull
  request.
- **Keep your branch current.** Rebase on or merge `main` before asking for review, and resolve
  conflicts on your branch, not in `main`.
- **Never force-push a branch someone else is also working on.**

**In a shared working copy** (people or AI agents in the same checkout, e.g. on the owner's
machine):

- **Look before you edit.** Run `git status` first. Files already modified are someone else's
  work in progress: don't revert, reformat or rewrite them. If you must change one, make the
  smallest edit and say so in your hand-off.
- **Leave the shared git state alone.** No `git stash`, `git reset`, `git checkout -- <file>`,
  `git add -A` or `git clean` — each one can destroy or sweep up someone else's uncommitted work.
  Stage only the files you changed, by name.
- **Don't commit or push unless the owner asks.** Work is reviewed before it is committed.

**Everywhere:**

- **Moving or renaming a file?** Update every reference to it in the same change, and call the move
  out in your hand-off.
- **Hand off clearly:** what changed and why, which files, what you ran, and what you did not
  verify.

## 7. Before you hand in

```bash
npm run typecheck
npm test
npm run build              # and build:web / build:server if you touched those
```

Run `npm run e2e` too if you changed anything that runs on youtube.com — it drives the live site in
Chromium. Update the README or the relevant doc when behaviour a reader relies on changes.

## 8. Commits and pull requests

- One logical change per commit. The message is a plain sentence saying what changed — look at
  `git log` for the style ("Adopt the real FocusSpace logo: target mark and two-tone wordmark").
- Branch from `main` for a pull request, and fill in the template: what changed, why, and how it
  was tested. Keep a pull request to one topic — two unrelated changes are two pull requests.
- The checks (typecheck, tests, all three builds) run on every pull request and must pass. A pull
  request is merged by the owner after review.

## 9. Secrets and security

- Never commit `.env`, keys, tokens, databases (`data/`) or anything in `release/`.
- If you find a security problem, tell the owner privately — not in an issue, commit message or PR.
