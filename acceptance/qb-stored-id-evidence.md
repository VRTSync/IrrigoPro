# Stored-ID-only QuickBooks invoice sync

## Scope

Re-sync updates only the stored QuickBooks invoice ID after checking both its
customer reference and invoice number. A missing link or explicitly deleted
invoice runs a customer-scoped number guard that refuses every match without
adopting it. Only a clear, collision-free result permits creation.

No client, invoice-numbering, payment-sync, schema, or production-data changes
are included. The independent creation wrapper and create/update primitives
remain in place.

## Automated proof

- Full requested command `node scripts/run-validation-lane.mjs api-billing`:
  **16 entries passed, 0 failed; exit 0**. Final lane summary:

  ```text
  auth-middleware-coverage | PASS
  company-id-backfill-migration | PASS
  pdf-cover-header | PASS
  qb-invoice-ops | PASS
  invoice-reminders | PASS
  invoice-ar-list | PASS
  invoice-ar-notes | PASS
  invoice-reminders-batch | PASS
  storage-error-propagation | PASS
  invoice-row-expansion-reads | PASS
  pdf-site-metadata | PASS
  seasonal-budget-api | PASS
  seasonal-budget-financial-pulse | PASS
  financial-pulse-manager-access | PASS
  bulk-budget-goals-backend | PASS
  budget-bookkeeper-exclusion | PASS
  LANE api-billing: 16 passed, 0 failed
  ```

- `qb-invoice-ops`: **46 passed, 0 failed** in the existing `api-billing` lane.
- Required recorded-request scenarios all pass:
  1. Stored `500` updates only `500`, without a number query.
  2. Unlinked `60897` for customer `42` creates despite CRM invoice `900`
     having that number under customer `77`.
  3. Corrupt stored `900` refuses with the exact customer-mismatch 409
     outcome; zero POSTs; the in-memory foreign invoice remains unchanged.
  4. Stored `500` with number `60898` refuses with the exact number-mismatch
     409 outcome and zero POSTs.
  5. Unlinked same-customer match `501` refuses with the exact collision
     message and zero POSTs.
  6. Stored-ID GET 400/fault `610` runs the customer guard and then creates.
  7. Stored-ID GET 401 refuses with the exact reconnect message and zero POSTs.
- Reader/query tests cover URL encoding, both query filters, backslash/quote
  escaping in both values, defensive customer filtering, auth, HTTP failures,
  network failures, token defaults, and malformed/wrong-ID GET responses.
- Existing stale-token retry, create/update, and date regressions pass.
- Unchanged correction, editability, and sync-route suites:
  **89 passed, 0 failed** using:

  ```sh
  pnpm --filter @workspace/api-server exec node --import tsx --test --test-concurrency=1 --test-reporter=spec src/routes/invoice-correction-routes.test.ts src/routes/invoice-editability.test.ts src/routes/invoice-sync-quickbooks-route.test.ts
  ```

- `pnpm --filter @workspace/api-server typecheck`: **exit 0**.
- No validation registrations or lane-manifest changes.

## Required grep proof

```text
$ git grep -n "lookupQbInvoiceByDocNumber" artifacts/
[no matches; exit 1]

$ git grep -n "FROM Invoice WHERE DocNumber" artifacts/api-server/src
artifacts/api-server/src/routes/qb-invoice-ops.ts:119:
  const query = encodeURIComponent(`SELECT Id, DocNumber, CustomerRef FROM Invoice WHERE DocNumber = '${escape(docNumber)}' AND CustomerRef = '${escape(qbCustomerId)}'`);
```

## Development acceptance: missing live evidence

Both API and frontend workflows start successfully. The `/invoices` screenshot
shows the real sign-in page, not a signed-in invoice or an error toast:
[`qb-stored-id-login-barrier.jpg`](qb-stored-id-login-barrier.jpg).

The development sync endpoint without an authenticated session returned:

```http
HTTP 401
{"message":"Authentication required"}
```

This is **app authentication**, not the tested QuickBooks reconnect outcome.

A read-only aggregate found one stored QuickBooks integration with a token
present; no credential values were read or printed. That does **not** establish
that the token is usable or that controlled sandbox fixtures are available.
The available screenshot browser cannot sign in or trigger actions, and no
authenticated IrrigoPro/QuickBooks browser session was available.

Consequently, **the live corrupt-link API 409, displayed toast, and QuickBooks
before/after screenshots were not collected**. The automated fixture results
above are not a substitute for that evidence. No app invoice link was
hand-edited, and no QuickBooks invoice was written for live acceptance; there
was therefore no test link to restore.

By source inspection only, the existing non-auth error handler displays
`err.message` in the destructive “QuickBooks sync failed” toast. Its rendered
409 wording and behavior were **not browser-verified**. No client changes were
made to work around this limitation.

To close the live evidence gap, use an authenticated development billing user
and two controlled QuickBooks sandbox customers: record the foreign invoice,
save the app invoice's original link, temporarily point it at the foreign ID,
trigger sync, capture the 409 and toast, compare the foreign invoice's ID,
number, customer, token, and lines before/after, and restore the original app
link in a `finally` step. Do not use production data.

Full validation output is retained under
`generated-artifacts/qb-stored-id/` in the workspace and included in the
downloadable acceptance report. Generated outputs are excluded from Git and
deployment.

## Work commit

The work commit message is:
`Make QuickBooks invoice sync stored-ID-only with ownership and collision refusals`.
The downloadable report records the resulting commit ID. The next numbering
slice is intentionally excluded.
