---
name: Customer record ownership plan
description: Approved planning reference and scope constraints for upcoming customer-record slices.
---

Use `docs/customer-records-plan.md` as the saved reference for the upcoming customer-record slices. The user asked to store the attached 2026-11-03 plan, not to implement it yet.

**Why:** The revised plan explicitly replaces the earlier two-way-sync approach. High Plains CRM is the sole writer of customer billing details to QuickBooks; IrrigoPro reads them and never writes customer details back.

**How to apply:** Read the full plan before scoping or implementing a slice, and verify its code observations against the current checkout. Preserve the eight-slice order, the default-off company ownership lock, editable IrrigoPro-only details, and the existing inline Labor Rates editor. Customer push to QuickBooks, full external API expansion, and customer-list consolidation are outside this plan. Do not enable High Plains' lock through a migration; an admin enables it after the lock slice ships.
