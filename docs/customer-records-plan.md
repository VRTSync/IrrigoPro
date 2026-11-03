# Plan: Customer Records — One Writer, One Modal, and a Lock Setting

**For:** Randy / High Plains CRM chat
**Date:** Nov 3, 2026 (rewritten the same day; this replaces the earlier two-way-sync version of this file)
**Code read:** IrrigoPro `main` @ `c91ea72f`
**Builds on:** "ASSESSMENT - Customer Creation and QuickBooks Sync.md". This plan replaces that file's points 1, 4, 5 and 6 and its slice list.
**Status:** Plan. No code changed. Each slice in section 7 becomes its own spec file.

---

## 1. Decisions locked (Randy, Nov 3)

- **One writer.** Only one system writes a customer's billing details to QuickBooks. For High Plains that system is the **CRM**. IrrigoPro reads those details from QuickBooks and never writes them back. Two-way sync between IrrigoPro and QuickBooks is dropped.
- **QuickBooks is the hub.** The flow is CRM to QuickBooks to IrrigoPro. Customers created directly in QuickBooks still reach IrrigoPro through the pull.
- **A company setting decides who owns customer records.** High Plains turns the lock on. A future company that runs only IrrigoPro leaves it off and manages customers in IrrigoPro.
- **The lock covers only the essential customer details.** IrrigoPro-only details stay editable either way: display name (`irrigoName`), labor rates, budgets, notes and the rest.
- **Visible flag.** A customer made inactive in QuickBooks is hidden in IrrigoPro (`hiddenFromBilling`). See section 5.
- **One customer modal** for both create and edit, used everywhere in the app.

---

## 2. The setting: "Customer records"

This goes on the Company settings page (`/company-profile`, nav label "Company"). It is a new section titled **Customer records**, and only company admins can change it.

| Setting | Column (new, additive on `companies`) | Default |
|---|---|---|
| **Customer details are managed outside IrrigoPro** (on/off) | `customerRecordsLocked boolean not null default false` | Off |
| **Managed in** (free-text name shown to users, e.g. "High Plains CRM") | `customerRecordsSystemName text` | null; shown as "your customer system" |

**Rules:**
- The lock can be turned on only while QuickBooks is connected. With the lock on, QuickBooks is the only way a customer reaches IrrigoPro. If QuickBooks later disconnects, the lock stays on. Company settings and All Customers show a banner saying new customers can't arrive until QuickBooks is reconnected.
- Turning the setting on or off is recorded in the audit log with who changed it and when.
- High Plains is switched on by an admin after slice 3 ships. It is a setting, not a migration.

### What the lock does

