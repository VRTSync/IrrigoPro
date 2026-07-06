-- Mission 4b — Aspire Integration: aspire_properties table
--
-- Adds the aspire_properties table that stores Aspire "property" child records
-- linked to IrrigoPro customers.  One property row exists per Aspire property
-- entity; identity-mapped via aspire_entity_map (irrigoEntity='aspire_property').
--
-- Design notes:
--   • branchName is nullable (NULL = single/primary property).  This follows the
--     NULL convention used by wet_checks.branch_name and site_maps — do NOT use
--     '' as the null-sentinel here (property_controllers is the legacy exception).
--   • companyId is NOT NULL; all reads must include a companyId WHERE clause.
--   • The table is purely additive — no existing tables are modified.
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Apply with:  pnpm --filter @workspace/db run push
--              OR  psql -f 0013_aspire_properties.sql

CREATE TABLE IF NOT EXISTS "aspire_properties" (
  "id"          serial PRIMARY KEY,
  "company_id"  integer NOT NULL REFERENCES "companies"("id"),
  "customer_id" integer NOT NULL REFERENCES "customers"("id"),
  -- nullable: NULL means single/primary property for this customer
  "branch_name" text,
  "street"      text,
  "city"        text,
  "state"       text,
  "zip"         text,
  "is_primary"  boolean NOT NULL DEFAULT false,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);

-- Primary lookup: property queries are always scoped to (company, customer).
CREATE INDEX IF NOT EXISTS "aspire_properties_company_customer_idx"
  ON "aspire_properties" ("company_id", "customer_id");

-- Business-key lookup: used by syncProperties to find existing rows before
-- inserting (avoids duplicates when branchName is the differentiator).
CREATE INDEX IF NOT EXISTS "aspire_properties_company_customer_branch_idx"
  ON "aspire_properties" ("company_id", "customer_id", "branch_name");

-- Company-scoped scan (e.g. list all properties per company dashboard).
CREATE INDEX IF NOT EXISTS "aspire_properties_company_idx"
  ON "aspire_properties" ("company_id");
