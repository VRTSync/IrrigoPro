---
name: Material markup scope
description: Locked business rules and supplied references for the incremental material pricing addition.
---

The material markup addition uses incremental brackets, not a flat percentage: default rates are 150%, 100%, 65%, 40%, 30%, 20% over cost portions ending at $5, $25, $100, $250, $500 and unbounded. Company schedules and customer contract overrides determine catalog unit prices; Rental, Service and Labor bypass computation, and costless parts retain manual prices. Do not restore document-level flat markup/tax.

**Why:** The user supplied locked pricing decisions on 2026-11-11. Existing documents must not be retroactively repriced; catalog bulk recalculation is a deliberate admin action, not automatic on schedule changes.

**How to apply:** Read the four Tiered Material Markup attachments dated 2026-11-11. The user's current instruction overrides their separate-ticket packaging: one addition, with schema/math, pricing/UI and bulk/category-retirement as three ordered tiers. Do not touch Command Center, site maps, controllers or irrigation zones. Preserve the category markup DB column while retiring its UI.

Schedule edits create retained new versions rather than changing historical versions in place. Existing document lines keep recorded unit prices; newly added catalog lines on those documents use current applicable rates.

**Why:** The user explicitly selected both recommendations on 2026-11-11, resolving conflicting schedule editing and document-update examples in the supplied briefs.

**How to apply:** Enforce existing-line identity and recorded prices server-side. Test an existing document with both retained and newly added lines after a schedule change; unrelated or quantity edits must not silently reprice retained lines.
