---
name: Document System build context
description: User-provided design context and audit for the upcoming Document System build.
---

The user supplied two reference documents on 2026-11-06 for an upcoming build, not an instruction to implement it.

Read `attached_assets/Pasted--Document-System-Design-Context-Locked-Decisions-Read-t_1793997084851.txt` and `attached_assets/Pasted--AUDIT-Document-System-Field-Capture-Wizard-and-System-_1793997091857.txt` before work in this family. The audit describes a historical snapshot; validate its code claims against current source.

**Rule:** Build seven separate slices in their specified order, each on current main; do not combine them. The individual slice specification overrides the mockup. Only the context and audit were supplied at intake, not the seven slice specifications.

**Why:** The user-provided context explicitly locks staged delivery and existing-role compatibility.

**How to apply:** The wizard belongs in the phone-first web app, not Expo. Exclude site maps, Command Center, and the existing Irrigation Profile edit flows/permission flags. Preserve field-tech, billing-manager, and bookkeeper behavior. The new documenter role gets only its property picker and wizard, becomes assignable only in Slice 7, and needs a deny-by-default API allowlist.

**Rule:** Confirm the five flagged design decisions before handing off Slice 2: edits invalidate verification; absent equipment is deactivated rather than deleted; explicit zone-type confirmation; four backflow-test answers; online-only step saves.

**Why:** The supplied context distinguishes these proposed decisions from the user's already-locked decisions.

**How to apply:** Do not interpret the document upload as approval of the flagged proposals. Use the original context for exact capture requirements, gap codes, verification rules, and exclusions.
