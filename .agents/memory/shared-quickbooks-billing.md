---
name: Shared QuickBooks billing ownership
description: Product constraint behind stored-ID sync and the separately staged numbering changes.
---

IrrigoPro and High Plains CRM create invoices in the same QuickBooks company.
Treat invoices created outside IrrigoPro as externally owned, even when their
numbers match.

**Why:** The user identified cross-app invoice overwrites as the risk requiring
stored-ID verification and refuse-only collision checks. Number coincidence is
not evidence of ownership.

**How to apply:** Keep ownership safety independent of numbering changes. The
user explicitly staged `IR-` numbering and removal of returned-number adoption
as a separate follow-on change; do not fold those changes into ownership fixes.
