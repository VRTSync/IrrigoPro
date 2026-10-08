---
name: Irrigation zone rollout boundaries
description: Locked product decisions and staged operational rollout for profile zones.
---

The 2026-10-05 specification makes zone records the truth, with count changes retiring/restoring identities from the highest positions. Retirement is distinct from the user's Needs attention status. Field technicians must keep count-changing access in both wet-check modes.

**Why:** The existing profile could display a counted controller with no zone records. The rollout intentionally repairs the underlying data before redesigning tiles or migrating downstream readers.

**How to apply:** Keep the count as a transactional mirror until the later reader-migration slice. Do not turn a zone-foundation change into a site-map or document/billing migration. Publishing and the super-admin's deployed backfill are separate operational steps, followed by independent verification; a merge is not proof that production data was repaired.

Connected controller tiles keep Add Zone available to zone editors, including field technicians, on both web profile surfaces. Only the stepper and retirement confirmation require controller management.

**Why:** The user's explicit permission correction overrides the build-out attachment's manager-only Add Zone statement. Consolidating the increment implementation must not narrow technician access.

**How to apply:** Gate the two increment controls separately; do not place a manager-only guard around their shared action. Field technicians may add/restored zones through Add Zone but must not get profile retirement controls.
