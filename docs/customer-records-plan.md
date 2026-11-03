# PLAN — Customer Records: Design Context (Locked Decisions)

This is the overview for the Customer Records family: who owns a customer's details, one customer modal, the lock setting, and keeping IrrigoPro in step with QuickBooks. **There are eleven tickets, one file each. Do not merge them into one task.** Each slice file carries its own decisions, so Replit never needs this file.

**Background:**
- "ASSESSMENT - Customer Creation and QuickBooks Sync.md" (Nov 3) holds the code findings and the unlinked-customer count queries.
- "NOTE TO CRM - Customer Records Rules.md" is the CRM's side.

## Why

High Plains keeps customers in three places: QuickBooks, IrrigoPro and High Plains CRM. Customers were typed in more than once and drifted apart. The code audit (`main` @ `c91ea72f`) found:

1. **Four ways a customer gets created in IrrigoPro.**
   - The customer form.
   - A second, cut-down form inside the customer picker.
   - A broken CSV import.
   - The external work-order API, which creates customers by name.
2. **The QuickBooks customer lookup ignored the company.** A second company's customers with the same QuickBooks id would never import.
3. **Single-customer routes didn't check the company.** That covers get, edit, delete and rates. Create also trusted the browser's `companyId`.
4. **The sync overwrote local edits** whenever QuickBooks had a value, and it created a duplicate for any hand-made customer later added in QuickBooks.
5. **No concept of a customer going inactive in QuickBooks.**
6. **QuickBooks sub-customers would arrive as unrelated customers.**

## Locked decisions (Randy, Nov 3)

- **One writer.** Only one system writes a customer's billing details to QuickBooks. For High Plains that is the CRM. IrrigoPro reads them from QuickBooks and never writes customers to QuickBooks. QuickBooks is the hub: CRM → QuickBooks → IrrigoPro.
- **Lock setting** ("Customer details are managed outside IrrigoPro", Company page):
  - **On (High Plains):** no customer creation in IrrigoPro, and the QuickBooks-owned fields are read-only, with QuickBooks winning on every sync.
  - **Off (future IrrigoPro-only companies):** IrrigoPro owns the details, and the sync only fills empty fields.
  - It can only be turned on while QuickBooks is connected.
- **QuickBooks-owned fields:** name, company name, billing contact, email, phone, mobile, billing address, service address (QuickBooks ship-to) and payment terms.
- **Always editable (IrrigoPro-only):** display name, rates, discount, contract, controllers, notes, property and billing notes, budgets, branches, boundary and the Visible toggle.
- **One customer modal** for create and edit everywhere. The Labor Rates page stays an inline rate editor (Randy).
- **Never link automatically.** Possible duplicates and sub-customers are held for a person on the Customer review page.
- **QuickBooks inactive → Hidden** (the Visible toggle), and back to Visible when reactivated, only if QuickBooks hid it. Hiding in IrrigoPro never touches QuickBooks.
- **Automatic pull every 15 minutes.** Sync now can be run any time.
- **External work-order API:** nothing calls it today. With the lock on, it matches by QuickBooks id or exact email and never creates a customer. It will be built out later for the CRM and Aspire.
- **No edit link to the CRM.** The modal says "Edit them in {name}" as plain text.
- **No destructive changes.** No customer is deleted or merged by these slices, and no column is dropped.

## Order

| # | File | Depends on |
|---|---|---|
| 1 | `FIX - Customer Records Slice 1 - QuickBooks Customer Lookups Stay Inside the Company.md` | — (ship first; it starts with a duplicate check that stops the build if duplicates exist) |
| 2a | `FIX - Customer Records Slice 2a - Customer Routes Check the Company.md` | 1 |
| 2b | `BUILD - Customer Records Slice 2b - One Customer Modal.md` | 2a |
| 3a | `BUILD - Customer Records Slice 3a - Customer Records Lock (Server).md` | 1, 2a |
| 3b | `BUILD - Customer Records Slice 3b - Customer Records Lock (Screens).md` | 2b, 3a |
| 3c | `BUILD - Customer Records Slice 3c - External Work-Order API Matches Customers, Never Creates While Locked.md` | 1, 3a |
| 4 | `BUILD - Customer Records Slice 4 - QuickBooks Field Map.md` | 1, 3a, 3b |
| 5a | `BUILD - Customer Records Slice 5a - Sync Holds Duplicates and Sub-Customers for Review (Server).md` | 4 |
| 5b | `BUILD - Customer Records Slice 5b - Customer Review Page.md` | 5a |
| 6 | `BUILD - Customer Records Slice 6 - Scheduled QuickBooks Customer Pull.md` | 4, 5a |
| 7 | `BUILD - Customer Records Slice 7 - QuickBooks Inactive Hides the Customer.md` | 6 |
| 8 | Duplicate pairs (hand-made + sync-made) — registry migration | not written; sized once the counts are in |

Migrations are numbered in build order: 0025 (Slice 1), 0026 (3a), 0027 (4), 0028 (5a), 0029 (6), 0030 (7). If slices merge out of order, renumber so the numbers stay unique and increasing.

## When to turn the lock on for High Plains

After **Slice 4** is merged, an admin turns it on (Company → Customer records, Managed in "High Plains CRM"). Before Slice 4, the new fields aren't fed from QuickBooks, so they would sit read-only and blank. Slice 6 then makes new CRM customers arrive automatically.

Before turning it on, run the assessment's count queries and work through Slice 5b's Customer review, so every customer IrrigoPro invoices is linked to QuickBooks.

## Outside these slices

- **The CRM side** (see the CRM note): the only writer, handling direct QuickBooks edits without overwriting, and a way to send a customer to QuickBooks right away.
- **Full sub-customer support** (per-branch billing): only when a real customer needs it.
- **Pushing customer edits from IrrigoPro to QuickBooks** for IrrigoPro-only companies: a future slice.
- **The duplicate `/customers` vs `/admin/customers` list pages**: under the no-duplicate-pages rule, not addressed here.