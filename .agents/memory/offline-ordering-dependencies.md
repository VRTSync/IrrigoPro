---
name: Offline ordering dependencies
description: Durable rules for queued mutations that order server writes without supplying server IDs.
---

Serialize dependency discovery and enqueue for mutations sharing one logical
entity. A reconnect does not erase queue order: a new online action must join
any unfinished chain instead of bypassing it through a direct request.

Ordering-only dependencies must treat completed, terminally failed, and removed
parents as settled. Only pending or syncing parents should block. The dependent
request can then receive its own actionable server validation response rather
than remaining pending forever.

**Why:** A list-then-enqueue race can let completion overtake a durable location
write, while generic entity dependencies can deadlock forever after users cancel
or cannot repair a failed predecessor.

**How to apply:** Use a per-entity critical section (or one IndexedDB
transaction) around predecessor lookup and enqueue. Distinguish ordering-only
edges from placeholder/server-ID edges, which still require successful parent
resolution.

Verification and Finish need a separate success dependency: a refused or
discarded prerequisite must fail verification visibly, even though later
ordinary patches may proceed. Do not treat a conflict's terminal engine status
as proof that its optimistic edit succeeded.

**Why:** Server-wins conflicts can be terminal/completed for the engine while
still representing a refused edit. Reapplying that edit or releasing verification
would show a false successful result.

**How to apply:** Keep authoritative snapshots separate from ordered optimistic
overlays, exclude refused edits, and retain success prerequisites independently
of ordering prerequisites.