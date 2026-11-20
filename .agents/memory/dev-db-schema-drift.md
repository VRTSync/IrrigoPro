---
name: Shared dev database lags merged schema
description: Why a freshly merged feature's table can be missing at runtime, and why that is drift rather than a bug in your change.
---

# Shared dev database lags merged schema

DDL in this project is applied with drizzle push, not ordered migration files.
Nothing applies a merged task's schema to the shared dev database
automatically, so a feature can merge and its table can still not exist there.

**Symptom:** a route 500s with Postgres `42P01 relation "<table>" does not
exist` for a table that is plainly defined in the schema module, while that
feature's own test suite passes (integration suites create the tables they
need, and can drop them again on teardown).

**Rule: a 42P01 for a recently merged table or 42703 for a recently merged
column is environment drift when that object exists in the checked-out schema
but is missing in the database.** Do not adopt the missing DDL into your
task's diff.

**Why:** it is invisible in a code review of your branch, and it will reappear
in production on the next publish unless whoever owns that feature applies the
DDL. Silently "fixing" it inside an unrelated task hides that fact and makes
the real owner's gap harder to see.

**How to apply:** confirm the table really is absent for the *server's*
connection rather than trusting a query tool that may point elsewhere —
compare `current_database()` and `to_regclass('public.<table>')` from both
sides. If you need the endpoint working to finish your own verification,
create only the specific missing objects, and never run a full push whose diff
also drops or recreates constraints on unrelated tables. Then say plainly, in
the completion notes, that production still needs the same DDL.

If the same column is also missing in an artifact typecheck, treat that as a
separate dependency problem: PostgreSQL DDL does not rebuild the generated
workspace declarations, and rebuilding the declarations does not update the
database.

Prefer a disposable local PostgreSQL database when validating against current
schema would otherwise require changing shared development data.

**Why:** Tests can exercise real queries and browser sign-in without repairing
or replacing the project's database. A daemon started inside a finite shell
task can be stopped with that task, even when the shell exits successfully.

**How to apply:** Run PostgreSQL itself as the long-lived test process, push
the schema only to its loopback connection, and point test commands explicitly
at that database. Keep external senders disabled for fixture browser runs.
