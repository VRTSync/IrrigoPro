# Clock ledger and location re-lettering acceptance

## Scope and prerequisite

Slice 1 was fetched from the existing GitHub remote and fast-forwarded into this
checkout before implementation. Its transaction-compatible `bindTickets` is used,
not recreated. No production backfill, ticket-label rewrite, PDF change, mobile
change, wizard change, or ledger browsing UI is included.

## Local implementation

- Additive `0035_controller_letter_ledger.sql`, matching the Drizzle schema,
  records final renames only. No old snapshot history is reconstructed.
- Single changes record one `change`; swaps record two `swap` entries; same-letter
  confirmations record none.
- Office-only `PUT /api/customers/:customerId/controllers/letters` checks ownership
  before body validation, including customer existence for super admins.
- The parent customer lock serializes location edits with existing clock
  creates/swaps. Binding, active-set locks, validation, final updates, ledger
  entries and snapshots share one transaction.
- Cycles stage **only changed** clocks outside both active uniqueness predicates.
  Final activity is restored before snapshots. Both unique indexes are retained.
- The dialog submits exactly the active clocks at its current branch, defaulting
  to the empty branch. It never combines branches from the legacy profile read.
  Successful saves invalidate the profile, property controllers and changed
  histories. Errors retain selections and display the server message.

## Schema verification

The additive migration was applied to the development database. The normal
schema push completed, and `pnpm --filter @workspace/db run verify` passed for
all 68 tables. A read-only Drizzle diff reported **zero ledger drift statements**.
The ledger's controller FK has an explicit short identifier so PostgreSQL's
63-byte name limit does not cause perpetual drop/recreate proposals.

The whole-database Drizzle diff is **not globally empty**: it still proposes
31 statements outside the new ledger, including existing overlong FK identifiers.
These unrelated schema differences were not adopted into this slice. The
project's table/column verifier is clean; the ledger itself is drift-free.
No destructive diff was applied by the read-only check.

## Regression evidence

- DB/shared composite library typecheck passed (`pnpm run typecheck:libs`).
- API and IrrigoPro leaf typechecks passed.
- Profile + role-matrix API suites: **137 tests passed**, including actual cycles
  under both real unique indexes, frozen billing identity, exact-set validation,
  duplicate IDs, branch isolation, unchanged stamps, office access, super-admin
  existence checks and a mid-batch rollback of binding/ledger/snapshots.
- Existing Document System API suite passed after adding ledger cleanup to its
  disposable test-tenant teardown.
- Profile/grid/zone web regressions: **112 tests passed** before the additional
  named-branch profile case.
- Final bounded Document System/profile web group: **206 tests passed**, including
  all 61 profile cases. Grid/zone tests were unchanged by the final dialog-width
  and profile-test changes.
- Shared zone/schedule tests: **33 passed**.
- Validation manifest guard: **8 passed**.
- The existing `api-field` workflow reported **21 entries passed, zero failed**.
  The affected API suites were also run directly against this slice.
- The existing complete `web` workflow reported **29 entries passed, zero failed**
  before the profile suite was added. The updated six-file web entry subsequently
  passed directly with all 206 tests; the profile suite is now registered in the
  existing bounded **web** lane. No workflow or validation registration was added.

## Signed-in browser evidence

A disposable development tenant and authenticated irrigation manager were used
through the real application and real API, without bypassing authentication.
The fixture included three controllers with two zones each and an existing
unbound, submitted billing sheet for B zone 2.

The browser selected A/B/C → C/A/B with native selects, checked duplicate feedback,
and saved successfully. It then opened the existing billing sheet list.
Independent database reads confirmed:

- the billing sheet's controller ID became the **original B clock's ID**;
- its stored letter remained **B**;
- that same clock's current letter was **A**;
- exactly three ledger rows shared one UUID;
- no browser page errors occurred.

The phone dialog was checked at 390×844 and its bounds were asserted inside the
viewport. Desktop evidence was captured at 1280×900.

Screenshots and machine-readable proof are retained outside Git at:

- `generated-artifacts/reletter-evidence/01-before-desktop.jpg`
- `generated-artifacts/reletter-evidence/02-cycle-desktop.jpg`
- `generated-artifacts/reletter-evidence/03-cycle-phone.jpg`
- `generated-artifacts/reletter-evidence/04-saved-profile.jpg`
- `generated-artifacts/reletter-evidence/05-original-billing.jpg`
- `generated-artifacts/reletter-evidence/proof.json`

The disposable tenant and ticket/clock fixtures were removed after capture.
Screenshots show test data only.

## Rollout status

**Local schema and feature verification: complete.**
**Merge: pending completion/approval. Production publish: not performed.**

After merge, an operator should use the supported Publish flow, confirm the
production ledger table is available, and verify the intended real location.
If applicable, run Slice 1's separately approved production binding migration
through its existing preview/acknowledgement flow. A local schema push or browser
fixture is not evidence that production has been migrated or re-lettered.
