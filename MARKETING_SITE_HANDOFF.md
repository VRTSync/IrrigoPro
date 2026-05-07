# IrrigoPro: split marketing site to its own domain

This document is the hand-off for splitting `irrigopro.com` (marketing site)
from `app.irrigopro.com` (IrrigoPro app + API).

## What changed in this monorepo

- The `artifacts/marketing-site` artifact was **removed**. This monorepo now
  ships only the IrrigoPro app and the API server.
- `/api/marketing-leads` now has its own CORS allowlist
  (`https://irrigopro.com`, `https://www.irrigopro.com`, plus
  `http://localhost:5173` for dev) so the standalone marketing site can post
  to it cross-origin. See `artifacts/api-server/src/routes/marketing.ts`.
- A standalone copy of the marketing site lives at
  `marketing-site-standalone/` at the repo root. It has **no** dependency on
  the monorepo (no `@workspace/*` imports), uses Vite `base = "/"`, and the
  demo form posts to `${VITE_API_BASE_URL}/api/marketing-leads`.

## How to ship this — step by step

### 1. Stand up the marketing site as its own Replit project

1. Create a new Replit project (any blank pnpm-friendly template).
2. Copy the contents of `marketing-site-standalone/` from this monorepo into
   the new project's root.
3. In the new project run:
   ```bash
   pnpm install
   pnpm run build      # sanity-check the build
   pnpm run dev        # sanity-check locally
   ```
4. Commit and publish as a **Static** deployment in Replit:
   - Build command: `pnpm run build`
   - Public directory: `dist`
5. Set the deployment env var:
   - `VITE_API_BASE_URL=https://app.irrigopro.com`

### 2. Connect `irrigopro.com` and `www.irrigopro.com`

In the marketing site's deployment → **Domains**:

1. Add `irrigopro.com`. Replit will show the DNS records you need.
2. Add `www.irrigopro.com`. Replit will show its DNS records.
3. In your DNS registrar, add the records Replit gave you. Typical shape:
   - **Apex (`irrigopro.com`)** — `A` record(s) pointing to Replit's
     deployment IP, **plus** a `TXT` verification record on
     `replit-verify.irrigopro.com` (or whatever name Replit asks for).
   - **`www.irrigopro.com`** — `CNAME` to the deployment hostname Replit
     shows you, plus its `TXT` verification record.
4. Wait for verification (usually a few minutes). Replit will issue the SSL
   certificate automatically.

### 3. Connect `app.irrigopro.com` to this monorepo

This monorepo is already deployed (or republish it after the marketing
artifact removal). In its deployment → **Domains**:

1. Add `app.irrigopro.com`. Replit will show its DNS records.
2. In your DNS registrar, add a `CNAME` record on `app.irrigopro.com`
   pointing to the deployment hostname Replit gives you, plus the `TXT`
   verification record Replit asks for.
3. Wait for verification + SSL issuance.

### 4. Verify end-to-end

Once DNS has propagated:

- `https://irrigopro.com` → marketing site landing page.
- `https://www.irrigopro.com` → marketing site landing page.
- `https://app.irrigopro.com` → IrrigoPro app login.
- Submit the **Request a demo** form on `https://irrigopro.com/demo`. It
  should POST cross-origin to `https://app.irrigopro.com/api/marketing-leads`
  and the lead should show up in the database (and trigger the notification
  email) just like before.

## DNS checklist (for your registrar)

Order of operations:

1. In each Replit deployment's **Domains** tab, click **Add custom domain**
   and enter the hostname. Replit will then show you the exact DNS records
   (values + verification tokens) you need.
2. Copy those records into your registrar's DNS settings.
3. Back in Replit, wait for "verifying" to flip to "verified" (usually a
   few minutes). SSL is then issued automatically.

The table below is the *shape* of the records you'll be asked to add — the
actual IPs / hostnames / verification tokens come from Replit in step 1.

| Hostname | Type | Value (from Replit) | Purpose |
|---|---|---|---|
| `irrigopro.com` (apex) | `A` (or `ALIAS`/`ANAME` if your registrar supports it) | Replit deployment IP shown in the marketing deployment's Domains tab | Marketing site |
| `irrigopro.com` (apex) | `TXT` | Replit-issued verification token | Domain ownership |
| `www.irrigopro.com` | `CNAME` | Replit deployment hostname for the marketing site | Marketing site |
| `www.irrigopro.com` | `TXT` | Replit-issued verification token | Domain ownership |
| `app.irrigopro.com` | `CNAME` | Replit deployment hostname for this monorepo | IrrigoPro app + API |
| `app.irrigopro.com` | `TXT` | Replit-issued verification token | Domain ownership |

> If your registrar does not support `ALIAS`/`ANAME` and only allows `CNAME`
> on subdomains, use the `A` records Replit shows for the apex.

## Troubleshooting

- **Demo form returns a CORS error in the browser.** The origin you're
  posting from isn't in the allowlist. Edit
  `artifacts/api-server/src/routes/marketing.ts` →
  `MARKETING_LEADS_ALLOWED_ORIGINS` and redeploy this monorepo.
- **Demo form 404s.** `VITE_API_BASE_URL` is wrong or not set on the
  marketing deployment. It should be `https://app.irrigopro.com` (no
  trailing slash).
- **Domain stuck "verifying".** DNS hasn't propagated yet. `dig +short
  irrigopro.com` (or your registrar's DNS check) should return Replit's IP.
