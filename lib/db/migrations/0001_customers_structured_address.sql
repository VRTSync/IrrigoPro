-- Task #347 — add structured address columns to `customers`.
--
-- Day-to-day this repo applies schema changes via
-- `pnpm --filter @workspace/db run push` (drizzle-kit push). This SQL
-- file is the explicit, hand-runnable equivalent for production
-- rollout and for any environment where running drizzle-kit isn't
-- desirable. It is safe to run once; re-running is a no-op thanks to
-- `IF NOT EXISTS`.
--
-- Rollout order:
--   1. Apply this migration on the deploy DB (or run
--      `pnpm --filter @workspace/db run push`).
--   2. Ship the application code that writes/reads the new columns.
--
-- All new columns are nullable. The legacy single-line `address`
-- column is preserved untouched so existing consumers (PDFs,
-- QuickBooks sync, list rows) keep working without any backfill.
-- Records that the user later edits will populate the structured
-- parts; a one-time backfill of legacy single-line addresses is
-- tracked separately as a follow-up task.

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "street" text;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "city" text;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "state" text;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "zip" text;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "country" text;
