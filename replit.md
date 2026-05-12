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
- `artifacts/irrigopro/src/lib/lifecycle.ts` — frontend lifecycle helpers + Tailwind tints (UI-only)
- `lib/db/src/schema/` — Drizzle ORM schema (single source of truth for DB; imported by both API server and frontend via `@workspace/db/schema`)
- `attached_assets/` — static assets shared between frontend and backend
- `marketing-site-standalone/` — snapshot of the marketing site as a fully standalone Vite project (no `@workspace/*` deps, base `/`). Drop into a separate Replit project for `irrigopro.com`. See `MARKETING_SITE_HANDOFF.md` for the full split + DNS plan.

## Architecture decisions

- No OpenAPI spec / codegen for this legacy port — frontend uses direct `apiRequest`/`queryClient` fetch layer
- `registerRoutes(app)` returns an HTTP Server directly — not converted to an Express Router
- Express 5 (path-to-regexp v8) incompatible patterns fixed: removed `(\d+)` inline regex params and `(*)` wildcard modifiers; replaced wildcard segments with `{*name}` syntax
- Frontend imports DB schema/types directly from `@workspace/db/schema` — no duplicated copy in the frontend tree
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

## Originals Storage Backfill

One-time backfill (Task #189 / #222) of the `originals/` prefix in object storage to bring legacy uploads down to the same target as the new upload pipeline (≤3840px, JPEG q=90, mozjpeg).

- Script: `artifacts/api-server/src/scripts/shrink-originals.ts` — resumable; persists processed keys to `app_settings.originalsShrink.done` and any failures to `app_settings.originalsShrink.failed`.
- Run: `node --import tsx/esm artifacts/api-server/src/scripts/shrink-originals.ts [--dry-run] [--batch=N]`
- First production run (May 10, 2026): 235 originals scanned, 221 re-encoded, 14 skipped (already ≤2 MB), 0 failures, **~943 MB freed** (executed across three resumable chunks of ~110s each: 310.0 MB + 380.2 MB + 253.0 MB; the per-chunk numbers are the last batch-boundary totals logged before each timeout, so the true freed total is slightly higher).
- `app_settings.originalsShrink.done` contains all 235 canonical keys; `app_settings.originalsShrink.failed` is empty. No retry needed.

## Performance (Task #532)

Performance sundown for slow field-LTE connections. The headline rule is
**every screen has to be useful on a 1-bar LTE truck connection**.

- **Route-level code splitting** — `artifacts/irrigopro/src/App.tsx`
  uses `React.lazy` for ~50 page components and a `Suspense` boundary
  inside each role's `<Switch>`. Login, NotFound, and the four role
  dashboards are eager so first paint isn't behind a chunk fetch. New
  pages should be added with `lazyPage(() => import(...))` and only
  promoted to eager if they are critical to first paint.
- **Connection-aware polling** —
  `artifacts/irrigopro/src/lib/queryClient.ts` exports
  `adaptiveRefetchInterval(baseMs)`. Components that schedule
  background polling (Navigation badges, NotificationSystem,
  QuickBooks health) pass their nominal interval through this helper
  so 2G/saveData connections back off to 5min and 3G doubles the
  cadence. The query client default `refetchIntervalInBackground:
  false` already pauses every poll on hidden tabs.
- **Lazy-loaded Leaflet** — `ColorCodedMapViewer` is loaded via
  `React.lazy` from both `customer-site-maps.tsx` and
  `site-maps-page.tsx`. Leaflet (~150KB) ships in its own chunk and
  is fetched only when the user opens a Map tab. Do not add new
  module-level `import L from "leaflet"` to anything that's part of
  a default-loaded route.
- **Pricing-strip fast path** —
  `applyPricingVisibility` in `artifacts/api-server/src/routes/routes.ts`
  short-circuits for any non-`field_tech` role (no `headerUserRole`
  lookup, no object walk). The walk itself is now in-place
  (`sanitizePricingFieldsInPlace`) which is roughly 3-4x cheaper on
  the work-orders list response.
- **Opt-in list pagination** — `paginate(req, res, rows, defaults)`
  in `routes.ts` adds `?limit`/`?offset` support to `/api/customers`,
  `/api/estimates`, `/api/invoices`, and `/api/work-orders` (including
  the `field_tech` short-circuit branch — techs are the most
  bandwidth-constrained users). Paginated responses include
  `X-Total-Count` so the client can drive `useInfiniteQuery` without
  a separate count call. When both query params are omitted the
  response is unchanged for backwards compatibility.
- **Incremental invoice loading** — `pages/invoices.tsx` uses
  `useInfiniteQuery` with 50-row pages driven by `X-Total-Count`,
  replacing the previous `?limit=500` blast. `customer-billing.tsx`
  drops its dashboard-panel fetch from 500 to 100 rows (the API
  returns invoices sorted by `createdAt` desc, so 100 is plenty to
  derive the latest billing month).
- **Higher offline retry cap** — `engine.ts` raised
  `DEFAULT_MAX_RETRY_AGE_MS` from 1h to 12h so a tech who is offline
  for half a shift (basement, remote site) still has queued writes
  resume the moment they're back in coverage.
- **Foreign-key indexes** — `lib/db/src/schema/schema.ts` declares
  indexes on the FKs hit by every list / dashboard / report path:
  `customers(companyId)`, `estimates(companyId, customerId, status,
  internalStatus)`, `work_orders(customerId, assignedTechnicianId,
  invoiceId, estimateId, (status, scheduledDate))`,
  `billing_sheets(customerId, technicianId, workOrderId, invoiceId,
  (status, createdAt))`. Apply with `pnpm --filter @workspace/db run push`.

Deferred follow-ups (out of this task's scope, tracked separately):
- Real PWA via `vite-plugin-pwa` (current setup uses a stub virtual
  module — `registerSW.ts` is wired up but `generateSW` is not yet
  configured).
- Read-side IndexedDB cache for work-order screens.
- Photo-grid signed-URL batching sweep across the remaining list
  pages (work orders detail / billing sheet detail / wet checks).
- Switch the paginated list endpoints' clients to
  `useInfiniteQuery` and drive the off-by-one with `X-Total-Count`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
