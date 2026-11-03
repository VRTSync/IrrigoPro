---
name: Customer record ownership plan
description: Customer-record design decisions, slice boundaries, and safe lock rollout prerequisites.
---

Use `docs/customer-records-plan.md` as the saved design-context overview from 2026-11-03. Individual slice specifications govern their own implementation; the overview is not a substitute for them. Uploading or saving a plan is not authorization to implement it.

**Why:** Customer records use a one-writer model: High Plains CRM → QuickBooks → IrrigoPro. The revised overview splits the work into independent slices with explicit dependencies, avoiding one combined implementation.

**How to apply:** Read the current overview and the relevant slice specification before future work. Keep slices separate. Preserve the inline Labor Rates editor and editable IrrigoPro-only fields. Never automatically link possible duplicates or sub-customers; hold them for review. These slices must not delete or merge customers, drop columns, or push customer edits to QuickBooks.

Enable High Plains' ownership lock only through an admin after the field-map slice is merged, the assessment count queries have run, and customer review has linked every customer IrrigoPro invoices.

**Why:** Enabling earlier would leave new QuickBooks-owned fields blank and read-only. This replaces the earlier instruction to enable after the lock slice alone.

**How to apply:** Treat field-map completion and customer-link review as prerequisites, not automatic permission to enable the lock. Scheduled pulling follows later; manual sync remains available.
