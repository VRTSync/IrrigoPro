---
name: Testable route extraction pattern
description: How to make inline routes.ts handlers testable without mounting full registerRoutes or mirroring logic.
---

## Rule
When a route handler needs a route-level regression test, extract it into `routes/<domain>-route.ts` that:
- Imports `storage` from `"../storage"` directly (not injected)
- Exports the Zod schema(s) and a `register*Routes(app, deps)` function
- Accepts auth/role helpers as `deps` (they're closures in registerRoutes)

**Why:** The 16k-line routes.ts monolith can't be partially-mounted for tests. Extracting
gives an importable seam. The test monkey-patches the `storage` singleton and imports
the real module — no handler logic is reimplemented in the test.

**How to apply:**
1. Create `artifacts/api-server/src/routes/<domain>-route.ts`; export schema(s) + `register<Domain>Routes(app, deps)`
2. In routes.ts: add `import { register<Domain>Routes } from "./<domain>-route"` and replace inline handlers with one call
3. Test: `import { register<Domain>Routes } from "./routes/<domain>-route"` + `import { storage } from "../storage"` + monkey-patch storage methods + mount with stub deps

Reference files: `routes/wet-check-photo-attach-route.ts` (photo attach), `routes/budget-routes.ts` (budget), `routes/wet-check-finding-patch.ts` (finding patch schema only).

Test runner: `node --import tsx/esm --test --test-reporter=spec "src/<test>.test.ts"` (not vitest in api-server).
