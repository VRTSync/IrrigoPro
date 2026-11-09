---
name: Controller identity and startup constraints
description: Historical identity failures and why real startup must be checked after retiring letter constraints.
---

## Stored identity, not presentation-derived identity
Use the stored controller identity and letter, never a letter inferred from a descriptive name or array position. The field-audit decisions in [Document System context](document-system-build-context.md) supersede the earlier auto-assignment and all-row uniqueness policy.

**Why:** Six controllers with descriptive names all resolved to the same last-character letter, causing silent data loss via the `wet_check_zone_records` unique index on `(wet_check_id, controller_letter, zone_number)`.

**How to apply:** Keep equipment references and historical printed letters separate from current display labels. Consult the current slice specification for who may choose or confirm letters.

## Schema changes must survive actual startup
Retired runtime hardening must not reintroduce constraints that the current audit model deliberately removed.

**Why:** A successful schema push and passing isolated route tests were followed by API startup silently restoring an obsolete all-row letter index and NOT NULL rule. That invalidated active-only reuse and atomic swaps despite a clean column drift check.

**How to apply:** When changing historical invariants, inspect old startup/snapshot-repair routines and verify the live constraints after a real restart. Do not treat a column-only drift check or a mini Express test app as proof that startup preserves the schema.
