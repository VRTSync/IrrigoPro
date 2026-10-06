# Zone-foundation baseline verification

## Checkout and method

- Requested baseline: `e5e4901172c29fd3b67cc432af359368286a2cc0`.
- Executed in a detached, clean worktree at `/tmp/irrigopro-2073-baseline`. This repository has no local `origin/main` ref; the exact requested commit is present and is an ancestor of the working branch.
- Dependencies were installed using the baseline's frozen lockfile, offline, with install scripts disabled. Workspace package links resolve inside the baseline worktree, not to the changed source tree.
- The seven configured shell commands below were run sequentially on the baseline, with no assertion edits, skips, or deletions.
- The clean lockfile installation initially lacked the workspace's untracked `fake-indexeddb` package. The first offline run therefore failed during import collection, not an assertion. Linking only that existing dependency into the baseline and rerunning produced **44 passing tests**. The initial import failure is not treated as a code failure.
- Raw output: `.local/state/zone-baseline-e5e49011/<check-name>.log`. These are local diagnostic files.
- No repair task was created and no application or test code was changed.

## Results

### `invoice-batch-reminders-ui` — FAIL (13 passed, 1 failed)

Command:
`pnpm --filter @workspace/irrigopro exec vitest run src/pages/invoices-batch-reminders.test.tsx`

Failing test:
`A/R list selection > drops the selection when the filters change underneath it`

Error:
`AssertionError: expected <p …(2)></p> to be null`

The selection banner remains after changing the filter.

### `nav-config-bookkeeper` — FAIL (73 passed, 4 failed)

Command:
`pnpm --filter @workspace/irrigopro exec vitest run src/components/layout/nav-config.test.ts src/components/layout/bookkeeper-nav.test.tsx`

Failing tests and errors:

- `bookkeeperNav — desktop sidebar > contains exactly Invoices, Customers, and QuickBooks`: expected three links, received four; additional `/reports/missing-location-data`.
- `no other role's nav structure moved (Task #1914) > billingManagerNav`: array equality mismatch; received additional `leaf /action-board` in Billing.
- `no other role's nav structure moved (Task #1914) > companyAdminNav`: array equality mismatch; received additional `leaf /action-board` in Billing.
- `no other role's nav structure moved (Task #1914) > managerNav`: array equality mismatch; received additional `leaf /action-board`.

### `invoice-ar-first-ui` — PASS (92 passed, 0 failed)

Command:
`pnpm --filter @workspace/irrigopro exec vitest run src/pages/invoices-ar-first-layout.test.tsx src/pages/invoices-ar-collections.test.tsx src/lib/quickbooks-health.test.ts`

Failing baseline test/error: **none**.

The earlier task completion run failed:
`select-all covers the filtered set > carries the search and billing month into the select-all fetch, the list and the aggregate`

Earlier error: `Test timed out in 5000ms.`

The same command was rerun with the zone-foundation changes and **all 92 tests passed**, including that named test (approximately 1.3 seconds). Neither the rewritten invoice test file nor the invoice page differs from the pinned baseline. The earlier completion-run timeout is not a reproduced change-induced failure.

### `offline-connection-recovery` — PASS (44 passed, 0 failed)

Command:
`pnpm --filter @workspace/irrigopro exec vitest run src/lib/offline/connection-recovery.test.ts src/lib/offline/connection-recovery-retry-budget.test.ts src/lib/offline/engine.test.ts src/pages/wet-checks/photo-capture-button.test.tsx`

Failing baseline test/error after matching the dependency environment: **none**.

The earlier completion run failed:
`a dropped connection does not spend the retry budget > still delivers the photo once storage comes back`

Earlier error: `AssertionError: expected false to be true`.

The same command was rerun with the zone-foundation changes and **all 44 tests passed**. These offline implementation/test files do not differ from the pinned baseline. The earlier assertion failure is not reproduced.

### `financial-pulse-manager-access` — FAIL (31 passed, 1 failed)

Command:
`pnpm --filter @workspace/api-server exec node --import tsx --test --test-reporter=spec src/routes/financial-pulse-access.test.ts`

Failing test:
`/api/financial-pulse/by-service-type CSV export returns 200 for irrigation_manager`

Error:
`AssertionError [ERR_ASSERTION]: The input did not match the regular expression /^Key,Label,/.`

