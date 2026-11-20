---
name: Orval path and query naming
description: Avoid a generated export collision when one operation has path and query parameters.
---

Orval can give a path-parameter Zod schema and a query-parameter TypeScript type the same `*Params` export name. Re-exporting both generated barrels then fails with TS2308 even though generation succeeds.

**Why:** The API uses both barrels; adding a read with both kinds of parameters exposed this generator naming collision.

**How to apply:** Keep generated files untouched. If a route already reuses the canonical domain ID parser, disable Zod path-parameter generation for that operation only; keep its query/body/response generation. Otherwise give validation exports a separate naming boundary.

Inherited, referenced query parameters also need expansion before generation. A successful build does not prove they were included in request URLs.

**Why:** Orval generated empty URL-parameter loops for referenced company scope even though hooks accepted a params object. Only a request-boundary test exposed the lost scope.

**How to apply:** Resolve parameter references and inherit them into operations in the source transformer, then test the actual generated URL for every scoped read and mutation.

Inline composed request bodies can cause the same collision under `*Body`, even without query parameters.

**Why:** Orval may emit both a Zod operation validator and a TypeScript type with the operation's body name.

**How to apply:** Put the composition in a distinctly named `components/schemas` entry and reference it from the operation. Run both generation and the composite library typecheck.