| | **Lock ON (High Plains)** | **Lock OFF (IrrigoPro-only companies; today's behavior for everyone)** |
|---|---|---|
| Create a customer in IrrigoPro | Not allowed. The buttons are replaced by "New customers are added in {Managed in}." `POST /api/customers` returns 403 with that message. | Allowed, through the one modal. |
| Edit locked fields (section 3) | Read-only in the modal, with the note "Edit in {Managed in}". There is no link to the other system. The server rejects changes to them with 409 and a plain message. It never silently ignores them. | Editable in the modal. |
| Edit IrrigoPro-only fields | Editable | Editable |
| QuickBooks pull, existing linked customers | **QuickBooks wins** on every locked field. That's safe, because nobody can edit those fields in IrrigoPro. | Does not overwrite. IrrigoPro owns the fields; the pull only links and fills empty fields. |
| QuickBooks pull, new QuickBooks customers | Brought in, after the duplicate guard (section 6). | Brought in, after the duplicate guard. |
| External work-order API (`POST /api/external/work-orders`) | Matches an existing customer by `quickbooksId` (new optional payload field), then by exact email. It never matches on name alone and never creates a customer. No match returns an error. | Unchanged. |

**Lock off with QuickBooks connected.** For a future IrrigoPro-only company, IrrigoPro would be the one writer. Its edits would eventually need to be **pushed** to QuickBooks. That push is a **future slice and not part of this plan**. Until it exists, an unlocked company's IrrigoPro edits stay in IrrigoPro, and QuickBooks keeps its own copy for invoicing. This matches what happens today.

---

## 3. Which fields lock

**Locked fields.** These come from QuickBooks when the lock is on.

| QuickBooks field | IrrigoPro field |
|---|---|
| `DisplayName` | `name` (the official / billing name) |
| `CompanyName` | `companyName` (new) |
| `GivenName`, `FamilyName` | `contactFirstName`, `contactLastName` (new) |
| `PrimaryEmailAddr` | `email` (billing emails; QuickBooks allows several separated by commas) |
| `PrimaryPhone` | `phone` |
| `Mobile` | `mobilePhone` (new) |
| `BillAddr` | `street`, `city`, `state`, `zip`, `country`. The single-line `address` is derived from these parts and is never edited on its own. |
| `ShipAddr` | `serviceStreet`, `serviceCity`, `serviceState`, `serviceZip` (new). Decided: yes. |
| `SalesTermRef` | `paymentTerms`, mapped by term name. A term IrrigoPro doesn't know goes to review instead of being guessed. |

**Stored for the sync's own use, never edited by anyone:** `quickbooksId`, `qbLastUpdatedAt` (new), `qbParentId` (new).

**Always editable (IrrigoPro-only):** display name (`irrigoName`), labor rate, emergency labor rate, discount, contract type and dates, `totalControllers`, `notes`, `propertyNotes`, `billingNotes`, every budget field, `branches`, the property boundary, controllers and zones, and the **Visible** toggle.

**Never pulled from QuickBooks:** QuickBooks `Notes`, tax settings, payment method, `PreferredDeliveryMethod`, customer type, website, fax and balance. IrrigoPro never writes anything to a QuickBooks customer, so it can never cause QuickBooks to email anyone.

All new columns are additive and nullable. Nothing is dropped.

---

## 4. One customer modal

### What exists today (verified)

| Editor | Where | Problem |
|---|---|---|
| `CustomerForm` (`components/customer-form.tsx`) | Mounted 4 times on `/customers` and 4 times on `/admin/customers`. Profile "Edit Customer" navigates to `/customers?edit=:id`. | Same form, but mounted in eight places. |
| Inline "Create New Customer" dialog (`components/ui/customer-selector.tsx` L321+) | The customer picker in the work order, estimate and billing sheet wizards and site maps | **A second, different form.** It writes a one-line address with no parts, and it's the main source of duplicates. |
| Labor Rates page (`pages/labor-rates.tsx`) | Admin nav | **Kept as an inline editor (Randy, Nov 3).** It writes the same `laborRate` and `emergencyLaborRate` columns as the modal, not a copy. Rates are IrrigoPro-only, so the lock never affects this page. |
| Property notes, billing notes | Inline on the customer profile | Fine. They are the only editors of those fields. |
| Visible toggle | `/admin/customers` | Fine. It is the only editor. |

### The change
- **One `CustomerModal`**, built from `CustomerForm`, mounted once in the app shell and opened through one hook: `openCustomerModal({ mode: "create" | "edit", customerId?, onSaved? })`. Every Add, Edit and Create button calls it. No page renders its own copy.
- **The modal has two blocks.**
  - **Customer details** (the locked fields). With the lock on, they are read-only, with a "Managed in {Managed in}" note and "Last updated from QuickBooks {time}".
  - **IrrigoPro details** (everything else). Always editable.
- **The customer picker's inline dialog is deleted.** With the lock off, its "Create New Customer" button opens the shared modal and selects the new customer on save. With the lock on, the button is replaced by the "added in {Managed in}" line. The button shows only for roles allowed to create (company admin), not for everyone as it does today.
- **Profile "Edit Customer" opens the modal in place.** The `/customers?edit=:id` deep link still works and opens the same modal.
- **One server path.** `POST /api/customers`, `PUT /api/customers/:id` and `PATCH /api/customers/:id` enforce the lock. They stop accepting `quickbooksId` and `companyId` from the request body in either mode. Linking happens only through the review screen.
- **CSV customer import is retired.** The route returns 410, and the orphan `customer-csv-upload.tsx` is removed. It is already broken and unreachable.
- **Two customer list pages.** `/customers` and `/admin/customers` overlap. That is out of scope here; both just open the same modal.

---

## 5. Visible flag

The **Visible** toggle on All Customers (`hiddenFromBilling`) already removes a customer from the billing list (Command Center), Financial Pulse, the billing preview, wet-check reconciliation and the irrigation profile pickers.

- **QuickBooks made inactive:** IrrigoPro sets `hiddenFromBilling = true` and records that it did so (`hiddenByQuickBooks = true`, new).
- **QuickBooks made active again:** IrrigoPro un-hides the customer only if IrrigoPro hid it because of QuickBooks. A customer someone hid by hand stays hidden.
- **Hiding in IrrigoPro never changes QuickBooks.** Hidden customers include maintenance and snow customers the CRM still bills.
- This works the same with the lock on or off.
- The hard-coded green "Active" chip on the profile header changes to show **Visible** or **Hidden**.

---

## 6. Review screen, duplicate guard, sub-customers

- **One review screen.** It is reached from Admin, then QuickBooks, then **Customer review**, and it lists:
  - **Unlinked IrrigoPro customers.** Link each one by hand to a ranked QuickBooks candidate (name, then billing street and zip), or mark it "Not in QuickBooks". Nothing links automatically.
  - **Names held by the duplicate guard.**
  - **Sub-customers held for review.**
  - **Payment terms IrrigoPro couldn't map.**

  With the lock on, an unlinked customer's locked fields stay read-only. It is fixed by linking it, not by editing it.
- **Duplicate guard.** Before the pull creates a customer, it checks for an unlinked customer in the same company with a matching normalized name. If it finds one, it holds the QuickBooks customer for review instead of creating it. The pull result reports `heldForReview`.
- **Sub-customers.** If a QuickBooks customer has a parent (`ParentRef`), it is held for review with the parent recorded (`qbParentId`), instead of arriving as a loose top-level customer. Full per-branch billing waits until a real customer is set up that way. PNC (one QuickBooks customer, branches as IrrigoPro labels) is unchanged.

---

## 7. Slices, in build order

Each slice leaves the app coherent.

| # | Slice | What it does |
|---|---|---|
| 1 | **Tenant-safe QuickBooks lookups** | Scope `getCustomerByQuickBooksId` by company. Remove the company-1 fallback. Add a unique partial index on `(company_id, quickbooks_id)` once the duplicate check query comes back clean. |
| 2 | **One customer modal** | Section 4, with no lock yet: the shared modal and hook, the picker's dialog deleted, the profile edit in place, the server stops accepting `quickbooksId`/`companyId`, and CSV import retired. The Labor Rates page is untouched. |
| 3 | **Customer records lock** | Section 2: the setting and its columns, the Company page section, server enforcement on `POST`/`PUT`/`PATCH` and the external API, the read-only Customer details block and the "added in" lines, and the audit entry. |
| 4 | **Field map** | Section 3: the new columns, the pull filling every locked field, QuickBooks winning when locked and not overwriting when unlocked, and payment-term mapping. |
| 5 | **Review screen and guards** | Section 6. |
| 6 | **Scheduled pull** | QuickBooks change feed (CDC) every 15 minutes per connected company. It follows the QuickBooks health job pattern (`qb-token-utils.ts` ~L385), holds an advisory lock, shows run status on the QuickBooks card, and keeps "Sync now". Ships after 5, so the guards are in place first. |
| 7 | **Visible flag from QuickBooks** | Section 5. |
| 8 | **Duplicate pairs** | A registry migration resolving hand-made plus sync-made pairs. Sized once the counts are known. |

The earlier version of this file had three-way compare, a push to QuickBooks and conflict review. All three are removed.

---

## Decisions (all answered Nov 3)

- **Ship-to address** maps to the IrrigoPro service address. The CRM and contract work will keep it accurate.
- **Labor Rates page** stays an inline editor.
- **External work-order API.** Nothing calls it today. Randy plans to build it out later for the CRM and for Aspire's API to use. Until then, this plan only stops it creating customers while the lock is on. The fuller external API is its own future project.
- **Scheduled pull.** IrrigoPro checks QuickBooks on its own every 15 minutes for new or changed customers, so a customer the CRM sends to QuickBooks shows up without anyone clicking. **Sync now** stays, and it can be run as often as wanted.
- **Edit link to the CRM** is dropped as unnecessary. IrrigoPro just says "Edit in {Managed in}".

## Still needed: counts
Run the two queries in the assessment file (unlinked customers per company, duplicate QuickBooks IDs), or sign in to IrrigoPro in the browser pane and I'll pull them read-only.