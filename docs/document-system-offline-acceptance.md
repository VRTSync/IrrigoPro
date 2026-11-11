# Document System offline acceptance

## Scope

All three tiers were implemented sequentially in the existing phone-first web
documenter. Water Map and native Expo changes were excluded. The existing
extra-program implementation was consumed rather than rebuilt.

One queue, engine, blob store, upload pipeline and sync UI are retained.
Documenter startup restricts that engine to the current user's document
mutations and leaves wet-check records intact.

## Tier checkpoints

1. **Download/read:** 157 targeted checks, the existing web lane and web
   typecheck passed before queued-save work began. The final production-bundle
   check also caught and replaced the pre-existing production service-worker
   registration stub. The resulting build emits a precached worker; a headless
   browser successfully reloads a documenter deep link without network.
2. **Queued saves:** 159 API route tests, the full web lane and database/API/web
   typechecks passed before offline-photo work began. The additive client-ID
   schema was applied and verified against development only. OpenAPI clients
   and validators were regenerated.
3. **Photos:** tests cover durable capture, both inputs and replacements,
   reopening previews, storage failure, ordered create/photo/verify/finish,
   attachment failure retention/retry, and discarding replacements. Existing
   wet-check photo tests remain included in the same validation lane.

**Nothing was published at any checkpoint.** Publication remains user-controlled
after merge, including the project's normal schema-release process.

## Reproduce automated checks

```sh
node scripts/run-validation-lane.mjs types
node scripts/run-validation-lane.mjs api-field
node scripts/run-validation-lane.mjs web
pnpm --filter @workspace/db run verify
```

The lanes passed with 4, 21 and initially 29 groups respectively. After combining
the newly merged markup feature, the full web lane passed all 30 groups,
including the added transient-upload recovery checks. API/web typechecks and
regenerated-contract library checks also passed on the combined branch.

The combined development schema verified all 72 tables. Three missing incoming
markup tables and their required indexes/foreign keys were added in development
only; no prices or other records were seeded or updated. Production was not
changed.

For the built-shell browser fixture, supply the artifact's ordinary build
environment (PORT and BASE_PATH), build the web artifact, then run:

```sh
node scripts/document-system-offline-browser.mjs
```

This uses the actual production bundle, service worker, IndexedDB, compression,
queue and upload pipeline against a temporary synthetic HTTP fixture. It does
not bypass authentication in application code and never contacts a project
database or a published environment. Generated screenshots are written under
the ignored `generated-artifacts/document-offline/` directory.

The fixture checks:

- Warm download and service-worker control.
- An offline deep-link reload from the precached shell.
- Clock camera and backflow library captures, local previews and queued saves.
- Backflow tag confirmation, Verify and Finish without a connection.
- Reconnect, ordered attachment before verification, and synced results at
  phone and desktop viewport sizes.
- A direct upload losing its storage connection or receiving storage HTTP 503
  while the browser still reports online; durable fallback, a real reload,
  restored local preview and replay. Unit checks also cover transient failures
  at signing/finalizing and preserve authorization/validation errors.
- No uncaught browser errors or unexpected/forbidden fixture API requests.

## Explicitly unverified

- A physical iPhone or Android phone in airplane mode.
- Installed/mobile Safari storage eviction and persistence behavior.
- A published build, live upload storage, or production database migration.
- Confirmation on a separately signed-in live desktop after physical-phone
  synchronization.

Headless screenshots are labelled synthetic fixture evidence. They are **not**
physical-device or production acceptance. The unauthenticated preview screenshot
only checked that the running sign-in screen loads; it is not documenter proof.
