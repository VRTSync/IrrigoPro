# Scheduled QuickBooks customer pull — verification

## Scope

The checkout already contained both prerequisite implementations: the field map
and lock-aware customer application, plus the paginated active-customer reader
and create-only review guards. The scheduled and manual paths now share those
implementations. No later Customer Records slice, production change, QuickBooks
customer write, email sender, new workflow, or automatic customer-lock enablement
is included.

The four nullable state columns are in the schema and the idempotent
`0029_qb_customer_pull_state.sql` migration. The development-only migration was
applied and its column types/nullability were read back from `information_schema`.
The existing post-merge schema workflow remains unchanged.

## Automated evidence

New API coverage is database-free and uses injected dependencies/transport:

- Fixed interval, exact CDC age boundary, five-minute overlap, full/manual mode.
- Exact inactive/deleted filters and skipped accounting.
- Attempt-before-fetch, start-time success checkpoint, persisted-summary shape,
  retained held/ignored/term warnings, isolated row failures.
- Busy does no work; customer-fetch 401/403 handling; fetch, apply and persistence
  errors return error results without advancing success.
- Same-session advisory lock acquisition/unlock/release, callback error cleanup,
  busy release, failed unlock destroying the client, and competing manual and
  scheduled runs applying only once.
- Delayed first tick, serial realms, non-overlapping sweeps, invalid company
  skips, connected-only processing, and recovery after realm/list failures.
- Real manual-handler delegation and response compatibility, caller-company-only
  status reads, null state for missing integration, single unref'd registration.
- CDC URL, ISO parameter, minorversion, wrapper usage, empty/missing responses,
  authorization/error shapes and nonfatal terms extraction.
- Actual customer application retains duplicate/sub-customer holds, dismissed
  ignores, and normal linked-customer updates.

The new web suite renders the actual exported status component and existing card:

- Relative `Last synced 3 minutes ago`, automatic cadence sentence, red error
  wording, and `Not synced yet`.
- Sixty-second polling.
- Successful `Sync now` immediately invalidates both customer queries and status,
  refetching and displaying the new relative time.
- A real mutation failure displays the server's exact 409 wording.

New suites are registered only in the existing serial `api-billing` and `web`
lanes. Existing source guards were adapted to follow the shared runner rather
than require application to remain inline in the manual handler.

Full command outputs and sandbox checks are retained under the ignored
`generated-artifacts/customer-pull/` directory and attached separately.

### Final lane results

| Command | Result | Output |
| --- | --- | --- |
| `node scripts/run-validation-lane.mjs api-billing` | 26 passed, 0 failed | `api-billing-final.log` |
| `node scripts/run-validation-lane.mjs web` | 25 passed, 0 failed | `web.log` |
| `node scripts/run-validation-lane.mjs types` | 4 passed, 0 failed | `types-final.log` |

The focused API run also passed all 56 tests across the pull, existing sync, and
company-scoped lookup suites. The new web suite passed all six tests.

Earlier runs are retained, not presented as passing: the first API lane exposed
an old source guard requiring direct inline application, and the first type lane
caught a missing schema import in the new state adapter. Both were fixed within
this change. A foreground type-lane retry was interrupted by the shell's
180-second limit, without a compiler error; the subsequent background run
completed all four entries. There are **no remaining baseline failures** in the
three final lane results, and no unrelated test or type repairs were made.

### Required row-error semantics and retry limitation

The completion review identified a retry limitation: an isolated customer
create/update failure recorded in `summary.results` can eventually fall outside
the five-minute CDC overlap if that QuickBooks record is not changed again.
Automatic replay of that failed row is therefore not guaranteed. A subsequent
manual **Sync now** performs a full read and can retry it.

The authoritative Slice 6 ticket explicitly requires per-customer errors not to
fail a run, and its test contract requires a successful summary to advance the
run-start checkpoint. The implementation intentionally preserves that requested
behavior rather than adopt the review's suggestion to stop checkpoint advancement.
An independently persisted failed-customer retry queue would be a separate
behavior/schema extension, not an unrequested change to this slice.

## Development runtime and unavailable live acceptance

The API and web managed workflows were restarted successfully. The new status
endpoint returned HTTP 401 with `{"message":"Authentication required"}` for an
unauthenticated request. The screenshot of `/quickbooks` shows the normal sign-in
page, not the signed-in QuickBooks card; signed-in UI was **not** visually verified.

The real advisory-lock helper was also exercised against development PostgreSQL
using a disposable, non-customer realm key: a competing dedicated session returned
`acquired: false`; after successful completion, a new session reacquired the key;
after a callback exception, another session also reacquired it. The pool was
closed afterward. This proof used no QuickBooks transport, customer writes, or
persistent fixtures. Output is in `development-lock-proof.txt`; it is not a
substitute for the unavailable live manual HTTP/QuickBooks scenario.

Development integration availability was queried without reading credentials:

```text
connection_status,integration_count
reconnect_required,1
```

There was no connected development QuickBooks integration or authenticated browser
session available for acceptance. Consequently, **not verified live**:

1. Creating a customer in QuickBooks and seeing it arrive automatically within
   fifteen minutes without a click.
2. Live scheduled `[QB customer pull]` logs and a screenshot of that customer.
3. The signed-in card's relative-time display and immediate manual refresh.
4. Competing live manual HTTP requests and the associated no-duplicate result.

The attached `[QB customer pull]` lines from automated tests are explicitly
stub/fake-timer evidence, not evidence of a live QuickBooks run.

A separate development query found zero duplicate nonempty QuickBooks-id groups
within a company. This describes the existing database only; it does **not**
prove live concurrency acceptance. No acceptance customers or integration
fixtures were created, no integration settings were changed, and no production
database or publishing operation was used.
