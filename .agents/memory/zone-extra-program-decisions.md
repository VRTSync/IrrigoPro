---
name: Zones on multiple programs
description: Locked scope and behavior for extra irrigation program lines.
---

Implement this family after both Clocks Own Their History slices have merged, server/schedule/PDF foundation first and wizard/display second. The approved visual reference is “Run Times — Second Program” from 2026-11-10.

**Why:** The user has zones running in multiple programs and requires each secondary program to have its own runtime and an obvious separate line inside the zone box.

**How to apply:** Preserve the zone's main program/runtime and store additional lines separately. Only the Document System wizard edits extras; Controllers & Zones and the profile PDF show them read-only. Remove an extra line with one tap on ×, without confirmation. Each line contributes its own minutes and program seasonal adjustment; zone overrides apply only to the main line. Extras do not create completeness gaps.

The main program wins a collision: changing it to an extra program removes that extra in the same transaction. Set all changes main lines only, except for this collision cleanup. Losing a main program preserves existing extras, even though adding extras requires a main program; show the unset main line in amber. Retiring/restoring zones preserves extras. Program deletion removes that program's extra lines. CSV replace clears extras without changing CSV columns. Site maps, wet checks and tickets remain out of scope.

**Why:** Existing main-only readers must remain valid, and temporary loss of a main program must not discard recorded secondary watering.

**Rule:** After refetch removes a program, local mutations must start from the
currently filtered, merged zone rather than overlaying an older draft again.

**Why:** Reapplying the older extra-line list resurrects a removed program and
can shift line indexes, so a change intended for the surviving line affects the
wrong program.

**How to apply:** Treat the rendered merged zone as the mutation input. Exercise
an edit after program removal, not just the first render after refetch.
