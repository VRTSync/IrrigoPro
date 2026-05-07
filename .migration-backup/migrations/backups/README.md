# Migration Backups

This directory holds one-shot CSV dumps of data being dropped by destructive Drizzle migrations, kept for historical reference and recovery. Each file captures the affected rows immediately before the destructive migration runs in production, so the data is recoverable even after the column or table is gone. Files are produced via `COPY (SELECT ...) TO STDOUT WITH CSV HEADER` against the live database and committed alongside the schema change that necessitates them.
