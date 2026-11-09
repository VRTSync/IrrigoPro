# Zero-minute runtime acceptance

Verified 2026-11-09 in the development environment. No production data was changed or published.

## Automated checks

- Existing `api-field` entries `system-documentation-routes` and `system-documentation-shared`: passed (11 real-route tests and 9 shared tests).
- Existing `web` entry `document-system-page`: passed (130 tests across five files, including 95 wizard tests).
- Library type builds (`pnpm typecheck:libs`) passed. Shared, API Server and IrrigoPro typechecks passed in library-first order.
- No validation registrations or workflows were added.

Coverage includes zero-runtime completion, stable singular/plural `run_times` labels, null/unknown/inactive program rejection, zone-count suppression, typed and minus-to-zero editing, unchanged program-pick defaults, bulk persistence of zero, per-program Review annotations, unchanged summaries without zeros, and the real verification endpoint.

## Phone-width flow

Desktop Chromium at **390 × 844**, using a newly created isolated development tenant and an equivalent eight-zone Controller A fixture:

1. Zone 8 initially had no program and zero minutes: amber, `1 zone without a program`, Next disabled.
2. Selected Program A: minutes defaulted to 10.
3. Typed zero: row was no longer amber, minus was disabled, Still needed cleared, Next enabled.
4. Next sent the existing bulk save with `runTimeMinutes: 0`, returning 200.
5. Review displayed `Program A: Mon at 5:00 AM, 100%, 8 zones (1 at 0 min), 70 min`.
6. Verify used the real authenticated endpoint and returned 200. Summary showed Controller A verified.
7. A fresh site read and storage read confirmed verification and Zone 8's program assignment and zero runtime.

Browser interactions used real pointer/keyboard events, scrolling, and center-point hit tests. No browser errors were recorded. The generated fixture tenant and account were deactivated after the check.

Screenshots, script and machine-readable report are retained outside Git under `generated-artifacts/zero-runtime/`:

- `01-zero-zone-next-enabled.jpg`
- `02-review-zero-count.jpg`
- `03-review-verify-enabled.jpg`
- `04-verified.jpg`
- `report.json`
- `acceptance.ts`

## Limits

- No physical iOS or Android phone was available; this is phone-width desktop Chromium evidence.
- The named Aspen Townhomes record was not edited or checked. An equivalent safe fixture was used.
- No canonical locked-design Markdown document was found. Uploaded historical text references were left unchanged.
