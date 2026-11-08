-- Migration 0031: Document System verification (Document System Slice 2)
ALTER TABLE irrigation_controllers
  ADD COLUMN IF NOT EXISTS field_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS field_verified_by_user_id integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS field_verified_by_name text;
ALTER TABLE irrigation_profile_zones
  ADD COLUMN IF NOT EXISTS zone_type_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE irrigation_backflows
  ADD COLUMN IF NOT EXISTS test_unknown_reason text,
  ADD COLUMN IF NOT EXISTS field_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS field_verified_by_user_id integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS field_verified_by_name text;
CREATE TABLE IF NOT EXISTS irrigation_site_documentation (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id),
  customer_id integer NOT NULL REFERENCES customers(id),
  branch_name text NOT NULL DEFAULT '',
  no_backflow_confirmed_at timestamptz,
  no_backflow_confirmed_by_user_id integer REFERENCES users(id),
  no_backflow_confirmed_by_name text,
  verified_at timestamptz,
  verified_by_user_id integer REFERENCES users(id),
  verified_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_irr_site_doc
  ON irrigation_site_documentation (company_id, customer_id, branch_name);
