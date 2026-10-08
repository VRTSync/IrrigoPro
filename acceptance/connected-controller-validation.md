# Connected controller validation

## Passing focused checks

- `pnpm --filter @workspace/shared exec node --import tsx --test src/irrigation-zones.test.ts`: 2 passed.
- API profile routes: 85 passed, including list classification, ordered/attributed retired detail, identity restoration, tenant isolation and exactly two batched zone reads across multiple controllers.
- Controller-zone foundation and backfill regression suites: 8 additional tests passed.
- Web controller-grid and irrigation-profile suites: 68 passed, including customer-card management/zone-editor boundaries for all five relevant roles.
- `pnpm --filter @workspace/shared typecheck`: passed.
- `pnpm --filter @workspace/api-server typecheck`: passed.
- `pnpm --filter @workspace/irrigopro typecheck`: passed.
- `git diff --check`: passed.

Referenced workspace declarations initially lagged the source schema. Rebuilding `lib/db` and `lib/shared` with `pnpm exec tsc -b lib/db lib/shared` resolved the apparent missing-retirement-field errors without schema edits.

## Independently reproduced baseline failure

`pnpm --filter @workspace/shared test`: 164 passed, 1 failed.

The unchanged `JOB_TYPE_COLORS` test “exports the exact four canonical hex values” expects estimate color `#6B46C1`, while the unchanged existing implementation returns `#475569`.

The same failure was independently reproduced in a detached baseline worktree:

```sh
git worktree add --detach /tmp/irrigation-baseline HEAD
pnpm --filter @workspace/shared exec node --import tsx --test --test-reporter=spec /tmp/irrigation-baseline/lib/shared/src/job-type-colors.test.ts
git worktree remove /tmp/irrigation-baseline
```

Neither the palette nor its test was changed. This is outside the irrigation slice; validation configuration was not weakened.

## Operational scope

No schema migration, production backfill, publishing, mobile changes, site-map changes, or new component/page/route files. The only `totalZones` occurrence remaining in the shared grid is the required count-endpoint request key.

See `connected-controller-evidence.md` for authenticated browser evidence and fixture availability.

## Completion-run resource failures and serial replays

The automatic concurrent completion run hit the container's process/thread limit (`pids.max = 1152`): logs contain `pthread_create: Resource temporarily unavailable`, `spawn node EAGAIN`, and `Cannot fork`. Some UI checks also timed out under that concurrent load. The run did not reach a terminal state.

Every failed regression command was replayed individually, using its original registered command unchanged. All 15 replays passed:

- storage-error-propagation
- work-order-labor-hours
- migration-page-post-run-ui
- seasonal-budget-ui
- bulk-budget-goals-backend
- bulk-budget-goals-frontend
- budget-route-nav-parity
- retire-followup-migration
- action-board-api
- action-board-ui
- wet-check-labor-shared
- wet-check-repair-totals
- wet-check-submit-preview-parity
- zone-screen-derived-labor
- action-board-plan-text

The typecheck command that failed with `Cannot fork` passes directly for all three requested packages. No validation configuration, assertions, worker flags, or timeouts were changed.

## Permission contract

The customer-profile caller now matches the dedicated irrigation profile: controller management belongs to company admins, super admins and irrigation managers; billing managers are read-only; field technicians retain zone editing and Add Zone.

The existing zone-count endpoint authorization was deliberately preserved, as required by the task's count-action step. This slice removes technician retirement controls from both profile UIs, not their pre-existing API capability used by other readers/workflows. Narrowing that shared endpoint would change the Slice 1 permission contract and requires separate authorization rather than silently changing an out-of-scope workflow.
