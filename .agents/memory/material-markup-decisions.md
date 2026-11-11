---
name: Material markup scope
description: Locked business rules and supplied references for the incremental material pricing addition.
---

The material markup addition uses incremental brackets, not a flat percentage: default rates are 150%, 100%, 65%, 40%, 30%, 20% over cost portions ending at $5, $25, $100, $250, $500 and unbounded. Company schedules and customer contract overrides determine catalog unit prices; Rental, Service and Labor bypass computation, and costless parts retain manual prices. Do not restore document-level flat markup/tax.

**Why:** The user supplied locked pricing decisions on 2026-11-11. Existing documents must not be retroactively repriced; catalog bulk recalculation is a deliberate admin action, not automatic on schedule changes.

**How to apply:** Read the four Tiered Material Markup attachments dated 2026-11-11. The user's current instruction overrides their separate-ticket packaging: one addition, with schema/math, pricing/UI and bulk/category-retirement as three ordered tiers. Do not touch Command Center, site maps, controllers or irrigation zones. Preserve the category markup DB column while retiring its UI.
