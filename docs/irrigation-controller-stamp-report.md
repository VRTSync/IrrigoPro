# Stable document controller references — completion report

## Scope delivered

- Scoped, executor-aware batch resolution of trimmed, case-insensitive letters. Company, customer and trimmed branch are exact scope boundaries. Customer-level scope is the empty branch. Empty letters cause no query; zero/multiple matches produce null identity and structured warnings, not failed saves.
- Estimate, work-order and billing-sheet headers; estimate/work-order items; and work-order zone photos stamp identity on their applicable storage write paths. Unrelated patches preserve identity. Customer/branch changes restamp the header and applicable items in one transaction, using their existing snapshots.
- Ordinary item edits retain parent-scoped prior location snapshots and identity through payload normalization and delete/reinsert replacement. Transient source-item hints disambiguate repeated parts; legacy clients use an ordered parent-scoped fallback. Unchanged locations are not re-matched after a rename. New or explicitly changed locations are resolved again, and explicit null letters clear identity.
- Shared wet-check conversion copies source zone-record controller identity into both new and appended estimate/work-order items, in service and inspection modes. Server-only source locations survive canonical estimate payload processing and bypass re-matching renamed letters. Snapshot letters, zone numbers, lineage and existing financial calculations remain intact.
- Existing location pickers receive the document branch through the shared customer step, three wizards and work-order completion. Requests use the cached API client, encoded branch URL and four-part query key. Prefix invalidations still refetch these queries. Mounts and empty responses preserve saved values; actual subsequent branch changes clear only controller/zone selection.
- Controller deletion retains ownership/authorization checks. Foreign-key failures return 409 with the exact work-history instruction; other failures remain 500. The existing controller grid needed a targeted error-parser change because the API client throws HTTP-prefixed JSON, not a plain message.

## Changed files

1. `artifacts/api-server/src/storage.ts`
2. `artifacts/api-server/src/routes/irrigation-profile-routes.ts`
3. `artifacts/api-server/src/document-controller-stamp.test.ts` (new real-DB regression suite)
4. `artifacts/irrigopro/src/components/location/work-location-controls.tsx`
5. `artifacts/irrigopro/src/components/location/work-location-controls.test.tsx`
6. `artifacts/irrigopro/src/components/location/customer-location-step.tsx`
7. `artifacts/irrigopro/src/components/estimates/estimate-wizard.tsx`
8. `artifacts/irrigopro/src/components/work-orders/work-order-wizard.tsx`
9. `artifacts/irrigopro/src/components/billing/billing-sheet-wizard.tsx`
10. `artifacts/irrigopro/src/components/work-orders/work-order-completion.tsx`
11. `artifacts/irrigopro/src/components/customers/irrigation-controller-grid.tsx`
12. `artifacts/irrigopro/src/components/customers/irrigation-controller-grid.test.tsx`
13. `scripts/validation-lanes.json`
14. `.agents/memory/irrigation-zone-rollout.md` (durable rollout boundary)
15. `docs/irrigation-controller-stamp-report.md` (this report)
16. `artifacts/api-server/src/estimate-payload.ts`
17. `artifacts/api-server/src/routes/estimate-routes.ts`
18. `artifacts/api-server/src/routes/routes.ts`
19. `artifacts/irrigopro/src/components/estimates/wizard/estimate-wizard-line-items-step.tsx`

The supplied attachment is input, not an edited implementation file.

## Validation-lane entries

Only the named `document-controller-stamp` entry was added to the existing **api-field** lane. No validation registration or workflow was added.

That entry uses the existing Node test runner's `--test-force-exit` option because the real production route registration starts background jobs. Fixture/server cleanup still runs in the suite's awaited teardown.

Existing **work-location-controls** and **retired-work-types** web entries remain unchanged and both execute the extended picker suite. The existing **irrigation-fast-entry** types entry executes the extended controller-grid suite. All other manifest entries and lane commands remain unchanged.

Final validation results on 2026-10-13:

| Check | Result |
| --- | --- |
| Manifest guard | 7 tests passed |
| api-billing | 16 entries passed, 0 failed |
| api-field | 17 entries passed, 0 failed |
| web | 21 entries passed, 0 failed |
| types | 4 entries passed, 0 failed |

No baseline/environmental blocker remains. Implementation type errors found during development were corrected before the final passing types-lane run, including the transient source-item hint typing added for edit round-trips.

Focused acceptance checks: 13 real-DB tests and 80 rendered UI tests pass. Another 23 existing estimate-price and work-order inline-edit contract tests pass alongside the real-DB suite. Fixtures use isolated companies/customers/controllers and clean their dependent rows and scoped audit records before ending their database pool. Case-variant duplicate letters test normalized ambiguity without removing the development database's legacy case-sensitive uniqueness index.

Rendered UI tests actually open the branch picker, check request URLs/cache keys, change branches, invalidate the controller prefix and exercise the controller-delete confirmation/toast. API tests exercise actual PostgreSQL foreign-key rejection and successful deletion, cross-tenant denial, unrelated 500s, canonical writes, both conversion modes/new-and-append paths, rename stability and transaction rollback.

