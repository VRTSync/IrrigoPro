# Customer Records server lock acceptance

## Scope and safety

- Server-only Customer Records Slice 3a: shared ownership contract, company columns and migration 0026, settings endpoints, customer create/edit/delete enforcement, and bounded tests.
- No screens, mobile changes, external work-order changes, QuickBooks sync changes, production changes, or real-company opt-ins.
- Migration 0026 is run twice before the integration suite's fixtures. New companies are asserted to default to unlocked with a null system name.
- Development evidence uses disposable companies, customers, an admin, and a synthetic QuickBooks integration. The connected prerequisite is exercised through the existing company-scoped lookup with `connectionStatus: "connected"`.
- This does **not** prove a live OAuth connection or call QuickBooks. The contract defines connectivity using the integration row's status. No real connection or company setting was changed.
- All fixture locks are restored off and fixture customers, integrations, audit rows, users, companies, and temporary bearer-token rows are deleted. The HTTP evidence contains no bearer token.

## Reproducible checks

```sh
pnpm run typecheck:libs
node scripts/run-validation-lane.mjs api-billing
node scripts/run-validation-lane.mjs types
git grep -n "\"name\", \"email\", \"phone\", \"address\"" artifacts/ lib/
```

The two new suites run serially as `customer-records-shared` and `customer-records-lock` in the existing `api-billing` lane. No workflow is added.

The integration suite mounts the real customer and settings handlers with stub authentication, real storage, and the real tenant guard. It covers all 14 ticket cases, strict settings validation, no-op auditing, normalized names, disconnected name-only/unlock changes, exact connected status, null-company GET, missing-company reads, cross-company customer writes, and customer-company enforcement for super-admin context.

The existing database-free tenant suite mocks the new lock reader so importing the real customer schemas does not load database runtime dependencies.

## Development network evidence

Captured through `curl` against the running application at the shared development proxy, authenticated using a short-lived disposable fixture token:

| Operation | Result |
| --- | --- |
| GET own settings before integration setup | 200, unlocked / null / disconnected |
| Unlocked create | 201 |
| Unlocked name edit | 200 |
| Unlocked delete | 200; database absence asserted |
| Lock with connected integration status | 200, locked / High Plains CRM / connected |
| Create while locked | 403, `CUSTOMER_RECORDS_LOCKED`, `New customers are added in High Plains CRM.` |
| PUT labor rate while locked | 200 |
| PUT changed email while locked | 409, `lockedFields: ["email"]`, `email is managed in High Plains CRM. Edit it there.` |
| Dedicated PATCH labor rates while locked | 200 |
| Unlock afterward | 200; database unlocked state asserted |
| Scoped audit query for fixture company | Exactly two events: locked and unlocked, including actor/company/target and `{ from, to }` |

The complete request/response and scoped audit query output is in the attached network evidence, with cleanup confirmation.

The application server was restarted successfully and its listening log checked. The unauthenticated web preview renders the sign-in screen. Signed-in UI was not verified; this slice adds no UI.

## Evidence files

Final results:

- `api-billing`: **22 passed, 0 failed**, exit 0.
- `types`: **4 passed, 0 failed**, exit 0.
- Focused real-database lock suite after the final test typing adjustments: **21 passed, 0 failed**.
- Shared helper suite: **4 passed, 0 failed**.
- Exact grep output (one result):

```text
lib/shared/src/customer-records.ts:5:  "name", "email", "phone", "address", "street", "city", "state", "zip", "country",
```

Generated outputs are excluded from Git and deployment under `generated-artifacts/customer-records/`:

- `api-billing.log`: complete billing-lane output.
- `types.log`: complete types-lane output.
- `network.log`: development `curl` requests/responses and scoped audit query output.
- `constant-grep.log`: exact single-list grep output.
- `libs.log`: shared library declaration/type build.

Final lane results and the exact grep output are attached with the task delivery.
