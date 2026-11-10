# Backflow date fields acceptance

## Scope

Only the Document System backflow wizard and its existing page tests changed.
Save logic, Review rendering, API/server, shared Input, and required-field rules
were not changed.

## Checks

- `pnpm --filter @workspace/irrigopro typecheck`: passed.
- `node scripts/run-validation-lane.mjs web`: executed all 29 existing entries.
  `DocumentSystemPage.test.tsx` passed all 102 tests, including stored-date clearing
  on Next, Back, and Save & exit; exact changed-only `{ installDate: null }`;
  unknown-date hint; set-then-clear without a write; Review's `Not known`; both
  inputs' local sizing classes; and the required Test date.
- The full web lane reported 27 passing entries and two failing entries:
  - `invoice-ar-first-ui`: two unrelated invoice tests exceeded their existing
    5000ms timeout (`writes a changed filter back to the URL, keeping the others`
    and `reports the server's total for the filtered set, not the sum of the loaded page`).
  - `document-system-page`: the separate `documenter-app.test.tsx` controller
    allowlist walk failed to reach `step-zone-count`. This is a controller
    path, before this task's backflow date UI. Its assertions and the validation
    manifest were left unchanged.
- Replaying those two unchanged entries serially through the existing lane
  runner: `invoice-ar-first-ui` passed all 92 tests. The
  `DocumentSystemPage.test.tsx` suite again passed all 102 tests; the separate
  documenter controller-walk failure reproduced. Full logs are retained locally
  in `/tmp/backflow-web-validation.log` and `/tmp/backflow-isolated-validation.log`
  for this session.

## 390px browser evidence

Chromium at 390×844 rendered the actual `BackflowFlow` component and application
CSS in an isolated browser fixture. API responses were intercepted; no records
were created or changed. This is component/browser evidence, **not signed-in
end-to-end or physical-iPhone verification**.

Both date fields measured:

| Property | Install date | Test date |
| --- | --- | --- |
| Left / right | 16 / 374px | 16 / 374px |
| Width | 358px | 358px |
| Height | 48px | 48px |
| Text | 16px, left aligned | 16px, left aligned |
| Document scroll width | 390px | 390px |

The clear button measured at least 44px tall. Browser pointer clicks were
hit-tested to confirm the clear and Next controls were reachable. The fixture
simulated an accidental selected install date, clicked Clear, checked the empty
value, continued without an install-date request, entered the required test
details, and reached Review with `Installed` = `Not known`. No browser runtime
errors occurred.

Local evidence (ignored generated output, also delivered as screenshot assets):

- `generated-artifacts/backflow-dates/location-unknown-390.jpg`
- `generated-artifacts/backflow-dates/location-accidental-date-390.jpg`
- `generated-artifacts/backflow-dates/location-cleared-390.jpg`
- `generated-artifacts/backflow-dates/last-test-390.jpg`
- `generated-artifacts/backflow-dates/review-installed-not-known-390.jpg`
- `generated-artifacts/backflow-dates/evidence.json`
- Reproduction: `node generated-artifacts/backflow-dates/capture.mjs`

## Device limitation

No physical iPhone is available. iOS Safari's native picker auto-fill,
WebKit-specific date-value rendering, and the complete accidental-tap → Clear
→ Review interaction still need acceptance on an actual iPhone. Chromium
measurements and jsdom class checks do not establish those device behaviors.

## Completion validation

The completion check did not mark the task complete:

- `node scripts/run-validation-lane.mjs web`: 28 entries passed, one failed.
  The remaining failure is the separate documenter controller allowlist walk
  described above. The invoice entry passed during this run.
- `node scripts/run-validation-lane.mjs types`: three entries passed, one failed.
  `validation-lanes-manifest` reports
  `Missing test: artifacts/irrigopro/src/components/document-system/controller-order-list.test.tsx`.
  The package typechecks passed. The manifest still references the removed
  controller-order test; changing that manifest is outside this fix's scope.
- API billing, API field, and completion code review passed.

Both blocking failures concern controller work outside the requested date fix.
They were not bypassed or silently repaired.
