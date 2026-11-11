---
name: Offline document identity transitions
description: Keep user ownership, logout epochs, and unsaved draft identities distinct during document sync.
---

Queue ownership is the stable tenant/user identity; a logout epoch only guards
late writes to cleared document copies. Never include the logout epoch in durable
queue ownership.

**Why:** Doing so strands an unchanged queue when the same person signs back in,
even though logout deliberately preserves the existing queue and blob stores.

**How to apply:** Capture the session epoch before asynchronous downloads or
refreshes, reject obsolete copy writes, and keep replay scoped to the stable user.

In an open newly-created clock flow, retain draft zone identity by zone number
and program identity by the create UUID while authoritative reads acquire server
IDs. Do not mutate the authoritative stored graph to retain draft IDs.

**Why:** Sync can replace IDs while someone is editing. Drafts keyed only by the
old numeric IDs otherwise silently lose edits or duplicate programs.

**How to apply:** Adapt only the active draft's view; use zone-number writes and
create-ID resolution on the wire, then reopen from the authoritative IDs.

Verify offline-shell acceptance against the actual built bundle and wait for
service-worker control before reloading a deep link without network.

**Why:** Component tests and successful builds can pass while a development
registration stub prevents any worker from being emitted or installed.

**How to apply:** Check generated worker/precache output and run a production-
bundle browser fixture. Keep this evidence explicitly separate from physical
phone or published-environment acceptance.

An asynchronous direct-to-queued fallback must keep the session that initiated
the operation, including while waiting for a per-site lock.

**Why:** A network request may fail after logout or account switching. Capturing
ownership only when the fallback eventually runs can assign old work to the new
account.

**How to apply:** Guard the initiating session before durable capture/enqueue,
while keeping the queue's stored owner stable across legitimate later logins.

Photo capture must also survive transient upload HTTP failures, not just a
rejected network request. Keep this distinct from ordinary documentation writes.

**Why:** A storage or gateway 5xx response can leave the only photo in page
memory even though the browser reports online. In contrast, ordinary document
writes must preserve their HTTP refusals rather than silently queue them.

**How to apply:** Preserve upload response status, durably capture transient
408/429/5xx photo failures, and keep authorization/validation refusals visible.
Verify survival through a real reload with the upload service still failing.
