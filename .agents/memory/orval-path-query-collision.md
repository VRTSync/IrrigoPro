---
name: Orval path and query naming
description: Avoid a generated export collision when one operation has path and query parameters.
---

Orval can give a path-parameter Zod schema and a query-parameter TypeScript type the same `*Params` export name. Re-exporting both generated barrels then fails with TS2308 even though generation succeeds.

**Why:** The API uses both barrels; adding a read with both kinds of parameters exposed this generator naming collision.

**How to apply:** Keep generated files untouched. If a route already reuses the canonical domain ID parser, disable Zod path-parameter generation for that operation only; keep its query/body/response generation. Otherwise give validation exports a separate naming boundary.
