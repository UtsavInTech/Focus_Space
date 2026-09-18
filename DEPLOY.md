# Deploying the FocusSpace API

The API is a plain Node ESM process (`dist-server/index.mjs`) with a SQLite file
beside it. It has no runtime dependencies to install — `npm run build:server`
bundles everything — so it deploys anywhere that runs Node 22.

Railway is the launch host; Cloudflare Workers + D1 is the intended long-term
home, and that port is a rewrite of `server/auth/db.ts`, `server/usage/db.ts`
and `server/index.ts` against D1 and the Fetch API, not a config change.

## 1. Create the service

```bash
railway init            # or: railway link, to attach to an existing project
railway up              # builds and deploys from this directory
```

`railway.json` sets the build command, the start command and the
`/v1/health` healthcheck.

> Railway is moving to Infrastructure as Code (`.railway/railway.ts`) and
> deprecates `railway.json` on 2026-12-01. We deliberately stayed on
> `railway.json`: the IaC file is the *whole* truth for a service, so adopting
> it means declaring every variable and volume there too — and a file that
> declares no secrets will happily delete the secrets you set in the
> dashboard. Migrate when there is time to move variables and the volume
> across in one go, not in the middle of a launch.

## 2. Add a volume — before the first real user

SQLite lives on disk, and a container filesystem does not survive a redeploy.
Without a volume, **every deploy deletes every account.** In the Railway
dashboard: *service → Variables → Volumes → New Volume*, mounted at `/data`.

Then set `DB_PATH=/data/focusspace.db` (below) so both database connections —
`server/auth/db.ts` and `server/usage/db.ts` — open the file on the volume.

## 3. Variables

| Variable | Value | Why |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | `sk-or-…` | The one key the product runs on. Never in the extension. |
| `AUTH_TOKEN_SECRET` | `openssl rand -base64 32` | Signs access/refresh tokens. Changing it signs everyone out. |
| `DB_PATH` | `/data/focusspace.db` | Must point at the mounted volume. |
| `HOST` | `0.0.0.0` | The default `127.0.0.1` accepts nothing from outside the container. |
| `NODE_ENV` | `production` | Refuses `AUTH_DEV_CODES`, and turns a missing mail provider into a loud error. |
| `RESEND_API_KEY` | `re_…` | Delivers verification codes. Without it **sign-up cannot complete**. |
| `MAIL_FROM` | `FocusSpace <hello@yourdomain>` | Must be on a domain verified in Resend. Unset falls back to Resend's sandbox sender, which only delivers to your own address. |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | Optional. |
| `FREE_PLAN_MONTHLY_AI_UNITS` | `200` | Optional — must match the Free plan on the pricing page. |
| `ANON_DAILY_AI_UNITS` | `10` | Optional. Signed-out allowance. |

`PORT` is set by Railway; the server already reads it.

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
# {"ok":true,"status":"ok","model":"openai/gpt-4o-mini","auth":"enabled"}
```

`auth: "enabled"` confirms `AUTH_TOKEN_SECRET` was read. If it says `disabled`,
the auth routes are off and nobody can sign in.
