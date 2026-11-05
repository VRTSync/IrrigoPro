# Customer Records Slice 7 — verification evidence

## Prerequisites and scope

- The checkout includes the merged Slice 5a review implementation and Slice 6 scheduled pull implementation before Slice 7 changes.
- Added only QuickBooks inactivity visibility/provenance, its input protection, full/CDC read integration, summaries, and the requested web status surfaces.
- No customer writes to QuickBooks, lock-setting changes, production changes, customer deletion, Command Center changes, expanded hidden-customer filtering, or history changes.
- The existing Slice 6 migration was applied to the development database because its pull-state columns were missing. Slice 7's additive migration was exercised idempotently against development; it does not rewrite existing visibility values.

## Automated checks

Final required lane results:

| Lane | Passed entries | Failed entries |
| --- | ---: | ---: |
| `api-billing` | 26 | 0 |
| `web` | 26 | 0 |
| `types` | 4 | 0 |

All three static guards passed. OpenAPI regeneration/shared-library compilation and `git diff --check` passed.

Full output is retained locally under `generated-artifacts/customer-visibility/` (excluded from Git and deployment):

- `api-billing.log`: `node scripts/run-validation-lane.mjs api-billing`
- `web.log`: `node scripts/run-validation-lane.mjs web`
- `types.log`: `node scripts/run-validation-lane.mjs types`
- `codegen.log`: OpenAPI client/Zod regeneration and shared-library type build.
- `static-guards.log`: no old full-fetch helper, no active-only customer query, and no old combined skipped-count field in application/shared source.

The API tests exercise the actual sync implementation in both lock modes, including inactive visibility-only writes, already-hidden no-ops, normal field patches on reactivation, visibility-only reactivation counts, manual hiding, inactive unlinked review bypass, and missing `Active`. Real development-database HTTP tests exercise PUT and PATCH with both visibility choices, strip malicious provenance writes, and verify creation cannot set provenance. The real review route test includes an inactive would-be candidate and confirms it is excluded.

The web lane includes `customer-visibility-chip`, with the requested text, styling and QuickBooks tooltip, plus Sync now invalidation of cached customer profiles.

## Browser and development-database acceptance

`acceptance.json` and `browser.log` record synthetic fixtures against the running app, authenticated through its real login endpoint. QuickBooks input rows are injected into the actual sync function with real database/storage dependencies. This is **not** a live QuickBooks sandbox test.

Verified:

1. A visible linked customer becomes hidden with QuickBooks provenance; stale remote name/email do not overwrite local fields.
2. The hidden customer is absent from the existing `billingVisible=true` picker API.
3. Its existing work order remains accessible through the customer history API and is rendered on the profile's Jobs tab.
4. Both desktop and mobile All Customers layouts show “Inactive in QuickBooks”.
5. The profile header renders Hidden with the exact tooltip; active input restores Visible and clears provenance.
6. A manual hide through the real PATCH endpoint remains hidden after inactive and active input.
7. No browser page errors. Synthetic company, user, customers and work-order fixtures were removed.

Screenshots retained locally and included in the deliverable evidence report:

- `profile-visible.png`
- `profile-hidden.png`
- `profile-hidden-history.png`
- `profile-restored.png`
- `all-customers-hidden-desktop.png`
- `all-customers-hidden-mobile.png`

## Live sandbox acceptance — BLOCKED

The development database has **zero connected sandbox QuickBooks integrations**, and no authorized sandbox editing session was supplied. Therefore the three human-in-QuickBooks inactive/reactivation/manual-hide scenarios followed by **Sync now** are **blocked, not passed**. The browser evidence above proves the application behavior with injected rows, not a live Intuit exchange.

To close the live acceptance gap, connect an authorized development sandbox and have its operator toggle the test customers in QuickBooks, then repeat the ticket's Sync now checklist. IrrigoPro must remain read-only for QuickBooks customers.

## Commit

The implementation commit is titled **Hide QuickBooks-inactive customers with manual visibility overrides**. Generated screenshots, lane logs and the self-contained verification report are excluded from Git; the report is delivered separately with its screenshots embedded.
