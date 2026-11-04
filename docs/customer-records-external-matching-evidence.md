# External work-order customer matching — acceptance evidence

## Scope and implementation checklist

- [x] Only the external work-order customer matching slice is implemented.
- [x] Optional `customer.quickbooksId` is trimmed and nonempty; blank IDs use the existing 400 `VALIDATION_ERROR` path. Other request fields are unchanged.
- [x] The existing customer-records route module exports the exact input, dependency and result types and the dependency-injected resolver specified in the ticket.
- [x] The real POST handler delegates to that resolver, using the API key's company for both the lock and customer lookups.
- [x] QuickBooks ID takes precedence in both modes. A match returns the existing customer and never creates one.
- [x] Locked fallback matches only trimmed, case-insensitive email; duplicates return the exact 409 response, and misses (including name-only matches) return the exact 422 response using the shared system label.
- [x] Matching-error returns precede customer creation, work-order creation and notification writes. API-key middleware and its usage tracking are unchanged.
- [x] Unlocked fallback preserves email → case-insensitive, untrimmed name → create, including first-match duplicate-email behavior.
- [x] The creation object retains company, name, email, optional phone/address and timestamped notes exactly; it never includes the supplied QuickBooks ID.
- [x] Existing/new customer variables, downstream customer reload, assignment, notifications and success response remain unchanged.
- [x] The database-free resolver suite covers all ten numbered cases, scoped lookup arguments, exact creation payload, zero locked creation calls, stored/incoming email trimming, shared-label fallback and handler-scoped delegation/schema guards.
- [x] The new suite is registered only as `external-customer-resolve` in the existing serial `api-billing` lane; no workflows were added.

## Development API proof

Captured on 2026-11-04 against the running development API through its preview proxy, with a temporary company-admin login and a development API key created by the existing API-key endpoint. Credentials were generated/consumed within the proof process and never printed.

The isolated synthetic company was **1197**. The settings endpoint was `PUT /api/company/1197/customer-records`. Both locking and unlocking returned 200. No real company settings were changed.

| Request | HTTP result | Company-scoped database proof |
| --- | --- | --- |
| Locked, unknown customer | 422 `CUSTOMER_NOT_FOUND`, exact High Plains CRM message | Customers **1 → 1**; work orders **0 → 0** |
| Locked, `customer.quickbooksId: " 301 "` | 201; `customerCreated: false`; customer **2540** | Work order **3036** belongs to company **1197** and customer **2540**; customer count stays **1** |
| Blank QuickBooks ID | 400 `VALIDATION_ERROR` | Existing schema validation path |
| Unlocked, same unknown customer request | 201; `customerCreated: true`; customer **2541** | Customers **1 → 2**, exactly one new customer; work order **3037** |

The locked-ID proof used a seeded customer with a QuickBooks ID and synthetic local “connected” integration metadata, matching the existing development-test fixture convention. **No real QuickBooks sync or OAuth connection was exercised.** The metadata existed only to satisfy the existing settings endpoint's connection prerequisite.

The original unlocked/null-label state was restored through the settings endpoint and re-read successfully. The temporary login session was destroyed, and all fixture work orders, customers, API keys, audit rows, integration metadata, user and company were deleted. The proof log records successful cleanup. No production writes, production setting changes or publishing occurred.

Raw output and the reproducible development proof script are retained under the ignored directory `generated-artifacts/customer-records-3c/`.

## Validation evidence

All requested validation passed:

- [x] `node scripts/run-validation-lane.mjs api-billing` — **23 passed, 0 failed**.
- [x] `node scripts/run-validation-lane.mjs types` — **4 passed, 0 failed**.
- [x] New `external-customer-resolve` suite — **17 tests passed**, database-free.
- [x] Unchanged `auth-middleware-coverage.test.ts` — passed within the billing lane.
- [x] Unchanged `external-parts-catalog.test.ts` — **24 tests passed**.
- [x] Development health endpoint returns `{"ok":true}` after the API workflow rebuild/restart.

There were no baseline failures or skipped validation lanes to distinguish. Full lane results, development request/count output and newest-commit evidence are attached with the delivery.

## Newest commit

The final commit message is **“Enforce customer-record locks in external work-order matching”**. It contains the resolver, the minimal POST-handler replacement, the new database-free tests, the billing-lane registration and this acceptance checklist. The delivery's commit-evidence attachment records the resulting commit hash and its file summary. Generated logs and fixture scripts stay outside Git.
