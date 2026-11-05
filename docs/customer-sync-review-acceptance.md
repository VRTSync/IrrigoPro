# Customer sync review server acceptance

Development verification date: 2026-11-04.

## Scope

Server-only customer review guards and resolution API. No review UI, scheduling,
inactive-customer changes, parent-child model, customer writes to QuickBooks,
production schema/data changes, or publishing.

The new migration is `lib/db/migrations/0028_customer_sync_review.sql`.
It was applied twice against the development database through the real-database
fixture setup, following the existing invoice-allocation suite pattern.
`pnpm --filter @workspace/db verify` confirmed all 66 schema tables match development.

## API contract

All routes require authentication and the existing QuickBooks capability guard.
Company scope comes exclusively from the authenticated company.

- `GET /api/customer-review`: `{ held, unlinked, qbError? }`.
  Each held row includes `candidateCustomer` (null or `{ id, name, irrigoName, address }`).
  Each unlinked entry is `{ customer, candidates }`; each candidate is
  `{ qbId, name, address, score }`. Remote failures preserve the local lists.
- `GET /api/customer-review/summary`: `{ held: number, unlinked: number }`,
  using scoped database counts without QuickBooks.
- `POST /api/customer-review/link`: `{ customerId, qbCustomerId }`; returns the
  customer. Changes only the QB link; the next normal sync refreshes details.
- `POST /api/customer-review/:id/create`: empty body; returns the created
  customer. Its review becomes `created` in the same transaction.
- `POST /api/customer-review/:id/dismiss`: empty body; returns the dismissed review.
- `POST /api/customer-review/not-in-quickbooks`: `{ customerId, value }`;
  returns the customer with the server-owned exclusion timestamp set or cleared.

Foreign customers/reviews return 404 before their state is disclosed. Link,
create and dismiss serialize on the tenant/QB identity; customer row locks and
the existing unique QB-link index prevent competing links. Audits transact
with mutations. The ordinary customer CRUD schemas strip the exclusion flag,
so it cannot bypass the audited review endpoint.
Candidate customer references use `ON DELETE SET NULL`: deleting a local
candidate preserves its open or historical review without blocking existing
customer deletion. The route regression test deletes candidates through the
ordinary customer DELETE endpoint, checks the retained review/list response,
and successfully creates from the still-open review afterward.

## Retained evidence

Validation results:

- `node scripts/run-validation-lane.mjs api-billing`: **25 passed, 0 failed**.
- `node scripts/run-validation-lane.mjs types`: **4 passed, 0 failed**.
  Shared-library compilation and the API typecheck also passed again after
  the candidate-deletion regression fix.
- Scoped sync/read tests: **25 passed**. Latest real-database review tests:
  **17 passed**, including candidate deletion and subsequent review resolution.
  The updated ordinary-customer schema/tenant tests also passed **46/46** with
  their required module-mocking flag. The initial combined invocation issue is
  recorded below.
- Development schema verification: **66 tables verified**.

The complete billing lane began before the final scoped refinements and
candidate-deletion fix; those changes were subsequently checked by the scoped
tests above. The other billing suites were unchanged.

Raw outputs and generated evidence are retained outside Git in:

```
generated-artifacts/customer-review/
  api-billing.txt
  types.txt
  types-final.txt
  schema-verify.txt
  targeted-final.txt
  customer-schema-final.txt
  route-suite-after-delete-fix.txt
  customer-review-injected-evidence.json
  unauthenticated-summary.json
  api-health.jpg
```

The route suite covers all ten ticket cases with two isolated development
companies, plus validation, capability enforcement, storage scoping/order,
audit attribution, exclusion eligibility and competing-resolution cases.
Fixture companies, customers, reviews, users and audit rows are deleted after
the suite. A separate post-suite query confirmed zero `review-test-%` companies.
After the deletion fix, the development FK definition was queried directly and
confirmed as `FOREIGN KEY (candidate_customer_id) REFERENCES customers(id) ON DELETE SET NULL`.
The idempotent migration upgrades an already-created restrictive FK as well as
creating the correct FK on a fresh database.

The generated JSON captures a duplicate hold with no new customer, an actual
HTTP link response from the registered route module, the next sync updating
that same local ID with zero held rows, and a sub-customer held without creation.
These use **injected QuickBooks reads with the real development database**.
They are not live QuickBooks sandbox acceptance.

One initial combined targeted command omitted Node's
`--experimental-test-module-mocks` flag for the existing tenant-guard suite;
that file could not load. Its correctly configured command subsequently passed.
This is recorded rather than represented as an application failure or hidden.

## Live sandbox acceptance unavailable

A development-only metadata query returned:

```
token_environment | connection_status   | count
sandbox           | reconnect_required  | 1
```

There is no connected sandbox integration available for the requested live
“Test Duplicate LLC” / “Test Duplicate” creation, curl link, next remote sync
and live sub-customer scenario. No sandbox customer fixture was created and no
integration settings were changed. A human must reconnect the development
sandbox before those live scenarios can be run. Injected evidence does not
fulfill or claim those live checks.

The rebuilt API started successfully, `/api/health` returned `{ "ok": true }`
through the preview proxy, and an unauthenticated request to the new summary
endpoint returned HTTP 401 with `Authentication required`.
