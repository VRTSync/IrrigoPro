---
name: Composite tenant foreign-key rollout
description: Schema push ordering can add a composite foreign key before its required unique index exists.
---
Keep composite tenant foreign keys; inspect the schema change order before applying them.

**Why:** Development schema push attempted to add a customer/schedule composite foreign key before creating its referenced company/id unique index. PostgreSQL rejected the foreign key even though the final schema definition was valid.

**How to apply:** Provision the referenced unique indexes through the approved schema process before retrying the push, verify the actual constraints afterward, and run registered data seeds only after schema completion. Production preparation requires separate approval; development verification is not a production migration.

Use named UNIQUE constraints, rather than standalone unique indexes, for these referenced tenant keys. Declare their columns in physical table-column order when using the current Drizzle introspector.

**Why:** Drizzle excludes any index referenced by a constraint, including a foreign key, from its index snapshot. A standalone referenced index consequently disappears from introspection and the next push tries to recreate it. Its UNIQUE-constraint reader also returns columns in physical order, so a different declared order causes repeated constraint replacement.

**How to apply:** Attach an existing unique index as a UNIQUE constraint without dropping its foreign keys, keep the schema declaration aligned, and verify a repeated push succeeds. A single successful push does not establish repeatability.
