# IrrigoPro

Production irrigation company management app: estimates → work orders → wet checks → billing → QuickBooks invoicing.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/irrigopro run dev` — run the frontend (port set by env)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string; `SENDGRID_API_KEY` — transactional email (estimate sends, password reset, verification, marketing-lead, etc.); optional `SENDGRID_FROM_EMAIL` overrides the default From address (`estimates@highplainsprop.com`)

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

- Multi-company irrigation management with role-based access (super_admin, company_admin, irrigation_manager, field_tech, billing_manager). The legacy `manager` alias was retired in Task #643 — `irrigation_manager` is the canonical role name in code, schema, and every guard.
- Full estimate lifecycle: draft → pending review → sent → approved/rejected/expired
- Work orders with technician scheduling, field photos, wet check inspections
- Billing sheets auto-generated from completed work orders; QuickBooks invoice export
- Parts catalog, assembly management, bulk CSV import
- Interactive site maps with controller and zone management

## Gotchas

- Express 5 rejects inline regex route params — never use `/:param(\d+)` or `/:param(*)` patterns
- `routes.ts` is a massive legacy file; build takes ~600ms via esbuild
- `GET /api/invoices` is intentionally **not company-scoped** — it is
  only safe for customer-bounded callers (`?customerId=`) or for the
  paginated all-tenants list (super_admin contexts). Never use it to
  build a dashboard rollup. The canonical "This Month Billed" tile
  rollup is `GET /api/dashboard/this-month-billed` (see Task #662),
  which joins `invoices` ⨝ `customers` to scope by
  `customers.companyId` and excludes `draft` / `cancelled`.

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

## Null-safe list rendering (Task #540)

The frontend's `getQueryFn` returns `null` on 401 (`returnNull` mode)
and several API endpoints return `null` for nested array fields on
freshly-created records (e.g. `wetCheck.zoneRecords`,
`zoneRecord.findings`, `wetCheck.photos`). TypeScript types declare
those as `T[]` so the compiler can't catch the mismatch — any
`.map / .filter / .some / .length / .flatMap` against the value
crashes the page.

Convention:

- For top-level list endpoints, use `useArrayQuery<T>(...)` from
  `@/lib/queryClient` instead of `useQuery<T[]>(...)`. The wrapper
  pipes the payload through `asArray()` via `select`, so a `null`
  from a 401 (`returnNull` mode) collapses to `[]` instead of
  crashing on the first `.map / .filter / .length` call. Still
  destructure with a `= []` default to cover the loading state
  (`select` has not run yet, so `data` is `undefined`):
  `const { data: rows = [], isLoading } = useArrayQuery<Row>({...});`
- For nested arrays inside object payloads (e.g.
  `wetCheck.zoneRecords`, `zoneRecord.findings`), wrap with the
  shared `asArray()` helper before calling any array method:
  `const records = asArray(wc.zoneRecords);`
  `const findings = asArray(zoneRecord?.findings);`
- Optimistic-update handlers that re-`map` a previous query payload
  must wrap the same way — the snapshot can have null nested arrays
  even when the parent object is non-null.

`artifacts/irrigopro/src/pages/wet-checks-null-safe.test.tsx` covers
the regression with: (a) a static-source guard against direct
`wc.zoneRecords.<method>` reads, (b) a runtime mount of `ZoneScreen`
with `findings: null`, and (c) a `useArrayQuery` test that mocks the
queryFn to return `null` (the 401 `returnNull` path) and confirms
the consumer sees `[]` instead of crashing.

## App Health (Task #550, Phase 1)

Super Admin "App Health" page at `/super-admin/app-health` — one
pane of glass for crashes, system status, sync, and audit signals.
Phase 1 ships the page chrome plus a working **Crashes & Errors**
tab; the other six tabs render a "coming in Phase N" placeholder.

- **Storage**: `client_errors` (legacy table name kept for back-compat)
  extended to the spec's `app_events` shape — added `occurred_at`,
  `company_id`, `session_id`, `type`, `severity`, `source`,
  `component`, `app_version`, `fingerprint`, `breadcrumbs` (jsonb),
  `context` (jsonb), `resolved_at`, `resolved_by`, plus indexes on
  `(fingerprint, created_at desc)`, `company_id`, `severity`,
  `app_version`.
- **Rollups**: new `app_event_groups` table (one row per
  `fingerprint`) tracks status (`open`/`muted`/`resolved`/
  `snoozed`), `event_count`, distinct `user_count`/`company_count`,
  `is_regression`, `first_seen_at`/`last_seen_at`, assignee,
  resolver. Maintained by an `INSERT … ON CONFLICT DO UPDATE` from
  the ingestion endpoint.
- **Ingestion**: `POST /api/client-errors` derives a sha1
  fingerprint from `name|topframe|component`, validates
  enum fields, persists the event row, then upserts the group.
  Re-occurrence of a `resolved` group flips it back to `open`
  with `is_regression=true`. Existing `error-boundary.tsx` payload
  extended with `appVersion`, `sessionId`, `component` (route),
  `breadcrumbs`, `context`. `main.tsx` now also installs global
  `error` / `unhandledrejection` listeners so non-React crashes
  reach the same pipeline, with a tiny in-memory breadcrumb ring
  capturing route changes (`window.__irrigoBreadcrumbs`).
- **Admin API** (super_admin only):
  - `GET  /api/admin/app-health/crashes` — filters
    `status`/`severity`/`company_id`/`version`/`q`/`window` plus
    `limit`/`offset`; sets `X-Total-Count`.
  - `GET  /api/admin/app-health/crashes/:fingerprint` — group +
    latest 50 events + breadcrumbs from the most recent event.
  - `POST /api/admin/app-health/crashes/:fingerprint/status` —
    mute/snooze/resolve/reopen one group.
  - `POST /api/admin/app-health/crashes/bulk-status` — same for
    a multi-select array of fingerprints.
- **Frontend**: `pages/super-admin-app-health.tsx` — header
  (title + 24h/7d/30d/90d window selector + Export stub), Phase 2
  status-hero placeholder, 7-tab nav, Crashes table with severity
  bar, regression badge, multi-select bulk Mute/Resolve, and a
  right-side `Sheet` drawer with stack trace, component stack,
  breadcrumbs, stats, and Mute/Snooze/Resolve actions. Polled
  every 15s via React Query.
- **Compatibility**: existing `/admin/client-errors` viewer
  (`pages/admin-client-errors.tsx` + `GET /api/admin/client-errors`)
  is untouched and keeps working.

## App Health Phase 2 (Task #551) deploy notes

- **DB migration**: this phase introduces the `audit_log` table
  (`lib/db/src/schema/audit-log.ts`). Production releases must run
  `pnpm --filter @workspace/db run push` against the deploy DB
  before traffic is shifted, otherwise
  `GET /api/admin/app-health/audit` will fail. The dev DB has
  already had this push applied.
- **Approximate metrics**: uptime, request rate, and API p95 in the
  Status Hero / Overview chart are computed from a process-local
  access-log ring buffer that resets on server restart. Sync queue
  depth is also a heuristic (in-progress field_work_sessions).
  These are explicitly approximations until persistent telemetry
  lands in Phase 3.

## App Health Phase 5 (Task #554) deploy notes

Phase 5 lights up the **Integrations** tab plus three super-admin
"break glass" actions. No DB migration is required — both the
per-tenant throttle and the force-upgrade pin live in the existing
`app_settings(key, value)` table under reserved key prefixes:

- `throttle:company:<id>` — `{rateLimit, expiresAt, setBy, setAt}`
- `minAppVersion:global` / `minAppVersion:company:<id>` —
  `{minAppVersion, scope, companyId, setAt, setBy}`

What's wired up:

- **Integrations tab** — `pages/super-admin-app-health.tsx` lazy-loads
  `IntegrationsTab` (kept off the default chunk so the page TTI
  stays under 1.5s). Backend aggregates per service over 10m / 1h /
  24h windows from `client_errors` where `source='integration'`,
  bucketing by `split_part(component, '.', 1)`. Status thresholds
  (>5 fails/10m ⇒ down, ≥1 ⇒ degraded) match the
  `integration-down` rule so the tab agrees with the active-
  incidents banner. Cards drill into a 50-row recent-failures
  drawer at
  `GET /api/admin/app-health/integrations/:service/recent-failures`.
- **Per-tenant throttle** — `lib/company-throttle.ts` keeps an
  in-memory map of `companyId → { rateLimit, expiresAt }`,
  hydrated from `app_settings` on registerRoutes startup and
  refreshed every 30s. `companyThrottleMiddleware` is mounted at
  the very top of `registerRoutes` (before the /api/* business
  routes) and reads the company id from `x-user-company-id`
  (header-auth) so it doesn't depend on per-route
  `requireAuthentication`. Returns `429` with `retryAfterMs` once
  the rolling-60s counter exceeds the cap. App-health, /health,
  /client-errors, and /config/min-app-version are exempt so the
  super-admin can always observe the throttled tenant. In-process
  state — best-effort across replicas, sufficient for the
  emergency-cap use case.
- **Force minimum app version** — `POST /…/companies/:id/force-upgrade`
  with `{minAppVersion, scope: 'company'|'global'}` writes the pin.
  Public endpoint `GET /api/config/min-app-version[?company_id=…]`
  is polled every 5 minutes by every browser
  (`lib/force-upgrade.ts`, started from `main.tsx` deferred boot).
  When the pin's `setAt` is newer than `localStorage.
  irrigopro:lastForceUpgrade` AND the running `VITE_BUILD_HASH`
  doesn't match, the client unregisters service workers, clears
  caches, stores the new `setAt` (so we don't loop), and
  `location.replace()` to pick up the deployed bundle.
- **Impersonation** — `POST /…/impersonate/start` validates the
  super-admin caller, looks up the target user (rejects
  super_admin targets), audits `auth.impersonation.start`, and
  returns the target user. Frontend `lib/impersonation.ts` tucks
  the original super-admin into `localStorage.
  irrigopro:impersonator` and swaps `localStorage.user` to the
  target. `ImpersonationBanner` (mounted in `desktop-shell` above
  `TopStrip`) stays pinned to every screen and exposes "Return to
  …" — restores the super-admin headers BEFORE POSTing
  `/…/impersonate/end` (so the super-admin guard passes for the
  end-of-impersonation audit row), then hard-reloads to
  `/super-admin/app-health`.
- **User drawer actions** — `Impersonate`, `Reset MFA`, and
  `Unlock` each open an `AlertDialog` confirm and write an
  `audit_log` row (`auth.impersonation.start`, `user.mfa.reset`,
  `user.unlock`). "Unlock" sets `users.is_active=true` (we don't
  have separate `lockedAt` columns yet, so unlock == reactivate).
  Reset MFA clears `mfa_enabled / mfa_secret / mfa_backup_codes /
  mfa_last_used`.

Caveats / known limits:

- Throttle counters are per-process. Multi-replica deployments
  will let each replica accept up to `rateLimit` rps; the cap is
  intentionally a coarse safety valve, not a precise budget.
- Impersonation is client-anchored (the super-admin guard sees the
  swapped headers as the target). Actions taken under
  impersonation are attributed to the target user in business
  data; the surrounding `auth.impersonation.start/.end` audit rows
  are the bracket. A future pass should propagate the
  impersonator id to every audit emitter.
- Force-upgrade relies on an existing `VITE_BUILD_HASH` build-time
  env var; environments that don't set it will silently no-op.

## Estimate lifecycle column (Task #642)

Single canonical `estimates.lifecycle` column persisted alongside the
legacy `(status, internalStatus)` pair. Stored values:
`draft | pending_review | sent | approved | rejected`. `expired` is
**not** stored — it's a read-time view over
`(lifecycle='sent', estimateDate > 30 days)` so a resend
(`estimateDate` reset) automatically rolls the row back to `sent`
without a write.

- **Schema**: `lib/db/src/schema/schema.ts` — `lifecycle` text column,
  not null, default `pending_review`. Apply with
  `pnpm --filter @workspace/db run push`.
- **Backfill**: `artifacts/api-server/src/scripts/backfill-estimate-lifecycle.ts`
  — idempotent; derives target from `deriveLifecycleForWrite(row)` and
  only writes rows that disagree. Dev run (May 15, 2026): 365 scanned,
  65 updated (300 pending_review + 33 sent + 30 draft + 2 approved).
  Run: `node --import tsx/esm artifacts/api-server/src/scripts/backfill-estimate-lifecycle.ts [--dry-run] [--batch=N]`
- **Helper**: `artifacts/api-server/src/lifecycle.ts` —
  `deriveLifecycleForWrite({status, internalStatus})` is the
  authoritative write-time mapping. `computeLifecycleStatus` now
  prefers the stored column when present and only re-derives expiry
  for `sent`.
- **Dual-write contract**: Every write path that mutates `status` /
  `internalStatus` must also stamp `lifecycle`. Sites:
  - `storage._writeEstimateWithItems` (insert), `storage.updateEstimate`
    (read-then-merge), `storage.updateEstimateWithItems`,
    `storage.rejectEstimateIfPending`,
    `storage.internallyApproveEstimateIfPending`,
    `storage.markEstimateSentToCustomer`,
    `storage.createWorkOrderFromEstimate`,
    `storage.approveEstimateAndCreateWorkOrder`.
  - Inline routes: `POST /api/estimates/:id/approve` and
    `POST /api/estimates/:id/reject` in `routes/routes.ts`.
  - `status='expired'` writes (token-expiry path) are special-cased in
    `updateEstimate` to leave `lifecycle` alone (stays `sent`).
- **Out of scope (future task)**: Dropping the legacy `status` and
  `internalStatus` columns is deferred until after production
  verification that all writes are dual-stamping and all reads agree
  with the column. Track as a separate follow-up.
- **Task #671 follow-up**: Two inline POST handlers in
  `estimate-routes.ts` (`POST /api/estimates/:id/approve` and
  `POST /api/estimates/:id/reject`) write a raw
  `db.update(estimates).set(...)` bypassing the storage helpers, and
  previously only set `status` — leaving `lifecycle` stale. Both now
  dual-stamp via `deriveLifecycleForWrite`. Regression guard:
  `routes/estimate-inline-lifecycle.test.ts` parses the source and
  asserts every raw `db.update(estimates)` block that writes
  `status:` or `internalStatus:` also writes `lifecycle:`. Backfill
  re-run on dev (May 18, 2026): 365 scanned, **65 updated** (the dev
  DB had drifted again since the May 15 run — most likely a reseed),
  idempotent rerun reports 0 updates. **Production still needs the
  backfill run** — the May 15 dev numbers were never replayed
  against prod, so EST-…6081 (id 2) and any siblings are still
  stale until ops runs
  `node --import tsx/esm artifacts/api-server/src/scripts/backfill-estimate-lifecycle.ts`
  against the deploy DB.

## Flat-only estimate labor (Task #657)

The estimate wizard now captures labor as a **single estimate-level
`totalLaborHours` value** — there is no per-row labor input and no
labor-mode toggle. The labor-mode column on `estimates` is still
present for back-compat reads but every new write forces it to
`'flat'`.

- **Server boundary**: `artifacts/api-server/src/estimate-payload.ts`
  — `processEstimatePayload` ignores the incoming `laborMode` field
  and always persists `laborMode='flat'` with per-row
  `estimate_items.labor_hours = '0.00'`. `laborSubtotal` is derived
  from `estimates.totalLaborHours * laborRate`. The wire field is
  kept on the input shape so legacy clients that still send
  `laborMode` don't 400.
- **Routes**: `routes/estimate-routes.ts` dropped the
  preserve-persisted-mode block on PUT; the payload helper is now
  the single source of truth.
- **Wizard**:
  `artifacts/irrigopro/src/components/estimates/estimate-wizard.tsx`
  removed `laborMode` state and the `LaborModeToggle` import. The
  line-items step has no per-row Labor Hrs column or input; the
  review step renders a single Labor row driven by
  `Total labor hours × rate`. On edit, legacy `per_part` rows
  hydrate by summing `item.laborHours` into `flatTotalHours` so the
  first save consolidates them with no data loss.
- **Backfill**: one-time migration
  `artifacts/api-server/src/scripts/backfill-estimate-labor-mode.ts`
  — idempotent; for every `laborMode='per_part'` row it sums
  `estimate_items.labor_hours`, writes that to
  `estimates.total_labor_hours`, zeroes the per-line values, and
  flips `labor_mode` to `'flat'` in a single transaction. Run:
  `node --import tsx/esm artifacts/api-server/src/scripts/backfill-estimate-labor-mode.ts [--dry-run] [--batch=N]`.
  Resumable: persists processed ids to
  `app_settings.estimateLaborMode.done` and any failures to
  `app_settings.estimateLaborMode.failed`. Dev DB run (May 15, 2026):
  365 scanned, **2 updated** (4 items zeroed, 6.00 total hours
  consolidated, 0 failures). The first dev pass executed before the
  resume-tracking refactor — the follow-up run with the persistent
  marker reported `updated=0` as expected, confirming idempotence.
- **Out of scope**: shared
  `components/wizard-shared/labor-mode-toggle.tsx` /
  `labor-mode-switch.ts` are still used by the billing-sheet wizard
  and work-order completion flows — left untouched.

## Financial Pulse Slice 4 — budget alerts (Task #693)

When the monthly invoice route flips a customer's `invoices.status` to a
finalized state, the route fires a fire-and-forget call to
`services/budget-alert-service.ts#checkBudgetThresholds(invoice)`. The
service computes month-to-date and year-to-date spend (createdAt
bucketing, draft/cancelled excluded — same convention as
`/api/customers/:id/budget-usage`), and for each of monthly × annual ×
soft × hard, attempts a single dedup-by-unique-index insert into
`customer_budget_alert_events (customerId, period, threshold,
periodKey)`. If — and only if — the insert returns a row (i.e. this
threshold has not already fired this period), it dispatches:

