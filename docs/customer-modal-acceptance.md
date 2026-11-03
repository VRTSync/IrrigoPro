# Customer Records — Shared modal acceptance

Verified on the development preview on 2026-11-03. No production changes or publishing.

## Prerequisites and reference restoration

- Slice 2a is present in the executor checkout: create derives ownership from the authenticated company; create/update schemas exclude browser-owned QuickBooks identifiers; single-customer routes use the tenant guard.
- Before implementing the modal, the saved design overview was compared byte-for-byte with the supplied Design Context attachment. It was already identical, so no artificial overview diff was introduced.
- The ownership memory note was replaced with the amendment's exact fenced Markdown, including frontmatter, and its existing index description was aligned.
- The overview's first line matches the required heading. Both obsolete-reference searches have no matches.

## Delivered behavior

- CustomerForm remains a locally mounted component, not a global modal provider. Existing Customers and All Customers mounts remain.
- The selector delegates creation to the full CustomerForm, offers creation only to authenticated company admins unless opted out, and uses the saved server response to select the customer, close the picker, and clear search.
- Profile Edit Customer opens the form in place under the existing admin gate. Set a budget opens the same form at Budget & Alerts. Every BudgetCard caller supplies the customer object.
- Successful saves retain reset, toast and list/budget invalidation behavior and call onSaved after closing. Customer-detail invalidation also refreshes the profile's separately keyed row after an in-place save.
- The orphaned list-page query-string editor and the selector's duplicate creator are removed.

## Automated validation

Commands:

```sh
node scripts/run-validation-lane.mjs web
node scripts/run-validation-lane.mjs types
```

The new `customer-selector-one-modal` entry is in the existing serial web lane; no workflow was added.

The selector suite covers the real full-form admin opening, billing-manager exclusion, caller opt-out, anonymous and super-admin exclusion, isolated stub save-selection wiring (exactly one callback, picker close and search reset), real POST/PUT response callbacks, cache invalidation, section scrolling/cancellation, and static single-writer/profile guards.

The updated BudgetBar fixtures and existing budget-preview tests run in the web lane. Full command output is attached in the self-contained acceptance report and retained locally under `generated-artifacts/customer-modal/`.

Source checks also verify:

- No retired duplicate-creator or redirect markers in web source.
- No obsolete edit links anywhere under artifacts.
- No literal customer-create writer elsewhere in non-test web source.
- All four BudgetCard mounts pass customer objects.
- No whitespace errors from `git diff --check`.

## Authenticated browser evidence

Real UI logins were performed in separate fresh browser contexts for company_admin and billing_manager, using synthetic verified-email users in an isolated development-only company. No existing account, company or customer was modified.

1. **Company admin wizard creation — PASS.** Work Orders → New Work Order → customer picker → Create New Customer opened Add New Customer. Screenshots show structured street/city/state/ZIP fields, rates, and Budget & Alerts. One real POST returned 201 with customer 2426 in the authenticated fixture company (1056). The wizard automatically selected that returned customer and closed both customer dialogs. The isolated unit test additionally proves exactly one selection callback and cleared search.
2. **Billing manager picker — PASS.** A separate authenticated login opened the same wizard picker, showed the existing customer, and offered no creation button.
3. **Profile edit in place — PASS.** Edit Customer opened the shared form with the customer's values while the URL remained `/customers/2426/profile`.
4. **No-budget profile — PASS.** Billing Details → Set a budget opened the same modal at Budget & Alerts while remaining on the profile. Measured card top and modal top were both 25px, with modal scrollTop 1682px.

Screenshots:

- `admin-full-form-address.png`
- `admin-full-form-rates.png`
- `admin-full-form-budget.png`
- `admin-wizard-selected.png`
- `billing-manager-no-create.png`
- `profile-edit-in-place.png`
- `profile-budget-focus.png`

All are embedded in the acceptance report; the machine-readable POST/selection/URL evidence is in `browser-report.json` beside them.

## Observations outside this slice

- There were no browser page errors and no blocked acceptance scenarios in the final run.
- The billing-manager shell made two background 403 requests to its company-profile endpoint, unrelated to picker creation. That existing role/request mismatch was recorded separately rather than widening permissions.
- The existing display-name auto-fill retained only the first typed character. Official name, address, rates and selection saved successfully; the auto-fill issue was recorded separately rather than changing unrelated form behavior.
- The initial browser fixture had no company onboarding details and was correctly sent to onboarding. A properly configured isolated fixture was then used for the successful run.
- Browser automation used the existing Puppeteer dependency because the specialized browser tester was unavailable in this executor.

## Scope boundary

No site-map files, All Customers, Labor Rates editor, notes editors, Visible controls, client company-default logic, API/schema files, migrations or QuickBooks writes were changed. Locking and all later Customer Records slices remain out of scope.
