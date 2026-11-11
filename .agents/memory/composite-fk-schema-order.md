---
name: Composite tenant foreign-key rollout
description: Schema push ordering can add a composite foreign key before its required unique index exists.
---
Keep composite tenant foreign keys; inspect the schema change order before applying them.

**Why:** Development schema push attempted to add a customer/schedule composite foreign key before creating its referenced company/id unique index. PostgreSQL rejected the foreign key even though the final schema definition was valid.

**How to apply:** Provision the referenced unique indexes through the approved schema process before retrying the push, verify the actual constraints afterward, and run registered data seeds only after schema completion. Production preparation requires separate approval; development verification is not a production migration.
