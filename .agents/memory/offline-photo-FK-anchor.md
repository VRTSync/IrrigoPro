---
name: offline-photo-FK-anchor
description: Root cause and regression-guard pattern for the "every photo shows as loose" wet-check photo bug.
---

## Rule
`queuePhotoUpload` in `artifacts/irrigopro/src/lib/offline/api.ts` must include
`zoneRecordId` and `findingId` in the mutation body (as `"{{zr}}"` / `"{{f}}"` placeholder
strings when the corresponding clientIds are provided, or the literal server id / null otherwise).

**Why:** The engine's placeholder resolver substitutes those strings with real server ids at
drain time. If the fields are absent from the body, the metadata POST sends null FKs and the
photo is stored as loose (LoosePhotosSection) regardless of which screen captured it.

**How to apply:** When touching `queuePhotoUpload`:
1. Verify lines building the `body` constant include both FK fields.
2. Run `vitest run src/pages/wet-checks/photo-capture-button.test.tsx` — Suite A calls
   `queuePhotoUpload` directly and asserts the enqueued IDB body has the placeholder strings.
   It FAILS immediately if those lines are removed (body fields become `undefined`).

## Test seam
`__setEngineForTests(engine)` in `engine.ts` must be called before `queuePhotoUpload` in tests
so the function uses a no-op test engine rather than the production singleton (which tries to
read `localStorage` auth headers). Pair with `vi.mock("@/lib/photo-prep")` since
`browser-image-compression` uses a web worker that never settles in jsdom.
