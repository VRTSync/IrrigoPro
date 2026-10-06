# Irrigation Build-Out: zone-record foundation handoff

## Changes and boundaries

Current profile-zone rows must be positions 1–N. The count column remains a transactional mirror for existing chips, wet checks, and location controls. Reductions retire rows; increases restore the same identity and fields. Needs attention (`is_active`) is unrelated to retirement.

No tile redesign, grid-entry expansion, downstream reader migration, production publish, or production backfill is part of this build.

## Schema before serving the updated application

Apply `lib/db/migrations/0023_irrigation_zone_retirement.sql` to the intended database using the project's approved schema deployment process. It is additive and repeatable: three nullable retirement fields, user FK, and partial `(company_id, controller_id)` current-zone index. The existing unique controller/zone-number identity remains.

The additive SQL was applied to **development only** for regression tests. It has not been applied to production by this build. Do not run the data backfill through startup or the merge hook.

## Separate production checkpoint

1. Confirm the deployed version contains this slice and confirm the additive schema is present. Publishing is a separate operation; merging does not publish.
2. Randy signs into the **deployed** `/admin/migrations` as super admin. Confirm the displayed database/environment is the intended production target.
3. Preview **Backfill controller zone records** (`backfill-controller-zone-records-v1`). It lists company, customer, controller, stored count, current row count, and compressed create/restore/retire ranges.
4. Unknown controllers with current rows use the highest current position as their target. Unknown controllers without current rows stay unconfigured. Resolve any invalid legacy target outside 1–100 explicitly; the migration does not truncate it or declare completion.
5. Review every proposed retirement and acknowledge when retirement is proposed. Creation/restoration alone requires no acknowledgement. Run the migration once.
6. Read the **independent post-run status and fresh preview**, not just the runner's success counts. All repaired controllers should show no remaining work; repeat preview must report zero controllers / zero creates / zero retirements. A failed controller prevents completion; successful controller transactions remain committed and a repeat run repairs only remaining work.
7. Confirm Villas at the Boulders Controller A shows 38 table rows and 38 chips. Lower to 30 and restore to 38; verify identical row IDs, preserved notes/runtime/program/overrides, and history entries. Both wet-check modes must update the profile on navigation without a manual reload; location counts must agree.

Attribution uses a **null user FK**, named `Migration backfill-controller-zone-records-v1`. Never create or assume a user with ID 0.

## Scoped verification commands (no new workflow)

```sh
pnpm exec tsc -b lib/db
pnpm --filter @workspace/db exec tsc --noEmit -p tsconfig.json
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/irrigopro typecheck
pnpm --filter @workspace/api-server exec node --import tsx --test --test-force-exit --test-reporter=spec src/routes/irrigation-profile-routes.test.ts src/lib/migrations/backfill-controller-zone-records.test.ts src/lib/migrations/registry.test.ts src/routes/admin-migrations-postrun.test.ts
pnpm --filter @workspace/irrigopro exec vitest run src/components/customers/irrigation-controller-grid.test.tsx src/pages/admin/migrations.test.tsx src/pages/admin/migrations-post-run.test.tsx src/components/location/work-location-controls.test.tsx
```

The route suite includes all ten supplied API scenarios plus bounded input, concurrent writers, invalid-user-FK rollback, and seed reconciliation. The migration suite covers preview/acknowledgement, inferred null counts, invalid legacy targets, tenant isolation, actual nullable attribution, idempotency, and independent failure verification.

Screenshots of the unauthenticated preview cannot prove the signed-in irrigation profile. The production signed-in visual acceptance above belongs to the separate deployment/backfill checkpoint.

## Development verification result

- All 142 scoped API/migration tests pass: the ten API scenarios, real DB tenant/actor-FK checks, concurrency, creation retries, rollback, registry, independent admin post-run verification, sparse Replace after shrink, and true-no-op CSV reimports (timestamps, attribution, history).
- All 59 scoped frontend tests pass. Scoped DB, API-server, and IrrigoPro TypeScript checks are clean.
- The managed API and web services restarted successfully. The unauthenticated sign-in page renders without browser errors. Signed-in rendered UI was not browser-verified; its controls and behavior were tested with component tests.
- Existing unrelated workflow logs from before this verification show resource-exhaustion failures (`EAGAIN` / thread creation) across many old test workflows. They also show a Financial Pulse CSV-header expectation failure in `src/routes/financial-pulse-access.test.ts` (`Key,Label` vs `Key,Group,Label`) and notification assertion failures in `src/services/budget-alert-service.test.ts` under `storage-error-propagation` and `seasonal-budget-api`. Those unrelated suites were not repaired or re-run by this slice. None of the scoped checks above is blocked by them.

The automated completion check subsequently ran the project's broader configured commands. `storage-error-propagation` and `seasonal-budget-api` passed in that run, superseding their older failure logs. Seven unrelated commands failed:

- `invoice-batch-reminders-ui`: selection did not clear on filter change.
- `nav-config-bookkeeper`: stale navigation expectations (including the existing Action Board link and bookkeeper link count).
- `offline-connection-recovery`: a retry-budget photo-delivery assertion returned false.
- `financial-pulse-manager-access`: CSV header expects `Key,Label`, but the current reader returns `Key,Group,Label`.
- `seasonal-budget-ui`: a 5-second test timeout followed by duplicate test elements.
- `bulk-budget-goals-frontend`: the same navigation expectations and budget-preview timeout.
- `budget-route-nav-parity`: the same navigation expectations plus a BudgetBar 5-second timeout.

These failures are outside the zone-foundation change; affected implementation/test files were not modified by this slice. They have not been suppressed or repaired to obtain a green global result.

On resubmission, completion code review **passed**, but the global validation gate still failed. `seasonal-budget-ui` passed on the retry; `invoice-ar-first-ui` instead failed with a 5-second timeout in the filtered select-all test. The remaining failed commands were `invoice-batch-reminders-ui`, `nav-config-bookkeeper`, `offline-connection-recovery`, `financial-pulse-manager-access`, `bulk-budget-goals-frontend`, and `budget-route-nav-parity`. The task cannot be marked complete while that configured gate remains red. Scoped slice verification remains green.

The subsequently requested pinned-baseline comparison is documented in [zone-foundation-baseline-report.md](zone-foundation-baseline-report.md). Five checks also fail without this slice. `invoice-ar-first-ui` and `offline-connection-recovery` pass both on baseline and with the slice when rerun; their earlier failures did not reproduce. No unrelated repair or assertion change was made.
