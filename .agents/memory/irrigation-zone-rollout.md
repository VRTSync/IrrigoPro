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

Fast-entry history treats individual zone edits as a rolling ten-minute session for one identified actor on one controller. A bulk apply is a separate deliberate action, and a non-zone action interrupts folding.

**Why:** The supplied specification explicitly rejects hundreds of per-cell history entries during large controller build-outs, while preserving bulk operations as readable audit events.

**How to apply:** Keep these audit boundaries when extending zone editing. Never merge across actors, absent actors, intervening actions, or expired sessions.

Document controller identity and displayed location snapshots have separate purposes. Ordinary location saves resolve the current scoped letter; wet-check conversion trusts the source zone's identity even after a rename. Existing readers must keep showing their saved letters and zone numbers.

**Why:** The stable-reference specification deliberately preserves historical display behavior and defers the registry migration and historical backfill to separate rollout steps.

**How to apply:** Do not turn identity stamping into snapshot relabeling, a new profile-zone identifier, or a historical backfill. Treat source wet-check identity as a server-only conversion input, not a client-controlled override.

Ordinary item edits must preserve server-owned location identity through replacement, even when the form sends only prices and quantities. Match prior rows within the same parent; a controller rename is not a reason to re-resolve an unchanged location.

**Why:** Pricing payload normalization and delete/reinsert editing can discard identity without any user-visible location change. Re-matching the saved letter after a rename loses the historical controller even if the snapshots were retained.

**How to apply:** Preserve unchanged location and identity together, use parent-scoped source-item hints for repeated parts, and re-resolve only newly selected locations or changed document scope. Test the real edit routes, not only location-bearing storage calls.
