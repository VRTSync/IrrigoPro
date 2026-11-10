# Document System program letters

## Scope

Implemented explicit A–F selection and correction in the phone-first web wizard.
No schema changes, migrations, old-program cleanup, permission changes or Expo
changes. Letter availability includes inactive programs; only active programs
appear as tabs.

## Automated coverage

Extended the existing DocumentSystemPage tests for explicit D creation after A,
inactive and normalized letter reservations, no-write Cancel, hidden actions when
A–F are reserved, rename overlays across stale refetches, retained setting drafts,
unchanged zone links and zero runtimes, and create/rename conflict Retry.

Extended the existing irrigation-profile route tests against the development
database for normalized active/inactive collisions, unchanged program identity and
settings, unchanged linked zones and runtimes, renamed-from history, verification
invalidation, foreign-tenant 404s, and concurrent create/create, create/rename and
rename/rename serialization.

The existing ordered controller-graph query feeds Controllers & Zones and PDF
readers. Those readers did not require changes. The browser acceptance script
also rendered the actual PDF HTML builder with the persisted A/D graph and checked
program heading order.

## Phone-sized browser evidence

Authenticated system-documenter session against the running development app and
real API/database, at 390 × 844 in Chromium mobile emulation. This is not a
physical-device or deployed-build test. Only the fixture clock photo response was
synthetic; program mutations, authentication and site reads were real. Fixtures
were removed after each run.

- New clock fixture: chose A, entered its required settings, then chose D. Exactly
  two create requests, with sortOrder 0 and 3. Tabs were A then D, with D selected.
  No B/C programs existed. Days and start times gated Next as before.
- Separate existing-B fixture: changed B to D using its original program id.
  Unsaved days, start-time and seasonal-adjust edits remained visible and saved
  normally on Next. Zone ids and program links were unchanged; runtimes remained
  0 and 17 minutes. Cancel produced no additional mutation.
- Lower controls were reached by scrolling and pointer hit-testing before clicks,
  not DOM-triggered button handlers.
- Successful run: no browser page errors and no forbidden API responses.

Generated captures and request report are under
`generated-artifacts/program-letters/` (excluded from Git/deployment):

- `02-pick-D-with-A-present.jpg`
- `03-A-and-D-selected.jpg`
- `04-change-B-to-D.jpg`
- `05-renamed-D-unsaved-settings-kept.jpg`
- `lower-controls-B.jpg` and `lower-controls-D.jpg`
- `06-renamed-D-runtimes.jpg`
- `report.json`, `ordered-profile.html`, and `acceptance.ts`

## Release boundary

This work was performed in an assigned-task fork. It has not been merged,
published, or verified on the deployed build. Publication must happen from the
merged main app, followed by the same explicit-letter and rename acceptance.
