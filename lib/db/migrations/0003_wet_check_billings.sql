-- Task #783 — WC Billing Slice 10 schema foundation.
--
-- Creates the `wet_check_billings` table and adds nullable FK columns to
-- `invoice_items` and `wet_check_findings`. Pure additive DDL — no data
-- migration, no dropped columns, no behavior change.
--
-- Column set is intentionally minimal: the core billing fields + FK/audit
-- additions for Slices 11-16 (conversion, migration, HTTP, UI).
-- No per-finding columns (workDescription, laborMode, AI fields, location,
-- approvedPartsSnapshot/LaborSnapshot) — those live on wet_check_findings.
--
-- Apply with: pnpm --filter @workspace/db run push
-- Or apply directly in production before routing traffic.

CREATE TABLE IF NOT EXISTS "wet_check_billings" (
  "id" serial PRIMARY KEY,
  "billing_number" text NOT NULL UNIQUE,
  "customer_id" integer REFERENCES "customers"("id"),
  "customer_name" text NOT NULL,
  "property_address" text NOT NULL,
  "work_date" timestamp NOT NULL,
  "technician_name" text NOT NULL,
  "technician_id" integer REFERENCES "users"("id"),
  "wet_check_id" integer NOT NULL REFERENCES "wet_checks"("id"),
  "status" text NOT NULL DEFAULT 'submitted',
  "total_hours" numeric(5,2) NOT NULL,
  "labor_rate" numeric(10,2) NOT NULL,
  "labor_subtotal" numeric(10,2) NOT NULL,
  "parts_subtotal" numeric(10,2) NOT NULL,
  "total_amount" numeric(10,2) NOT NULL,
  "applied_labor_rate" numeric(10,2),
  "invoice_id" integer REFERENCES "invoices"("id"),
  "billed_at" timestamp,
  "photos" text[] DEFAULT '{}',
  "notes" text,
  "branch_name" text,
  "approved_by" text,
  "approved_by_user_id" integer REFERENCES "users"("id"),
  "approved_at" timestamp,
  "approved_total" numeric(10,2),
  "no_photos_needed" boolean NOT NULL DEFAULT false,
  "no_photos_needed_by" integer REFERENCES "users"("id"),
  "no_photos_needed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "wet_check_billings_customer_idx"
  ON "wet_check_billings" ("customer_id");

CREATE INDEX IF NOT EXISTS "wet_check_billings_technician_idx"
  ON "wet_check_billings" ("technician_id");

CREATE INDEX IF NOT EXISTS "wet_check_billings_wet_check_idx"
  ON "wet_check_billings" ("wet_check_id");

CREATE INDEX IF NOT EXISTS "wet_check_billings_invoice_idx"
  ON "wet_check_billings" ("invoice_id");

CREATE INDEX IF NOT EXISTS "wet_check_billings_status_created_idx"
  ON "wet_check_billings" ("status", "created_at");

ALTER TABLE "invoice_items"
  ADD COLUMN IF NOT EXISTS "wet_check_billing_id" integer
    REFERENCES "wet_check_billings"("id");

ALTER TABLE "wet_check_findings"
  ADD COLUMN IF NOT EXISTS "wet_check_billing_id" integer
    REFERENCES "wet_check_billings"("id");
