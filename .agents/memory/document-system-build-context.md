---
name: Document System build context
description: User-provided design context and audit for the upcoming Document System build.
---

The user supplied two reference documents on 2026-11-06 for an upcoming build, not an instruction to implement it.

Read `attached_assets/Pasted--Document-System-Design-Context-Locked-Decisions-Read-t_1793997084851.txt` and `attached_assets/Pasted--AUDIT-Document-System-Field-Capture-Wizard-and-System-_1793997091857.txt` before work in this family. The audit describes a historical snapshot; validate its code claims against current source.

**Rule:** Build seven separate slices in their specified order, each on current main; do not combine them. The individual slice specification overrides the mockup. Only the context and audit were supplied at intake, not the seven slice specifications.

**Why:** The user-provided context explicitly locks staged delivery and existing-role compatibility.

**How to apply:** The wizard belongs in the phone-first web app, not Expo. Exclude site maps, Command Center, and the existing Irrigation Profile edit flows/permission flags. Preserve field-tech, billing-manager, and bookkeeper behavior. The new documenter role gets only its property picker and wizard and needs a deny-by-default API allowlist. The Slice 1 specification clarifies that administrative API assignment is allowed immediately under existing rank/admin rules; only UI role-picker assignment waits until Slice 7.

**Rule:** The user approved all five flagged design decisions at the Slice 2 handoff: edits invalidate verification; absent equipment is deactivated rather than deleted; explicit zone-type confirmation (existing Other zones unconfirmed); four backflow-test answers; online-only step saves with retained failed entries.

**Why:** The original context flagged these for confirmation, and the subsequent explicit approval locks them for later slices.

**How to apply:** Do not re-ask these decisions. Use the original context and each slice specification for exact capture requirements, gap codes, verification rules, and exclusions.