- **in-app** — `storage.createNotification` with type
  `budget_warning` / `budget_exceeded`, `relatedEntityType='customer'`
- **push** — through an injectable `pushDispatcher` seam (default
  no-op; the existing client polling pipeline picks up the in-app
  row and shows the OS notification — server-side web-push is
  deferred until a `push_subscriptions` table exists)
- **email** — Postmark via `EmailService.sendBudgetAlertEmail`,
  rendered inline by `renderTemplate(audience, threshold)`. The
  four canonical layouts also live as static `.html` references
  under `artifacts/api-server/src/templates/budget-alerts/`
  (`warning-internal.html`, `exceeded-internal.html`,
  `warning-customer.html`, `exceeded-customer.html`).

Channels are gated by `customers.budgetAlertChannels` (`inApp`,
`push`, `email` — defaults `true/true/false`). Recipients come from
`customers.budgetAlertRecipientUserIds`. A separate
`customers.budgetNotifyCustomerContact` toggle (default `false`)
also sends a customer-facing courtesy email to `customers.email`.

**Failure isolation contract**: every channel call is in its own
try/catch and the top-level `checkBudgetThresholds` swallows
everything. Invoice finalization MUST NOT fail because the alert
pipeline threw — the route invokes the service via a
`void (async () => { ... })()` wrapper on top of the service's own
catch-all.

