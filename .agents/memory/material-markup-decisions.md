---
name: Material markup scope
description: Locked business rules for flat-tier material pricing, exclusions, frozen documents and staged rollout.
---

The material markup addition uses flat tiers, not incremental brackets: one rate applies to the entire cost, with the schedule minimum dollar markup and the immediately previous tier's ceiling price as floors. The previous ceiling includes its minimum but is not recursively floored against all earlier tiers. Company schedules and customer contract overrides determine catalog unit prices; Rental, Service and Labor bypass computation, and costless parts retain manual prices. Do not restore document-level flat markup/tax.

**Why:** The user explicitly replaced the original incremental model with the flat-tier specification on 2026-11-16. Existing documents must not be retroactively repriced; catalog bulk recalculation is a deliberate admin action, not automatic on schedule changes.

**How to apply:** The Flat-Tier Model attachment dated 2026-11-16 supersedes the original attachments' math, reference cases and tier application; their structural contracts still apply. Deliver schema/math, pricing/UI and bulk/category-retirement as three ordered slices in one implementation. Do not touch Command Center, site maps, controllers or irrigation zones. Preserve the category markup DB column while retiring its UI.

Schedule edits create retained new versions rather than changing historical versions in place. Existing document lines keep recorded unit prices; newly added catalog lines on those documents use current applicable rates.

**Why:** The user explicitly selected both recommendations on 2026-11-11, resolving conflicting schedule editing and document-update examples in the supplied briefs.

**How to apply:** Enforce existing-line identity and recorded prices server-side. Test an existing document with both retained and newly added lines after a schedule change; unrelated or quantity edits must not silently reprice retained lines.

Editing a schedule automatically activates its new version and deactivates the previous one atomically; explicit new-schedule creation still requires separate activation. Catalog repricing uses the existing pricing audit fields and structured details, not new audit columns. New estimates, including wet-check conversions, use current applicable pricing rather than historical finding snapshots; existing estimate lines remain frozen.

**Why:** The user's revised combined brief explicitly supplied these semantics and supersedes conflicting examples in the original slices.

**How to apply:** Read `attached_assets/Pasted--2173-Tiered-Material-Markup-Engine-What-Why-Add-increm_1794432278680.txt` for the exact audit mapping and stored-line matching contract. Keep estimate pricing authoritative server-side, not just a client preview.

The staged Publish remains separately gated: do not restore the deferred customer composite foreign key until the user confirms the first Publish succeeded. Never add startup or deployment-time DDL, write production data, or publish as part of pricing development.

**Why:** The user approved a two-stage Publish to avoid the dependency-order failure; changing the pricing model does not approve bypassing that rollout.

**How to apply:** Follow `docs/material-markup-staged-publish.md`. Development-only schema checks do not authorize production changes.
