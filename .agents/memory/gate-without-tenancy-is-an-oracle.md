---
name: A new gate on an unscoped route becomes a cross-tenant oracle
description: Adding validation to a route that never checked ownership converts its error responses into an existence and attribute oracle.
---

Before adding a validation gate to a route, confirm the route already enforces
tenancy. A gate that answers *differently* depending on a record's contents is
an information leak on any route that does not first prove the caller owns that
record — the attacker stops caring about the write and reads the error instead.

**Why:** A branch-required gate was added to estimate create/update paths. The
update handler had never checked estimate ownership, and the create path looked
its customer up through a global, non-company-scoped getter. The gate itself was
correct, but bolted onto unscoped routes it became a probe: distinct responses
revealed that a foreign record existed and whether its parent had a given field
configured. The pre-existing hole was worse (a cross-tenant write), but the gate
is what made it *readable* without changing anything.

**How to apply:** When adding validation to an existing route, check for the
codebase's ownership predicate in that handler first. If it is absent, add it
before the gate, and order it first so the gate never speaks for a record the
caller does not own. Collapse "belongs to another tenant" into the identical
response as "does not exist" — a different status, message, or even a different
rejection *reason* for the same input is enough to distinguish them. Answer 404
rather than 403 for a foreign record, and place the ownership check ahead of
other state checks (draft/status/conflict) so those cannot leak either.

Beware fixtures that hide this: test helpers routinely omit `companyId` or pair
a record from one company with an auth context from another. Those rows usually
cannot exist under a NOT NULL schema, so when a new ownership check "breaks"
them, correct the fixture — do not loosen the check.
