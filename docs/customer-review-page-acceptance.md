# Customer review page — development acceptance

Verified on 2026-11-05 against the merged sync-review prerequisite.

## Delivered scope

The frontend consumes the prerequisite's actual `{ held, unlinked, qbError? }`
listing, `{ held, unlinked }` summary and record-valued resolution responses.
Unlinked entries contain `{ customer, candidates }`; candidates use `qbId`,
`name`, `address`, and a non-displayed `score`. A deleted local candidate is
nullable: its hold remains creatable or ignorable but has no invalid profile or
link button.

All five action paths use explicit AlertDialogs, with the ticket's fixed text
for existing candidates. Both create variants and Ignore submit an empty body;
link and Not in QuickBooks use the exact specified payloads. Pending actions
disable the affected row/card and keep confirmation and cancellation disabled
until completion. Success invalidates the three specified keys before its
action-specific toast; errors use `parseApiError` for the server message.

Only bookkeeper, billing_manager and company_admin have the route. The existing
three QuickBooks cards remain, with the success-only review card appended.
There are no new navigation items or capability changes. Manual customer import
retains its previous description and invalidations, appending positive held counts.
No server, schema-source, migration-source, matching/ranking, scheduler, mobile or
production changes are included.

## Automated evidence

Complete, unedited command outputs are attached in the self-contained HTML
acceptance report and retained under `generated-artifacts/customer-review-page/`.

| Command | Actual result | Output |
| --- | --- | --- |
| `node scripts/run-validation-lane.mjs web` | 25 passed, 0 failed | `web.txt` |
| `node scripts/run-validation-lane.mjs types` (initial) | 2 passed, 2 failed | `types.txt` |
| `pnpm run typecheck:libs` | Passed | `libs-refresh.txt` |
| `node scripts/run-validation-lane.mjs types` (after generated declaration rebuild) | 4 passed, 0 failed | `types-final.txt` |
| Final customer-review-page lane entry, run directly after strengthening its tests | 3 files, 27 tests passed | `targeted-final.txt` |

The initial types failures were stale generated database declarations missing
the prerequisite's already-present exports and customer exclusion field.
Rebuilding composite libraries resolved them without any source changes.
The full web lane passed with 26 review tests; the final focused rerun adds the
deleted-candidate regression and strengthens pending-row assertions. No other
web-lane source changed after its successful full run.

The focused suites cover all six supplied cases plus exact mutation arguments,
both create variants, confirmed Ignore, unlinked candidate linking, all three
success invalidations, cancel-without-request, repeat submission and row/card
pending controls, parsed server errors, threshold boundary and hidden numeric
scores, local-data preservation during QB failures, no candidates, loading,
failed reads, both empty states, static role-route guards, the summary card's
success/zero/loading/error states and sync-toast suffix behavior.

## Development database preparation

The runtime development database initially lacked `customer_sync_review` and
`customers.qb_not_in_quickbooks_at`. Preparation applied only the existing,
already-merged additive SQL from `0027_customer_qb_field_map.sql` and
`0028_customer_sync_review.sql`. It did not run a broad schema push, author new
DDL, enable any lock, modify integrations, or touch production.
The before-state and applied filenames are in `dev-setup.json` / `dev-setup.txt`.

## Signed-in browser evidence

Puppeteer drove the proxied development app using fresh real username/password
logins, separate browser contexts for each role, and an isolated fixture company
with verified temporary users. Temporary credentials were not retained in reports.

- `quickbooks-counts-detail.png`: the appended review card showing
  **2 held by the sync · 2 not linked to QuickBooks**, with its working link.
  This is a crop of the actual full-page capture, not a reconstructed UI.
- `billing-manager-held.png`: both held kinds, addresses, local candidate and
  unlinked customers, plus the truthful unavailable-suggestions warning.
- `held-link-dialog.png`: the exact confirmation before linking the held duplicate.
- `after-held-link.png`: the actual list after the real endpoint returned 200;
  the resolved hold and linked local customer disappear on refetch.
- `synthetic-unlinked-candidates.png` and `synthetic-candidate-link-dialog.png`:
  **synthetic suggestion rendering only**, clearly named as such in the UI.
  A browser-intercepted listing response supplied candidate names, addresses and
  scores. The link itself used the real development endpoint and the stored
  customer link was checked. These are not evidence of a live QuickBooks read.
- `irrigation_manager-access.png`: **404 Page Not Found** after a fresh login.
- `bookkeeper-access.png`, `company_admin-access.png`: the page opens after fresh
  logins. The billing-manager screenshot above verifies that role.

`browser-report.json` records the real link response, stored-link checks,
metadata, screenshots, access results and cleanup. The final run had **no browser
page errors**. Existing shell requests produced unrelated 403s:
billing-manager/bookkeeper requests to `/api/company/{fixtureCompanyId}/profile`,
and irrigation-manager landing requests to `/api/parts/pending-approval` and
`/api/manual-part-reviews`. No customer-review request was forbidden.

The fixture company, users, customers, reviews and audit rows were deleted.
The browser logged out each role and closed its contexts. No customer data was
written to QuickBooks.

## Blocked live acceptance — not claimed as passing

A development-only, credential-free metadata query returned:

```
token_environment | connection_status  | count
sandbox           | reconnect_required | 1
```

There is no connected QuickBooks sandbox available. Consequently:

- Live sandbox-derived candidate suggestions are **unverified**.
- Linking a live sandbox customer and proving its billing details update on the
  next **Sync customers** is **blocked**.

To finish those live checks, reconnect an approved development QuickBooks
sandbox, create the ticket's owned fixtures there, capture real suggestions,
confirm the link, run the existing manual import, verify its updated details,
then restore/delete the owned fixtures where practical. Do not infer that
synthetic suggestions or a local fake QB ID prove a remote sync.

## Commit scope

The newest implementation commit is titled:
**Add confirmed customer review page and QuickBooks review entry point**.
Its diff contains the page, permitted routes, existing QuickBooks UI
extensions, three focused frontend suites, the serial web-lane entry and this
acceptance record. Generated logs, screenshots, fixture scripts and HTML report
remain outside Git and deployment inputs.
