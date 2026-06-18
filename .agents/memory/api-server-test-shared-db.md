---
name: api-server test suite uses a shared dev DB
description: Why the full api-server test run is slow and why exact-count integration assertions can fail on leftover data rather than your change.
---

# api-server test suite: slow + shared dev DB

`pnpm --filter @workspace/api-server run test` runs every `src/**/*.test.ts`
with `node --test`. Two durable gotchas:

1. **It is slow (>110s total).** A 110s `timeout` will cut it off mid-run and
   every not-yet-finished file reports
   `Promise resolution is still pending but the event loop has already resolved`.
   That is the timeout, not a real failure. Run affected files individually
   (or in small groups) to verify, instead of relying on a single full run.

2. **Integration tests share the one dev DB** (`DATABASE_URL`). Many seed data
   via storage helpers and assert *exact* counts (e.g. billing-workspace queue
   WCB counts). Leftover rows from a previously interrupted run pollute the DB
   and make those exact-count assertions fail even on an unrelated change.
   Before blaming your edit, check whether the failing assertion is a global
   count and whether the table already has stray rows.

**How to apply:** verify with targeted file runs; treat full-suite timeouts and
exact-count integration failures as environmental until proven otherwise by an
isolated, clean-DB run. Source-scan tests (no DB) are the reliable guardrails.
