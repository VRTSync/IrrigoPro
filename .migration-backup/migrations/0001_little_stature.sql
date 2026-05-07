CREATE TABLE "photo_late_additions" (
        "id" serial PRIMARY KEY NOT NULL,
        "ticket_type" text NOT NULL,
        "ticket_id" integer NOT NULL,
        "ticket_number" text,
        "ticket_status_at_addition" text,
        "invoice_id_at_addition" integer,
        "company_id" integer,
        "actor_user_id" integer,
        "actor_name" text,
        "actor_role" text,
        "prior_photos" text[] DEFAULT ARRAY[]::text[] NOT NULL,
        "new_photos" text[] DEFAULT ARRAY[]::text[] NOT NULL,
        "added_photos" text[] DEFAULT ARRAY[]::text[] NOT NULL,
        "removed_photos" text[] DEFAULT ARRAY[]::text[] NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "uniq_property_ctrl";--> statement-breakpoint
ALTER TABLE "billing_sheets" ADD COLUMN "applied_labor_rate" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "internal_status" text DEFAULT 'pending_approval' NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "applied_labor_rate" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "property_controllers" ADD COLUMN "branch_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "photo_late_additions" ADD CONSTRAINT "photo_late_additions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_late_additions" ADD CONSTRAINT "photo_late_additions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photo_late_additions_ticket_idx" ON "photo_late_additions" USING btree ("ticket_type","ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_property_ctrl_branch" ON "property_controllers" USING btree ("customer_id","controller_letter","branch_name");