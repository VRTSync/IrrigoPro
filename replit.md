# IrrigoPro

Production irrigation company management app: estimates → work orders → wet checks → billing → QuickBooks invoicing.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/irrigopro run dev` — run the frontend (port set by env)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind v3 + Wouter + React Query
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod, drizzle-zod
- Build: esbuild (ESM bundle for API)

## Where things live

- `artifacts/api-server/src/routes/routes.ts` — all API routes (~10 000+ lines, legacy monolith)
- `artifacts/api-server/src/app.ts` — Express app setup, calls `registerRoutes(app)`
- `artifacts/api-server/src/routes/marketing.ts` — `/api/marketing-leads` endpoint, with explicit CORS allowlist for the standalone marketing site (irrigopro.com / www.irrigopro.com)
- `artifacts/irrigopro/src/` — React frontend
- `artifacts/irrigopro/src/shared/` — shared types & Zod schemas (lifecycle, schema)
- `lib/db/src/schema/` — Drizzle ORM schema (source of truth for DB)
- `attached_assets/` — static assets shared between frontend and backend
- `marketing-site-standalone/` — snapshot of the marketing site as a fully standalone Vite project (no `@workspace/*` deps, base `/`). Drop into a separate Replit project for `irrigopro.com`. See `MARKETING_SITE_HANDOFF.md` for the full split + DNS plan.

## Architecture decisions

- No OpenAPI spec / codegen for this legacy port — frontend uses direct `apiRequest`/`queryClient` fetch layer
- `registerRoutes(app)` returns an HTTP Server directly — not converted to an Express Router
- Express 5 (path-to-regexp v8) incompatible patterns fixed: removed `(\d+)` inline regex params and `(*)` wildcard modifiers; replaced wildcard segments with `{*name}` syntax
- `@shared/*` alias in Vite points to `artifacts/irrigopro/src/shared/` — frontend-only copies of shared types
- `virtual:pwa-register` stubbed in vite.config.ts via a custom Vite plugin (PWA not fully configured)

## Product

- Multi-company irrigation management with role-based access (super_admin, company_admin, manager, field_tech, billing_manager)
- Full estimate lifecycle: draft → pending review → sent → approved/rejected/expired
- Work orders with technician scheduling, field photos, wet check inspections
- Billing sheets auto-generated from completed work orders; QuickBooks invoice export
- Parts catalog, assembly management, bulk CSV import
- Interactive site maps with controller and zone management

## Gotchas

- Express 5 rejects inline regex route params — never use `/:param(\d+)` or `/:param(*)` patterns
- `routes.ts` is a massive legacy file; build takes ~600ms via esbuild
- `@shared/schema` is a copy of the drizzle schema — changes to `lib/db/src/schema/` must be mirrored there for frontend type safety
- drizzle-orm / drizzle-zod added to frontend devDeps only for type imports (not bundled at runtime meaningfully)

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