Actual header: `Key,Group,Label,Revenue,% of Total,# Invoices,Avg Ticket`.

### `bulk-budget-goals-frontend` — FAIL (50 passed, 3 failed)

Command:
`pnpm --filter @workspace/irrigopro exec vitest run src/pages/admin-budget-goals.test.tsx src/components/layout/nav-config.test.ts src/components/customer-form-budget-preview.test.tsx`

Failing tests:

- `no other role's nav structure moved (Task #1914) > billingManagerNav`
- `no other role's nav structure moved (Task #1914) > companyAdminNav`
- `no other role's nav structure moved (Task #1914) > managerNav`

Error for each: array equality mismatch caused by the additional `leaf /action-board` entry, as in `nav-config-bookkeeper`. The admin-budget-goals and customer-form-budget-preview files pass on this baseline.

### `budget-route-nav-parity` — FAIL (104 passed, 3 failed)

Command:
`pnpm --filter @workspace/irrigopro exec vitest run src/components/layout/budget-route-nav-parity.test.ts src/components/layout/nav-config.test.ts src/pages/budget-status.test.tsx src/components/budget/BudgetBar.test.tsx src/components/customer-form-budget-preview.test.tsx`

Failing tests:

- `no other role's nav structure moved (Task #1914) > billingManagerNav`
- `no other role's nav structure moved (Task #1914) > companyAdminNav`
- `no other role's nav structure moved (Task #1914) > managerNav`

Error for each: array equality mismatch caused by the additional `leaf /action-board` entry. The other four files pass on this baseline.

## Conclusion

Five checks fail on the pinned baseline and are demonstrably pre-existing. Two pass on the baseline **and also pass with the zone-foundation changes** when rerun. Thus, “all seven fail on baseline” is not true, but no check reproduced a baseline-pass/current-fail regression. No repair was started and no assertion was changed.

## Earlier baseline for the invoice-selection regression

At the user's request, the exact batch-reminders command was also run in a clean detached checkout of `09230dbb438c8daedfdf1f14a8b482716c186c8c`, before the invoice-search change.

**Result: PASS — all 14 tests pass.** Specifically, `A/R list selection > drops the selection when the filters change underneath it` passes in 313 ms. No assertions were changed. There was a React `act(...)` warning, but no failing assertion or test.

The test passes before the invoice-search change and fails on the later pinned baseline, which added `placeholderData: keepPreviousData` to the invoice query. This is evidence of a selection regression between the two commits, not a stale test. Repair should preserve the assertion and clear selection on filter identity changes, without relying on placeholder rows disappearing.

Raw output: `.local/state/zone-baseline-e5e49011/invoice-batch-reminders-pre-2071.log`.

## Cleanup role decisions

- Bookkeepers retain the read-only Missing Location Data report for billing-quality audits; this does not grant general ticket editing.
- Irrigation managers retain the Action Board for dispatch. Company admins retain it for company-wide operations oversight.
- Billing managers should not have the operational Action Board. Retain their Budget Status and Financial Pulse access; align the board's menu, page, and API capability policy in the separate cleanup work.
- Update the Financial Pulse CSV header assertion to include the shipped Group column, without changing export behavior.

These decisions are recorded for the separate cleanup tickets; no role, menu, application behavior, or test assertion was changed in the zone-foundation task.

## Latest retry: retained timeout names and pinned-baseline replay

The latest completion retry failed the unchanged global gate. Its full logs and validation-run record were unavailable in the resumed workspace. The table below covers the exact timeout names retained in the preceding log excerpts; it cannot certify an exhaustive inventory of that retry.

| Test | Retry timeout | Result at `e5e4901172c29fd3b67cc432af359368286a2cc0` |
| --- | --- | --- |
| `fetch only on expand > loading another page still issues none of them` | 5,000 ms, `invoice-row-expansion-ui` | PASS, 1,274 ms; all 20 tests pass |
| `select-all covers the filtered set > selects every matching invoice, not only the loaded page` | 5,000 ms, `invoice-ar-first-ui` | PASS, 1,348 ms in the previously saved baseline run; all 92 tests pass |
| `Command Center row Delete confirmation > names the draft, cancels safely, then removes the table and board row after confirmation` | 5,000 ms under `estimate-command-center`; 20,000 ms under `command-center-row-delete` | PASS in both exact commands, 522 ms and 822 ms respectively |
| `Command Center row Delete confirmation > removes pending-review value from Open pipeline after delete` | 5,000 ms, `estimate-command-center` | PASS; all 15 tests pass |

