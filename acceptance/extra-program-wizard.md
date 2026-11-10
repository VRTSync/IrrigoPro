# Zones on more than one program — wizard and office display

## Scope and reference

The server/schedule/PDF foundation was already merged at implementation start.
This slice changes only the web wizard's draft/save flow and Run times zone
boxes, existing Review Programs summary, and read-only grid/history display.
No server, schema, schedule math, PDF source, native mobile, or zone-count
implementation was changed.

The original canvas frame and sandbox component were absent in this checkout.
The user supplied the approved **Run Times — Second Program** screenshot;
the implementation follows that layout and the BUILD's labels and controls,
not the demonstration data.

## Automated evidence

- Full bounded `web` lane: **29 checks passed, 0 failed**.
- Final affected component suites: **175 tests passed** across the existing
  DocumentSystemPage and irrigation-controller-grid test files.
- All eight specified scenarios are covered, including exact main-before-extra
  request ordering and bodies, no-dialog removal with empty replacement,
  filtered selectors, contextual Add, Set all collision cleanup, failed-save
  Retry, Review totals, and separate snapshot extra-program runtimes.
- Additional checks cover retained unsaved values across refetches, multiple
  independent extra lines, 0/120-minute boundaries, remove/re-add,
  main-unset preservation, and deleting a program during an edited draft.
- The deleted-program test also edits the surviving line after refetch, proving
  removed lines are not reintroduced by an old draft overlay.
- Web typecheck: **passed**.
- Inherited PDF suite: **13 passed**; validation-lane manifest suite:
  **8 passed**.

## Authenticated phone-sized acceptance

Chromium at **390 × 844**, mobile/touch emulation and America/Denver timezone,
using a newly generated, email-verified company-admin account and isolated
company/customer/controller fixtures in the development database.

The fixture clock photo response alone was synthetic. Login, site reads,
program saves, verification, controller detail, database persistence and
the downloaded PDF all used the real app/server. Fixture records were removed.

Real browser pointer and keyboard interactions, with scrolling and center
hit-testing, demonstrated:

1. Add B to Zone 3, initially at Set-all minutes.
2. Change B to 12 minutes.
3. Remove B immediately, without a confirmation.
4. Re-add B and set it to 12; change main A to 21.
5. Next sends the main bulk request first, then one extra-program replacement;
   both return 200. Review counts the zone under A and B.
6. Finish/verify succeeds.
7. Navigate away and reload the site: main A remains 21 and extra B remains 12.
   Direct read-back confirms the saved extra-program row.
8. Controllers & Zones displays **Also B · 12 min**.
9. The actual authenticated `report-pdf` response was downloaded, text-checked
   and rasterized. Zone 3 appears under A at 21 minutes and under B at 12.

No browser page errors or forbidden responses were recorded. The requested
phone captures have no document-level horizontal overflow; the existing office
table scrolls horizontally inside its own container.

Evidence is retained in the ignored `generated-artifacts/extra-programs/`
directory: numbered phone captures, `profile.pdf`, `profile.txt`,
`profile-page-1.jpg`, the acceptance script and request report.

An initial acceptance assertion omitted the existing PDF Start/End columns;
the corrected assertion checks those columns and both per-program runtimes.
The final browser run completed all requested phone/grid/PDF checks, then an
optional desktop capture timed out when switching responsive layouts collapsed
the controller. No desktop capture is claimed. That optional capture was
removed from the retained acceptance script. Physical-device testing, real
on-screen phone keyboard behavior, and production testing were not performed.

## Environment and rollout boundary

The merged foundation's `irrigation_zone_extra_programs` table was missing in
the development database. Its existing `0036_zone_extra_programs.sql` migration
was applied locally, without a full schema push or any new migration/source
changes, to permit real persistence checks.

This slice remains in an assigned-task fork until merged. It has not been
published and no production database change was made. After merge, publishing
must be user-controlled from the main app; confirm that the foundation's schema
is present in production, then repeat save/reload, office-grid and PDF checks
against the published build. Do not interpret local evidence as production
verification.
