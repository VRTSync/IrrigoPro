# Customer Records Slice 2a — development acceptance

Verified 2026-11-03 on the task checkout. No production changes or publishing.

## Scope

- One authenticated-context-only customer tenant guard on all 12 specified
  single-customer registrations, with the specified role-middleware order.
- Authenticated company owns customer creation; customer writes strip
  client-supplied server-owned identifiers.
- Duplicate detail registration and legacy property-boundary helper removed.
- Customer CSV import responds with the specified 410 message; only its orphan
  uploader was deleted from the web app.
- No changes to the company-scoped QuickBooks lookup, customer list, site-map
  routes, irrigation-profile CSV import, or later customer-record slices.

## Automated evidence

The `customer-tenant-guard` entry is in the existing serial `api-billing` lane.
Its 46 checks cover the full ten-case behavior matrix, all 12 registration
chains, schema stripping, one shared guard instance, retired import, missing
authentication and storage failure. The actual four inline related-data read
handlers are also executed against in-memory storage for ordinary, exponent,
hexadecimal and decimal-form IDs. Every downstream query must use the
guard-attached customer's ID, not re-parse the path with a different conversion.

The same 46 checks also passed with `DATABASE_URL` removed from the test process:

```sh
env -u DATABASE_URL pnpm --filter @workspace/api-server exec node \
  --import tsx --experimental-test-module-mocks --test --test-reporter=spec \
  src/routes/customer-tenant-guard.test.ts
```

This suite mocks storage and runtime service imports before importing the
exported route schemas, preventing import-time storage initialization.

Full validation commands:

```sh
node scripts/run-validation-lane.mjs api-billing
node scripts/run-validation-lane.mjs types
```

Both lanes completed successfully:

```text
LANE api-billing: 20 passed, 0 failed
LANE types: 4 passed, 0 failed
```

The billing lane includes `customer-tenant-guard` (46/46 checks) and
`auth-middleware-coverage` (27/27 checks, including Part 8). The existing
`auth-middleware-coverage.test.ts` was not edited.

The exact retirement grep returned no matches (exit status 1):

```sh
git grep -n "loadCustomerWithTenantCheck\|customer-csv-upload\|Access denied for this customer" artifacts/
```

`git diff --check` passed. No new workflow was added.

## Authenticated development checks

A temporary verified `company_admin` account signed in through the real browser
login form. Its server-issued session cookie was used for API checks and the
explicit curl probe. No unsigned identity headers were used as credentials.

**Environment difference:** Development has no company 1. These checks used
existing company **3** and a customer belonging to another development company.
No new company was necessary. The literal company-1 acceptance check was
unavailable; the equivalent tenant isolation and ownership checks passed.

Only temporary customer fixtures were modified. Temporary customers, login
accounts and their sessions were removed after verification.

| Check | Actual result |
|---|---|
| Real browser login | 200; company_admin, company 3 |
| Customer detail API / profile opened in browser | GET 200 |
| Customer billing | GET 200 |
| Customer estimates | GET 200 |
| Customer work orders | GET 200 |
| Customer billing sheets | GET 200 |
| Property boundary load | GET 200 |
| Exponent-form customer ID on billing, estimates, work orders and billing sheets | GET 200; only authorized customer's data |
| Profile → Edit Customer → Update Customer | PUT 200 |
| Labor Rates inline edit → save | PATCH 200 |
| Profile → Property → upload temporary KML → Save Boundary | PUT 200 |
| Customers → Add Customer → Create Customer | POST 201; response companyId 3 |
| POST with forged companyId 99 and quickbooksId | 201; companyId 3, quickbooksId null |
| PATCH with forged companyId and quickbooksId plus editable phone | 200; identifiers unchanged, phone saved |
| Authenticated GET of foreign customer | 404; `Customer not found` |
| Explicit curl GET of foreign customer with real session cookie | 404; `{"message":"Customer not found"}` |
| POST customer CSV import | 410; exact retirement message |
| Delete temporary primary customer | 200 |

Customer-import response:

```json
{"message":"Customer CSV import was retired. Customers come from QuickBooks or the customer form."}
```

The unauthenticated screenshot check showed the login page rendering normally.
Signed-in verification was performed separately by browser automation; it is
not inferred from that screenshot.

Local command output and sanitized request/status evidence are retained under
the ignored `generated-artifacts/customer-routes/` directory. They contain no
passwords, cookies, tokens or database connection strings.