The three newly replayed commands ran sequentially in a clean detached worktree at the exact baseline commit, with its frozen lockfile installed offline and install scripts disabled. No assertions, timeouts, validation configuration, application source, or draft tasks were changed. The baseline checkout remained clean.

Raw output is retained alongside the earlier baseline logs:

- `.local/state/zone-baseline-e5e49011/invoice-row-expansion-ui.log`
- `.local/state/zone-baseline-e5e49011/estimate-command-center.log`
- `.local/state/zone-baseline-e5e49011/command-center-row-delete.log`

None of the retained timeout names reproduced as a timeout on the isolated baseline. That is not proof of why the broad retry timed out, nor authorization to weaken the gate. Both cleanup drafts remain proposed and unstarted.

## Imported invoice-selection repair report

The sections above preserve the original zone-foundation baseline evidence. The report below records the separate invoice-selection repair and supersedes the earlier suspected cause.

## Combined patch integration

The supplied invoice-selection series was applied before the supplied CSV/role-policy series using `git am`. The common publication commit was already an ancestor of this checkout. Its duplicate was omitted; no publication action occurred. Conflicts concerned only this report and the memory index, and both sides' content was retained. All behavioral patches and their supplied assertions were preserved without additional assertion or timeout edits.

The supplied role-policy patch makes Action Board operational-only: irrigation managers, company admins, and super admins with an explicitly selected company. Billing managers retain Budget Status and Financial Pulse but cannot access the board through its menu, direct page, or API. Bookkeepers retain the read-only Missing Location Data audit. This supplied behavior supersedes the intervening recommendation to keep billing-manager board access.

# Invoice selection cleanup baseline

Verified on 2026-10-06, independently of zone-foundation work. The repair was
built on current main, whose invoice implementation matches the pinned later
baseline. No zone-foundation branch, production publish, role repair, CSV
repair, validation-gate change, or test-timeout change was used.

## Reproduced baselines

Command:

```sh
pnpm --filter @workspace/irrigopro exec vitest run src/pages/invoices-batch-reminders.test.tsx
```

- `09230dbb438c8daedfdf1f14a8b482716c186c8c`: 14 passed.
- `e5e4901172c29fd3b67cc432af359368286a2cc0`: 13 passed, 1 failed.
  The unchanged assertion in “drops the selection when the filters change
  underneath it” expected the selection banner to be null.

Both commits were checked in detached temporary worktrees using the installed
dependencies. The earlier worktree needed its workspace package links pointed
at its own shared sources; using current shared sources omitted the removed
`usesUiDefault` export and was not a valid reproduction.

## Lifecycle findings and repair

The existing reset already depended on `arParams`, not invoice rows. The
failing test navigates to `aging=days90`, which the parser previously treated
as `all`. The earlier automatic collections landing filters made that
navigation change the effective query; after landing defaults were removed,
it no longer did. Accepting `days90` as an alias for the canonical
`days90Plus` bucket preserves the original assertion and makes that deep link
an actual filter change without restoring automatic landing filters.

Keeping previous data also exposes stale-scope interactions independently of
that alias: old rows remain selectable while the new query is pending, and
an outstanding full-set select-all request can repopulate the old IDs after
the filter changes.

- Reset selection, off-page totals, pending select-all, and open batch/merge
  confirmations in a layout effect keyed only by `arParams`.
- Disable row and select-all checkboxes for placeholder data, with handler
  guards also covering the single-row reminder entry points.
- Reject stale select-all completions and fallback selections by filter
  generation, including an A → B → A navigation.
- Retain `keepPreviousData`, existing search behavior, and selection across
  pagination/refetches within the same filter.

## Final verification

The original 14 batch-reminder tests and their assertions remain intact.
Five additional cases exercise:

1. Two selected invoices and an open confirmation followed by a held filter
   request: the banner and confirmation disappear immediately while old rows
   remain visible and disabled. After the new result arrives, both reminder
   preview and confirmed-send payloads contain only invoice ID `2`.
2. An old select-all success after a filter change cannot replace the new
   selection.
