-- Mission 6 — Aspire Integration: aspire_crew_reference table
--
-- Lightweight reference table for Aspire crews. IrrigoPro is individual-based
-- (field_tech users), not crew-based. This table is purely for display /
-- reporting and does NOT attempt to reconcile crew membership with IrrigoPro
-- user accounts. irrigoEntity = 'aspire_crew' in aspire_entity_map.
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "aspire_crew_reference" (
  "id"           serial PRIMARY KEY,
  "company_id"   integer NOT NULL REFERENCES "companies"("id"),
  -- aspire_id mirrors what aspire_entity_map.aspire_id stores for this crew.
  "aspire_id"    text NOT NULL,
  "crew_name"    text NOT NULL,
  -- JSON array of member display-name strings from Aspire. Not FK references.
  "member_names" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "description"  text,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);

-- Business key: one row per Aspire crew per company.
CREATE UNIQUE INDEX IF NOT EXISTS "aspire_crew_reference_company_aspire_uniq"
  ON "aspire_crew_reference" ("company_id", "aspire_id");

-- Company-scoped scan (list all crews for a company).
CREATE INDEX IF NOT EXISTS "aspire_crew_reference_company_idx"
  ON "aspire_crew_reference" ("company_id");
