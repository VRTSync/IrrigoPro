# Customer Records Slice 4 — acceptance evidence

Verified in development on 2026-11-04. No production changes or publishing.

## Completed

- [x] Nullable customer columns and idempotent migration 0027; existing payment terms and defaults retained.
- [x] Shared ordered ownership list expanded; timestamp excluded.
- [x] Pure mapper, normalized lock-aware patch builder, and dependency-injected row application.
- [x] Locked mirroring/clearing, unlocked fill-empty-only, one lock read, tenant-scoped lookups, isolated row errors.
- [x] Timestamp-only writes count as unchanged; empty patches do not write.
- [x] Single nonfatal Term query in the existing authenticated manual route; pagination and integration/environment selection retained.
- [x] Eight editable modal fields with shared disabled checks, edit/create values, and disabled Payment Terms trigger.
- [x] Database-free sync suite: 15 tests, including the 12 required cases and handler-scoped delegation/failure checks.
- [x] Expanded form suite: 5 tests covering locked inputs, actual Select trigger, payload stripping, reopening, unlocked edits, and empty creation defaults.
- [x] Existing lookup source guard now follows the delegated tenant-scoped lookup without dropping its scope assertions.
- [x] New suite registered only in the existing serial billing lane; no new workflows/endpoints/scheduler.
- [x] Development migration applied twice, followed by information-schema verification of all nine nullable columns.

## Actual final lane results

| Command | Result |
| --- | --- |
| `node scripts/run-validation-lane.mjs api-billing` | 24 passed, 0 failed; exit 0 |
| `node scripts/run-validation-lane.mjs web` | 24 passed, 0 failed; exit 0 |
| `node scripts/run-validation-lane.mjs types` | 4 passed, 0 failed; exit 0 |

Full unabridged final output is retained under
`generated-artifacts/customer-qb-field-map/{api-billing,web,types}.log` and
attached in the self-contained HTML evidence report. Initial billing/type
attempts were not green: an inline-lookup source assertion needed to follow
the extraction, and a duplicate lock import needed removal. Both were fixed;
the affected full lanes were rerun successfully. Initial logs are also retained.

`pnpm run typecheck:libs` succeeded before the artifact checks, refreshing
shared declarations. The API and web workflows run successfully. Browser
smoke evidence is `generated-artifacts/customer-qb-field-map/app-smoke.jpg`.
It shows the sign-in page, not the signed-in customer modal. Signed-in modal
appearance has **not** been browser-verified; rendered component tests prove
the requested input/Select behavior.

## Blocked live QuickBooks sandbox evidence

The development database reports one QuickBooks integration:
`connection_status = reconnect_required`, with zero unexpired connections.
No credentials were read or displayed. Query output is retained in
`generated-artifacts/customer-qb-field-map/development-evidence.json`.

- [ ] Full new-field / Net 15 sandbox import — **blocked by disconnected sandbox**.
- [ ] Locked sandbox mobile clearing to stored SQL null — **blocked**.
- [ ] Unlocked preservation of a locally edited phone after a sandbox change — **blocked**.
- [ ] Sandbox Net 45 toast and unchanged stored terms — **blocked**.

Automated mapping/patch/application tests demonstrate these rules but are
**not** claimed as live sandbox proof. No sandbox fixture values or real
development company lock settings were changed; therefore no such settings
require restoration. Existing database tests used and cleaned their own
synthetic tenant fixtures.

To finish live acceptance, reconnect QuickBooks in development to an approved
sandbox, run the four ticket scenarios, retain row/modal/toast evidence, and
restore the fixture values and prior lock state. Do not use production for
this verification or automatically enable the High Plains lock.

## Implementation commit

The implementation commit is named:
`Extend QuickBooks customer mapping with lock-aware sync and modal fields`.
It contains only this slice's schema, shared ownership, sync, modal,
regressions, lane registration, and this acceptance record.
