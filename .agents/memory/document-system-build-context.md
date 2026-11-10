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

**Rule:** Equipment notes in the Document System are optional field knowledge shared with the office, never a completion requirement. Zone notes are intentionally excluded.

**Why:** The user explicitly said zone problems belong in wet checks rather than the system record; equipment access and condition notes should not prevent documenting or verifying a system.

**How to apply:** Keep controller/backflow notes in the existing shared stores, preserve office and former-name notes unless edited, and do not add zone notes or notes-based gaps to this wizard.

**Rule:** Treat completed earlier slices as satisfied prerequisites; recovering archived scheduling records must not introduce another implementation or acceptance gate.

**Why:** The user explicitly corrected the historical planning snapshot: Slice 4 was already built. Recreating its task or requiring another approval would repeat work rather than advance the requested slice.

**How to apply:** Inspect the current implementation to consume its contracts. Stop only for an actually missing dependency, not a historical statement that it was absent.

**Rule:** Date-only backflow anniversaries must match the API's UTC calendar rollover independently of the phone's timezone.

**Why:** Local calendar-year arithmetic in Denver gave March 8 for a March 9 anniversary across a daylight-saving transition, while the UTC API returned March 9. Matching the source code's local operation does not match its semantics across timezones.

**How to apply:** Use timezone-independent calendar arithmetic for the wizard's due-date preview, retain the API's leap-day rollover, and verify DST boundaries in multiple browser timezones.

**Rule:** Restricted documenter account switching means ending the server session and authenticating as the next user, not selecting another local user perspective.

**Why:** The legacy Switch User screen enumerates general users and only changes local state; the documenter allowlist intentionally denies that list. Reusing the route must not leave an unusable account action or justify widening permissions.

**How to apply:** Keep the restricted path separate before the legacy selector mounts. Test the real destination and logout response, absence of the user-list request, cleared session, and a fresh sign-in; do not hide that boundary behind a mocked page.

**Rule:** The 2026-11-09 zero-minutes FIX supersedes the uploaded locked context's positive-runtime requirement. Active controller-program assignment is the answered signal; zero minutes is intentional non-running, not missing data.

**Why:** Field testing confirmed wired, numbered zones may be deliberately zeroed on the clock. Requiring positive minutes prevents faithful documentation and verification.

**How to apply:** Preserve the 0–120 per-zone range and 1–120 Set all range, including program-pick minute defaults. Do not reintroduce a positive-minutes completeness requirement or rewrite the uploaded historical reference.

**Rule:** The controller-letter context supplied on 2026-11-09 supersedes the earlier manual-reorder requirement. Read `attached_assets/Pasted--Controller-Letters-Design-Context-Locked-Decisions-Rea_1794263036857.txt` before either controller-letter slice.

**Why:** Field testing exposed conflicting auto-assigned letters and typed clock names. The user explicitly approved letter identity and removal of manual reordering.

**How to apply:** Build server/rules and UI/removal as two separate, ordered slices; publish only after both merge. Letters are chosen explicitly, names are server-derived as `Controller <letter>`, and active-letter conflicts require a confirmed atomic swap with history. Existing letters start unconfirmed; only on-site wizard confirmation satisfies verification and permits old-name normalization with meaningful names preserved in notes. Office changes and the other clock in a swap remain unconfirmed. Slice 2 removes reorder UI and its stored order column; lists sort by letter. Preserve frozen ticket letters, site maps, Expo, customer billing, and wet-check controller references. Ticket `(now P)` display is a later third slice. The context attachment alone is not an instruction to implement either slice.

**Rule:** Program letters describe what is actually set on the clock, not a consecutive sequence. A clock using A and D must not require placeholder B or C programs.

**Why:** Field testing on 2026-11-10 confirmed that A with D for drip is a normal real-world configuration. Empty intermediate programs create false documentation gaps.

**How to apply:** Keep program selection explicit and independent of controller-letter identity. Preserve program ids when correcting letters so existing zone assignments and runtimes remain attached.
