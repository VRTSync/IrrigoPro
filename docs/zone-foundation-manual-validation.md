# Zone foundation: direct execution of the unchanged validation gate

Verified on 2026-10-06 against `ca8c21d0d5c7a4b569d01b3e23f2f35faa29c907`.

All 56 registered validation checks ran directly in 12 consecutive batches: eleven batches of five checks, followed by one batch of one check. Each batch finished before the next started. The exact registered shell commands were preserved, including existing worker flags and timeouts. No gate definition, configuration, assertion, timeout, or application source was changed.

**Result: all 56 commands exited successfully; 2,405 test executions passed, zero failed, and zero were skipped.** Counts are per check, not deduplicated across overlapping suites. The typecheck-only check contains no tests; its shared, API, and frontend typechecks passed. The mobile check also passed its shared and mobile typechecks.

| Check | Tests passed | Tests failed |
| --- | ---: | ---: |
| auth-middleware-coverage | 27 | 0 |
| company-id-backfill-migration | 11 | 0 |
| pdf-cover-header | 25 | 0 |
| wc-customer-picker-filter | 11 | 0 |
| wet-check-zone-filter | 24 | 0 |
| qb-invoice-ops | 24 | 0 |
| wet-check-select-shape | 2 | 0 |
| invoice-reminders | 39 | 0 |
| invoice-ar-list | 80 | 0 |
| invoice-ar-ui | 36 | 0 |
| invoice-ar-notes | 59 | 0 |
| invoice-ar-notes-panel | 7 | 0 |
| invoice-reminders-batch | 43 | 0 |
| invoice-batch-reminders-ui | 19 | 0 |
| storage-error-propagation | 71 | 0 |
| invoice-row-expansion-reads | 22 | 0 |
| invoice-row-expansion-ui | 20 | 0 |
| nav-config-bookkeeper | 77 | 0 |
| invoice-draft-editor-line-items | 7 | 0 |
| work-order-labor-hours | 18 | 0 |
| invoice-ar-first-ui | 92 | 0 |
| invoice-aging-summary | 80 | 0 |
| migration-registry | 34 | 0 |
| username-normalization | 39 | 0 |
| estimate-expiry-anchor | 36 | 0 |
| estimate-lifecycle-ui | 47 | 0 |
| pdf-site-metadata | 123 | 0 |
| offline-connection-recovery | 44 | 0 |
| work-location-controls | 48 | 0 |
| migration-run-proof | 33 | 0 |
| migration-page-post-run-ui | 22 | 0 |
| seasonal-budget-api | 65 | 0 |
| seasonal-budget-financial-pulse | 234 | 0 |
| retired-work-types | 49 | 0 |
| financial-pulse-manager-access | 32 | 0 |
| work-type-seed-reconcile | 51 | 0 |
| seasonal-budget-ui | 6 | 0 |
| bulk-budget-goals-backend | 74 | 0 |
| bulk-budget-goals-frontend | 53 | 0 |
| bulk-budget-goals-types | 0 | 0 |
| budget-route-nav-parity | 111 | 0 |
| budget-bookkeeper-exclusion | 106 | 0 |
| estimate-branch-gate | 76 | 0 |
| retire-followup-migration | 65 | 0 |
| action-board-api | 36 | 0 |
| action-board-ui | 32 | 0 |
| wet-check-labor-shared | 1 | 0 |
| wet-check-repair-totals | 4 | 0 |
| wet-check-submit-preview-parity | 6 | 0 |
| finding-catalog-labor | 2 | 0 |
| zone-screen-derived-labor | 3 | 0 |
| action-board-plan-text | 12 | 0 |
| action-board-plan-ui | 14 | 0 |
| estimate-command-center | 15 | 0 |
| manager-mobile-action-board | 46 | 0 |
| command-center-row-delete | 92 | 0 |

No check failed, so the requested conditional standalone comparisons against `e5e4901172c29fd3b67cc432af359368286a2cc0` were unnecessary. No baseline suite run is claimed for this verification.

The current command list was independently compared with the earlier saved gate snapshot and was identical. Local evidence:

- `.local/state/task-2073-manual-gate.json`: exact registered commands.
- `.local/state/task-2073-manual-results/results.json`: per-check counts, exit codes, batch number, elapsed time, and output path.
- `.local/state/task-2073-manual-results/<check-name>.current.log`: full output for each check.
- `.local/state/run-task-2073-gate.py`: bounded direct-execution runner.

This is a direct execution report, not a successful completion-service result. At the user's instruction, no further completion retry was made. No production publish, production schema application, or deployed-admin backfill was performed.
