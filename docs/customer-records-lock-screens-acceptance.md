# Customer Records Lock screens — development acceptance

Date: 2026-11-03

## Scope and prerequisites

Verified the merged single-modal selector, customer-records server routes, shared
owned-field constant, and shared label helper in this checkout before building.
This change is web-only. No server rules, routes, schemas, migrations, QuickBooks
sync, site-map files, mobile screens, or later slices were changed.

## Validation

```sh
node scripts/run-validation-lane.mjs web
node scripts/run-validation-lane.mjs types
git grep -n "|| 3" artifacts/irrigopro/src/components/customer-form.tsx
```

Final results:

```text
LANE web: 24 passed, 0 failed
LANE types: 4 passed, 0 failed
Fallback grep: no matches (expected exit 1)
```

The new `customer-form-locked` suite has four real-form cases, the new
`customer-records-card` suite has five cases, and the extended selector suite
has 16 cases. Locked edits also retain their loaded owned-field values when
the form reopens, without sending those fields to the server.

Two earlier web runs exposed an existing budget-preview test setup problem:
cold-importing the large customer form inside the first timed case could use
its entire timeout and leave a late render in the next case. The existing real
form import now occurs during collection. Assertions, timeout limits, and lane
commands are unchanged. The final web run includes that correction; the
frontend typecheck also passed afterward. Test files are excluded from the
artifact's production typecheck, so this test-only import move does not
invalidate the completed types lane.

Raw logs, browser JSON, screenshots, and the self-contained `acceptance.html`
report are under `generated-artifacts/customer-records/`, ignored by Git and
deployment. The downloadable report embeds complete lane outputs and images.

## Development browser evidence

Used an isolated development company, one QuickBooks-linked fixture customer,
and fresh admin and irrigation-manager login sessions. Connected-state
acceptance used a synthetic integration-status fixture, not a live QuickBooks
OAuth connection or real credentials. Existing company settings and production
were not changed.

| Scenario | Screenshot |
| --- | --- |
| Unlocked Customers | `unlocked-customers.jpg` |
| Unlocked All Customers, linked deletion available | `unlocked-all-customers.jpg` |
| Unlocked customer modal | `unlocked-customer-modal.jpg` |
| Unlocked work-order customer picker | `unlocked-work-order-picker.jpg` |
| Lock enabled through the new Company card | `locked-company-card.jpg` |
| Locked Customers header, linked deletion absent | `locked-customers-linked-delete-absent.jpg` |
| Locked All Customers header, linked deletion absent | `locked-all-customers-linked-delete-absent.jpg` |
| Locked modal, blue note and disabled owned inputs | `locked-customer-modal.jpg` |
| Successful locked rate save and success toast | `locked-rate-save-success.jpg` |
| Locked work-order picker without Create New Customer | `locked-work-order-picker.jpg` |
| Disconnected enabling disabled, exact explanation | `disconnected-enabling-disabled.jpg` |
| Locked disconnected Company warning | `locked-disconnected-company.jpg` |
| Locked disconnected All Customers warning | `locked-disconnected-all-customers.jpg` |

The real form's rate edit returned HTTP 200 with `laborRate: "52.00"` and none
of `QB_OWNED_CUSTOMER_FIELDS`, including `address`, in the request. An independent
database read confirmed the persisted rate was `52.00`.

The isolated company's setting was restored through the card while disconnected.
A separate read confirmed `locked: false, systemName: null`. Its company,
customer, users, synthetic integration, and related audit fixtures were removed
afterward. The real High Plains lock was not enabled.

## Explicit evidence limitation

A fresh irrigation-manager login reaches the existing 404 page at
`/company-profile`: that role's web router does not mount Company Profile,
although the profile API permits reading it. A manager's rendered read-only
card was therefore **not verified in the running application**. The actual
card's component suite proves disabled switch/input controls and no Save button.
The route limitation is captured in `manager-company-route-unavailable.jpg` and
proposed separately, not repaired inside this slice.

That manager session also received existing background 403s from
`/api/parts/pending-approval` and `/api/manual-part-reviews`. No feature endpoint
returned 403 in the admin scenarios, and unrelated permissions were not widened.