**Read API**: `GET /api/customers/:id/budget-alert-events?limit=20`
(in `routes/budget-routes.ts`) returns the most recent rows joined
to `invoices` so each event carries `triggeringInvoiceNumber`. Same
visibility roles as `/budget-usage`
(super_admin / company_admin / billing_manager) plus a multi-tenant
guard. Powers the **Recent Budget Alerts** card on the customer
profile (`pages/customer-profile.tsx#RecentBudgetAlertsCard`),
rendered directly beneath `BudgetCard`.

Tests: `services/budget-alert-service.test.ts` — 9 scenarios:
single soft cross, idempotency, soft+hard on one invoice, period
rollover, no-cap no-op, customer-notify toggle (both states),
email-channel disabled, push failure isolation, top-level
swallow. The test inserts real `customers` rows in `before()`
(scratch ids 70001-70010, companyId=2) because the
`customer_budget_alert_events.customer_id` FK is hard.

## Estimate system

The estimate flow has two independent status axes (`status` =
customer response, `internalStatus` = internal review stage) plus a
single computed `lifecycleStatus` bucket. The UI groups and badges
should always switch on the computed lifecycle; behavior gates may
still check `status` directly. **Always check
[`docs/estimate-system.md`](docs/estimate-system.md) before editing
anything under `routes.ts` estimate handlers or
`components/estimates/**`** — it covers the lifecycle diagram, the
endpoint table, the role × action matrix, and the looks-similar-
but-isn't pitfalls (duplicate `POST` vs `PATCH` approve/reject,
`/transition` vs `/submit-for-review`, the dual customer-token
paths). The wizard's internals (3 state stores, 2×2 submission
matrix, `irrigopro:estimate-wizard-draft:v1:` autosave contract) are
in [`docs/estimate-wizard.md`](docs/estimate-wizard.md). The deep
audit of known gaps is in
[`docs/audits/estimate-handoffs-2026-05.md`](docs/audits/estimate-handoffs-2026-05.md).

