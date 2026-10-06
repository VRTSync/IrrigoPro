---
name: Every narrowing the user can see must be applied where the aggregates are
description: A browser-only filter beside server-side aggregates and a full-set select-all silently acts on rows nobody looked at.
---

When a list has server-side filters, server-computed aggregates (header
totals, summary strips) and a "select all matching" action, **any filter left
in the browser is a correctness bug, not a convenience.** The aggregates and
the full-set fetch are built from the server query, so a client-only search or
period filter makes them describe a wider set than the table shows — and a
bulk action on that selection touches rows the user never saw.

**Why:** the failure is silent and asymmetric. Everything looks right on a
single page of results; it only diverges once the result spans pages, which is
exactly when someone uses select-all.

**How to apply:**
- Put every user-visible narrowing in the URL and in the server query, so the
  list, the aggregate and the full-set selection all ask one question.
- If a filter genuinely cannot move server-side, do not offer full-set
  selection while it is active — select only the displayed rows.
- Regression-test the combination, not the parts: a filtered, paginated
  select-all must not be able to return an off-view id.

Invoice selections belong to the effective filter, not to whichever rows
remain visible while a request is pending. Pagination within that filter must
preserve selection; changing filters must drop it, including open reminder
confirmations. Returning to a previous filter is a new selection scope.

**Why:** Batch reminders can email customers from an earlier view if retained
placeholder rows or delayed select-all requests are allowed to restore IDs.
Matching a request's filter string alone is insufficient for A → B → A.

**How to apply:** Keep loading/focus continuity separate from permission to
select stale rows. Verify both delayed select-all success and failure paths,
and assert the actual reminder preview/send IDs after a filter transition.
- Keep local state only as an input echo (debounced write to the URL); never
  as the thing that decides which rows are shown.
