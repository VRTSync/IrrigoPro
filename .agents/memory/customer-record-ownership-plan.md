---
name: Customer record ownership plan
description: Overview of the Customer Records slices; the slice ticket in hand is always authoritative.
---

`docs/customer-records-plan.md` is the overview (order, dependencies, locked decisions) for the Customer Records family: Slices 1, 2a, 2b, 3a, 3b, 3c, 4, 5a, 5b, 6, 7, plus 8 when written. Randy authorizes each slice by sending its ticket.

**Why:** High Plains CRM is the only writer of customer billing details to QuickBooks. IrrigoPro reads them and never writes customers to QuickBooks.

**How to apply:** The slice ticket being built is the contract. Where it is more specific than the overview, follow the ticket. Never pull work from a later slice into the current one. High Plains' lock is turned on by an admin after Slice 4 ships, never by a migration.
