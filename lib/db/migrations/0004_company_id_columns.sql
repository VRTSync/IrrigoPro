-- Auth & Tenancy Hardening — Slice 4: company_id columns on work_orders,
-- billing_sheets, invoices; NOT NULL tighten on estimates.
--
-- Steps:
--   (a) ADD COLUMN IF NOT EXISTS company_id on all four tables (nullable first).
--   (b) Backfill from the customer's company_id where the column is still NULL.
--   (c) Assert zero NULL rows remain across all four tables — abort if any exist.
--   (d) ALTER COLUMN company_id SET NOT NULL on all four tables.
--   (e) CREATE INDEX IF NOT EXISTS for all four new indexes.
--
-- Safe to re-run (all steps are idempotent).
-- Apply with: pnpm --filter @workspace/db run push
-- Or directly in production before routing traffic.

-- ── (a) Add nullable column ──────────────────────────────────────────────────

ALTER TABLE "work_orders"
  ADD COLUMN IF NOT EXISTS "company_id" integer REFERENCES "companies"("id");

ALTER TABLE "billing_sheets"
  ADD COLUMN IF NOT EXISTS "company_id" integer REFERENCES "companies"("id");

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "company_id" integer REFERENCES "companies"("id");

ALTER TABLE "estimates"
  ADD COLUMN IF NOT EXISTS "company_id" integer REFERENCES "companies"("id");

-- ── (b) Backfill from customer's company_id ─────────────────────────────────

UPDATE "work_orders" wo
  SET "company_id" = c."company_id"
  FROM "customers" c
  WHERE wo."customer_id" = c."id"
    AND wo."company_id" IS NULL;

UPDATE "billing_sheets" bs
  SET "company_id" = c."company_id"
  FROM "customers" c
  WHERE bs."customer_id" = c."id"
    AND bs."company_id" IS NULL;

UPDATE "invoices" inv
  SET "company_id" = c."company_id"
  FROM "customers" c
  WHERE inv."customer_id" = c."id"
    AND inv."company_id" IS NULL;

UPDATE "estimates" est
  SET "company_id" = c."company_id"
  FROM "customers" c
  WHERE est."customer_id" = c."id"
    AND est."company_id" IS NULL;

-- ── (c) Assert zero NULLs remain — abort if any found ───────────────────────

DO $$
DECLARE
  wo_nulls  integer;
  bs_nulls  integer;
  inv_nulls integer;
  est_nulls integer;
BEGIN
  SELECT COUNT(*) INTO wo_nulls  FROM "work_orders"    WHERE "company_id" IS NULL;
  SELECT COUNT(*) INTO bs_nulls  FROM "billing_sheets"  WHERE "company_id" IS NULL;
  SELECT COUNT(*) INTO inv_nulls FROM "invoices"        WHERE "company_id" IS NULL;
  SELECT COUNT(*) INTO est_nulls FROM "estimates"       WHERE "company_id" IS NULL;

  IF wo_nulls > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % work_orders rows still have NULL company_id', wo_nulls;
  END IF;
  IF bs_nulls > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % billing_sheets rows still have NULL company_id', bs_nulls;
  END IF;
  IF inv_nulls > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % invoices rows still have NULL company_id', inv_nulls;
  END IF;
  IF est_nulls > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % estimates rows still have NULL company_id', est_nulls;
  END IF;
END $$;

-- ── (d) Enforce NOT NULL ─────────────────────────────────────────────────────

ALTER TABLE "work_orders"    ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "billing_sheets" ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "invoices"       ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "estimates"      ALTER COLUMN "company_id" SET NOT NULL;

-- ── (e) Create indexes ───────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "work_orders_company_idx"
  ON "work_orders" ("company_id");

CREATE INDEX IF NOT EXISTS "work_orders_company_status_scheduled_idx"
  ON "work_orders" ("company_id", "status", "scheduled_date");

CREATE INDEX IF NOT EXISTS "billing_sheets_company_idx"
  ON "billing_sheets" ("company_id");

CREATE INDEX IF NOT EXISTS "invoices_company_idx"
  ON "invoices" ("company_id");
