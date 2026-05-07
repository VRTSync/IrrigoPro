-- Task #358 — Billing Sheet Wizard With Required Pin
-- Add the five nullable site/pin columns to billing_sheets so the pin,
-- pinned address, and controller/zone captured by the new wizard (and
-- carried forward from the parent work order) actually persist.

ALTER TABLE "billing_sheets" ADD COLUMN IF NOT EXISTS "work_location_lat" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "billing_sheets" ADD COLUMN IF NOT EXISTS "work_location_lng" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "billing_sheets" ADD COLUMN IF NOT EXISTS "work_location_address" text;--> statement-breakpoint
ALTER TABLE "billing_sheets" ADD COLUMN IF NOT EXISTS "controller_letter" text;--> statement-breakpoint
ALTER TABLE "billing_sheets" ADD COLUMN IF NOT EXISTS "zone_number" integer;
