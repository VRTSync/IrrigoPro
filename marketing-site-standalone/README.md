# IrrigoPro Marketing Site (standalone)

Standalone Vite + React + Tailwind v4 marketing site for `irrigopro.com`.
This is a self-contained project — it has no dependency on the IrrigoPro
monorepo. The demo form posts to the IrrigoPro API at
`https://app.irrigopro.com/api/marketing-leads` (configurable via
`VITE_API_BASE_URL`).

## Local development

```bash
pnpm install
cp .env.example .env   # edit if you want to point at a local API
pnpm run dev           # http://localhost:5173
```

## Build

```bash
pnpm run build         # outputs to ./dist
pnpm run serve         # preview the built site
```

## Deploy on Replit

1. Create a new Replit project and drop these files at the project root.
2. Run `pnpm install`.
3. Publish as a **Static** deployment.
   - Build command: `pnpm run build`
   - Public directory: `dist`
4. In Deployment → Domains, add custom domains `irrigopro.com` and
   `www.irrigopro.com` and follow Replit's DNS prompts.
5. Set the env var `VITE_API_BASE_URL=https://app.irrigopro.com` for the
   deployment so the demo form posts to the live API.

## How the demo form works

`src/components/demo-form.tsx` reads `VITE_API_BASE_URL` and POSTs JSON to
`${VITE_API_BASE_URL}/api/marketing-leads`. The IrrigoPro API server has
CORS configured to accept requests from `https://irrigopro.com` and
`https://www.irrigopro.com` (and `http://localhost:5173` for local dev).
