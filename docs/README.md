# FocusSpace docs

Start with the [project README](../README.md) for what FocusSpace is and how the repository is laid
out, and [CONTRIBUTING.md](../CONTRIBUTING.md) for how to work in it.

## How it works today

| Doc | Read it when you are… |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Changing the extension: folders, messaging, the YouTube pipeline, performance rules, "adding things". |
| [RELEVANCE.md](RELEVANCE.md) | Touching how videos are scored, filtered or ranked for a Space. |
| [KNOWLEDGE.md](KNOWLEDGE.md) | Touching the learning path, the Video Knowledge Map, or transcript/chapter handling. |
| [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) | Adding an AI action, changing prompts, or changing what is sent to the AI. |

## Running it in production

| Doc | Covers |
| --- | --- |
| [DEPLOY.md](DEPLOY.md) | The API and website on Railway: services, the volume, every environment variable, release order. |
| [STORE.md](STORE.md) | Packaging the extension and the Chrome Web Store listing, permissions and data disclosure. |

## Design records

Written before a layer was built, to fix its decisions so parallel work did not collide. They explain
*why* things are the way they are; the code is the truth for *what* they are now. Source comments
link to them by section, so they are kept rather than rewritten.

| Doc | Layer |
| --- | --- |
| [LAYER_2B_IDENTITY.md](LAYER_2B_IDENTITY.md) | Accounts, sessions and tokens (`server/auth`). Google sign-in and the website handoff came later. |
| [LAYER_2C_USAGE_ENTITLEMENTS.md](LAYER_2C_USAGE_ENTITLEMENTS.md) | AI metering and plan entitlements (`server/usage`). Payments were added afterwards in `server/billing`. |
| [V5_CONTRACT.md](V5_CONTRACT.md) | Preference learning, notes and mind maps, chat and voice. |
| [INSTITUTES.md](INSTITUTES.md) | Coaching institutes on one product: courses, batches, admin console, consent, leads, scale. **Accepted 25 Oct 2026, not built.** |

## Direction and hand-offs

| Doc | Covers |
| --- | --- |
| [PROGRESS.md](PROGRESS.md) | How the product started, what changed and why, where it stands. |
| [prompts/CODEX_WEBSITE.md](prompts/CODEX_WEBSITE.md) | Prompt for a coding agent: update focusspace.xyz (exam features, For institutes page, Deep and Light). |
| [prompts/CODEX_INSTITUTES_PHASE1.md](prompts/CODEX_INSTITUTES_PHASE1.md) | Prompt for a coding agent: build institutes phase 1. Run after the website prompt is merged, one step at a time. |

Institute Phase 1 local implementation and release boundaries: [server guide](../server/institutes/README.md).
