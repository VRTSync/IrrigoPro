ALTER TABLE estimates ADD COLUMN IF NOT EXISTS origin_wet_check_id integer REFERENCES wet_checks(id);