## Financial Pulse Slice 3 (Task #692)

Drill-downs + Forward Look on `/financial-pulse`. Five new endpoints,
all `company_admin | billing_manager | super_admin` only:

- `GET /api/financial-pulse/top-customers?period=mtd|ytd&sort=revenue|budget_risk&limit=N`
  — per-customer revenue, monthly/annual cap usage with status
  (`unset|healthy|approaching|over`), avg days to pay, 7-month
  sparkline. `sort=budget_risk` ranks `over → approaching →
  healthy → unset`, then by `monthlyUsedPct` desc (see
  `sortTopCustomers` in `financial-pulse-math.ts`).
- `GET /api/financial-pulse/by-technician?period=…` — hours, revenue,
  labor cost, margin %, avg ticket, BS / WO counts. `laborCost` /
  `marginPct` are `null` when the tech has no `hourlyWage`.
- `GET /api/financial-pulse/by-service-type?period=…` — revenue,
  pct-of-total, invoice count, avg ticket per service type bucket
  (emergency / standard / contract / adhoc).
- `GET /api/financial-pulse/ar-aging` — Current / 1-30 / 31-60 / 60+
  buckets. Sum of `bucket.amount` equals
  `computeOutstandingAr(invoices)` (the Outstanding A/R KPI) within
  rounding — covered by `financial-pulse-slice3.test.ts`.
