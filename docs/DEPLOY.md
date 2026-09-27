# Deploying the FocusSpace API

The API is a plain Node ESM process (`dist-server/index.mjs`) with a SQLite file
beside it. It has no runtime dependencies to install — `npm run build:server`
bundles everything — so it deploys anywhere that runs Node 22.

Railway is the launch host; Cloudflare Workers + D1 is the intended long-term
home, and that port is a rewrite of `server/auth/db.ts`, `server/usage/db.ts`
and `server/index.ts` against D1 and the Fetch API, not a config change.

## 1. Create the service

Production runs as two Railway services built from this one repository:

| Service | Built from | Serves |
| --- | --- | --- |
| `focusspace-api` | `Dockerfile` (`npm run build:server`) | The API on Node 22, SQLite on a volume |
| `focusspace-web` | `Dockerfile.web` (`npm run build:web`) | The website as static files behind Caddy (`Caddyfile.web`) |

Point each service at its Dockerfile. Railway's auto-detection otherwise picks
`npm run build` — the *extension* — and serves `dist/` as a website, so the
Dockerfiles are load-bearing: don't delete or rename them.

```bash
railway link            # attach this directory to the existing project
railway up              # build and deploy the linked service
```

Set the healthcheck to `/v1/health` on the API service.

> Railway deprecates `railway.json` on 2026-12-01 in favour of
> Infrastructure as Code (`.railway/railway.ts`). The IaC file is the *whole*
> truth for a service: one that declares no secrets deletes the secrets set in
> the dashboard, and it tried to detach the volume when tested. Migrate when
> there is time to move every variable and the volume across in one change.

## 2. Add a volume — before the first real user

SQLite lives on disk, and a container filesystem does not survive a redeploy.
Without a volume, **every deploy deletes every account.** In the Railway
dashboard: *service → Variables → Volumes → New Volume*, mounted at `/data`.

Then set `DB_PATH=/data/focusspace.db` (below) so both database connections —
`server/auth/db.ts` and `server/usage/db.ts` — open the file on the volume.

## 3. Variables

| Variable | Value | Why |
| --- | --- | --- |
| `OPENAI_API_KEY` | `sk-…` | The one key the product runs on. Never in the extension. |
| `ADMIN_TOKEN` | a long random string | Reads active users, retention and paying users (`GET /v1/admin/metrics`, `npm run metrics` with `FOCUSSPACE_ADMIN_TOKEN` in your local `.env`). Without it the numbers can't be read at all. |
| `AUTH_TOKEN_SECRET` | `openssl rand -base64 32` | Signs access/refresh tokens. Changing it signs everyone out. |
| `DB_PATH` | `/data/focusspace.db` | Must point at the mounted volume. |
| `HOST` | `0.0.0.0` | The default `127.0.0.1` accepts nothing from outside the container. |
| `NODE_ENV` | `production` | Refuses `AUTH_DEV_CODES`, and turns a missing mail provider into a loud error. |
| `RESEND_API_KEY` | `re_…` | Delivers verification codes. Without it **sign-up cannot complete**. |
| `MAIL_FROM` | `FocusSpace <hello@yourdomain>` | Must be on a domain verified in Resend. Unset falls back to Resend's sandbox sender, which only delivers to your own address. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Optional. |
| `MAX_TOKENS` | `700` | Optional. Ceiling on one AI answer's length. |
| `OUTLINE_DAILY_LIMIT` | `500` | Optional. Most new video outlines made per day across everyone (each ≈ ₹0.05–0.50 of AI; a video over three hours is outlined in ~1-hour parts, ≈ ₹1.5 for five hours). Stored outlines are reused free and never count. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from Google Cloud | Google sign-in. Unset, Google sign-in is simply unavailable. |
| `GOOGLE_REDIRECT_URI` | `https://api.focusspace.xyz/v1/auth/google/callback` | Must match the Google client *exactly*. |
| `WEB_ORIGINS` | `https://focusspace.xyz` | Comma-separated allow-list of where a finished sign-in may return to. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | from Razorpay | Checkout. |
| `RAZORPAY_WEBHOOK_SECRET` | from the Razorpay webhook | Without it every webhook is rejected, so renewals are not recorded. |

`PORT` is set by Railway; the server already reads it.

Plan limits (Spaces, AI credits, the signed-out daily allowance) are not
environment variables: they come from `src/billing/plans.ts`, the same file the
pricing page reads, so the two cannot disagree. `FREE_PLAN_MONTHLY_AI_UNITS`,
`FREE_PLAN_MAX_SPACES` and `ANON_DAILY_AI_UNITS` are no longer read — delete
them from Railway if they are set.

`TRUST_PROXY` — leave unset. In production the API trusts Railway's
`X-Real-IP` / last `X-Forwarded-For` entry for the caller's address (the
signed-out AI allowance and rate limit are per address). Set `TRUST_PROXY=0`
only if the API is ever exposed without a proxy in front of it.

**Website service:** add `VITE_CHROME_WEB_STORE_URL` =
`https://chromewebstore.google.com/detail/…` as soon as the store listing
exists. Until it is set every "Add to Chrome" button only scrolls the page, and
`npm run build:web` prints a warning saying so.

**Release order — the API first, always.** An extension build that talks to a
server older than itself can break: 0.4.1 sends an `X-FocusSpace-Install`
header on signed-out AI requests, and an API without it in its CORS allow-list
rejects every one of them. Deploy the API, check `/v1/health`, then publish
the extension.

## 4. Point the clients at it

Railway gives the service a `*.up.railway.app` domain. Build both clients
against it:

```bash
VITE_API_URL=https://<service>.up.railway.app \
VITE_SITE_URL=https://<site-domain> \
npm run build && npm run build:web
```

`src/config.ts` bakes those in: the extension then talks to the deployed API
with no endpoint for anyone to configure, which is the whole point.

## 5. Check it

```bash
curl https://<service>.up.railway.app/v1/health
# {"ok":true,"status":"ok","model":"gpt-4o-mini","auth":"enabled"}
```

`auth: "enabled"` confirms `AUTH_TOKEN_SECRET` was read. If it says `disabled`,
the auth routes are off and nobody can sign in.
