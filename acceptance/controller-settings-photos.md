# Controller settings photos — verification

## Scope
- Replaced only the grid's raw image renderer with the existing PhotoImage, using medium, the original alt text and classes.
- Wrapper, empty state, permissions, Add/Replace controls and upload/attachment handlers are unchanged.
- No server, schema, authorization, storage implementation or stored-value changes.
- Inspected all web settingsPhotoUrl references: no additional raw-source renderer found. The Document System passes its photo value through its existing photo field/API-prefixed review renderer; unchanged.
- `git grep -n "src={controller.settingsPhotoUrl}" artifacts/irrigopro/src` returns no matches.
- Existing `irrigation-fast-entry` validation-lane registration retained unchanged.

## Automated checks
- Grid suite: **39 passed**, single worker (`--maxWorkers=1 --minWorkers=1`).
- `pnpm --filter @workspace/irrigopro typecheck`: **passed**.
- New tests use the real PhotoImage with an isolated fetch mock. They prove the exact `/api/photos/photos/abc/signed-url?variant=medium` request, returned signed image URL, no raw storage-id source, original wrapper/classes, empty/read-only state, and both Add and Replace upload/attachment flows.
- Photo reads and attachment mutations have separate method/path-aware mocks.
- Existing tests emit unrelated missing-default-query-function warnings; no failing grid assertions.

## Browser verification
- Real sign-in as a temporary irrigation manager at desktop 1440×1100.
- Temporary customer/controller only; no existing customer record changed.
- No-photo state visible before upload.
- Add Photo → Choose from Library: real storage upload, finalize and controller attachment each returned 200. Medium signed-URL request returned 200; image loaded at natural width 800; no raw storage-id source.
- Replace Photo: repeated real upload/finalize/attachment and medium signing, all 200; replacement image loaded at natural width 800.
- No browser page errors.
- Temporary customer, controller, zones/history, user and company database records removed afterward.
- Screenshots and detailed browser report are retained under ignored `generated-artifacts/controller-settings-photos/`: `grid-added-photo.jpg`, `grid-replaced-photo.jpg`, `report.json`.

## Record-specific limitation
Aspen Townhomes is unavailable in this development database (customer lookup for `%Aspen%Townhome%` returned no rows). The unauthenticated preview correctly shows sign-in and the customer API returns 401. Therefore the actual Aspen Controller A wizard photo and its requested screenshot could not be verified here. The screenshots are explicitly temporary fixture evidence, not Aspen evidence. Production was not modified or published.
