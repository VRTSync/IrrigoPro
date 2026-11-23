---
name: DB-free route tests with fixture rows
description: Stub db.select() with a table-aware chain and freeze Date, so route handlers can be tested on fixtures without the shared dev database.
---

Route handlers here can be exercised end-to-end — scope resolution, private
loaders, aggregation math, response shape — without Postgres, and without the
exact-count flakiness that the shared dev database causes.

**The stub.** Replace `db.select` with a Proxy chain whose `from(t)` records the
table and `where(c)` records the condition, and whose `then` resolves to fixture
rows chosen by that table. The projection object passed to `select()` can be
ignored; return rows already shaped with the field names the loader reads.

**Honouring scope filters.** Drizzle conditions are introspectable: an SQL object
carries `queryChunks`, `and()` nests further SQL objects inside them, a column
chunk has `.name` (snake_case) and `.table`, and a bound value is a `Param`
carrying both `value` and `encoder`. A plain `StringChunk` also has `value` but
no `encoder` — that pair is the discriminator. Walking the chunks lets the stub
apply the real tenancy filter instead of ignoring it, which is what makes
"company A cannot see company B's rows" a genuine assertion rather than a
tautology. Also gate on the referenced column name: several loaders query the
same table on different keys, and matching only on bound numbers makes an
invoice-id query accidentally return customer-scoped rows.

**Freezing the clock.** Handlers that call `new Date()` need a fixed instant for
day-of-month math. `mock.timers.enable({ apis: ["Date"], now })` from `node:test`
fixes the no-argument constructor while leaving `new Date(y, m, d)` and the
timers that HTTP depends on alone. Reset it in `after()`.

**Order matters:** patch `db.select` before `await import()`ing the route module,
or the module closes over the real one.

**Bootstrap is separate from requests.** Importing a route module can construct
storage and kick off asynchronous user seeding and startup migrations. Stub
those boot reads before the dynamic import (existing users and completed
migration markers), then restore the startup stubs before installing the
request fixtures. **Why:** otherwise a database-write spy can catch a late
bootstrap query and falsely attribute it to a read-only request.

**When a test doesn't need real storage at all:** mock the storage module
before dynamically importing the route, rather than patching methods on a
statically imported singleton. Use `node:test` module mocks with the matching
Node flag. This avoids boot-time connections that can keep the test process
alive even when every request-time storage method is stubbed.
