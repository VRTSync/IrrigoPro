-- Slice 2A: Wet Check Capture
--
-- Forward-only Drizzle migration that creates the new tables, indexes,
-- foreign keys, and the photo single-target check constraint introduced
-- by Task #229. Statements use IF NOT EXISTS / guarded DO blocks so the
-- migration is safe to apply on environments where the runtime startup
-- migration in server/index.ts has already created some of these
-- objects. The startup SQL remains as a runtime safety net; this file
-- is the canonical, versioned schema artifact.

CREATE TABLE IF NOT EXISTS "issue_type_configs" (
        "id" serial PRIMARY KEY NOT NULL,
        "company_id" integer NOT NULL,
        "issue_type" text NOT NULL,
        "issue_group" text NOT NULL,
        "display_label" text NOT NULL,
        "default_labor_hours" numeric(5, 2) NOT NULL,
        "part_category_filter" text,
        "is_active" boolean DEFAULT true NOT NULL,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "property_controllers" (
        "id" serial PRIMARY KEY NOT NULL,
        "company_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "controller_letter" text NOT NULL,
        "zone_count" integer DEFAULT 100 NOT NULL,
        "notes" text,
        "controller_id" integer,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wet_checks" (
        "id" serial PRIMARY KEY NOT NULL,
        "company_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "technician_id" integer NOT NULL,
        "technician_name" text NOT NULL,
        "customer_name" text NOT NULL,
        "property_address" text,
        "num_controllers" integer NOT NULL,
        "status" text DEFAULT 'in_progress' NOT NULL,
        "weather" text,
        "notes" text,
        "started_at" timestamp DEFAULT now() NOT NULL,
        "submitted_at" timestamp,
        "approved_at" timestamp,
        "approved_by" integer,
        "approved_by_name" text,
        "fully_converted_at" timestamp,
        "client_id" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wet_check_zone_records" (
        "id" serial PRIMARY KEY NOT NULL,
        "wet_check_id" integer NOT NULL,
        "controller_letter" text NOT NULL,
        "zone_number" integer NOT NULL,
        "status" text DEFAULT 'not_checked' NOT NULL,
        "ran_successfully" boolean,
        "observed_pressure" numeric(6, 2),
        "observed_flow" numeric(6, 2),
        "notes" text,
        "checked_at" timestamp,
        "checked_by" integer,
        "client_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wet_check_findings" (
        "id" serial PRIMARY KEY NOT NULL,
        "zone_record_id" integer NOT NULL,
        "wet_check_id" integer NOT NULL,
        "issue_type" text NOT NULL,
        "issue_group" text NOT NULL,
        "severity" text,
        "part_id" integer,
        "part_name" text,
        "part_price" numeric(10, 2),
        "quantity" integer NOT NULL,
        "labor_hours" numeric(5, 2) NOT NULL,
        "notes" text,
        "resolution" text DEFAULT 'pending' NOT NULL,
        "resolution_decided_at" timestamp,
        "resolution_decided_by" integer,
        "billing_sheet_id" integer,
        "estimate_id" integer,
        "work_order_id" integer,
        "converted_at" timestamp,
        "client_id" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "wet_check_finding_single_target" CHECK ((
      (CASE WHEN "wet_check_findings"."billing_sheet_id" IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN "wet_check_findings"."estimate_id"     IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN "wet_check_findings"."work_order_id"    IS NULL THEN 0 ELSE 1 END)
    ) <= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wet_check_photos" (
        "id" serial PRIMARY KEY NOT NULL,
        "wet_check_id" integer NOT NULL,
        "zone_record_id" integer,
        "finding_id" integer,
        "url" text NOT NULL,
        "caption" text,
        "taken_at" timestamp DEFAULT now() NOT NULL,
        "taken_by" integer NOT NULL,
        "client_id" text
);
--> statement-breakpoint

-- Foreign keys (guarded so re-running the migration is safe).
DO $$ BEGIN
  ALTER TABLE "issue_type_configs" ADD CONSTRAINT "issue_type_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "property_controllers" ADD CONSTRAINT "property_controllers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "property_controllers" ADD CONSTRAINT "property_controllers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "property_controllers" ADD CONSTRAINT "property_controllers_controller_id_controllers_id_fk" FOREIGN KEY ("controller_id") REFERENCES "public"."controllers"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wet_checks" ADD CONSTRAINT "wet_checks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wet_checks" ADD CONSTRAINT "wet_checks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wet_checks" ADD CONSTRAINT "wet_checks_technician_id_users_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wet_checks" ADD CONSTRAINT "wet_checks_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wet_check_zone_records" ADD CONSTRAINT "wet_check_zone_records_wet_check_id_wet_checks_id_fk" FOREIGN KEY ("wet_check_id") REFERENCES "public"."wet_checks"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wet_check_zone_records" ADD CONSTRAINT "wet_check_zone_records_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wet_check_findings" ADD CONSTRAINT "wet_check_findings_zone_record_id_wet_check_zone_records_id_fk" FOREIGN KEY ("zone_record_id") REFERENCES "public"."wet_check_zone_records"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wet_check_findings" ADD CONSTRAINT "wet_check_findings_wet_check_id_wet_checks_id_fk" FOREIGN KEY ("wet_check_id") REFERENCES "public"."wet_checks"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wet_check_findings" ADD CONSTRAINT "wet_check_findings_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wet_check_findings" ADD CONSTRAINT "wet_check_findings_resolution_decided_by_users_id_fk" FOREIGN KEY ("resolution_decided_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wet_check_findings" ADD CONSTRAINT "wet_check_findings_billing_sheet_id_billing_sheets_id_fk" FOREIGN KEY ("billing_sheet_id") REFERENCES "public"."billing_sheets"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wet_check_findings" ADD CONSTRAINT "wet_check_findings_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wet_check_findings" ADD CONSTRAINT "wet_check_findings_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wet_check_photos" ADD CONSTRAINT "wet_check_photos_wet_check_id_wet_checks_id_fk" FOREIGN KEY ("wet_check_id") REFERENCES "public"."wet_checks"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wet_check_photos" ADD CONSTRAINT "wet_check_photos_zone_record_id_wet_check_zone_records_id_fk" FOREIGN KEY ("zone_record_id") REFERENCES "public"."wet_check_zone_records"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wet_check_photos" ADD CONSTRAINT "wet_check_photos_finding_id_wet_check_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."wet_check_findings"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wet_check_photos" ADD CONSTRAINT "wet_check_photos_taken_by_users_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Indexes (idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_issue_type" ON "issue_type_configs" USING btree ("company_id","issue_type");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_property_ctrl" ON "property_controllers" USING btree ("customer_id","controller_letter");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_wet_check_client_id" ON "wet_checks" USING btree ("client_id") WHERE "wet_checks"."client_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wet_checks_customer" ON "wet_checks" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wet_checks_status" ON "wet_checks" USING btree ("company_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_wet_check_zone" ON "wet_check_zone_records" USING btree ("wet_check_id","controller_letter","zone_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_zone_record_client_id" ON "wet_check_zone_records" USING btree ("client_id") WHERE "wet_check_zone_records"."client_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_findings_wet_check" ON "wet_check_findings" USING btree ("wet_check_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_findings_zone" ON "wet_check_findings" USING btree ("zone_record_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_finding_client_id" ON "wet_check_findings" USING btree ("client_id") WHERE "wet_check_findings"."client_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_photos_wet_check" ON "wet_check_photos" USING btree ("wet_check_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_photo_client_id" ON "wet_check_photos" USING btree ("client_id") WHERE "wet_check_photos"."client_id" IS NOT NULL;
