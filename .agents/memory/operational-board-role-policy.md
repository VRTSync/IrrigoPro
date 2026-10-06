---
name: Operational board role policy
description: Approved separation between dispatch oversight, financial budget access, and read-only location audits.
---

Action Board is for irrigation managers and company admins (with super-admin access), not billing managers. Billing managers retain Budget Status and Financial Pulse. Bookkeepers retain Missing Location Data as a read-only billing audit, without broad ticket editing.

**Why:** These are separate responsibilities: financial oversight does not confer dispatch authority, and reading a billing audit does not confer ticket-management access. This is the approved product policy, not a snapshot-cleanup convenience.

**How to apply:** Preserve the separation across menus, direct page routes, and API capabilities. Keep restricted report deep links tenant-scoped, exact-record-limited, and read-only.
