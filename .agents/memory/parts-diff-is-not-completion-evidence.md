---
name: A parts diff is not evidence of undone work
description: Why nothing may re-derive "deferred work" by diffing an estimate's parts against a completed work order's parts.
---

Nothing downstream may second-guess a technician's completion by comparing parts lists. Do not
reintroduce an estimate-vs-work-order parts diff, in any form, to infer what was left undone —
not as a follow-up work order, not as a notice, not as a "completeness" audit or warning badge.

**Why:** work orders are created prefilled with the estimate's parts, the tech edits that list
down to what he actually installed, and completion *replaces* rather than appends. A part the
tech did not use is therefore indistinguishable from a part that was substituted — and
substitution is the normal case (poly goes in the ground where PVC was quoted). An auto-created
follow-up built on this diff produced phantom work orders against completed, approved, billed
tickets in production. Parts determine what is *billed*; they say nothing about whether the work
happened. Marking the ticket complete means the referenced fix is done — the same trust model
already applied to billing sheets.

**How to apply:** this kicks in whenever someone wants to flag "incomplete" work at or after
completion. The real open problem — an inspection estimate where many repairs genuinely went
untouched and nothing flagged it — is a punch-list/scope-tracking concern and needs an explicit
signal from the technician or the manager, not an inferred one. Solve it with recorded intent,
never by re-deriving it from the parts list.

Related: the work-order completion route requires `completedAt` in the request body; a scripted
completion that omits it dies with `RangeError: Invalid time value` before any write, which reads
as a server bug rather than a bad fixture.
