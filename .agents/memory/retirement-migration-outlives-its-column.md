---
name: A retirement migration outlives the column it retires
description: Why a "zero grep hits" completion bar for a column drop must exempt the migration that retires the rows, and where the real gate sits.
---

## Rule
When a feature is retired in slices (code deletion, then the schema drop), the cleanup
migration that fixes up the affected rows is **not** part of the code being deleted. It reads
the doomed column through raw SQL, carries an explicit "this column no longer exists" branch,
and has to keep working on both sides of the drop. Its test file names the column for the same
reason. A completion criterion phrased as "the repo-wide grep for the retirement terms returns
zero hits" is therefore unsatisfiable as written — exempt the migration, its test, and the
`lib/db/migrations/*.sql` that added the column, and enumerate every exemption, rather than
deleting them to make a grep go green.

**Why:** The migration is the thing that gives the orphaned rows an explanation. Deleting it to
satisfy a grep removes the only mechanism that can still identify and retire them.

**How to apply:** Scope the grep, then list each exemption by name in the completion report — a
reviewer reads an unqualified "zero hits" as a claim about the whole tree and will reject it
when any hit survives. Prove the drop instead by typechecking and by reading
`information_schema.columns` / `pg_indexes` on the live database.

## Recording the drop in lib/db/migrations
Nothing applies these files automatically (`drizzle-kit push` against the schema is the real
applier, and a couple of tests read individual files), but they are the record of how the
database reached its shape, so a schema drop still gets a numbered forward file with idempotent
`DROP INDEX IF EXISTS` / `DROP COLUMN IF EXISTS`. Do **not** delete the migration that
originally added the object. The precedent is `0018_document_controller_fk_drop_legacy.sql`,
which records dropping the legacy prototype tables while the files that created them stay put.
Put the production gate in the new file's header comment, and name the neighbouring
columns/indexes that are deliberately *not* dropped — that comment is what stops a future
reader from widening the drop.

## Corollary — the gate is the production schema push, not the merge
`scripts/post-merge.sh` force-pushes schema to the **dev** database, so merging a column drop
applies it to dev immediately. Production schema is a separate, user-confirmed publish step.
So "do not drop the column until the data migration has run" is a gate on the *production
push*, never on the merge — and the drop can land in code and dev while the production side
stays blocked on an operator. Write the blocked state into the run-record doc; the code diff
cannot carry it.

## Verifying a drop
`drizzle-kit push` can exit 0 without applying a data-loss diff (hence `push-force`), so an
exit code proves nothing. Read the live database: the dropped column absent from
`information_schema.columns`, the dropped index absent from `pg_indexes`, and — just as
important — the *neighbouring* columns and indexes still present, since an over-wide deletion
range is the real risk when the column sits next to a live one.
