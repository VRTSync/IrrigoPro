# Clocks Own Their History — Slice 1 acceptance

## Scope

This slice binds tickets to permanent controller IDs. It does not add a rename
ledger or re-lettering screen, change printed letters, or change schema. No
startup backfill is registered.

The user clarified on 2026-11-10 that Billed Clock Protection Slice 1 is queue
ordering, not a code dependency. That guard remains separate work.

## Local regression evidence

The existing suites contain real development-database fixtures covering:

| BUILD scenario | Evidence |
| --- | --- |
| 1. Normalized `d`, null branch, active preference, inactive ambiguity | `lib/migrations/registry.test.ts`: scoped candidates |
| 2. All seven tables; parent company/customer/branch scope; foreign isolation | `lib/migrations/registry.test.ts`: all-seven-table test |
| 3. D→X binds the old D/zone-5 sheet before rename; stored D remains | `routes/irrigation-profile-routes.test.ts`: rename/edits |
| 4. D↔E preserves both original IDs and letters | `routes/irrigation-profile-routes.test.ts`: swap test |
| 5. Unchanged normalized letter/null-or-empty branch preserves ID and ignores supplied ID; genuine letter/branch changes resolve | `routes/irrigation-profile-routes.test.ts`: rename/edits |
| 6. Letter-only zone insert resolves; ID miss adopts only unbound rows; another clock's bound history cannot match by letter | `routes/irrigation-profile-routes.test.ts`: technician writes |
| 7. Preview/run/check, acknowledgement, transactional marker, unresolved warnings, zero-write rerun | `lib/migrations/registry.test.ts`: acknowledged migration |

Additional cases prove rename rollback undoes binding, unresolved detail is
capped at 200 rows, preview warnings use the first 50 rows, no-op writes cannot
mark completion, and independent verification detects bindable rows introduced
after commit. A zone written under D and edited under X after its clock is
renamed reuses the original record ID and retains the stored D label while
saving new observations. Global-run tests restrict tenant enumeration to disposable test
companies and restore the prior development marker; unrelated tickets are not
backfilled by these tests.

API commands (run from repository root):

```sh
pnpm --filter @workspace/api-server typecheck
node scripts/run-validation-lane.mjs api-field
```

`api-field` already includes the migration-registry, irrigation-profile and
document-controller-stamp suites. No workflow or validation registration was
added. API health returned HTTP 200 after restarting the API service. The
public sign-in page rendered; the signed-in migration UI was not visually
verified (this slice changes no UI).

Verified locally on 2026-11-10:

- API-server typecheck: passed.
- Validation manifest guard: 8 tests passed.
- Migration registry: passed, including all new binding/migration cases.
- Irrigation profile plus role-matrix entry: passed after fixing test setup
  cleanup (no production rename behavior was changed).
- Document controller stamping: 14 tests passed, including live active/inactive
  preference.
- All 21 existing `api-field` entries have passing results: the initial full
  lane passed 19 entries; the two test-fixture failures above were corrected
  and both affected entries reran successfully using the existing lane runner.
- After completion feedback, candidate selection was made explicitly scalar
  (one result per eligible ticket). Both active and inactive ambiguous cases
  assert exact unresolved ticket IDs and one warning per ticket. The affected
  irrigation-profile/role-matrix entry and migration-registry entry reran
  successfully; the registry reported 44 passing tests. API typecheck remained
  clean.
- The completion run subsequently passed billing, web and types lanes but found
  a nondeterministic input-order assumption in the existing converted-item
  regression. Its fixture now explicitly chooses the starting A/B order before
  testing a B/A reorder; replacement-item preservation code was not changed.
  Both affected field entries reran successfully, including the new same-clock
  D→X zone-label regression and all 14 controller-stamping tests.

## Operator-only production acceptance — PENDING

Neither merge nor development tests establish that production tickets are bound.
This implementation did not publish, preview production data, or run any
production migration.

Randy's production checklist:

- [ ] Confirm the published build contains `bind-ticket-controllers-v1`.
- [ ] Open `/admin/migrations` in production and capture the preview **before**
      running it. Retain per-company/per-table bindable and unresolved counts,
      and the unmatched-ticket warning list.
- [ ] Review and acknowledge the preview, then run the migration.
- [ ] Confirm the committed-result verification succeeded and a fresh preview
      has zero bindable tickets. Unmatched rows remain unbound and reported;
      they do not block completion.
- [ ] Independently verify that Legends at Hunter's Glen's four billing sheets
      have the expected original `controller_id`, with stored letters unchanged.
      A completion marker alone is not evidence for these four records.
- [ ] On a disposable test location, verify a letter swap leaves tickets tied
      to their original clock IDs.
- [ ] Re-running should report zero newly bound rows unless new bindable legacy
      rows were introduced.

The marker is `bindTicketControllers.done`. `check()` returns `completed` when
zero bindable rows remain even without a marker; a marker with remaining
bindable rows returns `partially_applied`, not success.
