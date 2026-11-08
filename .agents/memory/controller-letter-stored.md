---
name: Controller letter stored column
description: Every irrigation_controllers insert must supply a stored A–Z letter; never derive it from a name or array index.
---

## Invariant
`irrigation_controllers.letter` is NOT NULL with a unique index per `(companyId, customerId, branchName, letter)`. Every insert path must supply a letter from the allocator.

**Why:** Six controllers with descriptive names all resolved to the same last-character letter, causing silent data loss via the `wet_check_zone_records` unique index on `(wet_check_id, controller_letter, zone_number)`.

**How to apply:** Route all new controller inserts through `createIrrigationController` (auto-assigns letter). A raw `db.insert(irrigationControllers)` without `letter` will fail at the DB level once NOT NULL is active — there is no silent fallback.

**Startup migration design rule:** A "completed" app_settings marker must verify that both the NOT NULL constraint and the named unique index are actually present before returning. A snapshot-restored DB may have the marker but lack the DDL; the startup migration must detect and re-apply both before serving requests.

**Dev validation rule:** After a schema push, restart the API before running controller-letter collision regressions. The dev database may lack the runtime-owned letter index even when the column-only drift verifier passes; the existing startup migration restores it.

**Why:** A verification-storage schema push passed its drift check, but the collision regression returned duplicate letters until the normal API startup restored the deferred index. No controller code change was needed.

**How to apply:** Distinguish missing runtime DDL from a regression. Inspect index presence and startup logs; do not widen an unrelated schema task to change the deferred-index policy.
