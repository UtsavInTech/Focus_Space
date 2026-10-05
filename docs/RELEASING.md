# Releasing a new version

Order matters: the API first, then the website, then the extension. A new extension talks to features the
API must already have.

## 1. Back up the database

Accounts, plans and payments live in SQLite on the Railway volume `focusspace-api-volume` (mounted at
`/data`). Deploys never touch the volume, and every schema change only adds columns or tables, but take a
backup before each release anyway:

Railway dashboard → project **focusspace** → service **focusspace-api** → **Volume** → **Backups** →
**Create backup**.

## 2. Check the API's variables

Railway → **focusspace-api** → **Variables**. Besides the ones in [DEPLOY.md](DEPLOY.md), Quiz me uses:

| Variable | Why |
| --- | --- |
| `OPENROUTER_API_KEY` | Checks every quiz question before it is shown. Without it every question is checked by the settle model instead, which costs more. |
| `QUIZ_JUDGE_MODEL` | Optional. Defaults to `typesafe/jev-1.13`. |
| `QUIZ_SETTLE_MODEL` | Optional. Defaults to `gpt-5-mini`. |

## 3. Deploy the API, then the website

```sh
railway link          # once per machine: pick project focusspace
railway up --service focusspace-api
curl https://api.focusspace.xyz/v1/health   # {"ok":true,...}
railway up --service focusspace-web
```

`railway up` uploads this folder as it is on disk (`.env` and `data/` are excluded), so deploy from the
commit you mean to release.

## 4. Build and package the extension

Raise `version` in `public/manifest.json` and `package.json` (the store refuses a version it has seen), then:

```sh
VITE_API_URL=https://api.focusspace.xyz VITE_SITE_URL=https://focusspace.xyz npm run build
npm run package        # writes release/focusspace-<version>.zip and refuses a localhost build
```

## 5. Update the Chrome Web Store listing

1. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) and click
   **FocusSpace**.
2. **Package** (left menu) → **Upload new package** → choose `release/focusspace-<version>.zip`.
3. **Store listing**: update the description if features changed, and the images:

   | Image | Size | Notes |
   | --- | --- | --- |
   | Store icon | 128 × 128 PNG | Also inside the package. |
   | Screenshots | 1280 × 800 (or 640 × 400), 1 to 5 | JPEG or PNG without transparency. The first one is what most people see. |
   | Small promo tile | 440 × 280 | Required. Shown in search results and category lists. |
   | Marquee promo tile | 1400 × 560 | Optional. An image, not text: used only if the store features the extension. The logo, the name and one line, e.g. “YouTube, organised around what you came for.” |

4. **Privacy practices**: update only if the extension now uses new permissions or data.
5. **Submit for review** (button at the top right of the item's page). If it is greyed out, hover it: it
   lists what is still missing. Choose whether to publish automatically once approved.
6. Review usually takes from a few hours to a few days. The item's status reads **Pending review**, then
   **Published**. Existing users receive the update automatically within a few hours of publishing; their
   Spaces, notes and settings stay in their browser and carry over.

## 6. Email

Verification codes are sent through Resend. Set `MAIL_FROM` to an address on a domain verified in Resend;
without it Resend's shared sender delivers only to the account owner's own address. The API allows at most
5 code requests per 15 minutes per person. Resend's own sending quota depends on the plan chosen there.