3. An old select-all failure cannot fall back to selecting old loaded IDs.
4. Returning to the original filter does not revive its earlier select-all.
5. Loading another page under the same filter retains the first selection;
   the later preview contains both newly selected page IDs.

Results:

```text
invoice-batch-reminders-ui: 19 passed
invoice-ar-first-ui:        92 passed
frontend typecheck:         passed
```

Commands:

```sh
pnpm --filter @workspace/irrigopro exec vitest run src/pages/invoices-batch-reminders.test.tsx
pnpm --filter @workspace/irrigopro exec vitest run src/pages/invoices-ar-first-layout.test.tsx src/pages/invoices-ar-collections.test.tsx src/lib/quickbooks-health.test.ts
pnpm --filter @workspace/irrigopro typecheck
```

Existing warning output includes the original test's navigation outside `act`
and nested anchor markup; neither required weakening an assertion or changing
test configuration. Signed-in selection behavior is verified by rendered UI
tests and intercepted request payloads, not by an unauthenticated screenshot.

## Full project completion gate

The completion gate reran both requested invoice suites successfully and
passed the shared, API, and frontend typechecks. It did not reach a terminal
status, so the task was not marked complete. Other configured checks reported
failures outside this repair:

- `nav-config-bookkeeper`: navigation expectation differences.
- `migration-page-post-run-ui`: existing 5-second test timeouts.
- `retired-work-types`: worker creation failed with `EAGAIN`.
- `financial-pulse-manager-access`: the CSV assertion expects `Key,Label,`
  while the response starts `Key,Group,Label,`.
- `seasonal-budget-ui`: timeouts and duplicate-element assertions.
- `bulk-budget-goals-frontend`: navigation assertions and budget UI timeouts.
- `budget-route-nav-parity`: reported failure.

No gate bypass, timeout adjustment, or unrelated repair was made. Completion
needs a successful full-gate rerun after the separate validation blockers
are resolved.

## Combined-workspace verification after patch integration

The supplied repair series are now integrated with the zone foundation. The following commands were run independently in this workspace, preserving each registered command exactly, without changing assertions or timeouts:

| Check | Current result |
| --- | --- |
| Slice 1 API, backfill, registry, and post-run checks | 142 passed |
| Slice 1 controller, migration-page, and location-control UI checks | 59 passed |
| `invoice-batch-reminders-ui` | 19 passed |
| `invoice-ar-first-ui` | 92 passed |
| `nav-config-bookkeeper` | 77 passed |
| `financial-pulse-manager-access` | 32 passed |
| `budget-route-nav-parity` | 111 passed |
| `bulk-budget-goals-frontend` | 53 passed |
| `action-board-plan-ui` | 14 passed |
| `action-board-api` | 36 passed |
| Missing Location Data route checks | 7 passed |
| `bulk-budget-goals-types` — shared, API, frontend | Passed |
| Database package typecheck | Passed |

The original five reproduced baseline failures listed above now pass with the supplied repairs. That is evidence for those repairs, not proof that every global check passes. Local outputs are in `.local/state/combined-patch-verification/`, with the focused Slice 1 outputs at `/tmp/combined-zone-api.log` and `/tmp/combined-zone-ui.log`.

The unchanged full completion gate was attempted twice after integration. Both attempts disconnected before returning validation results, and neither marked the task complete. The first run could not subsequently be recovered. No validation bypass or configuration change was made. There is consequently no returned list of remaining failing tests to compare against the pinned baseline for this attempt; the earlier timeout inventory is not being presented as a fresh gate result.

The API and web services restarted successfully. The unauthenticated sign-in page rendered without browser errors. Signed-in screens were not visually verified. No production publish, schema application, or deployed-admin backfill was performed. Completion remains blocked on obtaining a successful unchanged full-gate result.

## Subsequent direct gate execution

At the user's instruction, completion retries stopped. All 56 registered checks were then executed directly in consecutive batches of at most five, preserving the exact commands and timeouts. All 56 exited successfully: 2,405 test executions passed, none failed, and none were skipped. The complete check-by-check table and evidence pointers are in [zone-foundation-manual-validation.md](zone-foundation-manual-validation.md). Since no check failed, no conditional baseline replay was needed. This does not claim that the completion service returned a successful gate result. Nothing was published or run against production.
