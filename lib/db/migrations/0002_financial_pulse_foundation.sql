-- Task #687 — Financial Pulse Slice 1 foundation.
--
-- Adds per-customer budget cap + alert routing columns, per-user hourly
-- wage, and a new idempotency table for budget alert events. All
-- additions are nullable or defaulted so this migration is a no-op
-- against existing rows.
--
-- Day-to-day this repo applies schema changes via
-- `pnpm --filter @workspace/db run push`. This file is the explicit,
-- hand-runnable equivalent for production rollout.

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "monthly_budget_cap" numeric(12,2),
  ADD COLUMN IF NOT EXISTS "annual_budget_cap"  numeric(12,2),
  ADD COLUMN IF NOT EXISTS "budget_soft_threshold_percent" integer DEFAULT 75,
  ADD COLUMN IF NOT EXISTS "budget_hard_threshold_percent" integer DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "budget_alert_recipient_user_ids" jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "budget_alert_channels" jsonb DEFAULT '{"inApp":true,"push":true,"email":false}'::jsonb,
  ADD COLUMN IF NOT EXISTS "budget_notify_customer_contact" boolean DEFAULT false;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "hourly_wage" numeric(10,2);

CREATE TABLE IF NOT EXISTS "customer_budget_alert_events" (
  "id" serial PRIMARY KEY,
  "customer_id" integer NOT NULL REFERENCES "customers"("id"),
  "period" text NOT NULL,
  "threshold" text NOT NULL,
  "period_key" text NOT NULL,
  "triggering_invoice_id" integer REFERENCES "invoices"("id"),
  "fired_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_budget_alert_events_unique_idx"
  ON "customer_budget_alert_events" ("customer_id", "period", "threshold", "period_key");

CREATE INDEX IF NOT EXISTS "customer_budget_alert_events_customer_idx"
  ON "customer_budget_alert_events" ("customer_id");
