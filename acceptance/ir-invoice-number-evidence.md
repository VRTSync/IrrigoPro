# Permanent IR invoice numbers and QuickBooks number guards

## Scope and prerequisite

The merged stored-ID-only QuickBooks sync prerequisite was fast-forwarded into
this checkout before implementation. Its stored-ID ownership verification,
refusal branches, and legacy customer-scoped number behavior remain in place.
Migration 0024 was available before adding the two prescribed columns.

This change adds the permanent per-company counter, strict IR formatter,
true-only ten-minute realm preference cache, settings checks on all three app
invoice push paths, company-wide refuse-only IR collision guards, and returned
number mismatch persistence. Corrections retain invoice identity and original
transaction dates. Existing invoice numbers are not backfilled or renumbered.

No client, Command Center, PDF/email presentation, sorting/search, revision
helper, other-system prefix, or production data changes are included.

## Automated evidence

Command output is retained in `generated-artifacts/ir-invoice-numbers/` and
included in the downloadable acceptance report.

- `pnpm run typecheck:libs`: PASS. Required after the shared schema change so
  artifact typechecks consume current library declarations.
- `node scripts/run-validation-lane.mjs types`: **4 entries passed, 0 failed**.
- Final API-only typecheck after adding the actual-handler tests: PASS.
- `node scripts/run-validation-lane.mjs api-billing`: **18 entries passed,
  0 failed**. Exact summary is attached in the downloadable report.
- Latest number-allocation/static/actual-handler command:
  **34 tests passed, 0 failed**.
- QuickBooks operation suite: **59 tests passed, 0 failed**, including all
  prior stored-ID and legacy-number cases.
- Unchanged correction, editability, and sync HTTP caller suites:
  **89 tests passed, 0 failed**.

The two new lane entries are `invoice-number-format` and
`invoice-number-allocation`. The latter also executes the static source guards
and actual-route handler tests. No workflows or validation lanes were added.

### Real development database allocation

The allocation suite applies the prescribed SQL migration twice, then creates
two uniquely named throwaway companies and customers. It calls the real storage
method and cleans up its fixtures:

| Check | Verified result |
|---|---|
| First three company A invoices | IR-1001, IR-1002, IR-1003 |
| Ten simultaneous A allocations | Distinct consecutive IR-1004 through IR-1013 |
| First company B invoice | IR-1001 |
| Delete a local invoice, allocate again | Deleted invoice's number is not reused |
| Fail insertion after allocation | Counter remains consumed; next allocation skips it |
| Missing/null company | Throws; no timestamp fallback |
| Migration applied twice | Both executions succeed |

No existing company counter was advanced by these fixtures. Migration DDL was
applied to development only. No production mutation or publication was done.

### Actual handler execution with injected services

Tests parse the production route functions from `routes.ts` and execute those
functions with injected dependencies; they do not copy the route logic.
These are controlled tests, **not live QuickBooks sandbox acceptance**.

- Monthly and Bill Separately settings OFF: exact 409 wording and no allocation,
  invoice insertion, billing stamp, or QuickBooks POST.
- Both routes settings auth failure: exact 401 preflight wording and no number.
- Both routes thrown settings failure: exact 502 wording and no number.
- Cold-cache OFF followed by ON: immediate retry succeeds without waiting for a
  cached false; the first refusal leaves the counter at 1001.
- Both initial push routes company-wide collision: exact 409 refusal naming
  IR-1001; no POST and no billing stamp; local invoice rollback runs; counter
  remains 1002. Empty-search retry creates IR-1002 and advances to 1003.
- Bill Separately with absent/unusable integration: local IR invoice is still
  created and the source is billed without a QuickBooks push.
- Differing returned number `1034`: app keeps its IR number and persists mismatch.
- Shared sync entry point: settings checks precede orchestration; created outcome
  never writes `invoiceNumber`; verified updated outcome clears earlier mismatch.
- IR stored-ID correction/update: only the verified ID is posted, the IR number
  remains unchanged, and the sparse update omits `TxnDate`.
- Unlinked IR collision under another QuickBooks customer: company-wide query
  requests only IDs, never includes CustomerRef, and refuses without linking.
- Settings cache: realm isolation, true expiry at ten minutes, immediate
  false/auth/error retry, malformed response failure, and no cached failures.

Background PDF and alert work is outside the isolated handler VM. The unchanged
PDF and caller suites run separately.

## Audit

The requested `slice(-5)` / obsolete-prefix grep returns no results in artifacts
or libraries. Numeric-aware invoice sorts, lowercase substring search, and the
unused revision helper are unchanged.

The attachment's literal `(parseInt|Number)\(.*invoiceNumber` grep is not a
token-boundary check: it also matches the unchanged declaration
`deriveRevisionNumber(invoiceNumber: string)` and the required new function
names ending in `Number`. The full output is retained, not reported as empty.
The token-boundary audit `\b(parseInt|Number)\(.*invoiceNumber` returns no results.
There are no invoice-number numeric coercions in application code.

## Environment repair, not a PDF change

The first full billing run failed the unchanged `ticketPageWCB` snapshot because
ignored uploaded branding files were absent after the prerequisite merge.
Warnings explicitly reported missing logo assets. Three small original PDF
assets were restored locally from the pre-merge history:

- `attached_assets/FINAL-02_1754876518960.png`
- `attached_assets/IrrigoPro_2026-03_1780427958317.png`
- `attached_assets/IrrigoPro_2026-05_1780427958317.png`

The unchanged snapshot then passed: **36 tests, 0 failures**. No PDF renderer or
snapshot assertion was changed. The files remain ignored local runtime inputs,
not part of this work commit. Fresh environments still need the required assets;
their durable packaging is a separate follow-up.

The API workflow was restarted and served requests successfully.

## Live development sandbox evidence: unavailable

The available browser captures the sign-in page at `/invoices`, not an
authenticated invoice view. A development sync request without a session
returned HTTP 401 with `{"message":"Authentication required"}`. This is app
authentication, not the QuickBooks preflight auth outcome.

No authenticated IrrigoPro or QuickBooks sandbox browser session was available.
No credentials were requested in chat, extracted, displayed, or bypassed.
The signed-in UI was **not verified**.

The following requested live sandbox evidence was **NOT RUN**:

1. Monthly and Bill Separately with Custom transaction numbers ON, showing
   consecutive numbers in both applications.
2. Both routes and unlinked sync with the setting OFF and a cold/expired true
   cache, including unchanged real company counters.
3. Manually pre-created next-number sandbox collision, live 409/unbilled rollback,
   and the subsequent-number retry, with QuickBooks before/after evidence.
4. Correct/reissue of an IR invoice showing the same QuickBooks ID and number
   updated in place with its original transaction date.

Automated request fixtures and development-DB allocations are not substitutes
for that live evidence. No QuickBooks invoice was created, adopted, deleted, or
hand-edited for live acceptance. No real billing sources were marked billed by
the controlled route tests. A separate follow-up captures the missing live proof.

## Work commit

Work commit message:
`Allocate permanent IR invoice numbers and guard QuickBooks pushes`.

The downloadable report includes the final commit output and exact validation
summaries. Planned later CRM Billing Feed slices remain outside this change.