- `GET /api/financial-pulse/projections` — `mtd`, run-rate
  `projectedMonthEnd = mtd / daysElapsed * daysInMonth`,
  `prevMonthActual`, `prevMonthSameDay`.

Every endpoint supports CSV via `Accept: text/csv` *or* `?format=csv`.
Filenames: `financial-pulse-<tab>-YYYY-MM.csv` for `mtd`,
`-YYYY.csv` for `ytd`. Formula-injection guarded by prefixing any
field starting with `=+-@` with a single quote (`sendCsv` in
`financial-pulse.ts`).

Frontend (`pages/financial-pulse.tsx`):
- **Drill-downs band** — single `Card` with Tabs (By Customer / By
  Technician / By Service Type). Customers tab has client-side
  pagination (25/page from a 500-row fetch), `sort=budget_risk`
  toggle, per-row kebab menu, row click → `/customers/:id`.
- **Forward Look band** — A/R aging strip (4 color-coded buckets,
  click navigates to `/invoices?aging=<key>` — the invoices page
  doesn't yet support that query param, so it's a best-effort link
  pending follow-up) and Month-End Projection card with a stacked
  MTD-vs-projection bar.

Server tests: `routes/financial-pulse-slice3.test.ts` — 31 tests
covering the full role matrix (5 endpoints × 5 roles), CSV content
type / disposition on all three tab endpoints, aging-vs-KPI parity,
`sort=budget_risk` ordering, and `sort=revenue` regression.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
