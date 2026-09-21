---
name: Named-record cleanup migrations
description: Design rules for a Super Admin migration that repairs or cancels a hand-enumerated list of production records.
---

# A named-record migration widens its preview, never its write set

When a cleanup migration targets records that were enumerated by hand off a
screenshot or a support thread, the list is a snapshot of one day, not an
inventory — the mechanism that produced them usually stayed live afterwards.

**The rule:** the preview enumerates the *whole* population the mechanism can
produce (e.g. every row still carrying the lineage column) and reports anything
outside the named set as a finding. The write set stays exactly the named
records. Extras are never written and never abort the run.

**Why:** the blast radius stays fixed and reviewable while the operator still
learns about rows nobody enumerated — which matters most right before a later
task drops the column that explains where those rows came from.

**How to apply:**
- Resolve targets by their human-facing business key (work order number,
  invoice number), not by the lineage column a later slice deletes.
- Preflight collects *all* violations — missing targets, unexpected status,
  wrong tenant — and aborts before the first write with the whole list.
- Repeat every preflight condition as a predicate on the UPDATE itself (id, key,
  allow-list membership, explicit denial of any keep-this record, tenant, and
  the status preflight saw). 0 rows affected is a failed step, not a success.
- A "leave this one alone" record still gets resolved, asserted present and
  reported as an explicit no-op step; its absence is an abort, because it means
  this is not the database the constants were verified against.
- Guard every query that touches a soon-to-be-dropped column with an
  information_schema existence check, or the admin page 500s after the drop.
- Verify from a fresh post-commit read, including that the keep-this record's
  id and status are unchanged; only then write the completion marker.
