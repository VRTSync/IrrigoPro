---
name: Batching a per-customer helper
description: Turning a single-id read into a set-based one moves tenancy and test seams; both must be handled in the same change.
---

A helper that answers for ONE pre-validated id can legally leave a leg unscoped —
the caller already proved the id belongs to the tenant. The moment the same rules
are re-expressed over an arbitrary id list, that leg becomes an oracle: pass a
foreign id and it answers.

**Rule:** when converting a per-row helper into a batch, scope every leg explicitly,
and keep the single-id function as a thin wrapper over the batch so there is exactly
one implementation of the rules. A leg whose own table carries no tenant column
resolves tenancy by joining the owning row (a customer belongs to one company, so
this cannot change a correct single-id caller's result). A leg that already had a
tenant predicate keeps filtering on the SAME column it filtered on before — swapping
to the owner's column silently changes the answer for any row whose tenant was
re-stamped.

**Why:** the unscoped leg is invisible while only one validated id can reach it, and
the two legs disagreeing is invisible until a re-stamped row shows up in production.

**How to apply:** also budget for the test rework in the same task. Suites that
controlled the old helper patched its single I/O seam, and a shim that answers every
query with one row set will feed both legs the same rows — which hides exactly the
bug this change can introduce. Give each leg its own seam (one per table/method) and
make the shim reject a query it was not written for, rather than answering it.
