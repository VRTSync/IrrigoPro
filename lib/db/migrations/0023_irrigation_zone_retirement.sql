-- Migration 0023: irrigation zone retirement (Irrigation Build-Out Slice 1)
ALTER TABLE irrigation_profile_zones
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS retired_by_user_id integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS retired_by_name text;
CREATE INDEX IF NOT EXISTS irr_pzone_controller_current_idx
  ON irrigation_profile_zones (company_id, controller_id) WHERE retired_at IS NULL;
