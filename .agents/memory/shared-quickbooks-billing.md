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
user explicitly staged stored-ID ownership verification before permanent
numbering and number guards. Never substitute a number search for ownership.

IrrigoPro owns `IR-`; High Plains CRM owns `MA-` and `SN-`. New IrrigoPro numbers
are company-scoped, unpadded, and permanently consumed even on failed pushes.
Corrections retain identity and original transaction dates.

**Why:** A timed-out create might already have succeeded in QuickBooks. Reusing
its number would risk a collision; gaps are expected, not missing work.

**How to apply:** Treat any unlinked IR-number hit anywhere in the QuickBooks
company as refuse-only evidence. Do not adopt the invoice or its returned number.
Deploy the counter, settings preflight, and collision checks together.
