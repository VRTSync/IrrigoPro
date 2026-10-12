# Fast Zone Entry acceptance evidence

Verified on the development preview on October 8, 2026. This is not deployment or production-data proof.

## Browser checks

A real company-admin login was used with an isolated “Fast Zone Entry Acceptance” customer and Controller A containing 20 current zones. No application authentication was bypassed. The fixture company, customer, user, controller, programs, zones and history were removed after verification.

Both existing surfaces passed:

- Full customer irrigation profile.
- Customer profile’s Irrigation System card.

On each surface:

1. Clicking the first chip focused and selected Zone 1’s Name.
2. Ten names were entered using Enter to move down the Name column, without clicking between rows. Focus ended on Zone 11.
3. Each field PUT returned 200. There were **zero controller-list GETs during naming**.
4. History contained exactly one naming-session row: `Zones edited: 1-10`.
5. Collapsing the tile showed ten solid named chips, without a reload or list refetch.
6. Selecting all 20 zones, setting Rotor and Runtime 12, and pressing Apply once returned 20 updated rows.
7. The visible History drawer’s text contained both the naming session and the separate `Zones 1-20 set: Type Rotor, Runtime 12 min` entry.
8. No browser JavaScript errors or unexpected 403 responses were observed.

`results.json` records the browser assertions. The `*-keyboard.jpg`, `*-chips.jpg` and `*-bulk.jpg` images show the sheet, named chips and bulk controls on both surfaces.

Villas at the Boulders Controller A was not used for write acceptance: changing its operational zone names/types was not safe for this isolated verification. The equivalent 20-zone fixture provides the naming, bulk, history and cache evidence; the named-site write demonstration remains unavailable. Production was neither modified nor published.

## Automated verification

The registered `irrigation-fast-entry` validation command passed:

- API route/storage suite: **95 passed**, including existing Slice 1/2 regressions.
- Controller grid suite: **34 passed**, including existing Slice 2 permission, Add Zone, focus-token, count and retirement regressions.
- Shared irrigation zone/schedule suites: **33 passed**.
- `@workspace/api-server` typecheck: passed.
- `@workspace/irrigopro` typecheck: passed.

Coverage includes field-only payloads, keyboard navigation, Escape, validation, retrying newer drafts, serialized rapid edits and reversals, dirty-cell preservation across bulk refresh, live schedule drafts, selection/shift ranges, explicit Program None and Runtime zero, read-only rows, chip cache updates, Override saves, tenant/role guards, all-or-nothing validation and rollback, parser inverses, session boundaries and simultaneous-edit serialization.

The checkout had no existing irrigation-specific validation registration. A consolidated validation command was registered; no application service workflow was added.

`git grep -n "function ZoneRow(" artifacts/irrigopro/src` returns no matches. ProgramCard’s editing flow is unchanged.

## Full-project completion check limitation

The completion check attempted every registered project validation command, not just irrigation. Its first attempt lost its connection; its retry failed to reach a terminal status. The retry's irrigation command passed again. Other commands encountered process/thread exhaustion (`EAGAIN`, failed OS-thread creation and an aborted typecheck) and unrelated budget-preview test timeouts/duplicate-element failures. This is **not** a claim that every project-wide check passed. No unrelated budget, billing, mobile or type-error changes were made to address those failures.