The real registered PUT estimate and PATCH work-order-item routes also round-trip converted documents after a controller rename. Coverage includes repeated-part reordering, clients without source-item hints, changed locations, estimate branch restamping and lineage retention. A separate regression ensures new repeated parts cannot consume prior rows reserved by explicit hints, and explicit null letters clear even inconsistent legacy identities.

The API and web services restart successfully. The unauthenticated application screenshot shows the intact sign-in screen; the signed-in pages were **not verified in a live browser**. Their interaction behavior was verified through the rendered component tests, and branch-specific data through the existing real-DB profile-route tests.

## Production write audit

Audited Drizzle inserts/updates and raw SQL updates of all six document tables across storage and production routes. Migration/seed/script writes were identified but left unchanged.

### Stamped paths

| Storage seam | Disposition |
| --- | --- |
| `_writeEstimateWithItems`, `createEstimate`, `createEstimateFromPayload` | Header and destination items stamped; shared conversion may supply trusted source item identity. |
| `updateEstimate`, `updateEstimateWithItems` | Header patch stamping; customer/branch item restamps and replacements share the transaction. Unchanged prior item location/identity survives ordinary price/quantity edits. |
| `_writeWorkOrderWithItems`, `createWorkOrder` | Header and mapped items stamped; snapshots preserved. Ordinary create now uses one transaction. |
| `createWorkOrderFromEstimate`, `approveEstimateAndCreateWorkOrder` | Header and copied items re-resolve in destination scope; stale source document IDs are not trusted. |
| `updateWorkOrder` | Location edits restamp the header and items atomically; unrelated edits preserve identity. |
| `addWorkOrderItem`, `updateWorkOrderItem` | Scope read from actual stored parent; absent letter keys preserve identity. |
| `replaceWorkOrderItemsInTransaction`, `replaceWorkOrderItemsWithResync` | Parent-scoped matching preserves unchanged locations and IDs; changed/new locations are stamped within the existing transaction. Source hints preserve repeated-part associations and inspection lineage. |
| `attachWorkOrderZonePhoto` | Parent scope is locked in the stamp/insert transaction; existing client-ID deduplication/collision handling retained. |
| `createBillingSheet`, `updateBillingSheet` | Header identity stamped; existing pricing verification and number retry behavior retained. Billing-sheet items have no controller location. |
| `convertWetCheckToWetCheckBilling` direct estimate/work-order append inserts | Copy zone-record identity, with scoped fallback for rows without source records; destination headers/items still use existing conversion transactions. |

### Extra write paths and disposition

- `buildEstimateFromInspectionWetCheck`: no changes to this separate wet-check builder. Its existing canonical estimate writer now stamps destination items by scoped snapshot letters. Source-identity copying is limited to the shared conversion as requested.
- `getEstimate` legacy null-company repair: unchanged; tenant-repair write only. No historical controller backfill introduced.
- Estimate lifecycle/send/reject/internal approval, soft deletion, unapproval/unrejection and inspection handoff/unapproval methods: status, tokens, signature, timestamps or linkage only; unchanged.
- Work-order assignment, no-photo markers, item completion and user-deletion attribution cleanup: no customer/branch/controller-letter payload; unchanged.
- Billing/work-order recompute, labor edits, item resync, part repricing/approval, creation subtotal verification, mismatch repricing, invoice merge and storage total propagation: monetary/invoice/status fields only; unchanged. Replacement work-order item insertion is stamped at its existing seam.
- `estimate-routes.ts` direct approval/rejection writes: lifecycle/signature/timestamp only; unchanged.
- `estimate-routes.ts` ordinary PUT and `estimate-payload.ts`: retain transient source-item hints and explicit location fields through normalization. The wizard hydrates/submits those hints without changing the visible editor. IDs always come from matched rows in this estimate, never from client-supplied controller IDs.
- `routes/routes.ts` inline item edit, general work-order item replacement and field-completion payloads: carry source-item hints and applicable location snapshots into the existing replacement seam. Shared billing-sheet item validation is unchanged.
- `invoice-editability-routes.ts` direct writes: invoice membership, billed timestamp and status only; unchanged.
- `invoice-correction-routes.ts` direct writes: subtotal/total corrections or invoice linkage only; unchanged.
- `routes/routes.ts` raw SQL heals `work_orders.total_amount` and `billing_sheets.total_amount`: totals only; unchanged.
- Storage startup repair routines and `seed.ts` inserts: migration/seed work, deliberately not stamped or edited.

## Explicit exclusions confirmed

No historical controller-ID backfill, production data operation or publishing. No Slice 4c registry migration/tripwire or Slice 4d retirement work. No schema change, new columns, profile-zone IDs, prerequisite task, new page, endpoint, route or workflow. No mobile, site-map, PDF, invoice-generation, billing-math or `total_zones` code change. No wet-check capture/zone-record mutation change. No display-reader migration, snapshot relabeling, role/capability policy change or unrelated cleanup.

The planned next slices remain historical registry backfill/tripwire and later count retirement; this change does not execute either.
